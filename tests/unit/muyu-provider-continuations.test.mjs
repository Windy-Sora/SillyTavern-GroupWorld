import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderModule } from '../../muyu/modules/providers/index.js';
import { createReadContinuations } from '../../muyu/modules/providers/continuations.js';
import { validateJson } from '../../muyu/core/json-contract.js';
import { createPermissions } from '../../muyu/application/permissions.js';
import { assistantToolAccess } from '../../muyu/application/capabilities.js';
import { createToolBroker } from '../../muyu/tools/broker.js';

function fixture() {
    const target = { kind: 'chat', userKey: 'u', chatKey: 'A' };
    let current = target, reads = 0, body = 'x'.repeat(1999) + '😀' + 'tail';
    const port = { read(id, selector) {
        reads++;
        if (selector && selector !== 'range:0:1') throw Error('INVALID_SELECTOR');
        return { text: id === 'chatHistory' && !selector ? 'messages=1; selected branch' : body, limited: false };
    } };
    const module = createProviderModule({ providerPort: port, currentTarget: () => current });
    const read = (args, runId = 'r', origin = target) => {
        validateJson(module.registry.get('muyu.provider.read').inputSchema, args);
        const value = module.handlers['muyu.provider.read'](args, { runId, target: origin });
        validateJson(module.registry.get('muyu.provider.read').outputSchema, value);
        return value;
    };
    const resume = hint => ({ id: hint.continuation.id, continuationToken: hint.continuation.token });
    return { module, port, target, read, resume, reads: () => reads,
        body: value => { body = value; }, switch: () => { current = { ...target, chatKey: 'B' }; } };
}

test('Directory and page tokens restore exact host arguments without splitting surrogate pairs', () => {
    const f = fixture(), dir = f.read({ id: 'chatHistory' });
    assert.equal(dir.readHint.kind, 'directory');
    const page = f.read(f.resume(dir.readHint));
    assert.equal(page.readHint.kind, 'content');
    assert.equal(page.nextOffset, 1999);
    const tail = f.read(f.resume(page.readHint));
    assert.equal(tail.text, '😀tail'); assert.equal(tail.nextOffset, -1);
    assert.equal(tail.readHint.continuation, undefined);
    assert.equal(f.read(page.readHint.nextRead).text, tail.text); // Legacy API remains valid.
});

test('Invented, cross-source, cross-run and cross-target tokens never invoke the host', () => {
    const f = fixture(), first = f.read({ id: 'recentMessages' }), args = f.resume(first.readHint), before = f.reads();
    for (const [input, run, target] of [
        [{ ...args, continuationToken: 'invented' }, 'r', f.target],
        [{ ...args, id: 'chatHistory' }, 'r', f.target],
        [args, 'other', f.target], [args, 'r', { ...f.target, chatKey: 'B' }],
    ]) assert.match(f.read(input, run, target).status, /INVALID_CONTINUATION|TARGET_UNAVAILABLE/);
    assert.equal(f.reads(), before);
    f.switch(); assert.equal(f.read(args).status, 'TARGET_UNAVAILABLE');
    assert.equal(f.reads(), before);
});

test('Expired tokens and changed source evidence cannot return stale pages', () => {
    const f = fixture(), first = f.read({ id: 'recentMessages' }), args = f.resume(first.readHint);
    f.body('updated');
    const stale = f.read(args);
    assert.equal(stale.status, 'STALE_SOURCE'); assert.equal(stale.text, '');
    assert.equal(stale.readHint.continuation, undefined);
    assert.equal(stale.readHint.error.field, 'revision');
    f.module.forgetRun('r');
    const expired = f.read(args); assert.equal(expired.status, 'INVALID_CONTINUATION');
    assert.equal(expired.readHint.error.field, 'continuationToken');
    f.module.dispose(); assert.equal(f.read(args).status, 'TARGET_UNAVAILABLE');
});

