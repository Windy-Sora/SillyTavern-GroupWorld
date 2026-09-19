import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    return { promise, resolve, reject };
}

async function harness(overrides = {}, summaries = [{ content: 'old', active: true, rangeEnd: 1, basedOn: null }]) {
    const source = (await readFile(new URL('../../ui/sections/chatSummary.js', import.meta.url), 'utf8'))
        .replace(/^import .*;\r?\n/gm, '');
    const handlers = new Map();
    const controls = new Map();
    const notices = [];
    let section;
    function control(key) {
        if (controls.has(key)) return controls.get(key);
        const state = { value: key === 'summary-result' ? 'edited' : '', props: {} };
        const api = {
            key,
            prop(name, value) { if (value === undefined) return state.props[name]; state.props[name] = value; return this; },
            val(value) { if (value === undefined) return state.value; state.value = value; return this; },
            on(event, handler) { handlers.set(`${key}:${event}`, handler); return this; },
            toggle() { return this; }, text() { return this; }, show() { return this; }, hide() { return this; },
            find() { return { removeClass() { return this; }, addClass() { return this; } }; },
            contents() { return { last() { return { replaceWith() {} }; } }; },
        };
        controls.set(key, api);
        return api;
    }
    const system = {
        getSummaries: () => structuredClone(summaries),
        getLatestActive: () => structuredClone([...summaries].reverse().find(item => item.active) || null),
        updateSummaryContents: async () => 1,
        generateSummary: async () => ({ rangeEnd: 1 }),
        regenerateLastSummary: async () => ({}),
        revertLastSummary: async () => true,
        resetAll: async () => true,
        pruneDisabledSummaries: async () => 1,
        clearSummaries: async () => summaries.length,
        ...overrides,
    };
    const context = {
        registerSection: (_name, callback) => { section = callback; },
        callGenericPopup: async () => true,
        POPUP_TYPE: { CONFIRM: 1 },
        $: key => control(key),
        window: {},
        structuredClone,
    };
    vm.runInNewContext(source, context, { filename: 'chatSummary.js' });
    section({
        settings: { lang: 'en', summaryEnabled: true, summaryReusePrevious: true },
        $c: control,
        saveSettings() {},
        summarySystem: system,
        toastr: {
            success: text => notices.push(['success', text]),
            info: text => notices.push(['info', text]),
            error: text => notices.push(['error', text]),
        },
        isRoundActive: () => false,
        getChat: () => [{ mes: 'one' }],
    });
    return { handlers, controls, notices };
}

test('summary edit UI awaits system persistence and restores its control on rejection', async () => {
    const gate = deferred();
    const h = await harness({ updateSummaryContents: () => gate.promise });
    const action = h.handlers.get('summary-result-save:click')();
    await Promise.resolve();
    assert.deepEqual(h.notices, []);
    assert.equal(h.controls.get('summary-result-save').prop('disabled'), true);
    gate.reject(new Error('chat save failed'));
    await action;
    assert.deepEqual(h.notices.map(([type]) => type), ['error']);
    assert.equal(h.controls.get('summary-result-save').prop('disabled'), false);
});

test('summary pruning blocks edits that still use the stale scan numbering', async () => {
    const gate = deferred();
    let edits = 0;
    const list = [{ content: 'inactive', active: false, rangeEnd: 1, basedOn: null }, { content: 'active', active: true, rangeEnd: 1, basedOn: null }];
    const h = await harness({
        pruneDisabledSummaries: () => gate.promise,
        updateSummaryContents: async () => { edits++; return 1; },
    }, list);
    const pruning = h.handlers.get('summary-prune-btn:click')();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.controls.get('summary-result-save').prop('disabled'), true);
    await h.handlers.get('summary-result-save:click')();
    assert.equal(edits, 0);
    gate.resolve(1);
    await pruning;
    assert.equal(h.controls.get('summary-result-save').prop('disabled'), false);
});

test('summary destructive UI actions report rejected transactions without success feedback', async () => {
    for (const [key, method] of [
        ['summary-revert', 'revertLastSummary'],
        ['summary-reset', 'resetAll'],
        ['summary-prune-btn', 'pruneDisabledSummaries'],
        ['summary-scan-clear', 'clearSummaries'],
    ]) {
        const list = [{ content: 'active', active: true, rangeEnd: 1, basedOn: null }, { content: 'old', active: false, rangeEnd: 1, basedOn: null }];
        const h = await harness({ [method]: async () => { throw new Error('chat save failed'); } }, list);
        await h.handlers.get(`${key}:click`)();
        assert.deepEqual(h.notices.map(([type]) => type), ['error'], method);
    }
});

test('chat summary UI delegates all chat-state writes to the system', async () => {
    const source = await readFile(new URL('../../ui/sections/chatSummary.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /saveChatConditional/);
    assert.doesNotMatch(source, /allSummaries\[[^\]]+\]\.content\s*=/);
    assert.doesNotMatch(source, /(?:summaries|allSummaries)\.length\s*=(?!=)/);
    assert.match(source, /await ss\.updateSummaryContents\(updates\)/);
    assert.match(source, /await ss\.pruneDisabledSummaries\(\)/);
    assert.match(source, /await ss\.clearSummaries\(\)/);
});
