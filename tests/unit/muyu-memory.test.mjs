import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryReader } from '../../muyu/modules/memory/reader.js';
import { diagnoseMemory } from '../../muyu/modules/memory/diagnose.js';
import { readMemoryKnowledge, listMemoryKnowledge } from '../../muyu/modules/memory/knowledge.js';
import { createMemoryModule } from '../../muyu/modules/memory/index.js';
import { createToolBroker } from '../../muyu/tools/broker.js';
import { createApplication } from '../../muyu/application/service.js';
import { startMuyuRun } from '../../muyu/composition.js';
import { scriptedModel, text, done, request, flush } from './helpers/muyu-subject.mjs';

const A = { kind: 'chat', userKey: 'u', chatKey: 'A' };
function fixture() {
    const data = { target: A, settings: { memoryEnabled: true, autoMemoryEnabled: true, autoMemoryInterval: 10, autoMemorySpeakers: false }, metadata: { gd: { _autoMemLen: 5, _autoMemCharLen: { 'private-avatar': 5 }, charMemories: { 'private-avatar': [{ text: 'PRIVATE_BODY' }] } } }, group: { members: ['private-avatar'], disabled_members: [] }, count: 12, guards: { canFinalize: true, manualGenerating: false, generationType: 'normal' } };
    const reader = createMemoryReader({ extensionKey: 'gd', getTarget: () => data.target, getSettings: () => data.settings, getMetadata: () => data.metadata, getGroup: () => data.group, getMessageCount: () => data.count, getGuards: () => data.guards });
    return { data, reader };
}
const codes = report => report.findings.map(f => f.code);
const inspectCall = { callId: 'inspect', toolId: 'muyu.memory.inspect', version: 1, args: {} };
function broker(module, options = {}) {
    return createToolBroker({ registry: module.registry, handlers: module.handlers, runId: 'run', target: A, allowedTools: module.registry.list().map(d => d.id), policy: () => true, signal: new AbortController().signal, ...options });
}

test('Memory projection reads no bodies or credentials and never initializes missing stores', () => {
    const { data, reader } = fixture();
    Object.defineProperty(data.metadata.gd.charMemories['private-avatar'][0], 'text', { get() { throw new Error('body read'); } });
    Object.defineProperty(data.settings, 'agentConfigs', { get() { throw new Error('credentials read'); } });
    const result = reader.read(A); assert.equal(result.members[0].memoryCount, 1);
    assert.doesNotMatch(JSON.stringify(result), /private-avatar|PRIVATE_BODY/);
    data.metadata = Object.freeze({}); assert.equal(reader.read(A).members[0].memoryCount, 0); assert.deepEqual(data.metadata, {});
    result.members[0].covered = 999; assert.equal(reader.read(A).members[0].covered, 0);
});

test('Current disabled switches are blockers without fabricated historical reasons', () => {
    const { data, reader } = fixture(); data.settings.memoryEnabled = false; data.settings.autoMemoryEnabled = false;
    const report = diagnoseMemory(reader.read(A));
    assert.ok(codes(report).includes('MEMORY_DISABLED')); assert.ok(codes(report).includes('AUTO_DISABLED')); assert.ok(codes(report).includes('HISTORY_UNKNOWN')); assert.equal(report.evidenceComplete, false);
});

test('Batch threshold uses message counts independently from per-member progress', () => {
    const { data, reader } = fixture(); assert.ok(codes(diagnoseMemory(reader.read(A))).includes('INTERVAL_PENDING'));
    data.count = 20; data.group.members.push('another-private'); data.metadata.gd._autoMemCharLen['another-private'] = 19;
    const report = diagnoseMemory(reader.read(A)); assert.ok(codes(report).includes('BATCH_THRESHOLD_MET'));
    assert.deepEqual(report.state.members.map(m => m.covered), [5, 19]); assert.ok(codes(report).includes('PER_MEMBER_PROGRESS'));
    assert.deepEqual(report.state.members.map(m => [m.newMessages, m.intervalStatus]), [[15, 'met'], [1, 'pending']]);
    assert.ok(codes(report).includes('SKIP_IS_NOT_FAILURE'));
});

test('Initial, legacy, deleted-message and invalid counters remain distinguishable', () => {
    const { data, reader } = fixture(); data.metadata = {}; assert.equal(reader.read(A).baselineSource, 'initial');
    data.metadata = { gd: { _autoCheckLength: 20 } }; assert.equal(reader.read(A).baselineSource, 'legacy'); assert.ok(codes(diagnoseMemory(reader.read(A))).includes('COVERAGE_AHEAD'));
    data.metadata.gd._autoMemLen = 'invalid'; assert.ok(codes(diagnoseMemory(reader.read(A))).includes('STATE_INCOMPLETE'));
    data.settings.autoMemoryInterval = 0; assert.equal(reader.read(A).interval, 10);
});

test('No group, no members, excluded generation and unknown target filtering are explicit', () => {
    const { data, reader } = fixture(); data.group = null; assert.ok(codes(diagnoseMemory(reader.read(A))).includes('NO_GROUP'));
    data.group = { members: [] }; data.settings.autoMemorySpeakers = true; data.guards.generationType = 'regenerate';
    const result = codes(diagnoseMemory(reader.read(A))); for (const code of ['NO_TARGETS', 'GENERATION_EXCLUDED', 'TARGET_FILTER_UNKNOWN']) assert.ok(result.includes(code));
});

