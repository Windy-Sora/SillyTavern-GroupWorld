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

async function sectionHarness(overrides = {}, libraries = []) {
    const source = (await readFile(new URL('../../ui/sections/npcLibrary.js', import.meta.url), 'utf8'))
        .replace(/^import .*;\r?\n/gm, '');
    const handlers = new Map();
    const notices = [];
    let section;
    const selection = {
        length: 1,
        val() { return libraries[0]?.id || ''; },
        find() { return { remove() {} }; },
        append() {},
        html() {},
        prop() { return false; },
        off() { return this; },
        on(event, selectorOrHandler, handler) {
            const selector = typeof selectorOrHandler === 'string' ? `:${selectorOrHandler}` : '';
            handlers.set(`${this.key}:${event}${selector}`, handler || selectorOrHandler);
            return this;
        },
        trigger() {},
    };
    const $ = selector => typeof selector === 'object' ? selector : Object.assign(Object.create(selection), { key: selector });
    const system = {
        getLibraries: () => libraries,
        getLibrary: id => libraries.find(lib => lib?.id === id) || null,
        previewLibrary: () => ({ newCount: 0, overwriteCount: 0 }),
        saveCurrentAsLibrary: async () => ({ name: 'Pack' }),
        deleteLibrary: async () => true,
        ...overrides,
    };
    const context = {
        registerSection: (_name, callback) => { section = callback; },
        callGenericPopup: async (_message, type) => type === 1 ? 'Pack' : true,
        POPUP_TYPE: { INPUT: 1, CONFIRM: 2 },
        $,
        window: {},
    };
    vm.runInNewContext(source, context, { filename: 'npcLibrary.js' });
    section({
        settings: { lang: 'en' }, npcLibrarySystem: system,
        toastr: {
            success: text => notices.push(['success', text]),
            error: text => notices.push(['error', text]),
            warning: text => notices.push(['warning', text]),
        },
        getCurrentGroup: () => ({ name: 'Town' }),
    });
    return { handlers, notices };
}

test('NPC library UI waits for save and reports asynchronous failure', async () => {
    const gate = deferred();
    const h = await sectionHarness({ saveCurrentAsLibrary: () => gate.promise });
    const action = h.handlers.get('#gd-npc-library-save:click')();
    await Promise.resolve();
    assert.deepEqual(h.notices, []);
    gate.reject(new Error('disk unavailable'));
    await action;
    assert.deepEqual(h.notices.map(([type]) => type), ['error']);
});

test('NPC library UI waits for delete and reports asynchronous failure', async () => {
    const gate = deferred();
    const entry = { id: 'pack', name: 'Pack', npcCount: 1 };
    const h = await sectionHarness({ deleteLibrary: () => gate.promise }, [entry]);
    const action = h.handlers.get('#gd-npc-library-list:click:.gd-npclib-delete').call({ data: () => entry.id });
    await Promise.resolve();
    assert.deepEqual(h.notices, []);
    gate.reject(new Error('disk unavailable'));
    await action;
    assert.deepEqual(h.notices.map(([type]) => type), ['error']);
});

test('NPC library UI skips malformed legacy entries', async () => {
    const h = await sectionHarness({}, [null, 42, { id: 'pack', name: 'Pack', npcCount: 1 }]);
    assert.deepEqual(h.notices, []);
});

test('NPC library UI reports file import rejection without success feedback', async () => {
    const gate = deferred();
    const h = await sectionHarness({ importFileToLibrary: () => gate.promise });
    const target = { files: [{ name: 'pack.json' }], value: 'selected' };
    const action = h.handlers.get('#gd-npc-library-import-file:change').call(target);
    assert.deepEqual(h.notices, []);
    gate.reject(new Error('disk unavailable'));
    await action;
    assert.deepEqual(h.notices.map(([type]) => type), ['error']);
    assert.equal(target.value, '');
});

test('NPC library UI reports application rejection without success feedback', async () => {
    const gate = deferred();
    const entry = { id: 'pack', name: 'Pack', npcCount: 1 };
    const h = await sectionHarness({ applyLibrary: () => gate.promise }, [entry]);
    const action = h.handlers.get('#gd-npc-library-apply:click')();
    assert.deepEqual(h.notices, []);
    gate.reject(new Error('chat save failed'));
    await action;
    assert.deepEqual(h.notices.map(([type]) => type), ['error']);
});

test('NPC library UI warns when application persistence is unknown', async () => {
    const entry = { id: 'pack', name: 'Pack', npcCount: 1 };
    const unknown = Object.assign(new Error('verification unavailable'), { persistenceUnknown: true });
    const h = await sectionHarness({ applyLibrary: async () => { throw unknown; } }, [entry]);
    await h.handlers.get('#gd-npc-library-apply:click')();
    assert.deepEqual(h.notices.map(([kind]) => kind), ['warning']);
});
