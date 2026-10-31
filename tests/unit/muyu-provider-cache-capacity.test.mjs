import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderModule } from '../../muyu/modules/providers/index.js';
import { validateJson } from '../../muyu/core/json-contract.js';
import { createProcessStore } from '../../muyu/application/process-store.js';
import { diagnosticExport } from '../../muyu/application/diagnostic-export.js';
function fixture() {
    const target = { kind: 'global', userKey: 'u' }, values = new Map();
    let actual = target, asynchronous = false;
    const module = createProviderModule({ globalTarget: target, currentTarget: () => actual.kind === 'chat' ? actual : null,
        providerPort: { read(id, selector) { const value = values.get(selector) || { text: selector || 'root', limited: false }; return asynchronous ? Promise.resolve(value) : value; } } });
    const read = (selector = '', revision = '', offset = 0, runId = 'run') => {
        const result = module.handlers['muyu.provider.read']({ id: 'stCharacterComponents', selector, revision, offset }, { runId, target });
        const check = value => { validateJson(module.registry.get('muyu.provider.read').outputSchema, value); return value; };
        return result?.then ? result.then(check) : check(result);
    };
    const token = (value, runId = 'run') => module.handlers['muyu.provider.read']({ id: 'stCharacterComponents', continuationToken: value.readHint.continuation.token }, { runId, target });
    return { module, values, target, read, token, defer: () => { asynchronous = true; } };
}
test('more than 16 stable selectors can be read with correct parent evidence; old page tokens remain valid', () => {
    const f = fixture(); f.module.bindRun('run', 100000);
    f.values.set('card:0:regex:0', { text: 'x'.repeat(1999) + '🦉' + 'tail', limited: false });
    const root = f.read(), card = f.read('card:0', root.revision), page = f.read('card:0:regex:0', card.revision);
    for (let i = 1; i <= 48; i++) assert.equal(f.read('card:0:regex:' + i, card.revision).status, 'ok');
    const tail = f.token(page); assert.equal(tail.status, 'ok'); assert.equal(tail.text, '🦉tail');
    assert.equal(f.read('card:0', root.revision).revision, card.revision);
    f.values.set('card:0:regex:0', { text: 'CHANGED', limited: false });
    assert.equal(f.token(page).status, 'STALE_SOURCE'); // More capacity never weakens freshness.
});
test('reference capacity returns an explicit stop with no relist loop and no eviction of active pages', () => {
    const f = fixture(); f.module.bindRun('run', 1000000);
    f.values.set('card:0:regex:0', { text: 'x'.repeat(2500), limited: false });
    let root = f.read(), card = f.read('card:0', root.revision); const page = f.read('card:0:regex:0', card.revision);
    let full, index;
    for (index = 1; index < 1024; index++) { const result = f.read('card:0:regex:' + index, card.revision); if (result.status !== 'ok') { full = result; break; } }
    assert.ok(index > 16); assert.equal(full?.status, 'SOURCE_CACHE_FULL');
    assert.equal(full.readHint.recovery, 'stop'); assert.equal(full.readHint.error.retryable, false); assert.equal(full.readHint.nextRead, undefined);
    assert.equal(f.module.usage('run').exhausted, false);
    assert.equal(f.token(page).status, 'ok');
    root = f.read(); card = f.read('card:0', root.revision);
    assert.equal(f.read('card:0:regex:' + index, card.revision).status, 'SOURCE_CACHE_FULL');
    const freshRoot = f.read('', '', 0, 'new'), freshCard = f.read('card:0', freshRoot.revision, 0, 'new');
    assert.equal(f.read('card:0:regex:' + index, freshCard.revision, 0, 'new').status, 'ok');
});
test('UTF-8 evidence capacity is separate from data budget and rejects new evidence without replacing old references', () => {
    const f = fixture(); f.module.bindRun('run', 1000000);
    f.values.set('card:0:regex:0', { text: 'x'.repeat(2500), limited: false });
    const root = f.read(), card = f.read('card:0', root.revision), page = f.read('card:0:regex:0', card.revision);
    let full, index;
    for (index = 1; index <= 64; index++) {
        f.values.set('card:0:regex:' + index, { text: 'entry ' + index, limited: false, identity: '🦉'.repeat(100000) });
        const value = f.read('card:0:regex:' + index, card.revision); if (value.status !== 'ok') { full = value; break; }
    }
    assert.ok(index < 32, 'byte guard must count UTF-8 evidence, not just code units or returned page text');
    assert.equal(full?.status, 'SOURCE_CACHE_FULL'); assert.equal(f.module.usage('run').exhausted, false);
    assert.equal(f.token(page).status, 'ok');
    // Replacement accounts for the old evidence, not cumulative re-read size.
    for (let i = 0; i < 4; i++) {
        f.values.set('card:0:regex:1', { text: 'updated ' + i, limited: false, identity: '🦉'.repeat(100000) });
        assert.equal(f.read('card:0:regex:1', card.revision).status, 'ok');
    }
    f.values.set('card:0:regex:1', { text: 'smaller evidence', limited: false });
    assert.equal(f.read('card:0:regex:1', card.revision).status, 'ok');
    assert.equal(f.read('card:0:regex:' + index, card.revision).status, 'ok');
    f.values.set('card:0:regex:0', { text: 'replacement', limited: false, identity: 'x'.repeat(8388608) });
    assert.equal(f.read('card:0:regex:0', card.revision).status, 'SOURCE_CACHE_FULL');
    f.values.set('card:0:regex:0', { text: 'x'.repeat(2500), limited: false });
    assert.equal(f.token(page).status, 'ok');
});
test('capacity accounting transfers with the run; target, budget and run cleanup keep their original boundaries', () => {
    const f = fixture(); f.module.bindRun('run', 100000);
    f.values.set('card:0:regex:0', { text: 'x'.repeat(2500), limited: false });
    const root = f.read(), card = f.read('card:0', root.revision), page = f.read('card:0:regex:0', card.revision);
    for (let i = 1; i < 40; i++) assert.equal(f.read('card:0:regex:' + i, card.revision).status, 'ok');
    f.module.transferRun('run', 'next', 100000); assert.equal(f.token(page, 'next').status, 'ok');
    assert.equal(f.token(page).status, 'INVALID_CONTINUATION');
    f.module.forgetRun('next'); assert.equal(f.token(page, 'next').status, 'INVALID_CONTINUATION');
    f.module.bindRun('limited', 6000); f.module.charge('limited', 6000); assert.equal(f.read('', '', 0, 'limited').status, 'BUDGET_EXCEEDED');
    f.module.dispose(); assert.equal(f.read().status, 'TARGET_UNAVAILABLE');
});
test('cache capacity remains recognizable in process logs and safe diagnostic exports', () => {
    const store = createProcessStore(); store.create('r');
    store.event('r', { runId: 'r', seq: 1, type: 'tool.completed', payload: { attemptId: 1, toolId: 'muyu.provider.read', result: { ok: true, data: {
        source: 'stCharacterComponents', status: 'SOURCE_CACHE_FULL', text: '', nextOffset: -1, truncated: false, readAt: new Date().toISOString(), private: 'PRIVATE_SENTINEL',
    } } } });
    const process = store.snapshot('r'); assert.equal(process.rows[0].read.status, 'SOURCE_CACHE_FULL');
    const exported = diagnosticExport({ runs: [{ id: 'r', status: 'succeeded', process }] }, 1);
    assert.equal(JSON.parse(exported).runs[0].rows[0].read.status, 'SOURCE_CACHE_FULL'); assert.doesNotMatch(exported, /PRIVATE_SENTINEL/);
});
test('concurrent async reads cannot overcommit the last source-cache reference slot', async () => {
    const f = fixture(); f.module.bindRun('run', 1000000);
    const root = f.read(), card = f.read('card:0', root.revision);
    for (let i = 0; i < 253; i++) assert.equal(f.read('card:0:regex:' + i, card.revision).status, 'ok');
    f.defer();
    const result = await Promise.all([f.read('card:0:regex:1000', card.revision), f.read('card:0:regex:1001', card.revision)]);
    assert.deepEqual(result.map(row => row.status).sort(), ['SOURCE_CACHE_FULL', 'ok']);
    assert.equal((await f.read('card:0:regex:1002', card.revision)).status, 'SOURCE_CACHE_FULL');
    assert.equal(f.module.usage('run').exhausted, false);
});
