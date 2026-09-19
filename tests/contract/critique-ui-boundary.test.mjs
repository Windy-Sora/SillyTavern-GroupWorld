import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('critique UI delegates result mutations and parsing to the system boundary', async () => {
    const source = await readFile(new URL('../../ui/sections/critique.js', import.meta.url), 'utf8');
    assert.match(source, /cs\.updateActiveContent\(text\)/);
    assert.match(source, /catch \(error\)[\s\S]*Critique update failed/);
    assert.doesNotMatch(source, /active\.(content|data)\s*=/);
    assert.doesNotMatch(source, /JSON\.parse\(/);
    assert.doesNotMatch(source, /saveChatConditional/);
});
