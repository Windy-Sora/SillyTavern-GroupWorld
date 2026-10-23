import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../../settings.js';
import { createConfigDraftModule } from '../../muyu/modules/config-draft/index.js';
import { getMemoryConfigContract, memoryFields } from '../../muyu/modules/config-draft/contracts.js';
import { previewMemoryConfig, readConfigBaseline } from '../../muyu/modules/config-draft/preview.js';
import { validateConfigProfileManifest } from '../../systems/config-profile-validation.js';
import { createApplication } from '../../muyu/application/service.js';
import { startMuyuRun } from '../../muyu/composition.js';
import { createToolBroker } from '../../muyu/tools/broker.js';
import { createConfigProfileSubject } from './helpers/config-profile-subject.mjs';
import { scriptedModel, text, done, request, flush } from './helpers/muyu-subject.mjs';

const target = { kind: 'chat', userKey: 'u', chatKey: 'A' };
const baseline = { memoryEnabled: false, autoMemoryEnabled: false, autoMemoryInterval: 10, autoMemorySpeakers: false };
const call = changes => ({ callId: 'preview', toolId: 'muyu.config.preview', version: 1, args: { changes } });
const preview = (changes, extra = {}) => previewMemoryConfig({ baseline, changes, allowedFields: ['autoMemoryInterval'], ...extra });

test('Draft contract matches defaults and explicitly narrows UI interval range', () => {
    const contract = getMemoryConfigContract();
    for (const entry of contract.fields) assert.equal(JSON.parse(entry.defaultValue), DEFAULT_SETTINGS[entry.field]);
    assert.match(contract.fields.find(f => f.field === 'autoMemoryInterval').constraint, /不是运行时/);
    assert.deepEqual(Object.keys(readConfigBaseline({ ...baseline, secret: 'hidden' })), memoryFields);
});

test('Minimal draft changes only requested interval, warns but never enables dependencies', () => {
    const result = preview({ autoMemoryInterval: 20 });
    assert.deepEqual(result.manifest.settings, { autoMemoryInterval: 20 }); assert.deepEqual(result.diff, [{ field: 'autoMemoryInterval', before: '10', after: '20' }]);
    assert.deepEqual(result.warnings, ['MEMORY_NOT_ENABLED', 'AUTO_NOT_ENABLED']); assert.equal(result.intent, 'requires_user_review');
    assert.equal(validateConfigProfileManifest(result.manifest), result.manifest);
});

test('Explicit switches are allowed only by trusted scope and no fields are default-filled', () => {
    assert.throws(() => preview({ memoryEnabled: true }), /OUT_OF_SCOPE/);
    const result = preview({ memoryEnabled: true, autoMemoryEnabled: true }, { allowedFields: ['memoryEnabled', 'autoMemoryEnabled'] });
    assert.deepEqual(result.manifest.settings, { memoryEnabled: true, autoMemoryEnabled: true }); assert.deepEqual(result.warnings, []);
    assert.equal(preview({ autoMemoryInterval: 20 }, { baseline: {} }).diff[0].before, '(missing)');
});

test('Unknown fields, numeric coercion, out-of-range values and manifest injection are rejected', () => {
    for (const changes of [{ autoMemoryInterval: '20' }, { autoMemoryInterval: 0 }, { autoMemoryInterval: 201 }, { autoMemoryInterval: 1.5 }, { drawers: {} }, { agentConfigs: {} }, { memoryEnabled: null }, {}]) assert.throws(() => preview(changes));
    assert.throws(() => preview(JSON.parse('{"__proto__":{}}')));
});

test('Baseline reader never touches model credentials or prompt properties', () => {
    const settings = { ...baseline }; for (const key of ['agentConfigs', 'memoryPrompt']) Object.defineProperty(settings, key, { get() { throw new Error('private'); } });
    assert.deepEqual(readConfigBaseline(settings), baseline);
});

