import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isInside, relativePath, walkFiles } from '../lib/files.mjs';
import { mapLimit, runCommand } from '../lib/process.mjs';

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));

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

function traverse(graph, startFiles) {
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

export async function buildProjectIndex(root, config) {
    const sourceExtensions = new Set(config.sourceExtensions);
    const jsonExtensions = new Set(config.jsonExtensions);
    const allFiles = await walkFiles(root, { excludeDirectories: config.excludeDirectories });
    const sourceFiles = allFiles.filter(file => sourceExtensions.has(path.extname(file).toLowerCase()));
    const jsonFiles = allFiles.filter(file => jsonExtensions.has(path.extname(file).toLowerCase()));

    const sourceProbe = path.resolve(toolDirectory, '../lib/source-probe.mjs');
    const syntaxResults = await mapLimit(
        sourceFiles,
        config.staticChecks.syntaxConcurrency || 4,
        file => runCommand(process.execPath, [
            '--no-warnings',
            '--experimental-vm-modules',
            sourceProbe,
            file,
        ], { cwd: root, timeoutMs: 30_000 }),
    );
    const probeByFile = new Map();
    syntaxResults.forEach((result, index) => {
        const file = sourceFiles[index];
        if (result.code !== 0) {
            probeByFile.set(file, {
                ok: false,
                error: (result.stderr || result.stdout || 'Syntax check failed').trim(),
                imports: [],
            });
            return;
        }
        try {
            const parsed = JSON.parse(result.stdout);
            probeByFile.set(file, { ok: true, imports: parsed.imports || [] });
        } catch (error) {
            probeByFile.set(file, { ok: false, error: `Invalid source-probe output: ${error.message}`, imports: [] });
        }
    });

    const sources = new Map();
    for (const file of sourceFiles) sources.set(file, await readFile(file, 'utf8'));

    const jsonResults = new Map();
    for (const file of jsonFiles) {
        const rel = relativePath(root, file);
        try {
            const text = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '');
            jsonResults.set(rel, { ok: true, value: JSON.parse(text) });
        } catch (error) {
            jsonResults.set(rel, { ok: false, error: error.message });
        }
    }
    const manifest = jsonResults.get('manifest.json')?.value;

    const importRecords = [];
    const directHostDependent = new Set();
    let internalImports = 0;
    let hostImports = 0;
    let packageImports = 0;
    for (const file of sourceFiles) {
        const source = sources.get(file);
        for (const specifier of probeByFile.get(file)?.imports || []) {
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
            const offset = source.indexOf(specifier);
            importRecords.push({
                importer: file,
                importerRelative: relativePath(root, file),
                specifier,
                resolved: await resolveRelativeImport(file, specifier),
                line: offset >= 0 ? source.slice(0, offset).split(/\r?\n/).length : null,
            });
        }
    }

    const graph = new Map(sourceFiles.map(file => [file, []]));
    for (const record of importRecords) {
        if (record.resolved && graph.has(record.resolved)) graph.get(record.importer).push(record.resolved);
    }
    const entryRoots = new Set();
    if (typeof manifest?.js === 'string' && manifest.js.trim()) {
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
    const entryReachable = traverse(graph, entryRoots);
    const testReachable = traverse(graph, testRoots);
    const reachable = new Set([...entryReachable, ...testReachable, ...traverse(graph, toolRoots)]);

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
    const smokeSkipped = sourceFiles.filter(file => {
        const rel = relativePath(root, file);
        return smokeRoots.some(prefix => rel.startsWith(prefix)) && hostDependent.has(file);
    });
    const productionFiles = sourceFiles.filter(file => {
        const rel = relativePath(root, file);
        return !rel.startsWith('tests/') && !rel.startsWith('tools/');
    });

    return Object.freeze({
        root,
        config,
        allFiles,
        sourceFiles,
        jsonFiles,
        sources,
        probeByFile,
        jsonResults,
        manifest,
        importRecords,
        graph,
        reachable,
        entryReachable,
        testReachable,
        hostDependent,
        smokeCandidates,
        smokeSkipped,
        productionFiles,
        importCounts: { internalImports, hostImports, packageImports },
    });
}

export const projectServices = Object.freeze({
    exists,
    mapLimit,
    relativePath,
    runCommand,
});