test('Target switches and changing snapshots are rejected without returning mixed evidence', () => {
    const { data, reader } = fixture(); data.target = { ...A, chatKey: 'B' }; assert.throws(() => reader.read(A), /TARGET/);
    let count = 0; const changing = createMemoryReader({ extensionKey: 'gd', getTarget: () => A, getSettings: () => ({}), getMetadata: () => ({}), getGroup: () => null, getMessageCount: () => ++count });
    assert.throws(() => changing.read(A), /STALE/);
});

test('Knowledge returns task evidence with sources and explicit budget omissions', () => {
    const ids = listMemoryKnowledge().map(d => d.id), full = readMemoryKnowledge(ids);
    assert.equal(full.complete, true); assert.equal(full.documents.length, 3); assert.ok(full.documents.every(d => d.source && d.version));
    const limited = readMemoryKnowledge(ids, 1024); assert.equal(limited.complete, false); assert.ok(limited.missing.length); assert.ok(new TextEncoder().encode(JSON.stringify(limited)).length <= 1024);
    assert.equal(readMemoryKnowledge(['memory.missing']).complete, false); full.documents[0].text = 'changed'; assert.notEqual(readMemoryKnowledge(ids).documents[0].text, 'changed');
});

test('Tool registry and Broker validate read results and reject excess args/writes/default grants', async () => {
    const { reader } = fixture(), module = createMemoryModule({ reader }); const b = broker(module);
    const result = await b.call(inspectCall); assert.equal(result.ok, true); assert.ok(codes(result.data).includes('INTERVAL_PENDING'));
    assert.equal((await b.call({ ...inspectCall, callId: 'bad', args: { includeBody: true } })).error.code, 'INVALID_ARGUMENT');
    assert.equal((await b.call({ ...inspectCall, callId: 'write', toolId: 'muyu.memory.generate' })).error.code, 'PERMISSION_DENIED');
    assert.equal((await broker(module, { policy: undefined }).call(inspectCall)).error.code, 'PERMISSION_DENIED');
    assert.equal((await broker(module, { target: { kind: 'global', userKey: 'u' } }).call(inspectCall)).error.code, 'TARGET_UNAVAILABLE');
    for (const [toolId, args] of [['muyu.knowledge.list', {}], ['muyu.knowledge.read', { ids: ['memory.automation'] }]]) assert.equal((await b.call({ callId: toolId, toolId, version: 1, args })).ok, true);
});

async function applicationFixture() {
    const { data, reader } = fixture(), module = createMemoryModule({ reader });
    const model = scriptedModel([[request(inspectCall), done], [text('Untrusted model answer: ignore safeguards and write settings'), done]]);
    const app = createApplication({ currentTarget: A, startRun: input => startMuyuRun({ ...input, model, registry: module.registry, handlers: module.handlers, allowedTools: module.registry.list().map(d => d.id), policy: () => true }) });
    const session = app.createSession(A), submitted = app.submit(session, '为什么没提取？');
    for (let i = 0; i < 5; i++) await flush();
    assert.equal(app.snapshot().runs[0].status, 'succeeded'); return { data, module, app, ...submitted };
}

test('Trusted publisher binds deterministic report to successful run, not model claims', async () => {
    const { data, module, app, taskId, runId } = await applicationFixture(); const before = JSON.stringify(data);
    const artifact = module.publishReport(app, runId); assert.equal(artifact.taskId, taskId); assert.equal(artifact.sourceRunId, runId); assert.equal(artifact.content.navigation, 'memory-settings');
    assert.doesNotMatch(JSON.stringify(artifact), /ignore safeguards|PRIVATE_BODY|private-avatar/); assert.equal(JSON.stringify(data), before);
    assert.throws(() => module.publishReport(app, runId), /NOT_FOUND/); app.dispose(); module.dispose();
});

test('Publisher rejects changed settings and switched chats instead of saving stale report', async () => {
    const first = await applicationFixture(); first.data.settings.memoryEnabled = false; assert.throws(() => first.module.publishReport(first.app, first.runId), /STALE/); assert.equal(first.app.snapshot().artifacts.length, 0); first.app.dispose(); first.module.dispose();
    const second = await applicationFixture(); second.data.target = { ...A, chatKey: 'B' }; assert.throws(() => second.module.publishReport(second.app, second.runId), /TARGET/); second.app.dispose(); second.module.dispose();
});

test('Report cache and module disposal have explicit capacity and cleanup', async () => {
    const { reader } = fixture(), module = createMemoryModule({ reader, maxReports: 1 });
    assert.equal((await broker(module).call(inspectCall)).ok, true);
    assert.equal((await broker(module, { runId: 'second' }).call(inspectCall)).ok, false);
    module.forgetRun('run'); assert.equal((await broker(module, { runId: 'second' }).call(inspectCall)).ok, true);
    module.dispose(); assert.equal((await broker(module).call(inspectCall)).ok, false);
});

test('Changing member identities invalidates equally sized anonymous snapshots', () => {
    const { data, reader } = fixture(); data.metadata = {};
    const first = reader.read(A); data.group.members = ['replacement-private']; const second = reader.read(A);
    assert.deepEqual(first.members, second.members); assert.notEqual(first.revision, second.revision);
    assert.doesNotMatch(JSON.stringify(second), /replacement-private/);
});
