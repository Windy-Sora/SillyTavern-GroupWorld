import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcSystem } from '../../systems/npc-system.js';
import { createNpcAgent } from '../../agents/npc.js';
import { execute } from '../../systems/agent-runtime.js';
import { createNpcGenerationPort } from '../../muyu/host/npc-generation.js';

const row = (name = 'Merchant', description = 'A travelling merchant') => ({ name, description, personality: 'Calm', scenario: 'Tavern', first_mes: 'Hello' });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ render, generate, save, timeoutMs = 1000 } = {}) {
    const f = { metadata: {}, chat: [{ mes: 'Private story' }], mainApi: 'chat-completion',
        settings: { npcEnabled: true, npcMaxCount: 10, npcBatchSize: 3, npcGenerateFirstMes: false,
            agentConfigs: { npc: { useCustom: true, apiKey: 'secret-test', call: { timeout: 1000, retries: 2 } } } },
        characters: [{ name: 'Alice', avatar: 'alice.png', description: 'Private character' }, { name: 'Outsider', avatar: 'outside.png' }],
        group: { members: ['alice.png'] }, providers: [{ render() {} }], target: { kind: 'chat', userKey: 'user', chatKey: 'chat' },
        calls: { render: 0, model: 0, save: 0, notify: 0 }, busy: false };
    f.agent = createNpcAgent({ renderPrompt: async (prompt, _ctx, options) => {
        f.calls.render++; f.prompt = prompt; f.locals = options.locals;
        return render ? render(f) : 'Rendered story and provider';
    }, extractJsonObject: raw => raw.match(/\{.*\}/s)?.[0], log() {} });
    const ctx = () => ({ chat: f.chat, chatMetadata: f.metadata, mainApi: f.mainApi, generateRaw: async () => '' });
    f.system = createNpcSystem({ settings: f.settings, EXT_KEY: 'gd', getChatMetadata: () => f.metadata, getChat: () => f.chat,
        getCharacters: () => f.characters, getCurrentGroup: () => f.group, getContext: ctx,
        AgentRegistry: { get: () => f.agent }, execute,
        buildContextPool: options => ({ chat: () => f.chat, recentMessages: () => f.chat, characters: () => f.characters,
            group: () => options.group, npcExistingList: options.npcExistingList, npcBatchSize: options.npcBatchSize,
            npcGenerateFirstMes: options.npcGenerateFirstMes }),
        createCaller: (...args) => { f.callerArgs = args; return { supportsAbort: false, generate: async (prompt, options) => {
            f.calls.model++; f.signal = options.signal; f.sentPrompt = prompt;
            return generate ? generate(f) : JSON.stringify({ npcs: [row()] });
        } }; }, saveChatConditional: async () => { throw Error('unconfirmed saver forbidden'); }, log() {} });
    f.saver = async metadata => { f.calls.save++; assert.equal(metadata, f.metadata); if (save) await save(f); };
    f.port = createNpcGenerationPort({ getTarget: () => f.target, getSettings: () => f.settings, getContext: ctx,
        getProviders: () => f.providers, system: f.system, saveChatConfirmed: f.saver,
        changed: () => { f.calls.notify++; }, isBusy: () => f.busy, timeoutMs });
    f.prepare = (mode = 'trial', count, taskId = 'task') => f.port.prepareExecution({ revision: f.port.readState(f.target).revision, mode, count }, { target: f.target, taskId });
    f.run = (ticket, extra = {}) => f.port.execute(ticket.executionId, { target: f.target, taskId: 'task', ...extra });
    return f;
}

test('NPC inspection and preparation are pure bounded descriptors, not character-card operations', () => {
    const f = fixture(), state = f.port.readState(f.target), ticket = f.prepare();
    assert.equal(state.count, 0); assert.equal(state.effectiveCount, 3); assert.equal(state.persistence, 'unknown');
    assert.deepEqual(f.metadata, {}); assert.deepEqual(f.calls, { render: 0, model: 0, save: 0, notify: 0 });
    const publicText = JSON.stringify({ state, ticket });
    for (const secret of ['Private story', 'Private character', 'alice.png', 'secret-test', 'Outsider']) assert.equal(publicText.includes(secret), false);
    assert.equal(ticket.oneShot, true); assert.match(ticket.notice, /No existing edits/);
});