test('Same-task transfer carries tokens and accumulated budget but not the old run handle', () => {
    const f = fixture(); f.module.bindRun('r', 6000); f.body('长'.repeat(5000));
    const first = f.read({ id: 'recentMessages' }), args = f.resume(first.readHint);
    f.module.transferRun('r', 'continued', 96000);
    assert.equal(f.read(args).status, 'INVALID_CONTINUATION');
    const denied = f.read(args, 'continued');
    assert.equal(denied.status, 'BUDGET_EXCEEDED'); assert.equal(denied.readHint.error.retryable, false);
    assert.equal(denied.readHint.continuation, undefined);
    assert.equal(f.module.usage('continued').limit, 6000);
});

test('Argument errors give safe exact recovery advice and do not read data', () => {
    const f = fixture();
    for (const args of [{ id: 'chatHistory', offset: 10 }, { id: 'chatHistory', continuationToken: 'fake', selector: '' }]) {
        const value = f.read(args); assert.equal(value.status, 'INVALID_READ_ARGUMENTS');
        assert.equal(value.readHint.error.field, 'arguments'); assert.match(value.readHint.error.expected, /Do not mix/);
    }
    assert.equal(f.reads(), 0);
    const bad = f.read({ id: 'chatHistory', selector: '0:20', revision: '', offset: 0 });
    assert.equal(bad.status, 'INVALID_SELECTOR'); assert.equal(bad.readHint.error.field, 'selector');
    assert.doesNotMatch(JSON.stringify(bad.readHint), /😀|tail/);
});

test('Continuation tokens never bypass Broker authorization or revocation', async () => {
    const f = fixture(), permissions = createPermissions();
    const first = f.read({ id: 'recentMessages' }), args = f.resume(first.readHint), before = f.reads();
    const broker = createToolBroker({ registry: f.module.registry, handlers: f.module.handlers, runId: 'r', target: f.target, signal: new AbortController().signal,
        allowedTools: ['muyu.provider.read'], policy: ({ definition, args, target }) => assistantToolAccess(definition, args, target, 'task', permissions, f.port).decision === true });
    let sequence = 0;
    const call = () => broker.call({ toolId: 'muyu.provider.read', version: 2, callId: 'call' + ++sequence, args });
    assert.equal((await call()).error.code, 'PERMISSION_DENIED'); assert.equal(f.reads(), before);
    permissions.grantSource('source:recentMessages', f.target);
    assert.equal((await call()).data.text, '😀tail');
    permissions.revoke('source:recentMessages', f.target);
    const after = f.reads(); assert.equal((await call()).error.code, 'PERMISSION_DENIED'); assert.equal(f.reads(), after);
});

test('Continuation references are bounded and isolated copies, not executable data', () => {
    const store = createReadContinuations(), target = { kind: 'global', userKey: 'u' };
    const args = { id: 'recentMessages', selector: '', revision: 'r', offset: 1 };
    const first = store.issue(args, target); args.offset = 999;
    const resolved = store.resolve(first.id, first.token, target); assert.equal(resolved.offset, 1);
    resolved.offset = 888; assert.equal(store.resolve(first.id, first.token, target).offset, 1);
    for (let offset = 2; offset <= 128; offset++) assert.ok(store.issue({ ...args, offset }, target));
    assert.equal(store.issue({ ...args, offset: 129 }, target), null);
});

test('Same-task transfer resumes the referenced page without resetting its usage', () => {
    const f = fixture(); f.module.bindRun('r', 24000);
    const first = f.read({ id: 'recentMessages' }), used = f.module.usage('r').used;
    f.module.transferRun('r', 'next', 24000);
    const last = f.read(f.resume(first.readHint), 'next');
    assert.equal(last.text, '😀tail'); assert.equal(f.module.usage('next').used, used + new TextEncoder().encode(last.text).length);
});

test('Async reads finishing after run cleanup cannot publish data or mint references', async () => {
    let resolve;
    const target = { kind: 'chat', userKey: 'u', chatKey: 'A' };
    const module = createProviderModule({ currentTarget: () => target, providerPort: { read: () => new Promise(r => { resolve = r; }) } });
    const pending = module.handlers['muyu.provider.read']({ id: 'recentMessages' }, { runId: 'r', target });
    module.forgetRun('r'); resolve({ text: 'PRIVATE'.repeat(1000), limited: false });
    const result = await pending;
    assert.equal(result.status, 'TARGET_UNAVAILABLE'); assert.equal(result.text, '');
    assert.equal(result.readHint.continuation, undefined);
});
