import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationBatchPort } from '../../muyu/host/generation-batch.js';
import { createMemorySystem } from '../../systems/memory-system.js';
import { createProfileSystem } from '../../systems/profile-system.js';
import { createNpcSystem } from '../../systems/npc-system.js';
import { createMemoryAgent } from '../../agents/memory.js';
import { createNpcAgent } from '../../agents/npc.js';
import { execute } from '../../systems/agent-runtime.js';
import { createMemoryGenerationPort } from '../../muyu/host/memory-generation.js';
import { createProfileGenerationPort } from '../../muyu/host/profile-generation.js';
import { createNpcGenerationPort } from '../../muyu/host/npc-generation.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture({ generate, save, timeoutMs = 1000 } = {}) {
    const f = { metadata: {}, chat: [{ mes: 'Private story' }], target: { kind: 'chat', userKey: 'user', chatKey: 'A' }, mainApi: 'openai',
        settings: { memoryMaxEntries: 2, profileEnabled: true, profileJsonSchema: '', npcEnabled: true, npcMaxCount: 10, npcBatchSize: 2,
            agentConfigs: { memory: { call: { retries: 2, timeout: 1000 } }, profile: {}, npc: { call: { retries: 2, timeout: 1000 } } } },
        characters: [{ avatar: 'alice.png', name: 'Alice', description: 'Private character' }, { avatar: 'bob.png', name: 'Bob', description: 'Other' }],
        group: { members: ['alice.png','bob.png'] }, providers: [{ render() {} }], calls: [], saves: 0, busy: false };
    const context = () => ({ chat: f.chat, chatMetadata: f.metadata, mainApi: f.mainApi, groups: [f.group], groupId: 'group' });
    const output = kind => kind === 'memory' ? '{"memories":[{"event":"Met a friend","mood":"happy"}]}' : kind === 'profile'
        ? '{"summary":"Generated","tags":["owl"],"motivation":"Help","relationships":"Team"}'
        : '{"npcs":[{"name":"Merchant","description":"Traveller","personality":"Calm","scenario":"Town"}]}';
    const caller = kind => () => ({ supportsAbort: false, generate: async () => { f.calls.push(kind); return generate ? generate(kind, f, output(kind)) : output(kind); } });
    const saver = async metadata => { assert.equal(metadata, f.metadata); f.saves++; if (save) await save(f); };
    const common = { settings: f.settings, EXT_KEY: 'gd', getChatMetadata: () => f.metadata, getChat: () => f.chat,
        getCharacters: () => f.characters, getCurrentGroup: () => f.group, getContext: context,
        saveChatConditional: () => { throw Error('unconfirmed fallback forbidden'); }, log() {} };
    const memoryAgent = createMemoryAgent({ renderPrompt: async p => p, extractJsonObject: () => null, log() {} });
    const npcAgent = createNpcAgent({ renderPrompt: async p => p, extractJsonObject: () => null, log() {} }); f.agents = [memoryAgent, npcAgent];
    f.memory = createMemorySystem({ ...common, AgentRegistry: { get: () => memoryAgent }, execute, createCaller: caller('memory'),
        buildContextPool: ({ memoryCharacter, memoryExistingList }) => ({ chat: () => f.chat, memoryCharacter: () => memoryCharacter, memoryExistingList, recentMessages: () => f.chat }) });
    f.profile = createProfileSystem({ ...common, createCaller: caller('profile'), renderPrompt: async p => p, hashChar: (...args) => args.join('|'),
        djb2Hash: value => String(value.length), extractJsonObject: () => null, sanitizeJson: value => value, isRoundActive: () => false,
        setExtensionPrompt() {}, inject_ids: { QUIET_PROMPT: 'quiet' }, extension_prompt_types: { IN_PROMPT: 0 } });
    f.npc = createNpcSystem({ ...common, AgentRegistry: { get: () => npcAgent }, execute, createCaller: caller('npc'),
        buildContextPool: ({ group, npcExistingList, npcBatchSize, npcGenerateFirstMes }) => ({ group: () => group, characters: () => f.characters,
            recentMessages: () => f.chat, npcExistingList, npcBatchSize, npcGenerateFirstMes }) });
    const portCommon = { getTarget: () => f.target, getContext: context, getSettings: () => f.settings, getCharacters: () => f.characters,
        getProviders: () => f.providers, saveChatConfirmed: saver, timeoutMs: 1000 };
    f.ports = { memory: createMemoryGenerationPort({ ...portCommon, system: f.memory }), profile: createProfileGenerationPort({ ...portCommon, system: f.profile }),
        npc: createNpcGenerationPort({ ...portCommon, system: f.npc }) };
    f.batch = createGenerationBatchPort({ ...portCommon, extensionKey: 'gd', getAgents: () => f.agents,
        memoryGeneration: f.ports.memory, profileGeneration: f.ports.profile, npcGeneration: f.ports.npc, isBusy: () => f.busy, timeoutMs });
    f.step = (kind, index = 0, mode = 'save') => {
        if (kind === 'npc') return { kind, mode, count: 2, revision: f.ports.npc.readState(f.target).revision };
        const row = f.ports[kind].listTargets(f.target).items[index]; return { kind, mode, character: row.character, revision: row.revision };
    };
    f.prepare = steps => f.batch.prepareExecution({ steps }, { target: f.target, taskId: 'task' });
    f.run = (ticket, options = {}) => f.batch.execute(ticket.executionId, { target: f.target, taskId: 'task', ...options });
    return f;
}

