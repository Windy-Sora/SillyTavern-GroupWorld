import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderPort } from '../../muyu/host/providers.js';
import { createProviderModule } from '../../muyu/modules/providers/index.js';
import { readMemoryConfig } from '../../muyu/host/config-read.js';
import { createToolBroker } from '../../muyu/tools/broker.js';
import { validateJson } from '../../muyu/core/json-contract.js';

function fixture() {
    const settings = { memoryEnabled: true, autoMemoryEnabled: false, autoMemoryInterval: 15, apiKey: 'NEVER_SEND' };
    const globalTarget = { kind: 'global', userKey: 'u' }, chat = { kind: 'chat', userKey: 'u', chatKey: 'A' };
    let current = chat;
    const port = createProviderPort({ getSettings: () => settings, getContext: () => { throw Error('No chat read'); }, extensionKey: 'gd', bindings: [{ id: 'memoryConfig', render() { throw Error('Never render'); } }] });
    const module = createProviderModule({ providerPort: port, globalTarget, currentTarget: () => current });
    const args = { id: 'memoryConfig', selector: '', revision: '', offset: 0 };
    const read = (patch = {}, target = globalTarget) => {
        const r = module.handlers['muyu.provider.read']({ ...args, ...patch }, { runId: 'r', target });
        validateJson(module.registry.get('muyu.provider.read').outputSchema, r); return r;
    };
    return { module, settings, globalTarget, chat, read, args, switch: () => { current = null; } };
}
test('Structured config source shares Provider entry, preserves missing/unsupported and never reads other settings', () => {
    const f = fixture();
    Object.defineProperty(f.settings, 'secretGetter', { get() { throw Error('private'); } });
    const r = f.read(); assert.equal(r.status, 'ok'); assert.equal(r.data.persistence, 'unknown');
    assert.equal(r.data.fields.find(x => x.field === 'autoMemorySpeakers').state, 'missing');
    assert.equal(r.data.fields.find(x => x.field === 'autoMemoryInterval').value, '15');
    assert.equal(r.data.presentation.find(x => x.field === 'memoryEnabled').value.zh, '开启');
    assert.equal(r.data.presentation.find(x => x.field === 'autoMemorySpeakers').value.zh, '缺失／未读取');
    assert.doesNotMatch(JSON.stringify(r), /NEVER_SEND|secretGetter/);
    f.settings.autoMemoryInterval = 'secret invalid value';
    assert.deepEqual(f.read().data.fields.find(x => x.field === 'autoMemoryInterval'), { field: 'autoMemoryInterval', state: 'unsupported', value: '' });
    f.settings.autoMemoryInterval = 25; assert.equal(f.read().data.fields.find(x => x.field === 'autoMemoryInterval').value, '25');
    f.module.dispose();
});
test('Source-level scope preserves chat isolation and rejects all structured pagination arguments', () => {
    const f = fixture();
    for (const patch of [{ selector: 'character:0' }, { revision: 'old' }, { offset: 1 }]) assert.equal(f.read(patch).status, 'INVALID_SELECTOR');
    assert.equal(f.read({}, { kind: 'global', userKey: 'other' }).status, 'TARGET_UNAVAILABLE');
    assert.equal(f.read({ id: 'recentMessages' }).status, 'TARGET_UNAVAILABLE');
    assert.equal(f.read({}, f.chat).status, 'ok'); f.switch();
    assert.equal(f.read({}, f.chat).status, 'TARGET_UNAVAILABLE');
    assert.equal(f.read().status, 'ok'); f.module.dispose();
});
test('Structured snapshots consume byte budget without truncating objects', () => {
    const f = fixture(); f.module.bindRun('r', 6000);
    const first = f.read(); const bytes = new TextEncoder().encode(JSON.stringify(first.data)).length;
    assert.equal(f.module.usage('r').used, bytes);
    let last;
    for (let i = 0; i < 30; i++) last = f.read();
    assert.equal(last.status, 'BUDGET_EXCEEDED'); assert.equal(Object.hasOwn(last, 'data'), false);
    assert.ok(f.module.usage('r').used <= 6000); f.module.dispose();
});
test('Provider v2 and policy gate run before the structured adapter', async () => {
    const f = fixture(); let read = 0;
    const handler = f.module.handlers['muyu.provider.read'];
    const broker = createToolBroker({ registry: f.module.registry, handlers: { 'muyu.provider.read': (...args) => { read++; return handler(...args); } }, runId: 'r', target: f.globalTarget, signal: new AbortController().signal, allowedTools: ['muyu.provider.read'], policy: () => false });
    const call = { toolId: 'muyu.provider.read', version: 2, callId: 'one', args: f.args };
    assert.equal((await broker.call(call)).error.code, 'PERMISSION_DENIED');
    assert.equal((await broker.call({ ...call, version: 1, callId: 'old' })).error.code, 'UNSUPPORTED_CAPABILITY');
    assert.equal(read, 0); f.module.dispose();
});
test('Inconsistent config reads and replaced objects cannot publish a mixed snapshot', () => {
    assert.throws(() => readMemoryConfig(() => ({})), /STALE_SOURCE/);
    let value = 0; const settings = { get autoMemoryInterval() { return ++value; } };
    assert.throws(() => readMemoryConfig(() => settings), /STALE_SOURCE/);
});
test('Malformed structured adapter output is rejected rather than forwarding unknown fields', () => {
    const f = fixture(); const invalid = { ...f.read().data, apiKey: 'secret' };
    const m = createProviderModule({ globalTarget: f.globalTarget, providerPort: { read: () => ({ data: invalid }) } });
    const result = m.handlers['muyu.provider.read'](f.args, { runId: 'r', target: f.globalTarget });
    assert.equal(result.status, 'SOURCE_UNAVAILABLE'); assert.doesNotMatch(JSON.stringify(result), /secret/);
    m.dispose(); f.module.dispose();
});
