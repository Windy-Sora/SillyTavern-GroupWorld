import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mountFeatureViews } from '../../ui/feature-views.js';

// Presentation tree only; does not claim browser/CSS acceptance.
class Node {
    constructor(doc, tag = 'div') {
        this.ownerDocument = doc; this.tag = tag; this.children = []; this.dataset = {};
        this.attributes = {}; this.events = new Map();
    }
    remove() { if (this.parentElement) { const a = this.parentElement.children; a.splice(a.indexOf(this), 1); this.parentElement = null; } }
    append(el) { el.remove(); this.children.push(el); el.parentElement = this; }
    prepend(el) { el.remove(); this.children.unshift(el); el.parentElement = this; }
    before(el) { const p = this.parentElement; el.remove(); p.children.splice(p.children.indexOf(this), 0, el); el.parentElement = p; }
    replaceWith(el) { this.before(el); this.remove(); }
    contains(el) { return el === this || this.children.some(c => c.contains(el)); }
    matches(s) { return s === '[data-feature-view]' ? !!this.dataset.featureView : s === 'button[data-feature-view-button]' && this.tag === 'button' && !!this.dataset.featureViewButton; }
    querySelectorAll(s) { return this.children.flatMap(c => [...(c.matches(s) ? [c] : []), ...c.querySelectorAll(s)]); }
    closest(s) { return this.matches(s) ? this : this.parentElement?.closest(s); }
    setAttribute(k, v) { this.attributes[k] = v; }
    addEventListener(k, fn) { if (!this.events.has(k)) this.events.set(k, new Set()); this.events.get(k).add(fn); }
    removeEventListener(k, fn) { this.events.get(k)?.delete(fn); }
    click() { for (let n = this; n; n = n.parentElement) for (const fn of n.events.get('click') || []) fn({ target: this }); }
}
const all = node => [node, ...node.children.flatMap(all)];
function fixture(id = 'memory') {
    const doc = { createElement: tag => new Node(doc, tag), createComment: () => new Node(doc, '#comment') };
    const host = new Node(doc), gated = new Node(doc); gated.style = { display: 'none' }; host.append(gated);
    const groups = ['settings', 'advanced', 'use', 'more', 'use'].map((view, i) => {
        const el = new Node(doc); el.dataset.featureView = view;
        el.dataset.featureOrder = String(i === 4 ? 10 : 20); el.value = `draft-${i}`;
        gated.append(el); return el;
    });
    const settings = { lang: 'zh', mode: 'formula' }; let calls = 0;
    const original = [...gated.children];
    const controller = mountFeatureViews(host, { id, settings, onConnection: () => calls++ });
    return { host, gated, groups, original, settings, controller, calls: () => calls };
}
test('feature presentation preserves gating ancestors, data identity, action listeners and original order', () => {
    const f = fixture(); let clicks = 0; f.groups[2].addEventListener('click', () => clicks++);
    for (let i = 0; i < 3; i++) {
        f.controller.showView('use');
        f.controller.update(true);
        assert.ok(f.groups.every(group => f.gated.contains(group)));
        assert.equal(f.gated.style.display, 'none');
        assert.equal(f.groups[0].parentElement.hidden, false);
        assert.equal(f.groups[2].parentElement.hidden, false);
        const use = f.groups[2].parentElement;
        assert.ok(use.children.indexOf(f.groups[4]) < use.children.indexOf(f.groups[2]));
        assert.equal(f.groups[3].parentElement.tag, 'details');
        f.groups[2].click(); f.groups[1].value += '!';
        f.controller.showView('advanced');
        assert.equal(f.groups[1].parentElement.hidden, false);
        f.controller.update(false);
        assert.deepEqual(f.gated.children.filter(n => f.original.includes(n)), f.original);
    }
    assert.equal(clicks, 3); assert.equal(f.groups[1].value, 'draft-1!!!');
    f.controller.dispose(); assert.deepEqual(f.gated.children, f.original);
    assert.deepEqual(f.host.children, [f.gated]);
});
test('compact summary, language updates and connection cleanup do not invoke business actions', () => {
    const f = fixture('summary'); f.controller.update(true);
    assert.equal(all(f.host).some(n => n.dataset.featureViewButton), false);
    f.controller.showView('advanced');
    assert.equal(f.groups[1].parentElement.open, true);
    assert.ok(all(f.host).some(n => n.textContent?.includes('数据属于当前聊天')));
    f.settings.lang = 'en'; f.settings.mode = 'llm'; f.controller.update(true);
    assert.ok(all(f.host).some(n => n.textContent?.includes('Data belongs to this chat')));
    f.controller.showView('settings');
    const connect = all(f.host).find(n => n.textContent === 'Model connections…');
    assert.equal(connect.hidden, false); connect.click(); assert.equal(f.calls(), 1);
    f.controller.dispose(); connect.click(); assert.equal(f.calls(), 1);
});
test('incomplete hosts are a no-op', () => {
    assert.equal(mountFeatureViews(null), null);
    const doc = {}; assert.equal(mountFeatureViews(new Node(doc)), null);
});
test('compact director has no view buttons, keeps ordinary settings visible and only unfolds editors on demand', () => {
    const f = fixture('rules'); f.settings.mode = 'llm'; f.controller.update(true);
    assert.equal(all(f.host).filter(n => n.dataset.featureViewButton).length, 0);
    assert.equal(f.groups[0].parentElement.hidden, false);
    assert.equal(f.groups[2].parentElement.hidden, false);
    const advanced = f.groups[1].parentElement;
    assert.equal(advanced.tag, 'details'); assert.equal(advanced.open, false);
    f.controller.showView('advanced'); assert.equal(advanced.open, true);
    assert.equal(f.groups[2].parentElement.hidden, false);
    f.controller.update(false); assert.deepEqual(f.gated.children.filter(n => f.original.includes(n)), f.original);
    f.controller.update(true); assert.equal(advanced.open, true);
    const connect = all(f.host).find(n => n.textContent === '模型连接…');
    assert.equal(connect.hidden, false);
    f.settings.mode = 'formula'; f.controller.update(true); assert.equal(connect.hidden, true);
    f.controller.dispose(); assert.deepEqual(f.gated.children, f.original);
});
test('template groups retain mode/enable boundaries and leave summary status outside switched views', async () => {
    const html = await readFile(new URL('../../settings.html', import.meta.url), 'utf8');
    // Track div ancestry from the real template; fixtures cannot validate markup placement.
    const stack = [], ancestry = new Map();
    for (const token of html.matchAll(/<div\b[^>]*>|<\/div\s*>|<(?:input|textarea|span)\b[^>]*>/g)) {
        const tag = token[0];
        if (tag.startsWith('</')) { assert.ok(stack.length, 'balanced div close'); stack.pop(); continue; }
        const id = tag.match(/\bid="([^"]+)"/)?.[1];
        if (id) ancestry.set(id, [...stack]);
        if (tag.startsWith('<div')) stack.push({ id, view: tag.match(/data-feature-view="([^"]+)"/)?.[1] });
    }
    assert.equal(stack.length, 0);
    for (const [id, gate, view] of [
        ['gd-memory-prompt', 'gd-memory-section', 'advanced'],
        ['gd-mem-edit-event', 'gd-memory-section', 'use'],
        ['gd-llm-prompt', 'gd-llm-section', 'advanced'],
        ['gd-topn', 'gd-formula-section', 'use'],
        ['gd-summary-result', undefined, 'use'],
    ]) {
        const chain = ancestry.get(id); assert.ok(chain, id);
        if (gate) assert.ok(chain.some(n => n.id === gate), id);
        assert.equal(chain.findLast(n => n.view)?.view, view, id);
    }
    for (const id of ['gd-summary-lock-warn', 'gd-summary-status', 'gd-summary-scan-notice']) {
        assert.equal(ancestry.get(id).some(n => n.view), false, id);
    }
});
