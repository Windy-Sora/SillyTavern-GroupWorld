import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMemoryGenerationModule } from '../../muyu/modules/memory-generation/index.js';
import { createProfileGenerationModule } from '../../muyu/modules/profile-generation/index.js';
import { createNpcGenerationModule } from '../../muyu/modules/npc-generation/index.js';
import { createGenerationBatchModule } from '../../muyu/modules/generation-batch/index.js';
import { createAgentMemoryModule } from '../../muyu/modules/agent-memory/index.js';
import { createSettingsModule } from '../../muyu/modules/settings/index.js';
import { createSessionLibrary } from '../../muyu/sessions/library.js';
import { createMemoryHistoryStore } from '../../muyu/sessions/memory-store.js';
import { historyScope } from '../../muyu/sessions/contract.js';
import { validateJson } from '../../muyu/core/json-contract.js';
import { DEFAULT_SETTINGS } from '../../settings.js';
import { deferred } from './helpers/muyu-subject.mjs';

const target = { kind: 'chat', userKey: 'test', chatKey: 'A' };
const identity = (id = 'r', taskId = 't') => ({ id, taskId, target: { ...target } });
const context = (runId = 'r', value = target) => ({ runId, target: value, signal: new AbortController().signal });
const intent = { userQuestion: '记住：简洁回答' };
const factories = [
    ['memory_generation', createMemoryGenerationModule, 'targets'],
    ['profile_generation', createProfileGenerationModule, 'targets'],
    ['npc_generation', createNpcGenerationModule, 'state'],
    ['generation_batch', createGenerationBatchModule, 'prepare'],
    ['notes', createAgentMemoryModule, 'list'],
];
function fixture(prefix, factory, read) {
    let reads = 0;
    const port = { enabled: () => true, list: async () => { reads++; return []; },
        listTargets: () => { reads++; return {}; }, readState: () => { reads++; return {}; },
        prepareExecution: () => { reads++; return {}; }, forgetExecutions() {} };
    const module = factory({ port, charge: () => true });
    const peek = (runId = 'r', value = target) => module.handlers['muyu.' + prefix + '.' + read](prefix === 'notes' ? { query: '', offset: 0 } : {}, context(runId, value));
    const refused = async (runId, value) => {
        const before = reads;
        if (prefix === 'notes') assert.equal((await peek(runId, value)).status, 'disabled');
        else await assert.rejects(async () => peek(runId, value), /RUN_NOT_BOUND/);
        assert.equal(reads, before, 'rejected context must not enter the host');
    };
    return { module, peek, refused };
}
for (const [prefix, factory, read] of factories) {
    test(prefix + ': duplicate binding cannot replace the original run', async () => {
        const f = fixture(prefix, factory, read); f.module.bindRun(identity(), intent);
        assert.throws(() => f.module.bindRun(identity('r', 'another-task'), intent), /RUN_CAPACITY/);
        await f.peek();
        f.module.transferRun('r', identity('continued')); await f.peek('continued');
        await f.refused('r', target); f.module.dispose();
    });
    test(prefix + ': failed transfers preserve both source and destination', async () => {
        const f = fixture(prefix, factory, read); f.module.bindRun(identity(), intent); f.module.bindRun(identity('occupied'), intent);
        for (const next of [identity('occupied'), identity(), identity('next', 'wrong'), { ...identity('next'), target: { ...target, chatKey: 'B' } }]) {
            assert.throws(() => f.module.transferRun('r', next), /RUN_NOT_BOUND/);
            await f.peek(); await f.peek('occupied');
        }
        f.module.transferRun('missing', identity('unused')); await f.refused('unused', target);
        f.module.dispose();
    });
    test(prefix + ': binding snapshots the target and rejects a different chat', async () => {
        const f = fixture(prefix, factory, read), original = identity(); f.module.bindRun(original, intent);
        original.target.chatKey = 'B'; await f.peek(); await f.refused('r', original.target);
        assert.throws(() => f.module.transferRun('r', { ...original, id: 'next' }), /RUN_NOT_BOUND/);
        f.module.transferRun('r', identity('next')); await f.peek('next'); f.module.dispose();
    });
    test(prefix + ': capacity permits transfers and freed slots but not rebinding after disposal', async () => {
        const f = fixture(prefix, factory, read);
        for (let i = 0; i < 128; i++) f.module.bindRun(identity('r' + i), intent);
        assert.throws(() => f.module.bindRun(identity('overflow'), intent), /RUN_CAPACITY/);
        f.module.transferRun('r0', identity('continued')); await f.peek('continued');
        f.module.forgetRun('r1'); f.module.bindRun(identity('replacement'), intent); await f.peek('replacement');
        f.module.dispose(); f.module.dispose();
        assert.throws(() => f.module.bindRun(identity(), intent), /RUN_CAPACITY/); await f.refused('continued', target);
    });
}

