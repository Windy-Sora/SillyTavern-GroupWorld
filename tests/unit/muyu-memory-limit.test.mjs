import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryLimitPort } from '../../muyu/host/memory-limit.js';
import { createConfigWriter } from '../../muyu/host/config-write.js';
import { createSettingsModule } from '../../muyu/modules/settings/index.js';
import { actionReceipt, receiptContext, receiptSources, validateReceipt } from '../../muyu/actions/receipts.js';
import { requiredSources } from '../../muyu/application/capabilities.js';

function fixture(saveSettings = async () => undefined) {
    const settings = { memoryMaxEntries: 200 };
    const targetA = { kind: 'chat', userKey: 'u', chatKey: 'A' }, targetB = { kind: 'chat', userKey: 'u', chatKey: 'B' };
    const metadataA = { gd: { charMemories: { alice: Array.from({ length: 13 }, (_, i) => ({ event: 'secret-a-' + i })), bob: Array.from({ length: 11 }, (_, i) => ({ event: 'secret-b-' + i })) } } };
    const metadataB = { gd: { charMemories: { carol: [{ event: 'other chat' }] } } };
    let target = targetA, metadata = metadataA, prunes = 0;
    const port = createMemoryLimitPort({ getTarget: () => target, getMetadata: () => metadata, extensionKey: 'gd', memorySystem: {
        isPruning: () => false,
        async pruneAfter() {
            prunes++;
            for (const entries of Object.values(metadata.gd.charMemories)) entries.splice(0, Math.max(0, entries.length - settings.memoryMaxEntries));
        },
    } });
    const writer = createConfigWriter({ getSettings: () => settings, saveSettings, isBusy: () => false, memoryLimitPort: port });
    return { settings, port, writer, targetA, targetB, metadataA, metadataB, switchChat() { target = targetB; metadata = metadataB; }, prunes: () => prunes };
}

test('Memory-limit preview exposes counts, never raw memory or character IDs', () => {
    const f = fixture(), plan = f.port.plan(f.targetA, 10);
    assert.equal(plan.total, 4);
    assert.deepEqual(plan.counts, [{ slot: 1, before: 13, remove: 3 }, { slot: 2, before: 11, remove: 1 }]);
    assert.doesNotMatch(JSON.stringify(plan), /secret-a|secret-b|alice|bob/);
    assert.deepEqual(requiredSources('muyu.settings.preview', { changes: { memoryMaxEntries: 10 } }), ['source:memoryConfig', 'source:memoryDiagnostics']);
    assert.throws(() => f.port.plan(f.targetA, 9), /INVALID_MEMORY_LIMIT/);
});

test('Memory-limit draft is separate, chat-bound, and stale after a concurrent memory edit', () => {
    const f = fixture(), module = createSettingsModule({ getSettings: () => f.settings, getTarget: () => f.targetA, memoryLimitPort: f.port });
    module.bindRun({ id: 'r', taskId: 't', target: f.targetA });
    const ctx = { runId: 'r', target: f.targetA, signal: new AbortController().signal };
    assert.throws(() => module.handlers['muyu.settings.preview']({ changes: { memoryMaxEntries: 10, memoryKeepRecent: 5 } }, ctx), /MEMORY_LIMIT_REQUIRES_SEPARATE_DRAFT/);
    const result = module.handlers['muyu.settings.preview']({ changes: { memoryMaxEntries: 10 } }, ctx);
    assert.equal(JSON.parse(result.text).impact.remove, 4);
    const artifact = { id: 'a', revision: 1, kind: 'config-draft' };
    const app = { snapshot: () => ({ runs: [{ id: 'r', taskId: 't', status: 'succeeded', target: f.targetA }] }),
        createArtifact: value => Object.assign(artifact, value), getArtifact: () => artifact,
        validateArtifact: () => ({ status: 'valid' }) };
    module.publishDraft(app, 'r', result.candidateId);
    f.port.assertFresh(artifact.content.memoryPrunePlan);
    f.metadataA.gd.charMemories.bob.push({ event: 'concurrent' });
    assert.throws(() => module.validateSaved(app, 'a', 1), /STALE_MEMORY_PREVIEW/);
    module.dispose();
});

test('Approved memory limit saves global settings then prunes only the bound chat', async () => {
    const f = fixture(), plan = f.port.plan(f.targetA, 10);
    await assert.rejects(f.writer.apply({ baseline: { memoryMaxEntries: 200 }, changes: { memoryMaxEntries: 10 }, contractVersion: 2 }), /WRITE_UNAVAILABLE/);
    assert.equal(f.settings.memoryMaxEntries, 200);
    const result = await f.writer.apply({ baseline: { memoryMaxEntries: 200 }, changes: { memoryMaxEntries: 10 }, contractVersion: 2, memoryPrunePlan: plan });
    assert.equal(result.status, 'applied_unconfirmed');
    assert.deepEqual(result.memoryPrune, { status: 'pruned', removed: 4 });
    assert.equal(f.prunes(), 1);
    assert.equal(f.metadataA.gd.charMemories.alice.length, 10);
    assert.equal(f.metadataA.gd.charMemories.bob.length, 10);
    assert.equal(f.metadataB.gd.charMemories.carol.length, 1);
    const receipt = validateReceipt(actionReceipt({ id: 'apply:1', artifactId: 'a', revision: 1, status: result.status, result,
        content: { preview: { contractVersion: 2, diff: [{ field: 'memoryMaxEntries', before: '200', after: '10' }] }, memoryPrunePlan: plan } }));
    assert.deepEqual(receipt.memoryPrune, { chatKey: 'A', settingsSave: 'unconfirmed', status: 'pruned', planned: 4, removed: 4 });
    assert.deepEqual(receiptSources(receipt), ['source:memoryConfig', 'source:memoryDiagnostics']);
    assert.doesNotMatch(receiptContext([receipt]), /"chatKey"/);
});

