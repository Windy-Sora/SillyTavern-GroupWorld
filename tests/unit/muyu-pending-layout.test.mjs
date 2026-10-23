import test from 'node:test';
import assert from 'node:assert/strict';
import { createPendingCardLayout } from '../../muyu/ui/pending-card-layout.js';
import { createPermissionView } from '../../muyu/ui/permission-view.js';
import { createInteractionView } from '../../muyu/ui/interaction-view.js';
import { errorDestination } from '../../muyu/ui/error-navigation.js';

class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.style = { setProperty: (key, value) => this.attrs[key] = value }; }
    append(el) { this.children.push(el); el.parent = this; }
    setAttribute(key, value) { this.attrs[key] = value; }
    replaceChildren() { this.children = []; }
    remove() { this.parent.children = this.parent.children.filter(el => el !== this); }
    focus() { this.focused = true; }
}
const all = root => [root, ...root.children.flatMap(all)];

test('Pending layout follows actual transcript height, ignores zero and late resize, and disconnects', () => {
    let resize, watched, disconnects = 0;
    const doc = { defaultView: { ResizeObserver: class { constructor(callback) { resize = callback; } observe(el) { watched = el; } disconnect() { disconnects++; } } } };
    const root = new Element('section'), parent = new Element('div'); parent.clientHeight = 600;
    const layout = createPendingCardLayout({ doc, root, parent });
    assert.equal(watched, parent); assert.equal(root.attrs['--gd-muyu-operation-height'], '576px');
    parent.clientHeight = 240; resize(); assert.equal(root.attrs['--gd-muyu-operation-height'], '216px');
    parent.clientHeight = 0; resize(); assert.equal(root.attrs['--gd-muyu-operation-height'], '216px');
    layout.dispose(); layout.dispose(); parent.clientHeight = 800; resize();
    assert.equal(disconnects, 1); assert.equal(root.attrs['--gd-muyu-operation-height'], '216px');
});

for (const lang of ['zh', 'en']) for (const kind of ['permission', 'clarification']) test(`Pending body and buttons stay separate, drafts survive notifications / ${lang}/${kind}`, () => {
    const doc = { createElement: tag => new Element(tag) }, parent = new Element('div'), settings = new Element('div');
    let state = { viewToken: 1, connection: { model: 'test', endpoint: 'https://example.test' }, interaction: { id: 'one', kind, status: 'pending', source: 'recentMessages', reason: 'Read', question: 'Which?', options: ['short'], draft: 'keep' } };
    const calls = [], controller = { snapshot: () => state, answerPermission: (...args) => calls.push(args), setInteractionDraft: (...args) => calls.push(args), answerInteraction: (...args) => calls.push(args), cancelInteraction: (...args) => calls.push(args) };
    const factory = kind === 'permission' ? createPermissionView : createInteractionView;
    const view = factory({ doc, parent, settings, controller, act: fn => fn(), lang }); view.render(state);
    const root = view.operationTarget, body = root.children.find(el => el.className === 'gd-muyu-interaction-body'), actions = root.children.find(el => el.className === 'gd-muyu-actions');
    assert.ok(body); assert.ok(actions); assert.equal(actions.parent, root); assert.equal(all(body).some(el => el === actions), false);
    if (kind === 'permission') {
        assert.match(body.children[0].textContent, /test.*https:\/\/example.test/);
        assert.ok(all(body).some(el => el.textContent?.includes(lang === 'en' ? 'Read access does not approve' : '读取授权不批准')));
    }
    const input = all(body).find(el => el.tag === 'textarea'); if (input) input.focus();
    body.scrollTop = 40; view.render(structuredClone(state));
    assert.equal(root.children.find(el => el.className === body.className), body); assert.equal(body.scrollTop, 40);
    if (input) { assert.equal(input.value, 'keep'); assert.equal(input.focused, true); }
    const stale = actions.children[0].onclick;
    state.interaction = { ...state.interaction, id: 'two' }; stale(); assert.equal(calls.length, 0);
    view.render(state); actions.children[0].onclick(); assert.equal(calls.at(-1)[0], 'two');
    const old = actions.children[0].onclick; state.connection.endpoint = 'https://other.test'; old(); assert.equal(calls.length, 1);
    view.render(state); const disposed = actions.children[0].onclick; view.dispose(); disposed(); assert.equal(calls.length, 1);
});

test('Clarification choices fill only the exact current draft; grant changes invalidate captured callbacks', () => {
    const doc = { createElement: tag => new Element(tag) }, parent = new Element('div');
    const state = { interaction: { id: 'q', kind: 'clarification', status: 'pending', question: 'Style?', draft: '', options: ['short'] }, sourceGrants: [] };
    const calls = [], controller = { snapshot: () => state, setInteractionDraft: (...args) => calls.push(args) };
    const view = createInteractionView({ doc, parent, controller, act: fn => fn(), lang: 'en' }); view.render(state);
    const choice = all(parent).find(el => el.tag === 'button' && el.textContent === 'short'), old = choice.onclick;
    state.sourceGrants.push('source:recentMessages'); old(); assert.equal(calls.length, 0);
    view.render(state); assert.equal(all(parent).find(el => el.textContent === 'short'), choice);
    choice.onclick(); assert.deepEqual(calls, [['q', 'short']]); view.dispose();
});

test('Error destinations distinguish input, output, data, connection, access and unknown writes', () => {
    assert.equal(errorDestination('CONTEXT_LIMIT'), 'context');
    assert.equal(errorDestination('MODEL_OUTPUT_TRUNCATED'), 'output');
    assert.equal(errorDestination('BUDGET_EXCEEDED', 'provider_bytes'), 'dataBudget');
    assert.equal(errorDestination('BUDGET_EXCEEDED', 'run_time'), 'time');
    assert.equal(errorDestination('BUDGET_EXCEEDED', 'model_calls'), 'run');
    assert.equal(errorDestination('MODEL_AUTH_ERROR'), 'connection');
    assert.equal(errorDestination('HISTORY_PERMISSION_REQUIRED'), 'historyAccess');
    assert.equal(errorDestination('HISTORY_SYNC_FAILED'), 'storage');
    assert.equal(errorDestination('RECOVERY_UNCERTAIN'), 'results');
    assert.equal(errorDestination('<script>unsafe</script>'), null);
});