test('trial runs the registered real NPC pipeline without initializing stores or saving', async () => {
    const f = fixture(), result = await f.run(f.prepare());
    assert.equal(result.status, 'trial_completed'); assert.equal(result.generated, 1); assert.equal(result.chatSave, 'not_started');
    assert.equal(f.locals.batchSize, '3'); assert.match(f.locals.existingCharacters, /Alice/);
    assert.equal(f.sentPrompt, 'Rendered story and provider'); assert.equal(f.callerArgs.length, 2);
    assert.deepEqual(f.metadata, {}); assert.equal(f.calls.model, 1); assert.equal(f.calls.save, 0);
    assert.equal(result.outputUntrusted, true); assert.equal(result.npcs[0].imported, false);
    assert.equal(Object.hasOwn(result.npcs[0], 'first_mes'), false);
});

test('save appends unique records while preserving old identities, other chat data and character catalog', async () => {
    const f = fixture(), old = { name: 'Keeper', description: 'Keep' }, unrelated = { value: 'keep' };
    f.metadata.gd = { npcs: [old], unrelated }; const list = f.metadata.gd.npcs, chars = [...f.characters];
    const result = await f.run(f.prepare('save', 1));
    assert.equal(result.status, 'applied_confirmed'); assert.equal(result.chatSave, 'confirmed');
    assert.equal(f.metadata.gd.npcs, list); assert.equal(list[0], old); assert.equal(f.metadata.gd.unrelated, unrelated);
    assert.equal(list[1].importedAvatar, null); assert.equal(typeof list[1].createdAt, 'number');
    assert.deepEqual(f.characters, chars); assert.equal(f.calls.save, 1); assert.equal(f.calls.notify, 1);
});

test('requested count clamps to remaining capacity, dedups all ST characters and the generated batch', async () => {
    const f = fixture({ generate: () => JSON.stringify({ npcs: [row(' outsider '), row('New'), row(' NEW '), row('Extra'), row('Third')] }) });
    f.metadata.gd = { npcs: [row('Keeper')] }; f.settings.npcMaxCount = 3;
    const ticket = f.prepare('save', 5); assert.equal(ticket.effectiveCount, 2);
    const result = await f.run(ticket);
    assert.equal(f.locals.batchSize, '2'); assert.equal(result.generated, 2); assert.equal(result.skippedDuplicates, 2); assert.equal(result.omittedExcess, 1);
    assert.deepEqual(f.metadata.gd.npcs.map(n => n.name), ['Keeper', 'New', 'Extra']);
});

test('first-message option controls output, host resets all forged import provenance', async () => {
    const f = fixture(); f.settings.npcGenerateFirstMes = true;
    f.agent.pipeline.parse = () => [{ ...row(), imported: true, importedAvatar: 'forged.png', createdAt: -1, id: 'forged' }];
    const result = await f.run(f.prepare('save'));
    assert.equal(result.npcs[0].first_mes, 'Hello'); assert.equal(result.npcs[0].imported, false);
    assert.equal(result.npcs[0].importedAvatar, null); assert.ok(result.npcs[0].createdAt > 0); assert.equal(Object.hasOwn(result.npcs[0], 'id'), false);
});

test('all duplicate output reports no result, performs no save or store initialization', async () => {
    const f = fixture({ generate: () => JSON.stringify({ npcs: [row('Outsider')] }) });
    const result = await f.run(f.prepare('save'));
    assert.equal(result.status, 'no_result'); assert.equal(result.generated, 0); assert.deepEqual(f.metadata, {}); assert.equal(f.calls.save, 0);
});