test('batch preparation is pure, bounded and does not disclose raw data or child tickets', () => {
    const f = fixture(), ticket = f.prepare([f.step('memory'), f.step('profile'), f.step('npc')]);
    assert.equal(ticket.maximumModelCalls, 3); assert.equal(ticket.atomic, false); assert.deepEqual(f.metadata, {}); assert.equal(f.calls.length, 0);
    assert.equal(JSON.stringify(ticket).includes('alice.png'), false); assert.equal(JSON.stringify(ticket).includes('Private story'), false);
    assert.equal(ticket.steps.some(row => Object.hasOwn(row, 'executionId')), false);
});

for (const kind of ['memory','profile']) test(`two ${kind} saves on a previously empty warehouse execute sequentially without stale replays`, async () => {
    const f = fixture(), ticket = f.prepare([f.step(kind), f.step(kind, 1)]);
    const result = await f.run(ticket); assert.equal(result.status, 'completed'); assert.equal(result.completed, 2);
    assert.deepEqual(f.calls, [kind,kind]); assert.equal(f.saves, 2);
    const store = f.metadata.gd[kind === 'memory' ? 'charMemories' : 'characterProfiles']; assert.deepEqual(Object.keys(store), ['alice.png','bob.png']);
    assert.deepEqual(await f.run(ticket), result); assert.equal(f.calls.length, 2);
});

test('mixed memory/profile/NPC save batch retains all confirmed results and never imports cards', async () => {
    const f = fixture(), ticket = f.prepare([f.step('memory'), f.step('profile'), f.step('npc')]);
    const result = await f.run(ticket); assert.equal(result.status, 'completed'); assert.equal(result.completed, 3);
    assert.deepEqual(f.calls, ['memory','profile','npc']); assert.equal(f.saves, 3);
    assert.equal(f.metadata.gd.charMemories['alice.png'].length, 1); assert.equal(f.metadata.gd.characterProfiles['alice.png'].state, 'ready');
    assert.equal(f.metadata.gd.npcs[0].imported, false); assert.equal(f.characters.length, 2);
});

test('trial batch retains output as historical data and does not initialize any warehouse', async () => {
    const f = fixture(), ticket = f.prepare([f.step('memory',0,'trial'), f.step('profile',1,'trial'), f.step('npc',0,'trial')]);
    const result = await f.run(ticket); assert.equal(result.status, 'completed'); assert.deepEqual(f.metadata, {}); assert.equal(f.saves, 0);
    assert.equal(result.steps[0].result.entries[0].event, 'Met a friend'); assert.equal(result.steps[1].result.profile.summary, 'Generated');
});

