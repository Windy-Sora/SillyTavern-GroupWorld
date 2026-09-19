import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

async function harness(overrides = {}, options = {}) {
    const source = (await readFile(new URL('../../ui/sections/npc.js', import.meta.url), 'utf8'))
        .replace(/^import .*;\r?\n/gm, '');
    const handlers = new Map();
    const notices = [];
    const values = new Map([
        ['npc-list .gd-npc-edit-name[data-idx="0"]', 'Alice'],
        ['npc-list .gd-npc-edit-desc[data-idx="0"]', 'updated'],
        ['npc-list .gd-npc-edit-personality[data-idx="0"]', 'calm'],
        ['npc-list .gd-npc-edit-scenario[data-idx="0"]', 'town'],
        ['npc-list .gd-npc-edit-firstmes[data-idx="0"]', 'hello'],
    ]);
    const nodes = new Map();
    let currentIndex = 0;
    function node(key) {
        if (nodes.has(key)) return nodes.get(key);
        const item = {
            key, length: 1, data: () => currentIndex,
            val(value) { if (arguments.length) { values.set(key, value); return this; } return values.get(key) || ''; },
            prop() { return this; }, html() { return this; }, toggle() { return this; }, hide() { return this; }, show() { return this; },
            find(selector) { return node(`${key} ${selector}`); },
            on(event, handler) { handlers.set(`${key}:${event}`, { handler, node: this }); return this; },
        };
        nodes.set(key, item);
        return item;
    }
    const $ = target => typeof target === 'object' ? target : node(target);
    const npcs = options.npcs || [{ name: 'Alice', description: 'before', personality: 'calm' }];
    const npcSystem = {
        getNpcs: () => npcs,
        updateNpc: async () => {},
        deleteNpc: async () => {},
        ...overrides,
    };
    let section;
    let dashboardRefreshes = 0;
    vm.runInNewContext(source, {
        registerSection: (_name, callback) => { section = callback; },
        DEFAULT_NPC_PROMPT: 'default',
        callGenericPopup: async () => true,
        POPUP_TYPE: { CONFIRM: 1 },
        document: { createElement: () => ({ set textContent(value) { this.innerHTML = String(value); } }) },
        window: { __gdRefreshDashboard: () => { dashboardRefreshes++; } },
        $, console,
    }, { filename: 'npc.js' });
    section({
        settings: { lang: 'en', npcEnabled: true },
        $c: key => node(key), npcSystem, saveSettings() {}, getCurrentGroup: () => null,
        toastr: {
            success: message => notices.push(['success', message]),
            error: message => notices.push(['error', message]),
            info: message => notices.push(['info', message]),
            warning: message => notices.push(['warning', message]),
        },
    });
    return {
        notices,
        get dashboardRefreshes() { return dashboardRefreshes; },
        setIndex(index) { currentIndex = index; },
        setValue(key, value) { values.set(key, value); },
        click(key) {
            const { handler, node: target } = handlers.get(key);
            return handler.call(target);
        },
    };
}

test('NPC UI waits for edit persistence and reports rejection without success', async () => {
    const save = deferred();
    const h = await harness({ updateNpc: () => save.promise });
    const pending = h.click('npc-list .gd-npc-save:click');
    assert.deepEqual(h.notices, []);
    assert.equal(h.dashboardRefreshes, 0);
    save.reject(new Error('chat save failed'));
    await pending;
    assert.deepEqual(h.notices.map(([kind]) => kind), ['error']);
    assert.equal(h.dashboardRefreshes, 0);
});

test('NPC UI warns and refreshes retained changes when persistence is unknown', async () => {
    const npcs = [{ name: 'Alice', description: 'before' }];
    const unknown = Object.assign(new Error('verification unavailable'), { persistenceUnknown: true });
    const h = await harness({
        getNpcs: () => npcs,
        updateNpc: async () => { npcs[0].description = 'saved'; throw unknown; },
    }, { npcs });
    await h.click('npc-list .gd-npc-save:click');
    assert.equal(npcs[0].description, 'saved');
    assert.deepEqual(h.notices.map(([kind]) => kind), ['warning']);
    assert.match(h.notices[0][1], /Do not reload or retry yet/);
    assert.equal(h.dashboardRefreshes, 1);
});

test('NPC UI blocks stale row actions while deletion is waiting for persistence', async () => {
    const save = deferred();
    const npcs = [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Carol' }];
    const edits = [];
    const h = await harness({
        getNpcs: () => npcs,
        deleteNpc(index) { npcs.splice(index, 1); return save.promise; },
        updateNpc(index, updates) { edits.push([index, updates]); },
    }, { npcs });
    const deleting = h.click('npc-list .gd-npc-delete:click');
    await new Promise(setImmediate);
    assert.deepEqual(npcs.map(npc => npc.name), ['Bob', 'Carol']);

    h.setIndex(1); // The old Bob row still carries index 1, now occupied by Carol.
    h.setValue('npc-list .gd-npc-edit-name[data-idx="1"]', 'Bobby');
    await h.click('npc-list .gd-npc-save:click');
    assert.deepEqual(edits, []);
    assert.deepEqual(npcs.map(npc => npc.name), ['Bob', 'Carol']);

    save.resolve();
    await deleting;
    assert.equal(h.dashboardRefreshes, 1);
});

test('NPC UI waits for delete persistence and reports rejection without refresh', async () => {
    const save = deferred();
    const h = await harness({ deleteNpc: () => save.promise });
    const pending = h.click('npc-list .gd-npc-delete:click');
    await Promise.resolve();
    assert.equal(h.dashboardRefreshes, 0);
    save.reject(new Error('chat save failed'));
    await pending;
    assert.deepEqual(h.notices.map(([kind]) => kind), ['error']);
    assert.equal(h.dashboardRefreshes, 0);
});

test('NPC UI reports edit success only after persistence resolves', async () => {
    const save = deferred();
    const h = await harness({ updateNpc: () => save.promise });
    const pending = h.click('npc-list .gd-npc-save:click');
    assert.deepEqual(h.notices, []);
    save.resolve();
    await pending;
    assert.deepEqual(h.notices.map(([kind]) => kind), ['success']);
    assert.equal(h.dashboardRefreshes, 1);
});