for (const [label, mutate, code] of [
    ['disabled', f => { f.settings.npcEnabled = false; }, 'NPC_DISABLED'],
    ['full', f => { f.settings.npcMaxCount = 1; f.metadata.gd = { npcs: [row()] }; }, 'NPC_CAPACITY_EXCEEDED'],
    ['invalid limit', f => { f.settings.npcMaxCount = 201; }, 'UNSUPPORTED_NPC_LIMIT'],
    ['invalid first message switch', f => { f.settings.npcGenerateFirstMes = 'yes'; }, 'UNSUPPORTED_NPC_LIMIT'],
    ['invalid store', f => { f.metadata.gd = { npcs: {} }; }, 'UNSUPPORTED_NPC_STORE'],
    ['busy', f => { f.busy = true; }, 'NPC_BUSY'],
]) test(`NPC ${label} is rejected before rendering and billing`, () => {
    const f = fixture(); mutate(f); assert.throws(() => f.prepare('save'), new RegExp(code));
    assert.equal(f.calls.model, 0); assert.equal(f.calls.render, 0); assert.equal(f.calls.save, 0);
});

for (const output of [null, {}, [row('', 'body')], [row('New', '')], [{ ...row(), personality: 42 }], [row('New', 'x'.repeat(12001))]]) {
    test(`invalid NPC parsed output never saves: ${JSON.stringify(output).slice(0, 45)}`, async () => {
        const f = fixture(); f.agent.pipeline.parse = () => output;
        const result = await f.run(f.prepare('save')); assert.equal(result.code, 'INVALID_NPC_OUTPUT');
        assert.equal(result.status, 'outcome_unknown'); assert.equal(f.calls.model, 1); assert.equal(f.calls.save, 0); assert.deepEqual(f.metadata, {});
    });
}

test('aggregate output bound is enforced before saving', async () => {
    const f = fixture(); f.agent.pipeline.parse = () => [row('New', '中'.repeat(12000))];
    const result = await f.run(f.prepare('save')); assert.equal(result.code, 'NPC_OUTPUT_TOO_LARGE'); assert.deepEqual(f.metadata, {});
});

test('business model errors are safe and never automatically retried', async () => {
    const f = fixture({ generate: () => { throw Error('API secret-test detail'); } });
    const result = await f.run(f.prepare('save')); assert.equal(result.code, 'EXECUTION_ERROR'); assert.equal(f.calls.model, 1);
    assert.equal(JSON.stringify(result).includes('secret-test'), false); assert.equal(f.calls.save, 0);
});

test('one task cannot prepare a changed mode/count; consumed execution returns cached history', async () => {
    const f = fixture(), ticket = f.prepare('trial', 2);
    assert.deepEqual(f.prepare('trial', 2), ticket);
    assert.throws(() => f.prepare('save', 2), /NPC_CALL_ALREADY_PREPARED/);
    assert.throws(() => f.prepare('trial', 3), /NPC_CALL_ALREADY_PREPARED/);
    const result = await f.run(ticket); assert.deepEqual(await f.run(ticket), result); assert.equal(f.calls.model, 1);
    await assert.rejects(f.run(ticket, { taskId: 'other' }), /STALE_NPC_GENERATION/);
});

for (const [label, mutate] of [
    ['chat switch', f => { f.target = { ...f.target, chatKey: 'new' }; }],
    ['metadata replacement', f => { f.metadata = {}; }],
    ['chat mutation', f => { f.chat.push({ mes: 'new' }); }],
    ['business settings', f => { f.settings.npcPrompt = 'new'; }],
    ['NPC data', f => { f.metadata.gd = { npcs: [row()] }; }],
    ['character in-place mutation', f => { f.characters.push({ name: 'New' }); }],
    ['character same-value replacement', f => { f.characters[0] = { ...f.characters[0] }; }],
    ['Provider implementation', f => { f.providers[0].render = () => {}; }],
    ['Agent implementation', f => { f.agent.pipeline.parse = () => []; }],
]) test(`prepared NPC execution rejects stale ${label} before billing`, async () => {
    const f = fixture(), ticket = f.prepare('save'); mutate(f);
    await assert.rejects(f.run(ticket), /STALE_NPC_GENERATION|TARGET_UNAVAILABLE/);
    assert.equal(f.calls.render, 0); assert.equal(f.calls.model, 0); assert.equal(f.calls.save, 0);
});

