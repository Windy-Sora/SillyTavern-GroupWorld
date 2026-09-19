import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('dashboard NPC library delete waits for rejection and reports failure', async () => {
    const source = await readFile(new URL('../../ui/sections/dashboard.js', import.meta.url), 'utf8');
    const start = source.indexOf('    function appendNpcLibraryToolbar(');
    const end = source.indexOf('    function renderPanelLedger(', start);
    assert.ok(start >= 0 && end > start);
    let rejectSave;
    const save = new Promise((_, reject) => { rejectSave = reject; });
    const entry = { id: 'pack', name: 'Pack' };
    const handlers = new Map();
    const notices = [];
    let refreshes = 0;
    const selection = {
        val(value) { return value === undefined ? 'pack' : this; },
        append() { return this; },
        on(event, handler) { handlers.set(`${this.key}:${event}`, handler); return this; },
        find(key) { return Object.assign(Object.create(selection), { key }); },
    };
    const context = {
        npcLibrarySystem: {
            getLibraries: () => [entry], getLibrary: () => entry,
            deleteLibrary: () => save,
        },
        lang: 'en', $: key => Object.assign(Object.create(selection), { key }),
        esc: String, escPopup: String, openSettingsLabel: () => 'Settings',
        callGenericPopup: async () => true, POPUP_TYPE: { CONFIRM: 1 },
        toastr: {
            success: message => notices.push(['success', message]),
            error: message => notices.push(['error', message]),
        },
        window: { __gdRefreshNpcLibrary: () => { refreshes++; } },
        refreshDashboardAndOpenPanel: () => { refreshes++; },
    };
    vm.runInNewContext(source.slice(start, end), context);
    context.appendNpcLibraryToolbar(selection);
    const pending = handlers.get('.gd-dash-panel-npc-library-delete:click')();
    await Promise.resolve();
    assert.deepEqual(notices, []);
    assert.equal(refreshes, 0);
    rejectSave(new Error('disk unavailable'));
    await pending;
    assert.deepEqual(notices.map(([kind]) => kind), ['error']);
    assert.equal(refreshes, 2);
});
