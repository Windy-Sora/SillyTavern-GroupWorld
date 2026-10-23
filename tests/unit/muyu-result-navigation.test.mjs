import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceiptView } from '../../muyu/ui/receipt-view.js';
import { createTranscriptView } from '../../muyu/ui/transcript-view.js';
import { receiptNeedsReview, receiptSummary } from '../../muyu/ui/receipt-presentation.js';
import { createArtifactCards } from '../../muyu/ui/artifact-cards.js';
import { initializeDetails, patchReadonly } from '../../muyu/ui/readonly-dom.js';

class Element {
    constructor(tag, doc) { this.tagName = tag; this.ownerDocument = doc; this.children = []; this.textContent = ''; this.attrs = {}; }
    append(el) { el.remove(); this.children.push(el); el.parentElement = this; }
    insertBefore(el, reference) { if (el === reference) return; el.remove(); this.children.splice(reference ? this.children.indexOf(reference) : this.children.length, 0, el); el.parentElement = this; }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
    replaceChildren() { for (const child of [...this.children]) child.remove(); }
    setAttribute(name, value) { this.attrs[name] = value; }
    getAttribute(name) { return this.attrs[name]; }
    removeAttribute(name) { delete this.attrs[name]; }
    get open() { return Object.hasOwn(this.attrs, 'open'); }
    set open(value) { if (value) this.setAttribute('open', ''); else this.removeAttribute('open'); }
    get attributes() { return Object.entries(this.attrs).map(([name, value]) => ({ name, value })); }
}
const descendants = root => [root, ...root.children.flatMap(descendants)];
const result = status => ({ operationId: 'op', artifactId: 'draft', revision: 1, at: 1, status, diff: [], saveError: false, changed: false });

for (const initial of [false, true]) test('Nested artifact disclosure keeps reflected manual state / ' + initial, () => {
    const doc = { createElement: tag => new Element(tag, doc) }, owner = doc.createElement('div');
    const artifact = { id: 'draft', kind: 'inline', revision: 1, content: {} };
    const state = { viewKey: 'a', viewToken: 1, busy: false, artifacts: [artifact] };
    const views = { layout: () => 'inline', title: () => 'Draft', render: (_, { doc, card }) => {
        const detail = doc.createElement('details'), summary = doc.createElement('summary');
        detail.open = initial; summary.textContent = 'Full source'; detail.append(summary); card.append(detail); return true;
    } };
    const cards = createArtifactCards({ doc, views, controller: { snapshot: () => state }, act: fn => fn(), lang: 'en' });
    const root = cards.update(artifact, state, owner, 0), detail = root.children.find(el => el.tagName === 'details');
    detail.open = !initial; state.busy = true; cards.update(artifact, state, owner, 0);
    assert.equal(root.children.find(el => el.tagName === 'details'), detail);
    assert.equal(detail.open, !initial);
    assert.equal(Object.hasOwn(detail.attrs, 'open'), !initial);
    cards.dispose();
});

test('Reflected disclosure defaults still follow meaningful stage changes in both directions', () => {
    const target = new Element('details'), source = new Element('details'), defaults = new WeakMap();
    initializeDetails(target, defaults); target.open = true;
    source.setAttribute('data-state', 'idle'); patchReadonly(target, source, defaults);
    assert.equal(target.open, true); assert.equal(target.getAttribute('data-state'), 'idle');
    target.open = false; source.open = true; patchReadonly(target, source, defaults); assert.equal(target.open, true);
    target.open = false; patchReadonly(target, source, defaults); assert.equal(target.open, false);
    target.open = true; source.open = false; patchReadonly(target, source, defaults); assert.equal(target.open, false);
    target.open = true; patchReadonly(target, source, defaults); assert.equal(target.open, true);
});
function fixture(lang = 'en') {
    const doc = { createElement: tag => new Element(tag, doc) }, root = doc.createElement('div'), history = doc.createElement('div'), cards = doc.createElement('div'), calls = [];
    const state = { viewKey: 'a', viewToken: 1, connection: { model: 'synthetic' }, enabled: true, busy: false, canReadConfig: true, canCheckReceipts: { op: true }, receipts: [result('applied_confirmed')], artifacts: [{ id: 'draft', revision: 1, kind: 'config-draft', content: {} }], messages: [], runs: [], mode: 'assistant' };
    const controller = { snapshot: () => structuredClone(state), explainReceipt: id => calls.push(['explain', id]), checkReceipt: id => calls.push(['check', id]) };
    const view = createReceiptView({ doc, parent: root, controller, act: fn => fn(), lang, locateArtifact: (id, revision) => calls.push(['draft', id, revision]) });
    const views = { layout: () => 'inline', title: () => 'Draft', render: () => true };
    const transcript = createTranscriptView({ doc, history, cards, controller, act: fn => fn(), lang, views, locateReceipt: id => calls.push(['receipt', id]) });
    const render = () => { view.render(state); transcript.update(state); };
    const button = label => descendants(root).find(el => el.tagName === 'button' && el.textContent === label);
    const cleanup = () => { view.dispose(); transcript.dispose(); };
    return { root, history, cards, state, calls, view, transcript, render, button, cleanup };
}

