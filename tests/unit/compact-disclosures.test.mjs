import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { COMPACT_DISCLOSURES, mountCompactDisclosures } from '../../ui/compact-disclosures.js';

class Node {
    constructor(doc, tag, attrs = {}) { this.ownerDocument = doc; this.tag = tag; this.attrs = attrs; this.id = attrs.id; this.children = []; this.dataset = {}; this.open = false; }
    get firstElementChild() { return this.children[0]; }
    remove() { if (this.parentElement) { const a = this.parentElement.children; a.splice(a.indexOf(this), 1); this.parentElement = null; } }
    append(el) { el.remove(); this.children.push(el); el.parentElement = this; }
    before(el) { const p = this.parentElement; el.remove(); p.children.splice(p.children.indexOf(this), 0, el); el.parentElement = p; }
    replaceWith(el) { this.before(el); this.remove(); }
    contains(el) { return el === this || this.children.some(c => c.contains(el)); }
    querySelector(selector) {
        const match = selector.match(/^label\[for="(.+)"\]$/);
        const matches = el => match ? el.tag === 'label' && el.attrs.for === match[1] : el.id === selector.slice(1);
        for (const child of this.children) { if (matches(child)) return child; const found = child.querySelector(selector); if (found) return found; }
        return null;
    }
}
async function fixture() {
    const doc = { createElement: tag => new Node(doc, tag), createComment: () => new Node(doc, '#comment') };
    const root = new Node(doc, 'root'), stack = [root];
    const html = await readFile(new URL('../../settings.html', import.meta.url), 'utf8');
    const voids = new Set(['input', 'hr', 'br', 'img', 'meta', 'link']);
    for (const [token] of html.matchAll(/<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>/g)) {
        if (token.startsWith('<!--')) continue;
        const tag = token.match(/^<\/?([\w-]+)/)[1].toLowerCase();
        if (token.startsWith('</')) {
            assert.equal(stack.at(-1).tag, tag, `template nesting at ${token}`); stack.pop(); continue;
        }
        const attrs = Object.fromEntries([...token.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
        const el = new Node(doc, tag, attrs); stack.at(-1).append(el);
        if (!voids.has(tag) && !token.endsWith('/>')) stack.push(el);
    }
    assert.equal(stack.length, 1);
    return root;
}
const walk = node => [node, ...node.children.flatMap(walk)];

test('all curated disclosure ranges resolve in the real template and restore exact parent/order', async () => {
    const root = await fixture();
    const before = new Map(walk(root).map(el => [el, [...el.children]]));
    const controller = mountCompactDisclosures(root);
    for (let i = 0; i < 3; i++) {
        controller.update(true);
        assert.equal(walk(root).filter(el => el.tag === 'details').length, COMPACT_DISCLOSURES.length);
        assert.equal(walk(root).filter(el => el.tag === 'details').every(el => !el.open), true);
        controller.update(false);
        for (const [el, children] of before) assert.deepEqual(el.children, children, el.id || el.tag);
    }
    controller.dispose();
});
test('library routes expand only their own group, retain identity and preserve user collapse until navigation changes', async () => {
    const root = await fixture(), settings = { lang: 'zh' };
    const control = root.querySelector('#gd-npc-library-select'); control.value = 'draft';
    const controller = mountCompactDisclosures(root, { settings });
    controller.update(true, '#gd-npc-library-select');
    const details = walk(root).find(el => el.dataset.compactId === 'npc-library');
    assert.equal(details.open, true); assert.equal(details.contains(control), true);
    assert.equal(control.value, 'draft'); details.open = false;
    settings.lang = 'en'; controller.update(true, '#gd-npc-library-select');
    assert.equal(details.open, false); assert.equal(details.firstElementChild.textContent, 'NPC library');
    controller.update(true, '#gd-story-blueprint-library-select');
    controller.update(true, '#gd-npc-library-select'); assert.equal(details.open, true);
    controller.dispose(); assert.equal(root.querySelector('#gd-npc-library-select'), control);
});
test('core editors, runtime errors and enable containers stay outside auxiliary disclosures', async () => {
    const root = await fixture(); const controller = mountCompactDisclosures(root); controller.update(true);
    for (const id of ['gd-identity-prompt', 'gd-tester-input', 'gd-cp-new-content', 'gd-story-blueprint-last-error', 'gd-critique-lock-warn', 'gd-npc-enabled']) {
        const node = root.querySelector(`#${id}`); assert.ok(node, id);
        assert.equal(walk(root).some(el => el.tag === 'details' && el.contains(node)), false, id);
    }
    controller.dispose();
});
test('invalid mapping fails before mutating the template', async () => {
    const root = await fixture(), before = walk(root);
    assert.throws(() => mountCompactDisclosures(root, { definitions: [['bad', 'missing', 'missing', '', '']] }), /Invalid compact range/);
    assert.deepEqual(walk(root), before);
});
