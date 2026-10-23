import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { mountAssistantMenu } from '../../ui/assistant-menu.js';

function fixture(lang) {
    const listeners = new Map(), windowListeners = new Map();
    const doc = { addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key),
        defaultView: { innerWidth: 400, innerHeight: 600, addEventListener: (key, fn) => windowListeners.set(key, fn), removeEventListener: key => windowListeners.delete(key) } };
    function element() {
        return { ownerDocument: doc, children: [], attrs: {}, style: {}, hidden: false, events: {},
            append(...items) { this.children.push(...items); for (const item of items) item.parentElement = this; },
            contains(target) { return this === target || this.children.some(item => item.contains(target)); },
            setAttribute(key, value) { this.attrs[key] = value; },
            addEventListener(key, fn) { this.events[key] = fn; }, removeEventListener(key) { delete this.events[key]; },
            getBoundingClientRect() { return { left: 320, bottom: 500, width: 300, height: 140 }; },
            focus() { doc.activeElement = this; }, remove() { this.parentElement.children = this.parentElement.children.filter(item => item !== this); },
        };
    }
    doc.createElement = element; doc.body = element();
    const button = element(); button.id = 'gd-dash-get-assistant';
    const calls = [], dispose = mountAssistantMenu({ button, lang, onOpen: () => calls.push('agent'), onImport: () => calls.push('import') });
    return { doc, button, calls, dispose, listeners, windowListeners, menu: doc.body.children[0] };
}

for (const lang of ['zh', 'en']) test('Assistant menu orders and separates Agent and import actions / ' + lang, () => {
    const f = fixture(lang), [agent, legacy] = f.menu.children;
    assert.match(agent.children[0].textContent, lang === 'zh' ? /Agent（推荐）/ : /Agent \(recommended\)/);
    assert.match(legacy.children[0].textContent, lang === 'zh' ? /导入暮羽角色卡与世界书/ : /Import Muyu character card and world book/);
    assert.equal(f.menu.hidden, true); assert.deepEqual(f.calls, []);
    f.button.events.click(); assert.equal(f.menu.hidden, false); assert.equal(f.doc.activeElement, agent);
    assert.equal(f.menu.style.left, '92px'); assert.equal(f.menu.style.top, '452px');
    agent.onclick(); assert.deepEqual(f.calls, ['agent']); assert.equal(f.menu.hidden, true);
    f.button.events.click(); legacy.onclick(); assert.deepEqual(f.calls, ['agent', 'import']);
    f.dispose(); assert.equal(f.doc.body.children.length, 0);
});

test('Assistant menu closes on outside/Escape/scroll and cleans listeners on rebuild', () => {
    const f = fixture('zh');
    f.button.events.click(); f.listeners.get('keydown')({ key: 'ArrowDown', preventDefault() {} });
    assert.equal(f.doc.activeElement, f.menu.children[1]);
    f.listeners.get('keydown')({ key: 'Escape', preventDefault() {} }); assert.equal(f.doc.activeElement, f.button);
    f.button.events.click(); f.listeners.get('pointerdown')({ target: f.doc.body }); assert.equal(f.menu.hidden, true);
    f.button.events.click(); f.listeners.get('scroll')(); assert.equal(f.menu.hidden, true);
    f.button.events.click(); f.dispose(); assert.equal(f.listeners.size, 0); assert.equal(f.windowListeners.size, 0);
    assert.deepEqual(f.calls, []);
});

test('Assistant section routes opening independently and retains the import confirmation', async () => {
    const source = (await readFile(new URL('../../ui/sections/gdAssistant.js', import.meta.url), 'utf8'))
        .replace(/^import .*;\r?\n/gm, '').replaceAll('import.meta.url', '"https://example.test/extensions/gd/ui/sections/gdAssistant.js"');
    let init, options, confirmations = 0, disposed = 0;
    const button = { __gdAssistantDispose: () => disposed++ }, opened = [];
    vm.runInNewContext(source, { URL, registerSection: (_, fn) => { init = fn; },
        mountAssistantMenu: value => { options = value; return () => disposed++; },
        callGenericPopup: async () => { confirmations++; return false; }, POPUP_TYPE: { CONFIRM: 1 },
        fetch: () => { throw Error('No import request should be sent without confirmation'); },
    });
    init({ settings: { lang: 'en' }, $c: () => ({ length: 1, 0: button }), toastr: {}, muyuOwner: { floating: { open: id => opened.push(id) } } });
    assert.equal(disposed, 1); assert.equal(confirmations, 0);
    options.onOpen(); assert.deepEqual(opened, ['muyu']); assert.equal(confirmations, 0);
    await options.onImport(); assert.equal(confirmations, 1);
    button.__gdAssistantDispose(); assert.equal(disposed, 2);
});
