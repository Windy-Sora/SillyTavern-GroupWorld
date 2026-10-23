import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReceipt, receiptText, receiptContext, receiptStatuses } from '../../muyu/actions/receipts.js';
import { createSessionLibrary } from '../../muyu/sessions/library.js';
import { createMemoryHistoryStore } from '../../muyu/sessions/memory-store.js';
import { importedRecord } from '../../muyu/sessions/exchange.js';

const receipt = () => ({ operationId: 'op', artifactId: 'a', revision: 1, at: 1, status: 'applied_unconfirmed', diff: [{ field: 'autoMemoryInterval', before: '10', after: '15' }], saveError: true, changed: true });
test('Receipt contract is closed, bounded and never equates proposal with execution', () => {
    for (const status of receiptStatuses) assert.match(receiptText(validateReceipt({ ...receipt(), status })), /不单独证明批准或执行成功/);
    for (const patch of [{ approved: true }, { at: 1e30 }, { status: 'pending' }, { diff: [{ field: 'apiKey', before: '', after: '' }] }]) assert.throws(() => validateReceipt({ ...receipt(), ...patch }));
    assert.equal(receiptContext([]), '');
    const context = receiptContext([receipt()]);
    assert.match(context, /NOT whether this operation made a change/);
    assert.match(context, /does not undo or disprove the in-memory assignment/);
    assert.match(context, /historicalExplanation/);
    assert.equal((receiptContext(Array.from({ length: 5 }, (_, i) => ({ ...receipt(), operationId: String(i) }))).match(/operationId/g) || []).length, 3);
});
test('Receipt persistence deduplicates, restores inert facts, and import never restores authority', async () => {
    const store = createMemoryHistoryStore(), port = { enabled: () => true, open: async () => store };
    const a = createSessionLibrary({ port }); await a.ready;
    const id = a.create(JSON.stringify(['draft', 'global', null]));
    a.recordReceipt(id, receipt()); a.recordReceipt(id, receipt()); await a.flush();
    const b = createSessionLibrary({ port }); await b.ready; const record = await b.load(id);
    assert.equal(record.version, 4); assert.equal(record.receipts.length, 1); assert.deepEqual(record.required, ['diagnostics']);
    assert.match(a.export(id, 'markdown'), /persistence unconfirmed/);
    const imported = importedRecord(record); assert.equal(imported.imported, true); assert.equal(imported.receipts.length, 1);
    assert.equal(Object.hasOwn(imported, 'configActions'), false);
    await a.close(); await b.close();
});
test('History save failure keeps the receipt and retry only persists data', async () => {
    const backing = createMemoryHistoryStore(); let fail = true;
    const store = { ...backing, async write(...args) { if (fail) throw Error('storage failed'); return backing.write(...args); } };
    const a = createSessionLibrary({ port: { enabled: () => true, open: async () => store } }); await a.ready;
    const scope = JSON.stringify(['draft', 'global', null]), id = a.create(scope);
    a.recordReceipt(id, receipt()); await a.flush();
    assert.equal(a.get(id).receipts.length, 1); assert.equal(a.snapshot(scope, id).dirty, true);
    fail = false; await a.retry(); await a.flush(); assert.equal((await backing.read(id)).receipts.length, 1);
    await a.close();
});
