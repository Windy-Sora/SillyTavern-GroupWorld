import test from 'node:test';
import assert from 'node:assert/strict';
import { createDisplayConfigStore } from '../../muyu/host/display-config.js';
import { DISPLAY_DEFAULTS, validateDisplayConfig } from '../../muyu/preferences/contract.js';
import { createProcessView } from '../../muyu/ui/process-view.js';

test('Display preferences validate narrowly and persist without credentials or grants', async () => {
    let settings = {}, saves = 0;
    const port = createDisplayConfigStore({ getSettings: () => settings, saveSettings: async () => { saves++; } });
    assert.deepEqual(port.read(), DISPLAY_DEFAULTS);
    for (const value of [null, [], { processDetail: 'unknown' }, { processDetail: 'compact', fullAccess: true }]) assert.throws(() => validateDisplayConfig(value));
    await port.save({ processDetail: 'standard' }); assert.equal(saves, 1);
    assert.equal(port.read().processDetail, 'standard'); assert.equal(settings.muyuDisplayConfigVersion, 1);
    assert.doesNotMatch(JSON.stringify(settings), /apiKey|permission|fullAccess/);
    settings = { muyuDisplayConfig: { processDetail: 'broken' } }; assert.deepEqual(port.read(), DISPLAY_DEFAULTS);
});
test('Failed display saving retains previous preference and concurrent unrelated settings', async () => {
    const previous = { processDetail: 'standard' }, settings = { muyuDisplayConfig: previous };
    const port = createDisplayConfigStore({ getSettings: () => settings, saveSettings: async () => { settings.other = 'keep'; throw Error('private'); } });
    await assert.rejects(port.save({ processDetail: 'verbose' }), /DISPLAY_CONFIG_SAVE_FAILED/);
    assert.equal(settings.muyuDisplayConfig, previous); assert.equal(settings.other, 'keep');
});
for (const lang of ['zh', 'en']) test('Process detail modes preserve errors, node identity, and the full source trace / ' + lang, () => {
    const doc = { createElement: tag => ({ tag, textContent: '', children: [], attrs: {}, setAttribute(key, value) { this.attrs[key] = value; }, append(el) { this.children.push(el); }, replaceChildren() { this.children = []; }, scrollTop: 0 }) };
    const rows = [
        { type: 'model.started', attemptId: 1, durationMs: null },
        { type: 'tool.requested', attemptId: 1, durationMs: null },
        { type: 'tool.failed', attemptId: 1, durationMs: 2, error: 'PERMISSION_DENIED' },
        { type: 'model.completed', attemptId: 2, durationMs: 3, read: { source: 'recentMessages', status: 'ok', characters: 10 } },
    ];
    const run = { id: 'r', process: { phase: 'succeeded', cleaned: true, terminal: 'succeeded', toolFailures: 1, rows } };
    const source = JSON.stringify(run), view = createProcessView({ doc, lang });
    const compact = view.update(run, true, false, 'compact'); compact.open = true;
    assert.equal(compact.children[1].children.length, 2);
    assert.match(compact.children[0].textContent, lang === 'en' ? /failures or rejections/ : /失败或拒绝/);
    const standard = view.update(run, true, false, 'standard'); assert.equal(standard, compact); assert.equal(standard.open, true);
    assert.equal(standard.children[1].children.length, 2);
    assert.equal(view.update(run, true, false, 'detailed').children[1].children.length, 4);
    assert.equal(view.update(run, true, false, 'verbose').children[1].children.length, 5);
    assert.equal(JSON.stringify(run), source);
    rows.unshift({ type: 'tool.completed', attemptId: 3, durationMs: 1, read: { source: 'memoryConfig', status: 'INVALID_READ_ARGUMENTS', characters: 0 } });
    run.process.toolFailures = 0;
    const warning = view.update(run, true, false, 'compact');
    assert.equal(warning.children[1].children.length, 4);
    assert.match(warning.children[0].textContent, lang === 'en' ? /Includes read error records/ : /存在资料读取异常记录/);
});