test('Chat switch, concurrent edits and settings-save failures skip destructive pruning with partial results', async () => {
    for (const mutate of ['switch', 'memory', 'limit', 'save-error']) {
        let release, reject;
        const f = fixture(() => new Promise((resolve, fail) => { release = resolve; reject = fail; }));
        const plan = f.port.plan(f.targetA, 10);
        const pending = f.writer.apply({ baseline: { memoryMaxEntries: 200 }, changes: { memoryMaxEntries: 10 }, contractVersion: 2, memoryPrunePlan: plan });
        await Promise.resolve();
        if (mutate === 'switch') f.switchChat();
        if (mutate === 'memory') f.metadataA.gd.charMemories.bob.push({ event: 'new edit' });
        if (mutate === 'limit') f.settings.memoryMaxEntries = 5;
        if (mutate === 'save-error') reject(Error('settings save failed'));
        else release();
        const result = await pending;
        assert.equal(result.status, 'partial', mutate);
        assert.equal(result.memoryPrune.status, 'skipped', mutate);
        assert.equal(f.prunes(), 0, mutate);
        assert.equal(f.metadataA.gd.charMemories.alice.length, 13, mutate);
        assert.equal(f.metadataB.gd.charMemories.carol.length, 1, mutate);
    }
});

test('Prune failure is not reported as successful deletion or retried', async () => {
    const settings = { memoryMaxEntries: 200 }, target = { kind: 'chat', userKey: 'u', chatKey: 'A' };
    const metadata = { gd: { charMemories: { alice: Array.from({ length: 12 }, (_, i) => ({ event: `m${i}` })) } } };
    let attempts = 0;
    const port = createMemoryLimitPort({ getTarget: () => target, getMetadata: () => metadata, extensionKey: 'gd', memorySystem: {
        isPruning: () => false, async pruneAfter() { attempts++; throw Error('chat save failed'); },
    } });
    const writer = createConfigWriter({ getSettings: () => settings, saveSettings: async () => undefined, isBusy: () => false, memoryLimitPort: port });
    const result = await writer.apply({ baseline: { memoryMaxEntries: 200 }, changes: { memoryMaxEntries: 10 }, contractVersion: 2, memoryPrunePlan: port.plan(target, 10) });
    assert.equal(result.status, 'partial');
    assert.deepEqual(result.memoryPrune, { status: 'outcome_unknown', removed: 0 });
    assert.equal(attempts, 1);
    assert.equal(metadata.gd.charMemories.alice.length, 12);
});

test('A concurrent memory edit during chat save makes the prune result unknown', async () => {
    const settings = { memoryMaxEntries: 200 }, target = { kind: 'chat', userKey: 'u', chatKey: 'A' };
    const metadata = { gd: { charMemories: { alice: Array.from({ length: 12 }, (_, i) => ({ event: `m${i}` })) } } };
    let release;
    const port = createMemoryLimitPort({ getTarget: () => target, getMetadata: () => metadata, extensionKey: 'gd', memorySystem: {
        isPruning: () => false,
        async pruneAfter() {
            metadata.gd.charMemories.alice.splice(0, 2);
            await new Promise(resolve => { release = resolve; });
        },
    } });
    const writer = createConfigWriter({ getSettings: () => settings, saveSettings: async () => undefined, isBusy: () => false, memoryLimitPort: port });
    const pending = writer.apply({ baseline: { memoryMaxEntries: 200 }, changes: { memoryMaxEntries: 10 }, contractVersion: 2, memoryPrunePlan: port.plan(target, 10) });
    await Promise.resolve(); await Promise.resolve();
    metadata.gd.charMemories.alice.push({ event: 'concurrent' });
    release();
    const result = await pending;
    assert.equal(result.status, 'partial');
    assert.deepEqual(result.memoryPrune, { status: 'outcome_unknown', removed: 0 });
    assert.equal(metadata.gd.charMemories.alice.at(-1).event, 'concurrent');
});

test('A new generation starting during settings save prevents the later prune step', async () => {
    const f = fixture(); let release, busy = false;
    const writer = createConfigWriter({ getSettings: () => f.settings, saveSettings: () => new Promise(resolve => { release = resolve; }), isBusy: () => busy, memoryLimitPort: f.port });
    const pending = writer.apply({ baseline: { memoryMaxEntries: 200 }, changes: { memoryMaxEntries: 10 }, contractVersion: 2, memoryPrunePlan: f.port.plan(f.targetA, 10) });
    busy = true; release();
    const result = await pending;
    assert.equal(result.status, 'partial');
    assert.equal(result.memoryPrune.status, 'skipped');
    assert.equal(f.prunes(), 0);
});
