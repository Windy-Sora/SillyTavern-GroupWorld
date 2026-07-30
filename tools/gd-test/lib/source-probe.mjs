import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const target = process.argv[2];
if (!target) {
    console.error('Usage: node source-probe.mjs <module>');
    process.exitCode = 2;
} else {
    try {
        const source = (await readFile(target, 'utf8')).replace(/^#![^\r\n]*(?:\r?\n|$)/, '');
        const module = new vm.SourceTextModule(source, { identifier: target });
        const imports = Array.isArray(module.moduleRequests)
            ? module.moduleRequests.map(request => request.specifier)
            : [...module.dependencySpecifiers];
        process.stdout.write(JSON.stringify({
            imports,
        }));
    } catch (error) {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    }
}
