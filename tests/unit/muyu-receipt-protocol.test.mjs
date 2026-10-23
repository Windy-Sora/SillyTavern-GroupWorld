import test from 'node:test';
import assert from 'node:assert/strict';
import { builtinActionDescriptors } from '../../muyu/actions/builtins.js';
import { receiptProtocol, receiptProtocolDescriptors, actionReceiptProtocol, validateReceiptOwners } from '../../muyu/actions/receipt-protocol.js';
import { actionReceipt, validateReceipt, receiptSources, receiptContext, receiptText, receiptStatuses } from '../../muyu/actions/receipts.js';
import { receiptPresentationDescriptors } from '../../muyu/ui/receipt-presentation.js';

const diff = [{ field: 'autoMemoryInterval', before: '10', after: '15' }];
function content(version) {
    const c = { module: receiptProtocol(version).modules.find(v => v !== undefined), operation: 'update',
        name: 'Example', id: 'id', selector: 'item:0', character: 'character:0', index: 0,
        preview: { id: 'gold', diff }, next: { name: 'Example', providerName: 'Example' },
        completion: { before: { exists: false } }, libraryId: 'lib', count: 0 };
    if (version === undefined || version === 2) { delete c.operation; c.preview = { contractVersion: version, diff }; if (version === undefined) delete c.preview.contractVersion; }
    if (version === 3) c.preview.diff = [{ field: 'label', before: 'Old', after: 'New' }];
    if ([4, 9].includes(version)) { c.variables = [{ preview: { id: 'gold', diff: [{ field: 'label', before: 'Old', after: 'New' }] } }]; c.scripts = version === 9 ? [{ id: 'script', operation: 'create', next: { name: 'Example' } }] : []; }
    if (version === 5) c.fields = ['autoMemoryInterval'];
    if ([6, 7].includes(version)) { c.ids = ['Example']; if (version === 6) delete c.operation; }
    if ([11, 13].includes(version)) { c.operation = 'batch'; c.origin = 'batch'; c.entries = [{ operation: 'create', id: '', next: c.next }]; c.skipped = []; }
    if ([15, 17, 19].includes(version)) c.operation = 'apply';
    if (version === 24) delete c.operation;
    if (version === 26) c.kind = 'worldbooks';
    if (version === 27) c.operation = 'move';
    if ([28, 30, 31].includes(version)) c.operation = 'create';
    if (version === 29) c.operation = 'initialize';
    if (version === 33) c.selector = 'card:0';
    if (version === 34) c.selector = 'preset:0';
    return c;
}
const action = (c, status = 'outcome_unknown') => ({ id: 'op', artifactId: 'a', revision: 1, content: c, status, result: {} });

test('Receipt registry covers every action kind and GUI version with isolated metadata', () => {
    const actions = builtinActionDescriptors(), rows = receiptProtocolDescriptors();
    validateReceiptOwners(actions); assert.equal(rows.length, 35);
    assert.deepEqual(rows.map(r => r.version), [undefined, ...Array.from({ length: 34 }, (_, i) => i + 2)]);
    assert.deepEqual(receiptPresentationDescriptors(), rows.map(({ version, config, technical }) => ({ version, config, technical })));
    rows[0].owners[0].id = 'wrong'; rows[0].modules.push('unknown'); rows[0].sources = 'none';
    assert.equal(receiptProtocol(undefined).owners[0].id, 'actions'); assert.equal(receiptProtocol(undefined).sources, 'config');
    assert.ok(!receiptProtocol(undefined).modules.includes('unknown'));
    assert.throws(() => validateReceiptOwners(actions.map(a => a.id === 'actions' ? { ...a, id: 'wrong' } : a)), /INVALID_RECEIPT_OWNER/);
    assert.throws(() => validateReceiptOwners([...actions, { id: 'future', artifactKinds: ['future'] }]), /MISSING_RECEIPT_PROTOCOL/);
    assert.throws(() => validateReceiptOwners([...actions, actions[0]]), /DUPLICATE_RECEIPT_OWNER/);
});