test('Preview diff matches actual isolated config application and preserves unrelated settings', async () => {
    for (const changes of [{ autoMemoryInterval: 20 }, { memoryEnabled: true }, { autoMemorySpeakers: true, autoMemoryEnabled: true }]) {
        const result = preview(changes, { allowedFields: memoryFields });
        const { subject, settings, calls } = createConfigProfileSubject({ ...baseline, memoryPrompt: 'untouched', customPrompts: [] });
        const profile = { id: 'synthetic', name: 'synthetic', ...structuredClone(result.manifest) }; settings.configProfiles.push(profile);
        const before = structuredClone(settings); const applied = await subject.applyProfile('synthetic');
        assert.deepEqual(applied.changed.sort(), result.diff.map(d => d.field).sort());
        for (const key of Object.keys(before)) if (!(key in changes)) assert.deepEqual(settings[key], before[key]);
        assert.equal(calls.variableImports.length, 0);
    }
});

function moduleFixture() {
    const data = { settings: { ...baseline }, target };
    const module = createConfigDraftModule({ getSettings: () => data.settings, getTarget: () => data.target });
    return { data, module };
}
function broker(module) {
    return createToolBroker({ registry: module.registry, handlers: module.handlers, runId: 'r', target, allowedTools: module.registry.list().map(d => d.id), policy: () => true, signal: new AbortController().signal });
}
test('Broker denies invalid fields and module requires trusted run scope binding', async () => {
    const { module } = moduleFixture(); assert.equal((await broker(module).call(call({ autoMemoryInterval: 20 }))).ok, false);
    module.bindRun({ runId: 'r', taskId: 't', target, allowedFields: ['autoMemoryInterval'] });
    assert.equal((await broker(module).call(call({ autoMemoryInterval: '20' }))).error.code, 'INVALID_ARGUMENT');
    const denied = await broker(module).call(call({ memoryEnabled: true })); assert.deepEqual(denied.data.errors, ['OUT_OF_SCOPE']);
    const valid = await broker(module).call(call({ autoMemoryInterval: 20 })); assert.equal(valid.ok, true); assert.equal(valid.data.previews.length, 1); module.dispose();
});

async function appFixture() {
    const { data, module } = moduleFixture(); let changes = { autoMemoryInterval: 20 }, previousArtifact = null, candidateId;
    const app = createApplication({ currentTarget: target, startRun: input => {
        module.bindRun({ runId: input.identity.id, taskId: input.identity.taskId, target: input.identity.target, allowedFields: ['autoMemoryInterval'], previousArtifact });
        const model = scriptedModel([[request(call(changes)), done], [text('Draft only'), done]]);
        return startMuyuRun({ ...input, model, registry: module.registry, handlers: module.handlers, allowedTools: module.registry.list().map(d => d.id), policy: () => true, onEvent: e => { input.onEvent(e); if (e.type === 'tool.completed') candidateId = e.payload.result.data.candidateId; } });
    } });
    const sid = app.createSession(target), submitted = app.submit(sid, 'Only change interval to20');
    async function wait() { for (let i = 0; i < 5; i++) await flush(); }
    await wait();
    return { data, module, app, ...submitted, candidate: () => candidateId, async next(artifact, value) { previousArtifact = artifact; changes = { autoMemoryInterval: value }; const runId = app.continueTask(submitted.taskId, 'change interval'); await wait(); return runId; } };
}

test('Trusted publication and validation are separate; continuation invalidates old revision validation', async () => {
    const f = await appFixture(), before = JSON.stringify(f.data);
    const first = f.module.publishDraft(f.app, f.runId, f.candidate()); assert.equal(first.validation, null);
    const validated = f.module.validateSaved(f.app, first.id, 1); assert.equal(validated.validation.structural, 'passed');
    const nextRun = await f.next(validated, 30); const second = f.module.publishDraft(f.app, nextRun, f.candidate());
    assert.equal(second.revision, 2); assert.equal(second.validation, null); assert.equal(second.content.producedByRunId, nextRun);
    assert.equal(f.app.getArtifact(first.id, 1).validation.structural, 'passed'); assert.throws(() => f.module.validateSaved(f.app, first.id, 1), /STALE/);
    assert.equal(JSON.stringify(f.data), before); f.app.dispose(); f.module.dispose();
});

