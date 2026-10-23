import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemorySystem } from '../../systems/memory-system.js';
import { createMemoryAgent } from '../../agents/memory.js';
import { execute as runAgent } from '../../systems/agent-runtime.js';
import { createMemoryGenerationPort } from '../../muyu/host/memory-generation.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
    const metadata = {}, chat = [{ name: 'User', mes: 'Alice met Bob.', is_user: true }];
    const settings = { lang: 'en', memoryMaxEntries: 2, llmContextDepth: 10, agentConfigs: { memory: { useCustom: true, apiKey: 'SECRET', call: { retries: 2, timeout: 1000 } } } };
    const characters = [{ avatar: 'alice.png', name: 'Alice', description: 'A', personality: 'bold', scenario: 'town' }, { avatar: 'bob.png', name: 'Bob' }];
    const providers = [{ render: async () => '' }], group = { members: ['alice.png', 'bob.png'] };
    let target = { kind: 'chat', chatKey: 'A' }, currentMetadata = metadata, currentChat = chat;
    const calls = { rendered: 0, model: 0, saved: 0, changed: 0, signal: null };
    const agent = createMemoryAgent({ renderPrompt: async text => { calls.rendered++; return options.render ? options.render(text) : text; }, extractJsonObject: () => null, log: () => {} });
    const context = () => ({ chat: currentChat, chatMetadata: currentMetadata, mainApi: 'openai', generateRaw: async () => 'unused' });
    const deps = { settings, EXT_KEY: 'gd', getChatMetadata: () => currentMetadata, getChat: () => currentChat,
        getCharacters: () => characters, AgentRegistry: { get: () => agent }, execute: options.execute || runAgent,
        buildContextPool: ({ memoryCharacter, memoryExistingList }) => ({ memoryCharacter: () => memoryCharacter, memoryExistingList, chat: () => currentChat,
            recentMessages: () => currentChat.map(m => m.mes) }),
        getCurrentGroup: () => group, getContext: context, log: () => {}, saveChatConditional: async () => { calls.saved++; },
        createCaller: () => ({ supportsAbort: options.supportsAbort ?? false, generate: async (_prompt, { signal } = {}) => {
            calls.model++; calls.signal = signal;
            return options.generate ? options.generate(signal) : '{"memories":[{"event":"Met Bob","mood":"happy"}]}';
        } }) };
    const system = createMemorySystem(deps);
    const save = async value => { calls.saved++; assert.equal(value, metadata); return options.save?.(value); };
    const port = createMemoryGenerationPort({ getTarget: () => target, getSettings: () => settings, getContext: context,
        getCharacters: () => characters, getProviders: () => providers, system, saveChatConfirmed: options.noSaver ? undefined : save,
        changed: () => { calls.changed++; }, timeoutMs: options.timeout ?? 1000 });
    const prepare = (mode = 'save', taskId = 'task') => port.prepareExecution({ character: 'memory-character:0', mode }, { target, taskId });
    const execute = (ticket, signal, taskId = 'task') => port.execute(ticket.executionId, { target, taskId, signal });
    return { port, system, calls, metadata, settings, characters, providers, agent, chat, group, prepare, execute,
        switchChat: () => { target = { kind: 'chat', chatKey: 'B' }; currentMetadata = {}; currentChat = []; },
        replaceChat: () => { currentChat = [...chat]; }, replaceMetadata: () => { currentMetadata = structuredClone(metadata); } };
}

