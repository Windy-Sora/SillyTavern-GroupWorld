import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function sectionHarness(overrides = {}, list = []) {
    const source = (await readFile(new URL('../../ui/sections/summaryExport.js', import.meta.url), 'utf8'))
        .replace(/^import .*;\r?\n/gm, '');
    const handlers = new Map();
    const notices = [];
    let section;
    let fileRead;
    const controls = name => ({
        off() { return this; },
        on(event, handler) { handlers.set(`${name}:${event}`, handler); return this; },
        val() { return ''; },
        addClass() { return this; }, removeClass() { return this; }, css() { return this; },
    });
    const system = {
        getImportedSummaries: () => list,
        getActiveLiveSummary: () => ({ content: 'ready' }),
        parseImportFile: () => ({ ok: true, data: { source: { groupName: 'Group' } } }),
        addImportedSummary: async () => {},
        exportActiveSummary: () => ({}),
        ...overrides,
    };
    const context = {
        registerSection: (_name, callback) => { section = callback; },
        callGenericPopup: async () => true, POPUP_TYPE: { CONFIRM: 1 },
        $: selector => typeof selector === 'object' ? selector : {
            length: 1,
            html() {},
            off() { return this; },
            on(event, handler) { handlers.set(`${selector}:${event}`, handler); return this; },
            find(child) {
                return {
                    off() { return this; },
                    on(event, handler) { handlers.set(`${child}:${event}`, handler); return this; },
                };
            },
        },
        toastr: { success: value => notices.push(['success', value]), error: value => notices.push(['error', value]) },
        prompt: () => 'Imported',
        FileReader: class {
            readAsText() { this.result = '{}'; fileRead = this.onload(); }
        },
    };
    vm.runInNewContext(source, context, { filename: 'summaryExport.js' });
    section({ settings: { lang: 'en' }, $c: controls, summaryExportSystem: system, renderPrompt: async value => value });
    return { handlers, notices, waitForRead: () => fileRead };
}

test('summary export UI does not announce success when download fails', async () => {
    const h = await sectionHarness({ exportActiveSummary: () => { throw new Error('download failed'); } });
    h.handlers.get('summary-export-btn:click')();
    assert.deepEqual(h.notices.map(([type]) => type), ['error']);
});

test('summary import UI catches an asynchronous save failure', async () => {
    const h = await sectionHarness({ addImportedSummary: async () => { throw new Error('disk unavailable'); } });
    h.handlers.get('summary-import-file:change').call({ files: [{ name: 'summary.json' }], value: 'selected' });
    await h.waitForRead();
    assert.deepEqual(h.notices.map(([type]) => type), ['error']);
});

test('summary toggle and delete UI report save failures and refresh state', async () => {
    const entry = { id: 'entry', name: 'Imported', content: 'ready', enabled: true, createdAt: 1 };
    const h = await sectionHarness({
        setEnabled: async () => { throw new Error('disk unavailable'); },
        deleteImportedSummary: async () => { throw new Error('disk unavailable'); },
    }, [entry]);
    const target = { data: () => entry.id, prop: () => false };
    await h.handlers.get('.gd-summary-enabled:change').call(target);
    await h.handlers.get('.gd-summary-delete:click').call(target);
    assert.deepEqual(h.notices.map(([type]) => type), ['error', 'error']);
});

test('summary import UI skips malformed legacy list entries', async () => {
    const h = await sectionHarness({}, [null, { name: 'bad', content: 42 }, { id: 'ok', name: 'Good', content: 'ready' }]);
    assert.equal(h.notices.length, 0);
});