test('memory trimming stays within the exact selected character and preserves other metadata', async () => {
    const f = fixture(); f.metadata.gd = { charMemories: { 'alice.png': [{event:'old'},{event:'recent'}], 'bob.png': [{event:'keep'}] }, variables: { flag: true } };
    const result = await f.run(f.prepare([f.step('memory'), f.step('profile',1)])); assert.equal(result.status, 'completed');
    assert.deepEqual(f.metadata.gd.charMemories['alice.png'].map(row => row.event), ['recent','Met a friend']);
    assert.deepEqual(f.metadata.gd.charMemories['bob.png'], [{event:'keep'}]); assert.equal(f.metadata.gd.variables.flag, true);
});

test('no accepted NPC output is a completed no-result step, not permission to try again', async () => {
    const f = fixture({ generate: (kind, _f, raw) => kind === 'npc' ? '{"npcs":[{"name":"Alice","description":"Duplicate","personality":"","scenario":""}]}' : raw });
    const result = await f.run(f.prepare([f.step('npc'), f.step('profile')])); assert.equal(result.status, 'completed');
    assert.equal(result.steps[0].status, 'no_result'); assert.deepEqual(f.calls, ['npc','profile']); assert.equal(f.saves, 1);
});

test('unknown first save stops all remaining steps, preserves its possible write and never retries', async () => {
    const f = fixture({ save: () => { throw Error('save unknown'); } }), ticket = f.prepare([f.step('memory'), f.step('profile')]);
    const result = await f.run(ticket); assert.equal(result.status, 'outcome_unknown'); assert.equal(result.steps[0].status, 'outcome_unknown');
    assert.equal(result.steps[1].status, 'not_started'); assert.equal(f.saves, 1); assert.deepEqual(f.calls, ['memory']);
    assert.equal(f.metadata.gd.charMemories['alice.png'].length, 1); assert.deepEqual(await f.run(ticket), result); assert.equal(f.saves, 1);
});

test('later unknown save leaves earlier confirmed writes and reports partial execution', async () => {
    const f = fixture({ save: f => { if (f.saves === 2) throw Error('second unknown'); } });
    const result = await f.run(f.prepare([f.step('memory'), f.step('profile'), f.step('npc')]));
    assert.equal(result.status, 'partial'); assert.equal(result.completed, 1); assert.equal(result.steps[2].status, 'not_started');
    assert.equal(f.metadata.gd.charMemories['alice.png'].length, 1); assert.equal(f.metadata.gd.characterProfiles['alice.png'].state, 'ready');
});

test('same-character concurrent edit yields partial child outcome and stops the remainder', async () => {
    const f = fixture({ save: f => { f.metadata.gd.charMemories['alice.png'][0].event = 'Concurrent'; } });
    const result = await f.run(f.prepare([f.step('memory'), f.step('profile')]));
    assert.equal(result.steps[0].status, 'partial'); assert.equal(result.steps[1].status, 'not_started'); assert.equal(f.metadata.gd.charMemories['alice.png'][0].event, 'Concurrent');
});

for (const [name, mutate] of [
    ['unrelated variable', f => { f.metadata.gd.variables = { other: 'concurrent' }; }],
    ['other character memory', f => { f.metadata.gd.charMemories['bob.png'] = [{event:'concurrent'}]; }],
    ['other warehouse', f => { f.metadata.gd.npcs = []; }],
]) test(`confirmed child save cannot silently adopt concurrent ${name}`, async () => {
    const f = fixture({ save: f => { if (f.saves === 1) mutate(f); } });
    const result = await f.run(f.prepare([f.step('memory'),f.step('profile')]));
    assert.equal(result.status, 'partial'); assert.equal(result.completed, 1); assert.equal(result.steps[0].status, 'applied_confirmed');
    assert.equal(result.steps[0].code, 'STEP_STALE_OR_FAILED'); assert.equal(result.steps[1].status, 'not_started'); assert.deepEqual(f.calls, ['memory']);
});

