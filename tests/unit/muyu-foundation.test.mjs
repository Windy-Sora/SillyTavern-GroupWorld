import test from 'node:test';
import assert from 'node:assert/strict';
import { copyJson, jsonKey, checkSchema, validateJson } from '../../muyu/core/json-contract.js';
import { createToolRegistry } from '../../muyu/tools/registry.js';
import { createRunState, transitionRun, interruptRestoredRun } from '../../muyu/core/run-state.js';

const schema = { type: 'object', properties: { enabled: { type: 'boolean' }, interval: { type: 'integer', minimum: 1 } }, required: ['enabled'], additionalProperties: false };
const definition = () => ({ id: 'muyu.memory.read_status', version: 1, description: 'Safe statistics', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, outputSchema: schema, scope: 'chat', effect: 'read', dataClasses: ['settings.safe'], confirmation: 'policy', timeoutMs: 5000, retryPolicy: { kind: 'read', maxAttempts: 1 }, resourceKeys: ['chat.memory'] });
const initial = () => createRunState({ id: 'r1', sessionId: 's1', taskId: 't1', target: { kind: 'chat', userKey: 'user1', chatKey: 'group:A' } });
const event = (seq, status) => ({ eventId: 'e' + seq, runId: 'r1', seq, status });

test('Muyu JSON copies isolate references and canonical identities ignore key order', () => {
    const input = { x: [{ y: 1 }] }, out = copyJson(input);
    out.x[0].y = 2; assert.equal(input.x[0].y, 1);
    assert.equal(jsonKey({ b: 2, a: 1 }), jsonKey({ a: 1, b: 2 }));
});
test('Muyu JSON rejects executable, cyclic, sparse and non-finite data without invoking getters', () => {
    let invoked = 0;
    const getter = Object.defineProperty({}, 'x', { enumerable: true, get() { invoked++; return 1; } });
    const cyclic = {}; cyclic.x = cyclic;
    for (const input of [getter, cyclic, [, 1], Infinity, undefined, () => {}, new Date(), { x: BigInt(1) }, JSON.parse('{"__proto__":{}}')]) assert.throws(() => copyJson(input));
    assert.equal(invoked, 0);
});
test('Muyu JSON limits include UTF-8 size and nesting', () => {
    assert.throws(() => copyJson('羽'.repeat(12000)), /byte limit/);
    let v = {}; for (let i = 0; i < 20; i++) v = { v }; assert.throws(() => copyJson(v));
});
test('Muyu schemas are closed and reject unsupported keywords', () => {
    for (const s of [{ ...schema, additionalProperties: true }, { ...schema, pattern: '.*' }, { type: 'array' }, { type: 'string', minimum: 1 }]) assert.throws(() => checkSchema(s));
    assert.deepEqual(validateJson(schema, { enabled: false, interval: 4 }), { enabled: false, interval: 4 });
    for (const v of [{}, { enabled: 'false' }, { enabled: true, interval: 0 }, { enabled: true, interval: 1.5 }, { enabled: true, extra: 1 }]) assert.throws(() => validateJson(schema, v));
});
test('Muyu schemas validate array items and enum values', () => {
    const s = { type: 'array', items: { type: 'string', enum: ['ok'] }, maxItems: 1 };
    assert.deepEqual(validateJson(s, ['ok']), ['ok']);
    for (const v of [['bad'], [1], ['ok', 'ok']]) assert.throws(() => validateJson(s, v));
});
test('Muyu registry pins isolated immutable definitions and seals registrations', () => {
    const r = createToolRegistry(), d = definition(); r.register(d); d.description = 'changed';
    assert.equal(r.get(d.id).description, 'Safe statistics');
    assert.throws(() => { r.get(d.id).inputSchema.properties.x = {}; }, TypeError);
    r.list().pop(); assert.equal(r.list().length, 1);
    assert.throws(() => r.register(definition()), /Duplicate/);
    r.seal(); assert.throws(() => r.register({ ...definition(), id: 'muyu.memory.other' }), /sealed/);
});
test('Muyu registry rejects unsafe retry and malformed metadata, not executing any handler', () => {
    for (const override of [{ effect: 'write' }, { timeoutMs: 0 }, { confirmation: 'allow' }, { execute() {} }, { scope: 'anywhere' }]) assert.throws(() => createToolRegistry().register({ ...definition(), ...override }));
});
test('Muyu pure reducer accepts waiting/continuation and terminal transitions without mutating target', () => {
    const original = initial(); let state = original;
    for (const [i, status] of ['running', 'awaiting_input', 'running', 'succeeded'].entries()) state = transitionRun(state, event(i + 1, status));
    assert.equal(original.status, 'queued'); assert.equal(state.target.chatKey, 'group:A');
    assert.equal(state.status, 'succeeded'); assert.throws(() => transitionRun(state, event(5, 'running')), /terminal/);
});
test('Muyu reducer deduplicates exact events but rejects gaps, target injection and foreign runs', () => {
    const s = transitionRun(initial(), event(1, 'running'));
    assert.deepEqual(transitionRun(s, event(1, 'running')), s);
    for (const e of [event(3, 'failed'), { ...event(2, 'failed'), runId: 'other' }, { ...event(2, 'failed'), target: { chatKey: 'B' } }, event(1, 'failed')]) assert.throws(() => transitionRun(s, e));
});
test('Muyu cancellation prevents success and queued runs can be cancelled', () => {
    let s = transitionRun(initial(), event(1, 'running')); s = transitionRun(s, event(2, 'cancelling'));
    assert.throws(() => transitionRun(s, event(3, 'succeeded')));
    assert.equal(transitionRun(s, event(3, 'cancelled')).status, 'cancelled');
    assert.equal(transitionRun(initial(), event(1, 'cancelled')).status, 'cancelled');
});
test('Muyu restore interrupts active and approval-waiting snapshots, preserving target', () => {
    let s = transitionRun(initial(), event(1, 'running')); s = transitionRun(s, event(2, 'awaiting_approval'));
    const restored = interruptRestoredRun(s); assert.equal(restored.status, 'interrupted'); assert.equal(restored.lastEvent, null);
    assert.deepEqual(restored.target, s.target); assert.equal(s.status, 'awaiting_approval');
    assert.throws(() => interruptRestoredRun({ ...s, schemaVersion: 2 }));
});
