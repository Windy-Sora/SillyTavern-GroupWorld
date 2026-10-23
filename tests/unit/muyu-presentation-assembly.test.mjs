import test from 'node:test';
import assert from 'node:assert/strict';
import { createArtifactViews } from '../../muyu/ui/artifact-view-registry.js';
import { createBuiltinArtifactViews } from '../../muyu/ui/artifact-views.js';
import { builtinActionDescriptors } from '../../muyu/actions/builtins.js';
import { receiptPresentation, receiptPresentationDescriptors } from '../../muyu/ui/receipt-presentation.js';

const actions = [{ id: 'testActions', artifactKinds: ['future-draft'] }];
const descriptor = () => ({ kind: 'future-draft', title: ['测试草稿', 'Test draft'], layout: 'inline', role: 'action', actionOwner: 'testActions', render() {} });
test('Presentation rejects duplicated, incomplete, missing or incorrectly owned action routes', () => {
    assert.throws(() => createArtifactViews([descriptor(), descriptor()], actions), /INVALID/);
    for (const patch of [{ title: ['one'] }, { render: null }, { actionOwner: null }, { actionOwner: 'other' }, { layout: 'anchored-details' }, { role: 'report' }]) {
        assert.throws(() => createArtifactViews([{ ...descriptor(), ...patch }], actions), /INVALID/);
    }
    assert.throws(() => createArtifactViews([descriptor()], [...actions, { id: 'missing', artifactKinds: ['missing-draft'] }]), /MISSING/);
});
test('All production action kinds have explicit bilingual rendering and non-writing cards remain separate', () => {
    const views = createBuiltinArtifactViews(), rows = views.describe(); assert.equal(rows.length, 28);
    for (const action of builtinActionDescriptors()) for (const kind of action.artifactKinds) {
        const row = rows.find(r => r.kind === kind); assert.equal(row.actionOwner, action.id); assert.equal(row.role, 'action');
        assert.equal(views.layout(kind), 'inline'); assert.equal(views.title(kind, 'zh'), row.title[0]); assert.equal(views.title(kind, 'en'), row.title[1]);
    }
    for (const kind of ['task-plan', 'report']) { assert.equal(rows.find(r => r.kind === kind).actionOwner, null); assert.equal(views.layout(kind), 'anchored-details'); }
    assert.equal(views.title('report'), '排查报告'); assert.equal(views.title('task-plan', 'en'), 'Task plan');
});
test('Rendering uses exact owner and supplied controller; descriptors contain no executable callbacks', () => {
    const calls = [], d = descriptor(); d.render = ctx => calls.push(ctx);
    const views = createArtifactViews([d], actions), controller = { shouldNotRun() { throw Error('unexpected operation'); } };
    assert.equal(views.render('future-draft', { controller }), true); assert.equal(calls.length, 1); assert.equal(calls[0].controller, controller);
    assert.equal(views.describe()[0].render, undefined);
    views.describe()[0].title[0] = 'changed'; d.title[0] = 'mutated'; assert.equal(views.title('future-draft'), '测试草稿');
});
test('Unknown artifacts never fall back to configuration render or acquire an apply route', () => {
    const views = createBuiltinArtifactViews();
    for (const kind of ['future', '__proto__', 'constructor', '', undefined]) {
        assert.equal(views.render(kind, null), false); assert.equal(views.layout(kind), 'inline'); assert.equal(views.title(kind), '暂不支持的产物');
    }
});
test('Report and read-review layouts cannot be assigned to writing kinds', () => {
    for (const [kind, role] of [['report', 'report'], ['task-plan', 'read-review']]) {
        const d = { ...descriptor(), kind, role, actionOwner: null, layout: 'anchored-details' };
        assert.equal(createArtifactViews([d], []).describe()[0].role, role);
        assert.throws(() => createArtifactViews([{ ...d, kind: 'config-draft' }], []), /INVALID/);
        assert.throws(() => createArtifactViews([{ ...d, actionOwner: 'testActions' }], actions), /INVALID/);
    }
});
test('Every supported receipt version has explicit technical rendering and only config receipts have shortcuts', () => {
    const rows = receiptPresentationDescriptors(); assert.equal(rows.length, 35);
    assert.deepEqual(rows.map(r => r.version), [undefined, ...Array.from({ length: 34 }, (_, i) => i + 2)]);
    for (const version of [undefined, 2]) {
        const diff = [{ field: 'autoMemoryInterval' }], p = receiptPresentation({ version, diff });
        assert.equal(p.supported, true); assert.equal(p.config, true); assert.deepEqual(p.diffs, [diff]);
    }
    for (let version = 3; version <= 34; version++) {
        const r = { version, steps: [], fields: [] }, p = receiptPresentation(r); assert.equal(p.supported, true); assert.equal(p.config, false);
    }
    rows[0].config = false; assert.equal(receiptPresentation({ diff: [] }).config, true);
});
test('Bundle receipt technical diffs exclude variable/script steps; saved profiles show raw fields only', () => {
    for (const version of [4, 9]) {
        const diff = [{ field: 'mode' }]; const receipt = { version, steps: [{ kind: 'variable', diff: [{ field: 'value' }] }, { kind: 'settings', diff }, { kind: 'script' }] };
        assert.deepEqual(receiptPresentation(receipt).diffs, [diff]);
    }
    assert.deepEqual(receiptPresentation({ version: 5, fields: ['mode'] }), { supported: true, config: false, diffs: [], fields: ['mode'] });
});
test('Unknown receipt versions cannot reach diff formatting or enable explanation/check actions', () => {
    for (const version of [0, 1, 36, '2', '__proto__', null]) assert.deepEqual(receiptPresentation({ version }), { supported: false, config: false, diffs: [], fields: null });
});
