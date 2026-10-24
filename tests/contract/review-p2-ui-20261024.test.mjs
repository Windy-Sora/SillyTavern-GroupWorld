import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = async file => (await readFile(new URL('../../ui/sections/' + file, import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

async function critiqueFixture(overrides = {}) {
    const handlers = new Map(), elements = new Map(), notices = []; let section, locked = false;
    function control(name) {
        if (!elements.has(name)) {
            const props = {}, element = { props, value: '', label: '',
                prop(key, value) { if (arguments.length === 1) return props[key]; props[key] = value; return this; },
                val(value) { if (!arguments.length) return this.value; this.value = value; return this; },
                text(value) { if (!arguments.length) return this.label; this.label = value; return this; },
                data() { return this; }, toggle() { return this; }, show() { return this; }, hide() { return this; },
                on(type, callback) { handlers.set(name + ':' + type, callback); return this; } };
            elements.set(name, element);
        }
        return elements.get(name);
    }
    const toastr = Object.fromEntries(['success', 'error', 'info'].map(kind => [kind, text => notices.push([kind, text])]));
    const settings = { lang: 'en', critiqueEnabled: true };
    const cs = { getLatestActive: () => null, ...overrides };
    vm.runInNewContext((await source('critique.js')).replace(/^import .*;\n/gm, ''), {
        registerSection(_name, callback) { section = callback; }, $: control,
        callGenericPopup: async () => true, POPUP_TYPE: { CONFIRM: 1 },
    });
    section({ settings, $c: control, saveSettings() {}, critiqueSystem: cs, toastr, isRoundActive: () => locked, getChat: () => [] });
    return { control, notices, settings, handlers, setLocked(value) { locked = value; } };
}

for (const [button, method] of [['revert', 'revertLastCritique'], ['reset', 'resetAll']]) {
    test('P2-21: critique ' + button + ' reports save failures and restores enabled state', async () => {
        const f = await critiqueFixture({ [method]: async () => { throw Error('disk failed'); } });
        await f.handlers.get('critique-' + button + ':click')();
        assert.deepEqual(f.notices.map(x => x[0]), ['error']);
        assert.match(f.notices[0][1], /disk failed/); assert.equal(f.control('critique-' + button).props.disabled, false);
    });
}
for (const [button, method] of [['execute', 'generateCritique'], ['regenerate', 'regenerateLastCritique']]) {
    test('P2-21: critique ' + button + ' recomputes disabled controls after a task', async () => {
        const gate = deferred(); let calls = 0;
        const f = await critiqueFixture({ [method]: () => { calls++; return gate.promise; } });
        const work = f.handlers.get('critique-' + button + ':click')();
        await f.handlers.get('critique-' + button + ':click')(); assert.equal(calls, 1);
        f.settings.critiqueEnabled = false; f.setLocked(true); gate.resolve({ rangeEnd: 3 }); await work;
        assert.equal(f.control('critique-' + button).props.disabled, true);
        assert.equal(f.control('critique-reset').props.disabled, true);
    });
}

for (const file of ['memoryExport.js', 'profileExport.js', 'npcExport.js']) {
    test('P2-22: ' + file + ' reports FileReader errors without parsing or importing', async () => {
        const text = await source(file), errors = []; let listener, reads = 0;
        const context = { toastr: { error: message => errors.push(message) }, isZh: () => false, FileReader: class {
            readAsText() { reads++; this.onerror(); }
        }, renderImportList() { assert.fail('failed reads cannot render an import'); },
        parseImportFile() { assert.fail('failed reads cannot parse'); }, parseNpcImportFile() { assert.fail('failed reads cannot parse'); } };
        if (file === 'memoryExport.js') {
            const start = text.indexOf("$c('memory-import-file').off("), end = text.indexOf("$c('memory-import-btn')", start);
            context.$c = () => ({ off() { return this; }, on(_type, callback) { listener = callback; } });
            vm.runInNewContext(text.slice(start, end), context);
            listener.call({ files: [{}], value: 'selected' });
        } else {
            const start = text.indexOf('function handleImportFile('), end = text.indexOf('// ── Bindings', start);
            vm.runInNewContext(text.slice(start, end) + ';handleImportFile({});', context);
        }
        assert.equal(reads, 1); assert.equal(errors.length, 1); assert.match(errors[0], /Could not read import file/);
    });
}

async function npcImportFixture() {
    const text = await source('npc.js'), start = text.indexOf("$list.find('.gd-npc-import').on(");
    const gate = deferred(), npcs = [{ name: 'A' }, { name: 'B' }], notices = []; let click, calls = 0, refreshed = 0;
    const sandbox = { $list: { find: () => ({ on(_type, callback) { click = callback; } }) }, deletionPending: false, npcs,
        $: () => ({ data: () => 1, prop() {} }), npcSystem: { getNpcs: () => npcs, importNpcAsCharacter: () => { calls++; return gate.promise; } },
        L: (_zh, en) => en, renderNpcList() { refreshed++; }, window: {},
        toastr: Object.fromEntries(['success', 'warning', 'error'].map(type => [type, text => notices.push([type, text])])) };
    vm.runInNewContext(text.slice(start, text.indexOf('// Edit toggle', start)), sandbox);
    return { click, gate, npcs, notices, calls: () => calls, refreshed: () => refreshed };
}
test('P2-23: NPC import success uses the captured target name even after an earlier NPC is removed', async () => {
    const f = await npcImportFixture(), work = f.click();
    f.npcs.splice(0, 1); f.gate.resolve('B.png'); await work;
    assert.equal(f.calls(), 1); assert.equal(f.notices[0][0], 'success'); assert.match(f.notices[0][1], /B.*B.png/);
});
test('P2-23: stale NPC buttons do not start an import', async () => {
    const f = await npcImportFixture(); f.npcs.length = 0; await f.click();
    assert.equal(f.calls(), 0); assert.equal(f.refreshed(), 1);
});

for (const event of ['cancel', 'empty-change', 'success', 'failure']) {
    test('P2-24: standalone variable picker is removed after ' + event, async () => {
        const text = await source('variables.js'), start = text.indexOf('function importVariablesFromPicker('), end = text.indexOf('function openVariableSettings(', start);
        const events = new Map(); let attached = 0, imports = 0;
        const input = { files: event === 'empty-change' ? [] : [{}], style: {}, addEventListener(type, callback) { events.set(type, callback); },
            remove() { attached = 0; }, click() {} };
        const sandbox = { document: { createElement: () => input, body: { appendChild() { attached++; } } },
            variableSystem: { async importFromFile() { imports++; if (event === 'failure') throw Error('bad file'); return { ok: true, count: 1 }; } },
            refresh() {}, t: text => text, toastr: { success() {}, error() {} } };
        vm.runInNewContext(text.slice(start, end) + ';importVariablesFromPicker();', sandbox);
        assert.equal(attached, 1);
        await events.get(event === 'cancel' ? 'cancel' : 'change')();
        assert.equal(attached, 0); assert.equal(imports, ['success', 'failure'].includes(event) ? 1 : 0);
    });
}
