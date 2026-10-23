import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'acorn';

test('Muyu core stays host-independent; production entry delegates mounting to UI', () => {
    for (const name of fs.readdirSync(new URL('../../muyu/core/', import.meta.url)).filter(n => n.endsWith('.js'))) {
        const source = fs.readFileSync(new URL('../../muyu/core/' + name, import.meta.url), 'utf8');
        const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
        for (const item of ast.body.filter(n => n.type === 'ImportDeclaration')) assert.match(item.source.value, /^\.\/[^/]+\.js$/);
        assert.doesNotMatch(source, /\b(?:window|document|localStorage|fetch)\s*[.(]/);
    }
    const entry = fs.readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
    assert.doesNotMatch(entry, /from\s+['"][^'"]*muyu\//);
});
