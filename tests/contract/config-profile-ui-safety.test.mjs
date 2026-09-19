import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('config profile apply handler reports failures before success refreshes', async () => {
    const source = await readFile(new URL('../../ui/sections/configProfiles.js', import.meta.url), 'utf8');
    const handler = source.slice(
        source.indexOf("$list.find('.gd-cfg-apply-btn')"),
        source.indexOf('// Export'),
    );

    assert.match(handler, /try\s*\{/);
    assert.match(handler, /await\s+sys\.applyProfile\(id, mergeMode\)/);
    assert.match(handler, /catch\s*\(e\)\s*\{[\s\S]*toastr\.error/);
    assert.ok(handler.indexOf("let mergeMode = 'keep'") < handler.indexOf('try {'));
    assert.ok(handler.indexOf('sys.applyProfile') < handler.indexOf('__gdRefreshDashboard'));
    assert.ok(handler.indexOf('__gdRefreshDashboard') < handler.indexOf('toastr.success'));
});

test('dashboard profile handlers await application before reporting success', async () => {
    for (const relativePath of ['../../ui/sections/dashboard.js', '../../dashboard.js']) {
        const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
        assert.match(source, /await\s+ctx\.configProfileSystem\?\.applyProfile\(id\)/);
        assert.match(source, /await\s+ctx\.configProfileSystem\?\.applyProfile\(profile\.id\)/);
    }
});

test('config profile save and delete handlers report persistence failures before refreshing', async () => {
    const source = await readFile(new URL('../../ui/sections/configProfiles.js', import.meta.url), 'utf8');
    const deleting = source.slice(
        source.indexOf("$list.find('.gd-cfg-delete-btn')"),
        source.indexOf('// Save current'),
    );
    const saving = source.slice(
        source.indexOf("$c('cfg-save-btn')"),
        source.indexOf('// Import .zip'),
    );

    for (const [handler, operation] of [
        [deleting, 'sys.deleteProfile'],
        [saving, 'sys.saveCurrentAsProfile'],
    ]) {
        assert.match(handler, /try\s*\{/);
        assert.match(handler, /catch\s*\(e\)\s*\{[\s\S]*toastr\.error/);
        assert.ok(handler.indexOf(operation) < handler.indexOf('renderList'));
        assert.ok(handler.indexOf('toastr.error') < handler.indexOf('renderList'));
    }
});