test('conversation persistence settings do not invalidate approved business work', async () => {
    const f = fixture(), ticket = f.prepare(); f.settings.muyuConversations = [{ text: 'new history' }];
    assert.equal((await f.run(ticket)).status, 'trial_completed');
});

test('NPC concurrent edits during a model request prevent append, preserving new edits', async () => {
    const wait = deferred(), f = fixture({ generate: () => wait.promise });
    f.metadata.gd = { npcs: [row('Keeper')] }; const ticket = f.prepare('save'), pending = f.run(ticket);
    await tick(); f.metadata.gd.npcs[0].description = 'Concurrent'; wait.resolve(JSON.stringify({ npcs: [row()] }));
    assert.equal((await pending).code, 'STALE_NPC_GENERATION'); assert.equal(f.calls.save, 0);
    assert.equal(f.metadata.gd.npcs.length, 1); assert.equal(f.metadata.gd.npcs[0].description, 'Concurrent');
});

test('confirmed save with a concurrent edit is partial; historical output remains unchanged', async () => {
    const f = fixture({ save: f => { f.metadata.gd.npcs[0].description = 'Concurrent'; } });
    const result = await f.run(f.prepare('save'));
    assert.equal(result.status, 'partial'); assert.equal(result.chatSave, 'confirmed'); assert.equal(f.calls.notify, 0);
    assert.equal(f.metadata.gd.npcs[0].description, 'Concurrent'); assert.equal(result.npcs[0].description, 'A travelling merchant');
});

test('unknown save keeps appended data and unrelated edits, without retry or whole-store rollback', async () => {
    const f = fixture({ save: f => { f.metadata.gd.other = 'Concurrent'; throw Error('unknown persistence'); } });
    const result = await f.run(f.prepare('save'));
    assert.equal(result.status, 'outcome_unknown'); assert.equal(result.chatSave, 'unknown'); assert.equal(f.calls.save, 1);
    assert.equal(f.metadata.gd.npcs.length, 1); assert.equal(f.metadata.gd.other, 'Concurrent');
});

test('switching chat during save does not notify or write into the new chat', async () => {
    const wait = deferred(), entered = deferred(), f = fixture({ save: () => { entered.resolve(); return wait.promise; } });
    const original = f.metadata, pending = f.run(f.prepare('save')); await entered.promise;
    f.metadata = {}; f.chat = []; f.target = { ...f.target, chatKey: 'new' }; wait.resolve();
    const result = await pending; assert.equal(result.status, 'partial'); assert.equal(result.chatSave, 'confirmed');
    assert.equal(original.gd.npcs.length, 1); assert.deepEqual(f.metadata, {}); assert.equal(f.calls.notify, 0);
});

test('abort during save reports uncertainty and never retries an in-flight write', async () => {
    const wait = deferred(), entered = deferred(), f = fixture({ save: () => { entered.resolve(); return wait.promise; } });
    const controller = new AbortController(), ticket = f.prepare('save'), pending = f.run(ticket, { signal: controller.signal });
    await entered.promise; controller.abort(); const result = await pending;
    assert.equal(result.code, 'CANCELLED'); assert.equal(result.chatSave, 'unknown'); assert.equal(result.resultWriteStarted, true);
    assert.equal(f.system.isGenerating(), true); wait.resolve(); await tick(); assert.equal(f.system.isGenerating(), false);
    assert.equal(f.calls.save, 1); assert.equal(f.calls.notify, 0); assert.equal(f.metadata.gd.npcs.length, 1);
    assert.deepEqual(await f.run(ticket), result);
});

