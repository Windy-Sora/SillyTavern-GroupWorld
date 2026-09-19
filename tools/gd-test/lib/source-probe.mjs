import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parse } from 'acorn';

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
        const pending = [parse(source, { ecmaVersion: 'latest', sourceType: 'module' })];
        while (pending.length) {
            const node = pending.pop();
            if (node.type === 'ImportExpression') {
                if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
                    imports.push(node.source.value);
                } else if (node.source.type === 'TemplateLiteral' && node.source.expressions.length === 0) {
                    imports.push(node.source.quasis[0].value.cooked ?? node.source.quasis[0].value.raw);
                }
            }
            for (const value of Object.values(node)) {
                if (Array.isArray(value)) pending.push(...value.filter(item => item && typeof item.type === 'string'));
                else if (value && typeof value.type === 'string') pending.push(value);
            }
        }
        process.stdout.write(JSON.stringify({
            imports,
        }));
    } catch (error) {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    }
}
