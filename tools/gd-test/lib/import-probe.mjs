import path from 'node:path';
import { pathToFileURL } from 'node:url';

const target = process.argv[2];
if (!target) {
    console.error('Usage: node import-probe.mjs <module>');
    process.exitCode = 2;
} else {
    try {
        const module = await import(pathToFileURL(path.resolve(target)).href);
        const invalidExports = Object.entries(module)
            .filter(([, value]) => value === undefined)
            .map(([name]) => name);
        if (invalidExports.length) {
            throw new Error(`Undefined exports: ${invalidExports.join(', ')}`);
        }
        process.stdout.write(JSON.stringify({ exports: Object.keys(module).sort() }));
    } catch (error) {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    }
}