for (const [name, mutate] of [
    ['chat body', f => { f.chat[0].mes = 'changed'; }],
    ['metadata', f => { f.metadata = {}; }],
    ['root reference', f => { f.metadata.gd = {}; }],
    ['model setting', f => { f.settings.agentConfigs.memory.apiKey = 'other'; }],
    ['Provider implementation', f => { f.providers[0].render = () => {}; }],
    ['character reference', f => { f.characters[0] = {...f.characters[0]}; }],
    ['Agent implementation', f => { f.agents[0].pipeline.parse = () => []; }],
    ['target', f => { f.target = {...f.target,chatKey:'B'}; }],
    ['busy', f => { f.busy = true; }],
]) test(`stale batch ${name} cannot start rendering, calls or writes`, async () => {
    const f = fixture(), ticket = f.prepare([f.step('memory'),f.step('profile')]); mutate(f);
    await assert.rejects(f.run(ticket), /STALE_GENERATION_BATCH|TARGET_UNAVAILABLE|GENERATION_BATCH_BUSY/); assert.equal(f.calls.length, 0); assert.equal(f.saves, 0);
});

test('Muyu conversation persistence is not a business configuration change', async () => {
    const f = fixture(), ticket = f.prepare([f.step('memory'),f.step('profile')]); f.settings.muyuHistoryAccount = { texts: ['new'] };
    assert.equal((await f.run(ticket)).status, 'completed');
});

for (const kind of ['memory','profile','npc']) test(`duplicate ${kind} target is rejected without a paid attempt`, () => {
    const f = fixture(), step = f.step(kind); assert.throws(() => f.prepare([step,step]), /DUPLICATE_GENERATION_BATCH_STEP/); assert.equal(f.calls.length, 0);
});

test('batch cannot include Blueprint, arbitrary keys, changed modes or other user tasks', async () => {
    const f = fixture(), step = f.step('memory');
    assert.throws(() => f.prepare([{...step,kind:'blueprint'}]), /INVALID_GENERATION_BATCH/);
    assert.throws(() => f.prepare([{...step,code:'evil'}]), /INVALID_GENERATION_BATCH/);
    assert.throws(() => f.prepare([{...step,mode:'replace'}]), /INVALID_GENERATION_BATCH/);
    const ticket = f.prepare([step]); assert.throws(() => f.prepare([{...step,mode:'trial'}]), /GENERATION_BATCH_ALREADY_PREPARED/);
    await assert.rejects(f.run(ticket,{taskId:'other'}), /STALE_GENERATION_BATCH/); assert.equal(f.calls.length, 0);
});

test('preflight failure clears child tickets and prevents partial execution', () => {
    const f = fixture(), step = f.step('memory'), bad = {...f.step('profile'),revision:'stale'};
    assert.throws(() => f.prepare([step,bad]), /STALE_PROFILE_GENERATION/); assert.equal(f.calls.length, 0); assert.deepEqual(f.metadata, {});
    assert.ok(f.prepare([step]));
});

test('pre-aborted batch does not consume the approval or perform any effects', async () => {
    const f = fixture(), ticket = f.prepare([f.step('memory')]), controller = new AbortController(); controller.abort();
    assert.equal((await f.run(ticket,{signal:controller.signal})).status,'not_started'); assert.equal(f.calls.length,0);
    assert.equal((await f.run(ticket)).status,'completed');
});

test('stop during native work keeps physical busy and blocks late writes and later calls', async () => {
    const wait = deferred(), f = fixture({generate: async (_kind,_f,raw) => {await wait.promise;return raw;}}), controller = new AbortController();
    const ticket = f.prepare([f.step('memory'),f.step('profile')]), pending = f.run(ticket,{signal:controller.signal});
    await tick(); controller.abort(); const result = await pending;
    assert.equal(result.steps[1].status,'not_started'); assert.equal(f.memory.isGenerating(),true); assert.equal(f.saves,0);
    wait.resolve(); await tick(); assert.equal(f.memory.isGenerating(),false); assert.equal(f.saves,0); assert.deepEqual(f.metadata,{});
    assert.deepEqual(await f.run(ticket),result); assert.deepEqual(f.calls,['memory']);
});

test('batch timeout is one total deadline, does not reset for each child', async () => {
    const wait = deferred(), f = fixture({timeoutMs:15,generate:async (_kind,_f,raw)=>{await wait.promise;return raw;}});
    const result = await f.run(f.prepare([f.step('memory'),f.step('profile')]));
    assert.equal(result.code,'TIMEOUT'); assert.equal(result.steps[0].code,'TIMEOUT');
    assert.equal(result.steps[1].status,'not_started'); assert.equal(f.saves,0); wait.resolve(); await tick(); assert.equal(f.saves,0);
});

