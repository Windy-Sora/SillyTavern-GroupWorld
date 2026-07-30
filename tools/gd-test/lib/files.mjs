import { readdir } from 'node:fs/promises';
import path from 'node:path';

export function toPosix(filePath) {
    return filePath.split(path.sep).join('/');
}

export function relativePath(root, filePath) {
    return toPosix(path.relative(root, filePath));
}

export function isInside(root, candidate) {
    const rel = path.relative(root, candidate);
    return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

export async function walkFiles(root, {
    excludeDirectories = [],
    predicate = () => true,
} = {}) {
    const excluded = new Set(excludeDirectories);
    const files = [];

    async function visit(directory) {
        const entries = await readdir(directory, { withFileTypes: true });
        entries.sort((a, b) => a.name.localeCompare(b.name));

        for (const entry of entries) {
            if (entry.isDirectory() && excluded.has(entry.name)) continue;
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                await visit(fullPath);
            } else if (entry.isFile() && predicate(fullPath)) {
                files.push(fullPath);
            }
        }
    }

    await visit(root);
    return files;
}

export async function discoverTests(root, config, suiteNames) {
    const files = [];
    for (const suiteName of suiteNames) {
        const directories = config.suites[suiteName] || [];
        for (const relativeDirectory of directories) {
            const directory = path.resolve(root, relativeDirectory);
            try {
                const discovered = await walkFiles(directory, {
                    excludeDirectories: config.excludeDirectories,
                    predicate: file => config.testFilePattern.test(file),
                });
                for (const file of discovered) files.push({ suite: suiteName, file });
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
        }
    }
    return files;
}