test('All wire versions keep terminal statuses, closed validation, historical text and model projection', () => {
    for (const { version } of receiptProtocolDescriptors()) for (const status of receiptStatuses) {
        const c = content(version), receipt = actionReceipt(action(c, status));
        assert.equal(actionReceiptProtocol(c).version, version); assert.equal(receipt.version, version);
        assert.equal(receipt.status, status); assert.deepEqual(validateReceipt(receipt), receipt);
        assert.throws(() => validateReceipt({ ...receipt, granted: true }));
        for (const lang of ['zh', 'en']) assert.match(receiptText(receipt, lang), lang === 'zh' ? /历史/ : /Historical/);
        const context = receiptContext([receipt]); assert.match(context, /historical reference only/); assert.match(context, /historicalExplanation/);
        assert.deepEqual(receiptSources(receipt), version === undefined || version === 2 ? ['source:memoryConfig'] : [3, 4, 9].includes(version) ? ['source:variables'] : []);
    }
});

test('Shared and historical action variants have exact routing without guessing an owner', () => {
    for (const module of ['profile-editor', 'npc-editor']) {
        const receipt = actionReceipt(action({ module, operation: 'create' }));
        assert.equal(receipt.version, 30); assert.equal(receipt.kind, module === 'profile-editor' ? 'profile' : 'npc');
    }
    for (const module of [undefined, 'memory-config', 'settings-config']) for (const version of [undefined, 2]) {
        assert.equal(actionReceipt(action({ module, preview: { ...(version === 2 ? { contractVersion: 2 } : {}), diff } })).version, version);
    }
    for (const module of ['future-editor', 'constructor', '__proto__', 'config', '', null]) {
        assert.throws(() => actionReceipt(action({ module, preview: { diff } })), /UNKNOWN_RECEIPT_MODULE/);
    }
    assert.throws(() => actionReceipt(action(undefined)), /UNKNOWN_RECEIPT_MODULE/);
});

test('Unknown wire versions fail before schema, permission projection or model explanation fallback', () => {
    const receipt = actionReceipt(action(content(undefined)));
    for (const version of [0, 1, 36, '2', null, '__proto__']) {
        assert.equal(receiptProtocol(version), undefined);
        for (const call of [validateReceipt, receiptSources, receiptText, r => receiptContext([r])]) {
            assert.throws(() => call({ ...receipt, version }), /UNKNOWN_RECEIPT_VERSION/);
        }
    }
});

test('Source grants retain per-domain settings, variable steps and multi-save scope boundaries', () => {
    const c = content(2); c.preview.diff = [{ field: 'memoryMaxEntries', before: '200', after: '10' }, { field: 'storyBlueprintCompletionVariable', before: 'old', after: 'new' }];
    c.memoryPrunePlan = { target: { chatKey: 'PRIVATE_CHAT' }, total: 3 };
    c.completionVariablePlan = { target: { chatKey: 'PRIVATE_CHAT' } };
    const receipt = actionReceipt(action(c, 'partial'));
    assert.deepEqual(receiptSources(receipt), ['source:memoryConfig', 'source:configSettings', 'source:memoryDiagnostics', 'source:variables']);
    assert.doesNotMatch(receiptContext([receipt]), /PRIVATE_CHAT|chatKey/);
    assert.match(receiptContext([receipt]), /"status":"partial"/);
    const b = content(9); b.settings = { preview: { diff: [...diff, { field: 'topN', before: '1', after: '2' }] } };
    assert.deepEqual(receiptSources(actionReceipt(action(b))), ['source:variables', 'source:memoryConfig', 'source:configSettings']);
});

test('Model projection preserves original bounded excerpts and no-diff receipts omit private content', () => {
    const c = content(2); c.preview.diff = [{ field: 'llmPrompt', before: 'x'.repeat(800), after: 'y'.repeat(800) }];
    const context = receiptContext([actionReceipt(action(c))]);
    const projected = JSON.parse(context.slice(context.lastIndexOf('\n') + 1));
    assert.equal(projected[0].diff[0].before, 'x'.repeat(500) + '… [display excerpt, not the complete value]');
    for (const { version } of receiptProtocolDescriptors().filter(r => r.projection === 'identity')) {
        const c = { ...content(version), code: 'PRIVATE_CODE', body: 'PRIVATE_BODY', apiKey: 'PRIVATE_KEY' };
        assert.doesNotMatch(receiptContext([actionReceipt(action(c))]), /PRIVATE_CODE|PRIVATE_BODY|PRIVATE_KEY/);
    }
    const b = content(4); b.variables[0].preview.diff = [{ field: 'label', before: 'x'.repeat(800), after: 'y'.repeat(800) }];
    assert.match(receiptContext([actionReceipt(action(b))]), /excerpt/);
});