test('parallel repeats await the same batch, never run the same paid step twice', async () => {
    const wait=deferred(),f=fixture({generate:async (_kind,_f,raw)=>{await wait.promise;return raw;}}),ticket=f.prepare([f.step('memory')]);
    const first=f.run(ticket),second=f.run(ticket);await tick();assert.equal(f.calls.length,1);wait.resolve();
    assert.deepEqual(await first,await second);assert.equal(f.saves,1);
});

test('forget/clear retires batch authority; old descriptors never restore execution rights', async () => {
    const f=fixture(),ticket=f.prepare([f.step('memory')]);f.batch.forgetExecutions('task');
    assert.equal(f.batch.describeExecution(ticket.executionId,f.target),null);await assert.rejects(f.run(ticket),/STALE_GENERATION_BATCH/);
    const next=f.prepare([f.step('profile')]);f.batch.clearExecutions();await assert.rejects(f.run(next),/STALE_GENERATION_BATCH/);assert.equal(f.calls.length,0);
});

test('a same-value replacement of another character entry is not adopted after a confirmed save', async () => {
    const f = fixture({ save: f => { f.metadata.gd.charMemories['bob.png'] = [...f.metadata.gd.charMemories['bob.png']]; } });
    f.metadata.gd = { charMemories: { 'bob.png': [{event:'keep'}] } };
    const result = await f.run(f.prepare([f.step('memory'), f.step('profile')]));
    assert.equal(result.status, 'partial'); assert.equal(result.steps[0].status, 'applied_confirmed');
    assert.equal(result.steps[1].status, 'not_started'); assert.equal(f.calls.length, 1);
});

test('profile capacity is checked against the entire approved list before any effects', () => {
    const f = fixture(); f.metadata.gd = { characterProfiles: Object.fromEntries(Array.from({length:511}, (_,i) => ['old'+i, {state:'ready'}])) };
    const steps = [f.step('profile'), f.step('profile',1)];
    assert.throws(() => f.prepare(steps), /PROFILE_CAPACITY_EXCEEDED/); assert.equal(f.calls.length,0); assert.equal(f.saves,0);
});

test('a partial child result is never considered safe enough to continue even when save confirmed', async () => {
    const f = fixture({ save: f => { f.metadata.gd.npcs[0].description = 'Concurrent'; } });
    const result = await f.run(f.prepare([f.step('npc'), f.step('profile')]));
    assert.equal(result.steps[0].status, 'partial'); assert.equal(result.steps[0].chatSave, 'confirmed');
    assert.equal(result.steps[1].status, 'not_started'); assert.deepEqual(f.calls,['npc']);
});

test('retiring a running batch prevents late native data from reaching another step', async () => {
    const wait=deferred(),f=fixture({generate:async (_kind,_f,raw)=>{await wait.promise;return raw;}}),ticket=f.prepare([f.step('memory'),f.step('profile')]);
    const pending=f.run(ticket);await tick();f.batch.forgetExecutions('task');const result=await pending;
    assert.equal(result.steps[1].status,'not_started');wait.resolve();await tick();assert.equal(f.saves,0);assert.equal(f.calls.length,1);
    await assert.rejects(f.run(ticket),/STALE_GENERATION_BATCH/);
});

test('aggregate output omits long bodies but retains every per-step outcome and saved content', async () => {
    const f=fixture({generate:(kind,_f,raw)=>kind==='profile'?JSON.stringify({summary:'"'.repeat(2600),tags:[],motivation:'',relationships:''}):raw});
    // Four distinct targets permit a bounded list without repeating a character.
    f.characters.push({avatar:'c.png',name:'C'},{avatar:'d.png',name:'D'});
    const result=await f.run(f.prepare([0,1,2,3].map(i=>f.step('profile',i))));
    assert.equal(result.status,'completed');assert.equal(result.steps.length,4);assert.ok(result.steps.some(row=>row.outputOmitted));
    assert.ok(new TextEncoder().encode(JSON.stringify(result)).length<32768);
    for(const c of f.characters)assert.equal(f.metadata.gd.characterProfiles[c.avatar].profile.summary.length,2600);
});
