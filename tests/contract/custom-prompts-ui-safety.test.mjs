import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('custom prompt UI awaits every persistence mutation before reporting success', async () => {
    const source = await readFile(new URL('../../ui/sections/customPrompts.js', import.meta.url), 'utf8');
    for (const call of [
        'sys.setMasterEnabled(on)',
        'sys.update(id, { name, content, dataJson, scope })',
        'sys.toggle(id)',
        'sys.remove(id)',
        'sys.add(name, content, true, { dataJson, scope })',
        'sys.importPrompts(result.data, overwrite)',
    ]) {
        assert.match(source, new RegExp(`await\\s+${call.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    }
    assert.match(source, /reader\.onerror\s*=/);
    assert.match(source, /sys\.exportPrompts\([\s\S]*?catch\s*\(error\)/);
});
