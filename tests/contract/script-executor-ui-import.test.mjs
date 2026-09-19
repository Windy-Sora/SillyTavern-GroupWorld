import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('script executor UI delegates import and export mutations to the system boundary', async () => {
    const source = await readFile(new URL('../../ui/sections/scriptExecutors.js', import.meta.url), 'utf8');
    const exportHandler = source.slice(source.indexOf("$c('se-export-btn')"), source.indexOf('// ── Import'));
    const importHandler = source.slice(source.indexOf("$('#gd-se-import-file')"), source.indexOf('function escHtml'));

    assert.match(exportHandler, /sys\.createExportData\(\)/);
    assert.match(importHandler, /await sys\.importExecutors\(data/);
    assert.doesNotMatch(importHandler, /sys\.(?:add|remove)\(/);
    assert.doesNotMatch(importHandler, /flushEditToModel\(/);
    assert.ok(importHandler.indexOf('await sys.importExecutors') < importHandler.indexOf('toastr.success'));
});

test('script executor UI awaits CRUD persistence before refreshing and reports failures', async () => {
    const source = await readFile(new URL('../../ui/sections/scriptExecutors.js', import.meta.url), 'utf8');
    for (const call of [
        'sys.add(', 'sys.update(', 'sys.remove(', 'sys.toggle(',
    ]) {
        const awaited = source.split(`await ${call}`).length - 1;
        const all = source.split(call).length - 1;
        assert.equal(awaited, all, `${call} must always be awaited`);
    }
    assert.match(source, /async function flushEditToModel\(\)/);
    assert.match(source, /catch \(error\) \{\s*toastr\.warning/);
});