test('Changed baseline or chat prevents publishing, and latest candidate ID is required', async () => {
    const f = await appFixture(); assert.throws(() => f.module.publishDraft(f.app, f.runId, 'guessed'), /SOURCE/);
    f.data.settings.autoMemoryInterval = 15; assert.throws(() => f.module.publishDraft(f.app, f.runId, f.candidate()), /STALE/);
    f.data.settings.autoMemoryInterval = 10; f.data.target = { ...target, chatKey: 'B' }; assert.throws(() => f.module.publishDraft(f.app, f.runId, f.candidate()), /TARGET/); assert.equal(f.app.snapshot().artifacts.length, 0); f.app.dispose(); f.module.dispose();
});

test('Concurrent artifact edit prevents continuation from overwriting new revision', async () => {
    const f = await appFixture(), first = f.module.publishDraft(f.app, f.runId, f.candidate());
    const run = await f.next(first, 30); f.app.updateArtifact(first.id, 1, { ...first.content, note: 'concurrent' });
    assert.throws(() => f.module.publishDraft(f.app, run, f.candidate()), /STALE/); assert.equal(f.app.getArtifact(first.id).content.note, 'concurrent'); f.app.dispose(); f.module.dispose();
});

test('No-op proposals stay minimal and can be validated as no effective change', async () => {
    const f = await appFixture(); const first = f.module.publishDraft(f.app, f.runId, f.candidate()); const run = await f.next(first, 10);
    const cleared = f.module.publishDraft(f.app, run, f.candidate()); assert.deepEqual(cleared.content.preview.manifest.settings, {});
    assert.equal(f.module.validateSaved(f.app, cleared.id, 2).validation.semantic, 'warnings'); f.app.dispose(); f.module.dispose();
});

test('Continuation rejects a draft belonging to another task', async () => {
    const f = await appFixture(), artifact = f.module.publishDraft(f.app, f.runId, f.candidate());
    assert.throws(() => f.module.bindRun({ runId: 'other', taskId: 'wrong-task', target, allowedFields: ['autoMemoryInterval'], previousArtifact: artifact }), /INVALID_PREVIOUS/);
    f.app.dispose(); f.module.dispose();
});

test('Saved validation checks baseline freshness and cannot certify forged preview labels', async () => {
    const f = await appFixture(), artifact = f.module.publishDraft(f.app, f.runId, f.candidate());
    f.data.settings.autoMemoryEnabled = true;
    assert.throws(() => f.module.validateSaved(f.app, artifact.id, 1), /STALE_BASELINE/);
    assert.equal(f.app.getArtifact(artifact.id).validation, null);
    f.data.settings.autoMemoryEnabled = false;
    const forged = structuredClone(artifact.content); forged.preview.semantic = 'passed';
    f.app.updateArtifact(artifact.id, 1, forged); assert.throws(() => f.module.validateSaved(f.app, artifact.id, 2), /INVALID_DRAFT/);
    f.app.dispose(); f.module.dispose();
});

test('Draft module lifecycle clears bindings and limits stored runs', () => {
    const module = createConfigDraftModule({ getSettings: () => baseline, getTarget: () => target, maxRuns: 1 });
    const bind = runId => module.bindRun({ runId, taskId: 't', target, allowedFields: ['autoMemoryInterval'] });
    bind('one'); assert.throws(() => bind('two'), /CAPACITY/); module.forgetRun('one'); bind('two'); module.dispose(); assert.throws(() => bind('three'), /DISPOSED/);
});