for (const lang of ['zh', 'en']) test('Result cards preserve disclosure and body identity across ordinary state changes / ' + lang, () => {
    const f = fixture(lang); f.render(); const card = f.view.find('op'), body = card.children[1]; assert.equal(card.open, false); card.open = true;
    const source = JSON.stringify(f.state); f.render(); assert.equal(f.view.find('op'), card); assert.equal(card.children[1], body); assert.equal(card.open, true);
    f.state.busy = true; f.render(); assert.equal(f.view.find('op'), card); assert.equal(card.children[1], body); assert.equal(card.open, true);
    assert.equal(f.button(lang === 'en' ? 'Ask Muyu to explain' : '让暮羽解释结果').disabled, true);
    f.state.busy = false; f.render(); assert.equal(JSON.stringify(f.state), source); assert.equal(f.calls.length, 0); f.cleanup();
});

for (const lang of ['zh', 'en']) test('Draft and receipt navigation requires an exact ID and revision / ' + lang, () => {
    const f = fixture(lang); f.render(); const forward = descendants(f.cards).find(el => el.tagName === 'button');
    assert.equal(forward.textContent, lang === 'en' ? 'View operation receipt' : '查看操作回执'); forward.onclick();
    f.button(lang === 'en' ? 'View original draft' : '查看原始草稿').onclick();
    assert.deepEqual(f.calls, [['receipt', 'op'], ['draft', 'draft', 1]]); assert.ok(f.transcript.findArtifact('draft', 1)); assert.equal(f.transcript.findArtifact('draft', 2), null);
    const oldForward = forward.onclick, oldBack = f.button(lang === 'en' ? 'View original draft' : '查看原始草稿').onclick;
    f.state.artifacts[0].revision = 2; f.render(); oldForward(); oldBack(); assert.equal(f.calls.length, 2);
    assert.equal(f.button(lang === 'en' ? 'View original draft' : '查看原始草稿'), undefined);
    assert.equal(descendants(f.cards).filter(el => el.tagName === 'button').length, 0); f.cleanup();
});

for (const status of ['applied_unconfirmed', 'saved_unconfirmed', 'partial', 'outcome_unknown']) test('Unconfirmed, partial and unknown results remain visible in folded summaries / ' + status, () => {
    const f = fixture(); f.state.receipts = [result(status)]; f.render(); const card = f.view.find('op'); assert.equal(card.open, true);
    card.open = false; f.state.busy = true; f.render(); assert.equal(card.open, false); assert.equal(card.getAttribute('data-state'), 'warning');
    assert.match(card.children[0].textContent, /unconfirmed|Partially|unknown/); assert.doesNotMatch(card.children[0].textContent, /save confirmed/); f.cleanup();
});

test('Confirmed results with an additional domain warning are never presented as entirely confirmed', () => {
    const r = { ...result('applied_confirmed'), version: 2, memoryPrune: { settingsSave: 'confirmed', status: 'outcome_unknown' } };
    assert.equal(receiptNeedsReview(r), true); assert.match(receiptSummary(r, 'zh'), /另有保存或变化警告/);
    assert.equal(receiptNeedsReview({ ...result('not_executed'), saveError: true }), true);
    assert.equal(receiptNeedsReview({ ...result('saved_confirmed'), version: 5, fields: [], persistence: 'unconfirmed' }), true);
});

for (const change of ['view', 'connection', 'permission', 'readonly', 'removed']) test('Captured receipt action cannot outlive its scope or permissions / ' + change, () => {
    const f = fixture(); f.render(); const card = f.view.find('op'), captured = f.button('Ask Muyu to explain').onclick;
    if (change === 'view') f.state.viewToken++;
    if (change === 'connection') f.state.connection.model = 'other';
    if (change === 'permission') f.state.canReadConfig = false;
    if (change === 'readonly') f.state.readOnly = true;
    if (change === 'removed') f.state.receipts = [];
    captured(); assert.equal(f.calls.length, 0, 'also rejects before a render arrives'); f.render(); captured(); assert.equal(f.calls.length, 0);
    if (change === 'view' || change === 'removed') assert.ok(!descendants(f.root).includes(card)); f.cleanup();
});

test('Checks and explanation failures update disclosure summaries without changing receipt facts', () => {
    const f = fixture(); f.render(); const card = f.view.find('op'), receipt = JSON.stringify(f.state.receipts);
    f.state.configChecks = { op: { state: 'different', fields: [], readAt: '' } }; f.render(); assert.equal(card.open, true); assert.match(card.children[0].textContent, /Current-value check/);
    f.state.receiptExplanations = { op: 'failed' }; f.render(); assert.match(card.children[0].textContent, /Explanation failed; original result unchanged/);
    assert.equal(JSON.stringify(f.state.receipts), receipt); f.cleanup();
});

test('Unknown versions, detached legacy receipts and disposal never offer guessed navigation', () => {
    const f = fixture(); f.state.receipts = [{ version: 999, operationId: 'unknown' }]; f.render(); assert.equal(descendants(f.root).filter(el => el.tagName === 'button').length, 0);
    f.state.receipts = [result('applied_confirmed')]; f.state.artifacts = []; f.render(); assert.equal(f.button('View original draft'), undefined);
    const callback = f.button('Ask Muyu to explain').onclick; f.cleanup(); f.cleanup(); callback(); assert.equal(f.calls.length, 0);
    assert.equal(f.view.find('op'), null); assert.equal(f.transcript.findArtifact('draft', 1), null); f.view.render(f.state); assert.equal(f.root.children.length, 0);
});
