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

async function sectionHarness(fileName, system, libraries = []) {
    const source = (await readFile(new URL(`../../ui/sections/${fileName}`, import.meta.url), 'utf8'))
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
        prop(_name, value) { return value === undefined ? true : this; },
        off() { return this; },
        on(event, selectorOrHandler, handler) {
            const selector = typeof selectorOrHandler === 'string' ? `:${selectorOrHandler}` : '';
            handlers.set(`${this.key}:${event}${selector}`, handler || selectorOrHandler);
            return this;
        },
        trigger() {},
    };
    const $ = selector => typeof selector === 'object' ? selector : Object.assign(Object.create(selection), { key: selector });
    const context = {
        registerSection: (_name, callback) => { section = callback; },
        callGenericPopup: async (_message, type) => type === 1 ? 'Pack' : true,
        POPUP_TYPE: { INPUT: 1, CONFIRM: 2 },
        $,
        window: {},
    };
    vm.runInNewContext(source, context, { filename: fileName });
    section({
        settings: { lang: 'en' },
        profileLibrarySystem: fileName === 'profileLibrary.js' ? system : undefined,
        storyBlueprintLibrarySystem: fileName === 'storyBlueprintLibrary.js' ? system : undefined,
        toastr: {
            success: text => notices.push(['success', text]),
            error: text => notices.push(['error', text]),
            warning: text => notices.push(['warning', text]),
        },
        getCurrentGroup: () => ({ name: 'Campaign' }),
    });
    return { handlers, notices };
}

function profileSystem(overrides = {}, libraries = []) {
    const auto = { enabled: false, mode: 'best', fixedId: '', overwriteExisting: false, matchNameOnly: false, importTemplate: false };
    return {
        getLibraries: () => libraries,
        getLibrary: id => libraries.find(entry => entry.id === id) || null,
        getAutoLoadSettings: () => auto,
        matchLibraryProfiles: () => ({ matches: [], memberCount: 0 }),
        saveCurrentAsLibrary: async () => ({ name: 'Pack' }),
        deleteLibrary: async () => true,
        updateAutoLoadSettings: async patch => Object.assign(auto, patch),
        ...overrides,
    };
}

function storySystem(overrides = {}, libraries = []) {
    return {
        getLibraries: () => libraries,
        getLibrary: id => libraries.find(entry => entry.id === id) || null,
        saveCurrentAsLibrary: async () => ({ name: 'Pack' }),
        deleteLibrary: async () => true,
        ...overrides,
    };
}

test('Profile Library UI waits for save rejection before reporting failure', async () => {
    const gate = deferred();
    const h = await sectionHarness('profileLibrary.js', profileSystem({ saveCurrentAsLibrary: () => gate.promise }));
    const action = h.handlers.get('#gd-profile-library-save:click')();
    await Promise.resolve();
    assert.deepEqual(h.notices, []);
    gate.reject(new Error('settings save failed'));
    await action;
    assert.deepEqual(h.notices.map(([type]) => type), ['error']);
});

test('Profile Library UI awaits automatic-setting persistence failures', async () => {
    const gate = deferred();
    const h = await sectionHarness('profileLibrary.js', profileSystem({ updateAutoLoadSettings: () => gate.promise }));
    const action = h.handlers.get('#gd-profile-library-auto-enabled:change').call({ prop: () => true });
    await Promise.resolve();
    assert.deepEqual(h.notices, []);
    gate.reject(new Error('settings save failed'));
    await action;
    assert.deepEqual(h.notices.map(([type]) => type), ['error']);
});

test('Story Blueprint Library UI waits for save rejection before reporting failure', async () => {
    const gate = deferred();
    const h = await sectionHarness('storyBlueprintLibrary.js', storySystem({ saveCurrentAsLibrary: () => gate.promise }));
    const action = h.handlers.get('#gd-story-blueprint-library-save:click')();
    await Promise.resolve();
    assert.deepEqual(h.notices, []);
    gate.reject(new Error('settings save failed'));
    await action;
    assert.deepEqual(h.notices.map(([type]) => type), ['error']);
});

test('Story Blueprint Library UI waits for delete rejection before refreshing success state', async () => {
    const gate = deferred();
    const libraries = [{ id: 'pack', name: 'Pack', nodeCount: 1 }];
    const h = await sectionHarness('storyBlueprintLibrary.js', storySystem({ deleteLibrary: () => gate.promise }, libraries), libraries);
    const action = h.handlers.get('#gd-story-blueprint-library-list:click:.gd-sblib-delete').call({ data: () => 'pack' });
    await Promise.resolve();
    assert.deepEqual(h.notices, []);
    gate.reject(new Error('settings save failed'));
    await action;
    assert.deepEqual(h.notices.map(([type]) => type), ['error']);
});

test('dashboard library controls await system-owned persistence APIs', async () => {
    const source = await readFile(new URL('../../ui/sections/dashboard.js', import.meta.url), 'utf8');
    assert.match(source, /await profileLibrarySystem\.deleteLibrary\(id\)/);
    assert.match(source, /await profileLibrarySystem\.updateAutoLoadSettings\(\{ enabled, mode: next\.mode \|\| 'best' \}\)/);
    assert.match(source, /await storyBlueprintLibrarySystem\.deleteLibrary\(id\)/);
});
