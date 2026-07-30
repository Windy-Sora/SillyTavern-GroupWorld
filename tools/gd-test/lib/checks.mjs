import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isInside, relativePath, walkFiles } from './files.mjs';
import { mapLimit, runCommand } from './process.mjs';

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));

function issue(severity, code, file, message, line = null) {
    return { severity, code, file, line, message };
}

async function exists(filePath) {
    try {
        return (await stat(filePath)).isFile();
    } catch {
        return false;
    }
}

async function resolveRelativeImport(importer, specifier) {
    const base = path.resolve(path.dirname(importer), specifier);
    const candidates = path.extname(base)
        ? [base]
        : [base, `${base}.js`, `${base}.mjs`, path.join(base, 'index.js'), path.join(base, 'index.mjs')];
    for (const candidate of candidates) {
        if (await exists(candidate)) return candidate;
    }
    return null;
}

function findLine(source, offset) {
    return source.slice(0, offset).split(/\r?\n/).length;
}

export async function runStaticChecks(root, config) {
    const startedAt = Date.now();
    const sourceExtensions = new Set(config.sourceExtensions);
    const jsonExtensions = new Set(config.jsonExtensions);
    const allFiles = await walkFiles(root, {
        excludeDirectories: config.excludeDirectories,
    });
    const sourceFiles = allFiles.filter(file => sourceExtensions.has(path.extname(file).toLowerCase()));
    const jsonFiles = allFiles.filter(file => jsonExtensions.has(path.extname(file).toLowerCase()));
    const issues = [];

    const sourceProbe = path.join(toolDirectory, 'source-probe.mjs');
    const syntaxResults = await mapLimit(
        sourceFiles,
        config.staticChecks.syntaxConcurrency || 4,
        file => runCommand(process.execPath, [
            '--no-warnings',
            '--experimental-vm-modules',
            sourceProbe,
            file,
        ], {
            cwd: root,
            timeoutMs: 30_000,
        }),
    );
    const importsByFile = new Map();
    syntaxResults.forEach((result, index) => {
        if (result.code !== 0) {
            issues.push(issue(
                'error',
                'JS_SYNTAX',
                relativePath(root, sourceFiles[index]),
                (result.stderr || result.stdout || 'Syntax check failed').trim(),
            ));
            importsByFile.set(sourceFiles[index], []);
            return;
        }
        try {
            const parsed = JSON.parse(result.stdout);
            importsByFile.set(sourceFiles[index], parsed.imports || []);
        } catch (error) {
            issues.push(issue(
                'error',
                'SOURCE_PROBE',
                relativePath(root, sourceFiles[index]),
                `Invalid source-probe output: ${error.message}`,
            ));
            importsByFile.set(sourceFiles[index], []);
        }
    });

    const parsedJson = new Map();
    for (const file of jsonFiles) {
        const rel = relativePath(root, file);
        try {
            const text = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '');
            parsedJson.set(rel, JSON.parse(text));
        } catch (error) {
            issues.push(issue('error', 'JSON_PARSE', rel, error.message));
        }
    }

    const manifest = parsedJson.get('manifest.json');
    if (!manifest) {
        issues.push(issue('error', 'MANIFEST_MISSING', 'manifest.json', 'Missing or invalid manifest.json'));
    } else {
        for (const key of ['display_name', 'loading_order', 'js', 'css', 'version']) {
            if (manifest[key] === undefined || manifest[key] === '') {
                issues.push(issue('error', 'MANIFEST_FIELD', 'manifest.json', `Required field "${key}" is missing`));
            }
        }
        if (manifest.js && !(await exists(path.resolve(root, manifest.js)))) {
            issues.push(issue('error', 'MANIFEST_ENTRY', 'manifest.json', `JavaScript entry does not exist: ${manifest.js}`));
        }
        if (manifest.css && !(await exists(path.resolve(root, manifest.css)))) {
            issues.push(issue('error', 'MANIFEST_ENTRY', 'manifest.json', `CSS entry does not exist: ${manifest.css}`));
        }
        if (manifest.version && !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version)) {
            issues.push(issue('warning', 'MANIFEST_VERSION', 'manifest.json', `Version is not SemVer-like: ${manifest.version}`));
        }
    }

    const sourceByFile = new Map();
    for (const file of sourceFiles) {
        sourceByFile.set(file, await readFile(file, 'utf8'));
    }

    let internalImports = 0;
    let hostImports = 0;
    let packageImports = 0;
    const importRecords = [];
    const directHostDependent = new Set();
    for (const file of sourceFiles) {
        const rel = relativePath(root, file);
        const source = sourceByFile.get(file);

        if (config.staticChecks.checkMergeMarkers) {
            const marker = /^(?:<<<<<<<|=======|>>>>>>>)(?:\s|$)/m.exec(source);
            if (marker) {
                issues.push(issue('error', 'MERGE_MARKER', rel, 'Unresolved merge-conflict marker', findLine(source, marker.index)));
            }
        }
        if (config.staticChecks.checkReplacementCharacters) {
            const replacement = source.indexOf('\uFFFD');
            if (replacement >= 0) {
                issues.push(issue('warning', 'ENCODING_REPLACEMENT', rel, 'Contains Unicode replacement character U+FFFD', findLine(source, replacement)));
            }
        }

        if (!config.staticChecks.checkRelativeImports) continue;
        for (const specifier of importsByFile.get(file) || []) {
            if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
                packageImports++;
                continue;
            }
            const unresolvedBase = path.resolve(path.dirname(file), specifier);
            if (!isInside(root, unresolvedBase)) {
                hostImports++;
                directHostDependent.add(file);
                continue;
            }
            internalImports++;
            importRecords.push({
                importer: file,
                importerRelative: rel,
                specifier,
                resolved: await resolveRelativeImport(file, specifier),
                line: source.indexOf(specifier) >= 0 ? findLine(source, source.indexOf(specifier)) : null,
            });
        }
    }

    // Missing imports in code reachable from the manifest, test files, or tools
    // are fatal. Orphaned legacy files remain visible as warnings without
    // permanently blocking the active extension's test pipeline.
    const graph = new Map(sourceFiles.map(file => [file, []]));
    for (const record of importRecords) {
        if (record.resolved && graph.has(record.resolved)) {
            graph.get(record.importer).push(record.resolved);
        }
    }
    const entryRoots = new Set();
    if (manifest?.js) {
        const entry = path.resolve(root, manifest.js);
        if (graph.has(entry)) entryRoots.add(entry);
    }
    const testRoots = new Set();
    const toolRoots = new Set();
    for (const file of sourceFiles) {
        const rel = relativePath(root, file);
        if (rel.startsWith('tests/')) testRoots.add(file);
        if (rel.startsWith('tools/')) toolRoots.add(file);
    }

    function traverse(startFiles) {
        const visited = new Set();
        const pending = [...startFiles];
        while (pending.length) {
            const file = pending.shift();
            if (visited.has(file)) continue;
            visited.add(file);
            for (const dependency of graph.get(file) || []) pending.push(dependency);
        }
        return visited;
    }
    const entryReachable = traverse(entryRoots);
    const testReachable = traverse(testRoots);
    const reachable = new Set([...entryReachable, ...testReachable, ...traverse(toolRoots)]);
    for (const record of importRecords) {
        if (record.resolved) continue;
        const active = reachable.has(record.importer);
        issues.push(issue(
            active ? 'error' : 'warning',
            active ? 'IMPORT_MISSING' : 'IMPORT_MISSING_ORPHAN',
            record.importerRelative,
            `Relative import cannot be resolved: ${record.specifier}`,
            record.line,
        ));
    }

    // Import host-independent production modules in isolated Node processes.
    // This catches top-level ReferenceErrors and broken export initialization
    // that syntax parsing alone cannot detect.
    const hostDependent = new Set(directHostDependent);
    let changed = true;
    while (changed) {
        changed = false;
        for (const [importer, dependencies] of graph) {
            if (hostDependent.has(importer)) continue;
            if (dependencies.some(dependency => hostDependent.has(dependency))) {
                hostDependent.add(importer);
                changed = true;
            }
        }
    }
    const smokeRoots = (config.staticChecks.moduleSmokeRoots || [])
        .map(directory => `${directory.replaceAll('\\', '/')}/`);
    const smokeCandidates = sourceFiles.filter(file => {
        const rel = relativePath(root, file);
        return smokeRoots.some(prefix => rel.startsWith(prefix)) && !hostDependent.has(file);
    });
    const importProbe = path.join(toolDirectory, 'import-probe.mjs');
    const smokeResults = await mapLimit(
        smokeCandidates,
        config.staticChecks.moduleSmokeConcurrency || 4,
        file => runCommand(process.execPath, [importProbe, file], {
            cwd: root,
            timeoutMs: 15_000,
        }),
    );
    smokeResults.forEach((result, index) => {
        if (result.code !== 0) {
            issues.push(issue(
                'error',
                'MODULE_IMPORT',
                relativePath(root, smokeCandidates[index]),
                (result.stderr || result.stdout || 'Module import smoke test failed').trim(),
            ));
        }
    });

    const productionFiles = sourceFiles.filter(file => {
        const rel = relativePath(root, file);
        return !rel.startsWith('tests/') && !rel.startsWith('tools/');
    });
    const productionSet = new Set(productionFiles);
    const countProduction = visited => [...visited].filter(file => productionSet.has(file)).length;

    const errors = issues.filter(item => item.severity === 'error').length;
    const warnings = issues.length - errors;
    return {
        name: 'static',
        ok: errors === 0,
        durationMs: Date.now() - startedAt,
        counts: {
            sourceFiles: sourceFiles.length,
            jsonFiles: jsonFiles.length,
            internalImports,
            hostImports,
            packageImports,
            moduleSmokeChecked: smokeCandidates.length,
            moduleSmokeSkipped: sourceFiles.filter(file => {
                const rel = relativePath(root, file);
                return smokeRoots.some(prefix => rel.startsWith(prefix)) && hostDependent.has(file);
            }).length,
            productionModules: productionFiles.length,
            entryReachableModules: countProduction(entryReachable),
            testReachableModules: countProduction(testReachable),
            errors,
            warnings,
        },
        issues,
    };
}