for (const unknown of [false, true]) test('notes: continuation preserves pending write deduplication, unknown=' + unknown, async () => {
    let saves = 0; const entered = deferred(), save = deferred();
    const module = createAgentMemoryModule({ port: { enabled: () => true, async save() {
        saves++; entered.resolve(); await save.promise;
        if (unknown) throw Error('NOTE_SAVE_UNKNOWN');
        return { id: 'note', revision: 1, scope: 'chat' };
    } } });
    module.bindRun(identity(), intent);
    const args = { quote: '简洁回答', scope: 'chat' }, pending = module.handlers['muyu.notes.remember'](args, context());
    await entered.promise; module.transferRun('r', identity('continued'));
    const continued = module.handlers['muyu.notes.remember'](args, context('continued')); save.resolve();
    const first = await pending; assert.equal(first.status, unknown ? 'save_unknown' : 'saved');
    assert.deepEqual(await continued, first); assert.equal(saves, 1); module.dispose();
});
test('notes: continuation retains the local read budget', async () => {
    const module = createAgentMemoryModule({ port: { enabled: () => true, list: async () => [] }, budget: () => 1000 });
    module.bindRun(identity(), intent);
    const first = await module.handlers['muyu.notes.list']({ query: '', offset: 0 }, context());
    module.transferRun('r', identity('continued'));
    const second = await module.handlers['muyu.notes.list']({ query: '', offset: 0 }, context('continued'));
    assert.equal(second.status, 'ok'); assert.ok(second.remainingBytes < first.remainingBytes); module.dispose();
});

test('history: archived records reject runtime patches without dirtying or changing data; restore remains writable', async () => {
    const store = createMemoryHistoryStore(), library = createSessionLibrary({ port: { enabled: () => true, open: async () => store } });
    await library.ready;
    const scope = historyScope('chat', target), id = library.create(scope); await library.flush(); await library.archive(id, true);
    const before = library.get(id), snapshot = library.snapshot(scope, id);
    for (const patch of [{ messages: [{ role: 'user', content: 'late', runId: 'r' }] }, { status: 'succeeded' }, { title: 'late' }, { required: [] }, { contextSummary: null }]) {
        assert.throws(() => library.update(id, patch), /HISTORY_READ_ONLY/);
        assert.deepEqual(library.get(id), before); assert.deepEqual(library.snapshot(scope, id), snapshot);
    }
    await library.flush(); assert.deepEqual(await store.read(id), before);
    await library.rename(id, 'Archived title'); await library.archive(id, false);
    library.update(id, { status: 'succeeded' }); await library.flush(); assert.equal((await store.read(id)).status, 'succeeded');
    await library.close();
});
test('history: imported records stay read-only after unarchiving, while metadata management and deletion work', async () => {
    const library = createSessionLibrary(); await library.ready;
    const scope = historyScope('chat', target), source = library.create(scope), id = await library.import(JSON.stringify(library.get(source)));
    await library.archive(id, true); await library.archive(id, false); await library.rename(id, 'Imported title');
    const before = library.get(id), snapshot = library.snapshot(scope, id);
    assert.throws(() => library.update(id, { messages: [], status: 'succeeded' }), /HISTORY_READ_ONLY/);
    assert.deepEqual(library.get(id), before); assert.deepEqual(library.snapshot(scope, id), snapshot);
    await library.remove(id); assert.equal(library.get(id), null); await library.close();
});