test('release during a native request prevents any late save', async () => {
    const wait = deferred(), f = fixture({ generate: () => wait.promise }), ticket = f.prepare('save');
    const pending = f.run(ticket); await tick(); f.port.forgetExecutions('task');
    const result = await pending; assert.equal(result.code, 'CANCELLED'); assert.equal(f.system.isGenerating(), true);
    wait.resolve(JSON.stringify({ npcs: [row()] })); await tick(); assert.equal(f.system.isGenerating(), false);
    assert.equal(f.calls.save, 0); assert.deepEqual(f.metadata, {});
});

test('long output is omitted only from the port DTO, not from the saved NPC', async () => {
    const f = fixture({ generate: () => JSON.stringify({ npcs: [row('Long', 'x'.repeat(7000))] }) });
    const result = await f.run(f.prepare('save')); assert.equal(result.status, 'applied_confirmed');
    assert.equal(result.outputOmitted, true); assert.deepEqual(result.npcs, []); assert.equal(f.metadata.gd.npcs[0].description.length, 7000);
});

test('pre-aborted execution performs no effects and does not consume the ticket', async () => {
    const f = fixture(), ticket = f.prepare(), controller = new AbortController(); controller.abort();
    assert.equal((await f.run(ticket, { signal: controller.signal })).status, 'not_started');
    assert.equal(f.calls.model, 0); assert.equal((await f.run(ticket)).status, 'trial_completed');
});

test('cancel during render prevents model and save, while retaining the physical busy lock', async () => {
    const wait = deferred(), f = fixture({ render: () => wait.promise }), controller = new AbortController();
    const pending = f.run(f.prepare('save'), { signal: controller.signal }); await tick(); controller.abort();
    assert.equal((await pending).code, 'CANCELLED'); assert.equal(f.system.isGenerating(), true);
    await assert.rejects(f.system.generateNpcs(), /NPC_BUSY/);
    wait.resolve('Rendered'); await tick(); assert.equal(f.system.isGenerating(), false); assert.equal(f.calls.model, 0); assert.equal(f.calls.save, 0);
});

test('native timeout does not permit overlapping physical calls or a late save', async () => {
    const wait = deferred(), f = fixture({ generate: () => wait.promise, timeoutMs: 15 });
    const ticket = f.prepare('save'), result = await f.run(ticket);
    assert.equal(result.code, 'TIMEOUT'); assert.equal(result.status, 'outcome_unknown'); assert.equal(f.system.isGenerating(), true);
    assert.throws(() => f.prepare(), /NPC_BUSY/); await assert.rejects(f.system.generateNpcs(), /NPC_BUSY/);
    wait.resolve(JSON.stringify({ npcs: [row()] })); await tick(); assert.equal(f.system.isGenerating(), false);
    assert.equal(f.calls.save, 0); assert.deepEqual(await f.run(ticket), result); assert.equal(f.calls.model, 1);
});

test('clearing/forgetting tickets never restores execution permission from old descriptors', async () => {
    const f = fixture(), ticket = f.prepare(); f.port.forgetExecutions('task');
    assert.equal(f.port.describeExecution(ticket.executionId, f.target), null); await assert.rejects(f.run(ticket), /STALE_NPC_GENERATION/);
    const next = f.prepare(); f.port.clearExecutions(); await assert.rejects(f.run(next), /STALE_NPC_GENERATION/); assert.equal(f.calls.model, 0);
});

test('wrong revision/count and unavailable confirmed saver fail before any effects', () => {
    const f = fixture(); assert.throws(() => f.port.prepareExecution({ revision: 'wrong', mode: 'save' }, { target: f.target, taskId: 'task' }), /STALE_NPC_GENERATION/);
    assert.throws(() => f.prepare('save', 0), /UNSUPPORTED_NPC_LIMIT/);
    const port = createNpcGenerationPort({ getTarget: () => f.target, getSettings: () => f.settings,
        getContext: () => ({ chat: f.chat, chatMetadata: f.metadata, mainApi: f.mainApi }), getProviders: () => f.providers, system: f.system });
    assert.throws(() => port.prepareExecution({ revision: port.readState(f.target).revision, mode: 'save' }, { target: f.target, taskId: 'task' }), /WRITE_UNAVAILABLE/);
    assert.equal(f.calls.model, 0);
});
