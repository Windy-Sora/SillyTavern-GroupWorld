import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
const read = relativePath => readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

test('settings template, section registration, and variable runtime stay assembled', async () => {
    const [template, settingsInit, index] = await Promise.all([
        read('settings.html'),
        read('ui/settings-init.js'),
        read('index.js'),
    ]);

    assert.match(template, /data-card="variables"/);
    assert.match(template, /id="gd-var-list"/);
    assert.match(settingsInit, /import '\.\/sections\/variables\.js';/);
    assert.match(index, /createVariableSystem\s*\(/);
    assert.match(index, /variableSystem/);
});

test('cross-brand template and profile loading retain both compatible directories', async () => {
    const [settingsInit, profiles] = await Promise.all([
        read('ui/settings-init.js'),
        read('systems/config-profile-system.js'),
    ]);

    for (const source of [settingsInit, profiles]) {
        assert.match(source, /SillyTavern-GroupDirector/);
        assert.match(source, /SillyTavern-GroupWorld/);
    }
    assert.match(settingsInit, /renderSettingsTemplate/);
    assert.match(profiles, /assets\/profiles\/\$\{name\}\.json/);
});