function settingsFixture(factory = createSettingsModule, memoryLimitPort) {
    const settings = structuredClone(DEFAULT_SETTINGS), module = factory({ getSettings: () => settings, getTarget: () => target, memoryLimitPort });
    module.bindRun(identity());
    let published = 0;
    const app = { snapshot: () => ({ runs: [{ ...identity(), status: 'succeeded' }] }),
        createArtifact: value => { published++; return { id: 'artifact', revision: 1, ...value }; } };
    return { settings, module, app, published: () => published };
}
for (const sample of ['a', '汉', '🦉', '"\\\n']) for (const apply of [false, true]) test('settings: actual output and private draft obey independent limits for ' + JSON.stringify(sample) + ', apply=' + apply, () => {
    let accepted = 0, rejected = 0;
    for (const length of [1, 1000, 4000, 6000, 8000, 10000]) {
        const f = settingsFixture(), prompt = sample.repeat(length).slice(0, 8000);
        try {
            const result = f.module.handlers['muyu.settings.preview']({ changes: { knowledgeText: prompt }, apply }, context());
            validateJson(f.module.registry.get('muyu.settings.preview').outputSchema, result);
            assert.equal(result.applyRequested, apply ? true : undefined);
            const artifact = f.module.publishDraft(f.app, 'r', result.candidateId);
            assert.equal(artifact.content.requestedChanges.knowledgeText, prompt);
            assert.ok(Buffer.byteLength(JSON.stringify(artifact.content), 'utf8') <= 24000);
            assert.equal(f.settings.knowledgeText, DEFAULT_SETTINGS.knowledgeText); accepted++;
        } catch (error) {
            assert.match(error.message, /DRAFT_TOO_LARGE|JSON byte limit/); assert.equal(f.published(), 0); rejected++;
        } finally { f.module.dispose(); }
    }
    assert.ok(accepted > 0); assert.ok(rejected > 0);
});

// Tighten only the public response schema to exercise a future contract/output mismatch.
// All production validation, candidate ownership and private-plan cleanup still execute.
const settingsUrl = new URL('../../muyu/modules/settings/index.js', import.meta.url);
const settingsSource = await readFile(settingsUrl, 'utf8');
const tightened = settingsSource.replace('const string = { type: \'string\', maxLength: 24000 };', 'const string = { type: \'string\', maxLength: 100 };')
    .replace(/from '(\.[^']+)'/g, (_match, path) => 'from ' + JSON.stringify(new URL(path, settingsUrl).href));
assert.notEqual(tightened, settingsSource);
const tightSettings = (await import('data:text/javascript;base64,' + Buffer.from(tightened + '\n//# sourceURL=muyu-settings-response-fixture.mjs').toString('base64'))).createSettingsModule;
for (const apply of [false, true]) test('settings: response preflight releases private plans and retains no candidate, apply=' + apply, () => {
    const active = new Set(); let forgotten = 0;
    const port = { plan() { const plan = { id: 'plan', total: 0, counts: [] }; active.add(plan.id); return plan; },
        forget(plan) { assert.ok(active.delete(plan.id)); forgotten++; }, assertFresh() {} };
    const f = settingsFixture(tightSettings, port);
    assert.throws(() => f.module.handlers['muyu.settings.preview']({ changes: { memoryMaxEntries: 10 }, apply }, context()), /DRAFT_TOO_LARGE/);
    assert.equal(active.size, 0); assert.equal(forgotten, 1); assert.equal(f.published(), 0);
    assert.equal(f.settings.memoryMaxEntries, DEFAULT_SETTINGS.memoryMaxEntries);
    f.module.forgetRun('r'); f.module.dispose(); assert.equal(forgotten, 1, 'failed draft cannot retain a lease for later disposal');
});