test('preparation is pure, redacted, scoped and idempotent', () => {
    const f = fixture(), ticket = f.prepare();
    assert.deepEqual(f.metadata, {}); assert.equal(f.calls.model, 0); assert.equal(f.calls.rendered, 0);
    assert.deepEqual(f.prepare(), ticket); assert.doesNotMatch(JSON.stringify(ticket), /SECRET|alice\.png/);
    assert.equal(ticket.mode, 'save'); assert.match(ticket.notice, /prune/);
    assert.throws(() => f.prepare('trial'), /ALREADY_PREPARED/);
});
test('trial returns bounded host-stamped extraction without initializing metadata or saving', async () => {
    const f = fixture(), result = await f.execute(f.prepare('trial'));
    assert.equal(result.status, 'trial_completed'); assert.equal(result.chatSave, 'not_started');
    assert.deepEqual(f.metadata, {}); assert.equal(f.calls.saved, 0); assert.equal(f.calls.model, 1);
    assert.equal(result.entries[0].round, 1); assert.ok(Number.isSafeInteger(result.entries[0].timestamp));
    assert.equal(f.system.isGenerating(), false);
});
test('save appends and reports actual pruning, preserving unrelated character memory', async () => {
    const f = fixture();
    f.metadata.gd = { charMemories: { 'alice.png': [{ event: 'old1' }, { event: 'old2' }], 'bob.png': [{ event: 'Bob' }] }, untouched: true };
    const bob = f.metadata.gd.charMemories['bob.png'];
    const result = await f.execute(f.prepare());
    assert.equal(result.status, 'applied_confirmed'); assert.equal(result.pruned, 1); assert.equal(result.generated, 1);
    assert.deepEqual(f.metadata.gd.charMemories['alice.png'].map(e => e.event), ['old2', 'Met Bob']);
    assert.equal(f.metadata.gd.charMemories['bob.png'], bob); assert.equal(f.calls.saved, 1);
    assert.equal(f.settings.memoryEnabled, undefined);
});
test('one execution ticket never regenerates, even after current configuration changes', async () => {
    const f = fixture(), ticket = f.prepare(), result = await f.execute(ticket);
    f.settings.memoryMaxEntries = 20;
    assert.deepEqual(await f.execute(ticket), result); assert.equal(f.calls.model, 1); assert.equal(f.calls.saved, 1);
});
test('pending duplicate returns unknown without a second generation', async () => {
    const wait = deferred(), f = fixture({ generate: () => wait.promise }), ticket = f.prepare();
    const work = f.execute(ticket); await tick();
    const duplicate = await f.execute(ticket); assert.equal(duplicate.code, 'ALREADY_STARTED'); assert.equal(f.calls.model, 1);
    wait.resolve('{"memories":[]}'); assert.equal((await work).status, 'no_result');
});
test('pre-aborted execution starts no render, model, save or store initialization', async () => {
    const f = fixture(), ticket = f.prepare(), control = new AbortController(); control.abort();
    assert.equal((await f.execute(ticket, control.signal)).status, 'not_started');
    assert.equal(f.calls.rendered, 0); assert.equal(f.calls.model, 0); assert.deepEqual(f.metadata, {});
});
test('cancel during rendering stops later model request and write, retaining drain lease', async () => {
    const wait = deferred(), f = fixture({ render: () => wait.promise }), ticket = f.prepare(), control = new AbortController();
    const work = f.execute(ticket, control.signal); await tick(); control.abort();
    assert.equal((await work).status, 'outcome_unknown'); assert.equal(f.system.isGenerating(), true);
    wait.resolve('rendered'); await tick(); assert.equal(f.calls.model, 0); assert.equal(f.calls.saved, 0); assert.equal(f.system.isGenerating(), false);
});
test('native request remains busy after timeout until physical completion; no late write', async () => {
    const wait = deferred(), f = fixture({ generate: () => wait.promise, timeout: 15 }), ticket = f.prepare();
    const result = await f.execute(ticket); assert.equal(result.code, 'TIMEOUT'); assert.equal(result.modelCallAttempted, true);
    await tick(); assert.equal(f.system.isGenerating(), true);
    assert.throws(() => f.prepare('save', 'task2'), /MEMORY_BUSY/);
    await assert.rejects(f.system.generateForCharacter('alice.png'), /MEMORY_BUSY/);
    wait.resolve('{"memories":[{"event":"late","mood":"happy"}]}'); await tick();
    assert.equal(f.system.isGenerating(), false); assert.equal(f.calls.saved, 0); assert.deepEqual(f.metadata, {});
    assert.deepEqual(await f.execute(ticket), result); assert.equal(f.calls.model, 1);
});
test('managed-call timeout also retains physical request and does not retry', async () => {
    const wait = deferred(), f = fixture({ generate: () => wait.promise }); f.settings.agentConfigs.memory.call.timeout = 10;
    const result = await f.execute(f.prepare()); assert.equal(result.status, 'outcome_unknown'); assert.equal(f.calls.model, 1);
    assert.equal(f.system.isGenerating(), true); wait.resolve('{}'); await tick(); assert.equal(f.system.isGenerating(), false);
});
test('HTTP failures do not retry despite legacy retry settings', async () => {
    const f = fixture({ supportsAbort: true, generate: () => { throw Error('SECRET HTTP error'); } });
    const result = await f.execute(f.prepare()); assert.equal(f.calls.model, 1); assert.equal(f.calls.saved, 0);
    assert.equal(result.code, 'EXECUTION_ERROR'); assert.doesNotMatch(JSON.stringify(result), /SECRET/);
});
for (const [name, mutate] of Object.entries({
    'chat content': f => { f.chat[0].mes = 'changed'; }, 'chat array': f => f.replaceChat(), 'metadata identity': f => f.replaceMetadata(),
    'business connection': f => { f.settings.agentConfigs.memory.apiKey = 'different'; },
    'settings': f => { f.settings.memoryMaxEntries++; }, 'character description': f => { f.characters[0].description = 'changed'; },
    'character identity': f => { f.characters[0] = { ...f.characters[0] }; }, 'character directory order': f => { f.characters.reverse(); }, 'group': f => { f.group.members.push('other.png'); },
    'Provider implementation': f => { f.providers[0].render = async () => 'changed'; },
    'Agent pipeline': f => { f.agent.pipeline.prompt = async () => 'changed'; },
    'selected memory': f => { f.metadata.gd.charMemories['alice.png'].push({ event: 'concurrent' }); },
})) test(`changed ${name} invalidates prepared execution before paid request`, async () => {
    const f = fixture(); f.metadata.gd = { charMemories: { 'alice.png': [] } };
    const ticket = f.prepare(); mutate(f);
    await assert.rejects(f.execute(ticket), /STALE_MEMORY_GENERATION/); assert.equal(f.calls.model, 0); assert.equal(f.calls.saved, 0);
});
test('target change while model is pending rejects late generated writes', async () => {
    const wait = deferred(), f = fixture({ generate: () => wait.promise }), ticket = f.prepare(), work = f.execute(ticket); await tick();
    f.switchChat(); wait.resolve('{"memories":[{"event":"late","mood":"neutral"}]}');
    assert.equal((await work).status, 'outcome_unknown'); assert.deepEqual(f.metadata, {}); assert.equal(f.calls.saved, 0);
});
test('unrelated character edit during generation is retained and does not block selected save', async () => {
    const wait = deferred(), f = fixture({ generate: () => wait.promise });
    f.metadata.gd = { charMemories: { 'alice.png': [], 'bob.png': [{ event: 'old' }] } };
    const work = f.execute(f.prepare()); await tick(); f.metadata.gd.charMemories['bob.png'].push({ event: 'concurrent' });
    wait.resolve('{"memories":[{"event":"Met Bob","mood":"happy"}]}');
    assert.equal((await work).status, 'applied_confirmed'); assert.equal(f.metadata.gd.charMemories['bob.png'].length, 2);
});
test('selected concurrent edit during generation blocks overwrite', async () => {
    const wait = deferred(), f = fixture({ generate: () => wait.promise }); f.metadata.gd = { charMemories: { 'alice.png': [] } };
    const work = f.execute(f.prepare()); await tick(); f.metadata.gd.charMemories['alice.png'].push({ event: 'concurrent' });
    wait.resolve('{"memories":[{"event":"Met Bob","mood":"happy"}]}');
    assert.equal((await work).status, 'outcome_unknown'); assert.equal(f.calls.saved, 0);
    assert.deepEqual(f.metadata.gd.charMemories['alice.png'], [{ event: 'concurrent' }]);
});
test('save failure retains applied memory and concurrent edits, never retries or rolls back whole store', async () => {
    const f = fixture({ save: metadata => { metadata.gd.charMemories['bob.png'] = [{ event: 'concurrent' }]; throw Error('SECRET save error'); } });
    const ticket = f.prepare(), result = await f.execute(ticket);
    assert.equal(result.status, 'outcome_unknown'); assert.equal(result.chatSave, 'unknown'); assert.equal(result.resultWriteStarted, true);
    assert.equal(f.metadata.gd.charMemories['alice.png'][0].event, 'Met Bob'); assert.equal(f.metadata.gd.charMemories['bob.png'][0].event, 'concurrent');
    assert.equal(f.calls.saved, 1); assert.deepEqual(await f.execute(ticket), result);
});
test('save confirmation with concurrent selected change is partial, not current-state proof', async () => {
    const f = fixture({ save: metadata => { metadata.gd.charMemories['alice.png'].push({ event: 'concurrent' }); } });
    const result = await f.execute(f.prepare()); assert.equal(result.status, 'partial'); assert.equal(result.chatSave, 'confirmed');
    assert.equal(f.metadata.gd.charMemories['alice.png'].length, 2);
});
test('cancel during save reports unknown and does not retry an in-flight save', async () => {
    const wait = deferred(), f = fixture({ save: () => wait.promise }), ticket = f.prepare(), control = new AbortController();
    const work = f.execute(ticket, control.signal); await tick(); assert.equal(f.calls.saved, 1); control.abort();
    const result = await work; assert.equal(result.chatSave, 'unknown'); assert.equal(result.resultWriteStarted, true);
    wait.resolve(); await tick(); assert.equal(f.calls.saved, 1); assert.deepEqual(await f.execute(ticket), result);
});
for (const raw of ['not JSON', '{"memories":[{"event":"x","mood":"invalid"}]}']) test(`invalid output cannot save: ${raw}`, async () => {
    const f = fixture({ generate: () => raw }); const result = await f.execute(f.prepare());
    assert.equal(result.status, 'outcome_unknown'); assert.equal(f.calls.saved, 0); assert.deepEqual(f.metadata, {});
});
test('existing memory parser null-list normalization remains a no-result, never a save', async () => {
    const f = fixture({ generate: () => '{"memories":null}' }); const result = await f.execute(f.prepare());
    assert.equal(result.status, 'no_result'); assert.equal(f.calls.saved, 0); assert.deepEqual(f.metadata, {});
});
test('large output is omitted from ticket result without claiming failed generation', async () => {
    const f = fixture({ generate: () => JSON.stringify({ memories: [{ event: '猫'.repeat(2100), mood: 'happy' }] }) });
    const result = await f.execute(f.prepare()); assert.equal(result.status, 'applied_confirmed'); assert.equal(result.outputOmitted, true);
    assert.deepEqual(result.entries, []); assert.equal(f.metadata.gd.charMemories['alice.png'][0].event.length, 2100);
});
test('oversized generated content rejects before mutation', async () => {
    const f = fixture({ generate: () => JSON.stringify({ memories: [{ event: '猫'.repeat(11900), mood: 'happy' }] }) });
    const result = await f.execute(f.prepare()); assert.equal(result.code, 'MEMORY_OUTPUT_TOO_LARGE'); assert.deepEqual(f.metadata, {});
});
test('missing confirmed saver refuses save preparation before paid request; trial remains available', () => {
    const f = fixture({ noSaver: true }); assert.throws(() => f.prepare(), /GENERATION_UNAVAILABLE/);
    assert.equal(f.prepare('trial').mode, 'trial'); assert.equal(f.calls.model, 0);
});
test('retired ticket and wrong task cannot execute', async () => {
    const f = fixture(), ticket = f.prepare(); await assert.rejects(f.execute(ticket, undefined, 'other'), /STALE/);
    f.port.forgetExecutions('task'); await assert.rejects(f.execute(ticket), /STALE/); assert.equal(f.calls.model, 0);
});
test('forget while rendering prevents all subsequent stages', async () => {
    const wait = deferred(), f = fixture({ render: () => wait.promise }), work = f.execute(f.prepare()); await tick();
    f.port.clearExecutions(); wait.resolve('done'); assert.equal((await work).status, 'outcome_unknown'); assert.equal(f.calls.model, 0);
});
test('legacy generation retains its original result and save behavior with busy tracking', async () => {
    const wait = deferred(), f = fixture({ generate: () => wait.promise }), work = f.system.generateForCharacter('alice.png'); await tick();
    assert.equal(f.system.isGenerating(), true); assert.throws(() => f.prepare(), /MEMORY_BUSY/);
    wait.resolve('{"memories":[{"event":"legacy","mood":"happy"}]}'); await work;
    assert.equal(f.calls.saved, 1); assert.equal(f.system.isGenerating(), false); assert.equal(f.metadata.gd.charMemories['alice.png'][0].event, 'legacy');
});
test('creation of an empty selected bucket invalidates an old missing-bucket ticket', async () => {
    const f = fixture(); f.metadata.gd = { charMemories: {} }; const ticket = f.prepare();
    f.metadata.gd.charMemories['alice.png'] = [];
    await assert.rejects(f.execute(ticket), /STALE/); assert.equal(f.calls.model, 0);
});
test('trial reports expected pruning without applying it', async () => {
    const f = fixture(); f.metadata.gd = { charMemories: { 'alice.png': [{ event: 'one' }, { event: 'two' }] } };
    const result = await f.execute(f.prepare('trial')); assert.equal(result.wouldPrune, 1); assert.equal(result.pruned, 0);
    assert.equal(f.metadata.gd.charMemories['alice.png'].length, 2); assert.equal(f.calls.saved, 0);
});
test('a configured memory Schema is honored before any approved write', async () => {
    const f = fixture(); f.settings.memoryJsonSchema = JSON.stringify({ type: 'object', properties: { memories: { type: 'array', items: {
        type: 'object', properties: { event: { type: 'string' }, mood: { type: 'string', enum: ['sad'] } }, required: ['event', 'mood'] } } }, required: ['memories'] });
    const result = await f.execute(f.prepare()); assert.equal(result.status, 'outcome_unknown'); assert.equal(f.calls.saved, 0);
});
test('registered Agent attempting a second paid call is refused without duplication', async () => {
    const f = fixture(); f.agent.pipeline.call = async caller => { await caller.generate('first'); return caller.generate('second'); };
    const result = await f.execute(f.prepare()); assert.equal(result.status, 'outcome_unknown'); assert.equal(f.calls.model, 1); assert.equal(f.calls.saved, 0);
});
test('settings change while saving is partial and does not erase concurrent configuration', async () => {
    let f; f = fixture({ save: () => { f.settings.memoryMaxEntries = 20; } });
    const result = await f.execute(f.prepare()); assert.equal(result.status, 'partial'); assert.equal(f.settings.memoryMaxEntries, 20);
});
test('UI observer exception cannot turn a confirmed save into a failure', async () => {
    const f = fixture(); const result = await f.system.generateApproved('alice.png', { mode: 'save', validate: () => {},
        saveChatConfirmed: async () => {}, changed: () => { throw Error('observer'); } });
    assert.equal(result.status, 'applied_confirmed');
});
test('generation directory is pure, bounded and never exposes memory bodies or connection secrets', () => {
    const f = fixture(), target = { kind: 'chat', chatKey: 'A' }, value = f.port.listTargets(target);
    assert.equal(value.items.length, 2); assert.equal(value.nextOffset, -1); assert.deepEqual(f.metadata, {});
    assert.doesNotMatch(JSON.stringify(value), /SECRET|alice\.png|PRIVATE_BODY/); assert.equal(f.calls.model, 0);
    assert.throws(() => f.port.listTargets(target, -1));
});
test('prepare consumes the exact directory revision, with stale or fake revisions refusing effects', () => {
    const f = fixture(), target = { kind: 'chat', chatKey: 'A' }, row = f.port.listTargets(target).items[0];
    assert.throws(() => f.port.prepareExecution({ character: row.character, revision: 'fake', mode: 'trial' }, { target, taskId: 't' }), /STALE/);
    f.settings.memoryMaxEntries++;
    assert.throws(() => f.port.prepareExecution({ character: row.character, revision: row.revision, mode: 'trial' }, { target, taskId: 't' }), /STALE/);
    assert.equal(f.calls.model, 0);
});
test('assistant history and GUI persistence do not invalidate business execution consent', async () => {
    const f = fixture(), target = { kind: 'chat', chatKey: 'A' }, row = f.port.listTargets(target).items[0];
    f.settings.muyuHistoryAccount = { saved: 'during handoff' }; f.settings.muyuEnabled = true;
    const ticket = f.port.prepareExecution({ character: row.character, revision: row.revision, mode: 'save' }, { target, taskId: 'task' });
    f.settings.muyuHistoryAccount.saved = 'after consent'; f.settings.muyuContextConfig = { inputTokens: 900000 };
    assert.equal((await f.execute(ticket)).status, 'applied_confirmed'); assert.equal(f.calls.model, 1);
});
test('target directory does not duplicate or require a serialized long conversation per character', () => {
    const f = fixture(); f.chat.push({ mes: 'x'.repeat(16 * 1024 * 1024) });
    const directory = f.port.listTargets({ kind: 'chat', chatKey: 'A' }); assert.equal(directory.items.length, 2);
    assert.ok(JSON.stringify(directory).length < 1000); assert.equal(f.calls.model, 0);
    assert.throws(() => f.prepare(), /MEMORY_CONTEXT_TOO_LARGE/);
});
