import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfileSystem } from '../../systems/profile-system.js';
import { createProfileGenerationPort } from '../../muyu/host/profile-generation.js';

const profile = () => ({ summary: 'Generated', tags: ['owl'], motivation: 'Help', relationships: 'Team' });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ render, generate, save, validate, useCustom = false } = {}) {
    const f = { settings: { profileEnabled: true, profileGeneratorPrompt: '{{charName}}|{{charDescription}}|{{provider}}', profileJsonSchema: '',
        agentConfigs: { profile: { useCustom } } }, metadata: {}, chat: [{ mes: 'body' }], mainApi: 'chat-completion',
        characters: [{ avatar: 'alice.png', name: 'Alice', description: 'description', personality: 'owl', scenario: 'tavern' },
            { avatar: 'bob.png', name: 'Bob', description: 'other' }],
        calls: { render: 0, model: 0, save: 0, notify: 0, quiet: 0 }, round: false };
    f.system = createProfileSystem({ settings: f.settings, EXT_KEY: 'gd', getChatMetadata: () => f.metadata, getChat: () => f.chat,
        getCharacters: () => f.characters, getCurrentGroup: () => ({ id: 'group', members: ['alice.png', 'bob.png'] }),
        getContext: () => ({ mainApi: f.mainApi, generateRaw: async options => { f.rawOptions = options; return generate ? generate() : JSON.stringify(profile()); } }),
        hashChar: (...args) => args.join('|'), djb2Hash: text => 'schema:' + text,
        extractJsonObject: text => text.match(/\{.*\}/s)?.[0], sanitizeJson: text => text,
        isRoundActive: () => f.round, saveChatConditional: async () => { throw Error('must not use unconfirmed saver'); },
        renderPrompt: async prompt => { f.calls.render++; f.prompt = prompt; return render ? render(f) : prompt.replace('{{provider}}', 'provider'); },
        createCaller: (config, raw) => ({ generate: async (prompt, options = {}) => {
            f.calls.model++; f.config = config; f.signal = options.signal; return raw({ prompt });
        } }),
        setExtensionPrompt: () => { f.calls.quiet++; }, inject_ids: { QUIET_PROMPT: 'quiet' }, extension_prompt_types: { IN_PROMPT: 0 } });
    f.run = (mode = 'trial', extra = {}) => f.system.generateApproved('alice.png', { mode,
        validate: () => validate?.(f), saveChatConfirmed: async metadata => { f.calls.save++; assert.equal(metadata, f.metadata); if (save) await save(f); },
        changed: () => { f.calls.notify++; }, ...extra });
    return f;
}

test('profile inspection and trial are pure and resolve the real character/Provider prompt', async () => {
    const f = fixture();
    assert.equal(f.system.inspectGeneration('alice.png').exists, false);
    assert.deepEqual(f.metadata, {}); assert.equal(f.calls.render, 0);
    const result = await f.run();
    assert.equal(result.status, 'trial_completed'); assert.deepEqual(result.profile, profile());
    assert.equal(result.formatChecked, 'standard_fields'); assert.equal(result.chatSave, 'not_started');
    assert.equal(f.rawOptions.prompt, 'Alice|description|provider'); assert.equal(Object.hasOwn(f.rawOptions, 'jsonSchema'), false);
    assert.deepEqual(f.metadata, {}); assert.deepEqual(f.calls, { render: 1, model: 1, save: 0, notify: 0, quiet: 1 });
});

test('missing profile save preserves archives and schema metadata, creates a generated ready record', async () => {
    const f = fixture();
    const archive = { old: { summary: 'archived' } }; f.metadata.gd = { archivedProfiles: archive, profileVersion: 1, profileSchemaHash: '' };
    const result = await f.run('save');
    assert.equal(result.status, 'applied_confirmed'); assert.equal(f.calls.save, 1); assert.equal(f.calls.notify, 1);
    assert.equal(f.metadata.gd.archivedProfiles, archive); assert.equal(f.metadata.gd.profileSchemaHash, '');
    assert.equal(f.metadata.gd.profileVersion, 1);
    const stored = f.metadata.gd.characterProfiles['alice.png'];
    assert.equal(stored.state, 'ready'); assert.equal(stored.manualEdited, false); assert.equal(stored.hash, 'description|owl|tavern');
    assert.deepEqual(stored.profile, profile()); assert.equal(typeof stored.updatedAt, 'number');
});

test('first save does not initialize schema version/hash or archives', async () => {
    const f = fixture(); await f.run('save');
    assert.deepEqual(Object.keys(f.metadata.gd), ['characterProfiles']);
});

for (const existing of [null, { state: 'pending' }, { state: 'failed' }, { state: 'ready', manualEdited: true, profile: profile() }]) {
    test(`save refuses existing profile including ${existing?.state || 'null'} without generating`, async () => {
        const f = fixture(); f.metadata.gd = { characterProfiles: { 'alice.png': existing } };
        await assert.rejects(f.run('save'), /PROFILE_ALREADY_EXISTS/);
        assert.equal(f.calls.model, 0); assert.equal(f.calls.render, 0); assert.equal(f.metadata.gd.characterProfiles['alice.png'], existing);
    });
}

test('trial preserves a hand-edited profile and its object identity', async () => {
    const f = fixture(), entry = { state: 'ready', manualEdited: true, profile: { summary: 'Keep me' } };
    f.metadata.gd = { characterProfiles: { 'alice.png': entry } };
    assert.equal((await f.run()).status, 'trial_completed'); assert.equal(f.metadata.gd.characterProfiles['alice.png'], entry);
});

for (const schema of ['not json', 'null', '{"type":"object"}', '{"type":"object","properties":{"custom":{"type":"string"}}}']) {
    test(`unsupported configured schema fails before render/model: ${schema}`, async () => {
        const f = fixture(); f.settings.profileJsonSchema = schema;
        await assert.rejects(f.run('save'), /UNSUPPORTED_PROFILE_SCHEMA/); assert.equal(f.calls.render, 0); assert.equal(f.calls.model, 0); assert.deepEqual(f.metadata, {});
    });
}

test('explicit standard schema is forwarded to native generation', async () => {
    const f = fixture(); f.settings.profileJsonSchema = f.system.getDefaultProfileSchema();
    await f.run(); assert.deepEqual(f.rawOptions.jsonSchema, { name: 'character_profile', value: JSON.parse(f.system.getDefaultProfileSchema()), strict: true });
});

for (const raw of ['[]', 'null', '{}', '{"summary":42,"tags":[],"motivation":"","relationships":""}',
    JSON.stringify({ ...profile(), tags: [42] }), JSON.stringify({ ...profile(), extra: 'not standard' }),
    JSON.stringify({ ...profile(), tags: Array(65).fill('x') }), JSON.stringify({ ...profile(), summary: 'x'.repeat(12001) }),
    JSON.stringify({ ...profile(), tags: ['x'.repeat(201)] }), '{"__proto__":{},"summary":"","tags":[],"motivation":"","relationships":""}']) {
    test(`invalid generated shape never creates/marks a failed profile: ${raw.slice(0, 65)}`, async () => {
        const f = fixture({ generate: () => raw }); await assert.rejects(f.run('save'), /INVALID_PROFILE_OUTPUT/);
        assert.equal(f.calls.model, 1); assert.equal(f.calls.save, 0); assert.deepEqual(f.metadata, {});
    });
}

test('JSON extraction is supported but does not fill missing contract fields', async () => {
    const f = fixture({ generate: () => 'prose ' + JSON.stringify(profile()) + ' end' });
    assert.deepEqual((await f.run()).profile, profile());
});

test('literal replacement metacharacters in character data are preserved', async () => {
    const f = fixture(); f.characters[0].description = "$& $` $'";
    await f.run(); assert.equal(f.prompt, "Alice|$& $` $'|{{provider}}");
});

for (const [name, mutate, error] of [
    ['disabled', f => { f.settings.profileEnabled = false; }, 'PROFILE_DISABLED'],
    ['director busy', f => { f.round = true; }, 'PROFILE_BUSY'],
    ['stale schema hash', f => { f.metadata.gd = { profileSchemaHash: 'old' }; }, 'PROFILE_SCHEMA_STALE'],
    ['unsupported version', f => { f.metadata.gd = { profileVersion: 2 }; }, 'UNSUPPORTED_PROFILE_STORE'],
    ['array store', f => { f.metadata.gd = { characterProfiles: [] }; }, 'UNSUPPORTED_PROFILE_STORE'],
    ['duplicate avatar', f => { f.characters.push({ ...f.characters[0] }); }, 'PROFILE_CHARACTER_UNAVAILABLE'],
    ['malformed role fields', f => { f.characters[0].description = {}; }, 'PROFILE_CHARACTER_UNAVAILABLE'],
]) test(`profile generation fail-closed: ${name}`, async () => {
    const f = fixture(); mutate(f); await assert.rejects(f.run(), new RegExp(error)); assert.equal(f.calls.model, 0);
});

test('missing confirmed saver and invalid modes/validation fail before any effects', async () => {
    const f = fixture();
    await assert.rejects(f.run('save', { saveChatConfirmed: undefined }), /WRITE_UNAVAILABLE/);
    await assert.rejects(f.run('overwrite'), /INVALID_PROFILE_GENERATION/);
    await assert.rejects(f.run('trial', { validate: undefined }), /INVALID_PROFILE_GENERATION/);
    assert.equal(f.calls.render, 0);
});

test('already aborted generation does not render or start the model', async () => {
    const f = fixture(), abort = new AbortController(); abort.abort();
    await assert.rejects(f.run('save', { signal: abort.signal }), /CANCELLED/); assert.equal(f.calls.render, 0);
});

test('cancel during Provider render retains the physical lease and prevents later model work', async () => {
    const wait = deferred(), f = fixture({ render: () => wait.promise }), abort = new AbortController();
    const work = f.run('save', { signal: abort.signal }); await tick(); abort.abort();
    await assert.rejects(work, /CANCELLED/); assert.equal(f.system.isGenerating(), true);
    await assert.rejects(f.system.generateSingleProfile('alice.png'), /PROFILE_BUSY/);
    wait.resolve('rendered'); await tick(); assert.equal(f.system.isGenerating(), false); assert.equal(f.calls.model, 0); assert.deepEqual(f.metadata, {});
});

test('cancel during native model work keeps lease and defers quiet cleanup until drain', async () => {
    const wait = deferred(), f = fixture({ generate: () => wait.promise }), abort = new AbortController();
    const work = f.run('save', { signal: abort.signal }); await tick(); assert.equal(f.calls.model, 1); abort.abort();
    await assert.rejects(work, /CANCELLED/); assert.equal(f.system.isGenerating(), true); assert.equal(f.calls.quiet, 0);
    await assert.rejects(f.run(), /PROFILE_BUSY/); await assert.rejects(f.system.generateProfilesBatch(['bob.png']), /PROFILE_BUSY/);
    wait.resolve(JSON.stringify(profile())); await tick(); assert.equal(f.calls.quiet, 1); assert.equal(f.system.isGenerating(), false);
    assert.equal(f.calls.save, 0); assert.deepEqual(f.metadata, {});
});

test('custom model receives cancellation signal and never clears native quiet prompt', async () => {
    const f = fixture({ useCustom: true }), abort = new AbortController(); await f.run('trial', { signal: abort.signal });
    assert.equal(f.signal, abort.signal); assert.equal(f.calls.quiet, 0); assert.equal(f.config.useCustom, true);
});

for (const [name, mutate] of [
    ['chat identity', f => { f.chat = [...f.chat]; }], ['chat body', f => { f.chat[0].mes = 'changed'; }],
    ['metadata', f => { f.metadata = {}; }], ['character identity', f => { f.characters[0] = { ...f.characters[0] }; }],
    ['character body', f => { f.characters[0].description = 'changed'; }], ['native connection', f => { f.mainApi = 'different'; }],
    ['business configuration', f => { f.settings.profileGeneratorPrompt = 'different'; }],
    ['same profile created', f => { f.metadata.gd = { characterProfiles: { 'alice.png': { state: 'ready' } } }; }],
]) test(`in-flight ${name} change refuses stale output without save`, async () => {
    const wait = deferred(), f = fixture({ generate: () => wait.promise }); const work = f.run('save'); await tick(); mutate(f);
    wait.resolve(JSON.stringify(profile())); await assert.rejects(work, /STALE_PROFILE_GENERATION/); assert.equal(f.calls.save, 0);
});

test('assistant history/settings updates do not invalidate business generation', async () => {
    const f = fixture({ generate: () => { f.settings.muyuSessions = { changed: true }; return JSON.stringify(profile()); } });
    assert.equal((await f.run('save')).status, 'applied_confirmed');
});

test('unrelated role edits during model/save survive and do not masquerade as failure', async () => {
    const wait = deferred(), entry = { profile: { summary: 'Before' } }, f = fixture({ generate: () => wait.promise,
        save: () => { entry.profile.summary = 'After save'; } });
    f.metadata.gd = { characterProfiles: { 'bob.png': entry } }; const work = f.run('save'); await tick(); entry.profile.summary = 'During generation';
    wait.resolve(JSON.stringify(profile())); assert.equal((await work).status, 'applied_confirmed');
    assert.equal(f.metadata.gd.characterProfiles['bob.png'], entry); assert.equal(entry.profile.summary, 'After save');
});

test('save failure remains unknown, preserves concurrent edits and never retries/rolls back', async () => {
    const f = fixture({ save: f => { f.metadata.gd.characterProfiles['bob.png'] = { profile: { summary: 'Concurrent' } }; throw Error('offline PRIVATE'); } });
    const result = await f.run('save'); assert.equal(result.status, 'outcome_unknown'); assert.equal(result.chatSave, 'unknown');
    assert.equal(f.calls.save, 1); assert.equal(f.metadata.gd.characterProfiles['alice.png'].state, 'ready');
    assert.equal(f.metadata.gd.characterProfiles['bob.png'].profile.summary, 'Concurrent'); assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});

test('same-role edit during confirmed save returns partial without overwriting it or refreshing drafts', async () => {
    const f = fixture({ save: f => { f.metadata.gd.characterProfiles['alice.png'].profile.summary = 'Concurrent manual'; } });
    const result = await f.run('save'); assert.equal(result.status, 'partial'); assert.equal(result.chatSave, 'confirmed');
    assert.equal(f.metadata.gd.characterProfiles['alice.png'].profile.summary, 'Concurrent manual'); assert.equal(f.calls.notify, 0);
});

test('chat switch during confirmed save is partial and never notifies the new panel', async () => {
    const f = fixture({ save: f => { f.chat = []; } }); assert.equal((await f.run('save')).status, 'partial'); assert.equal(f.calls.notify, 0);
});

test('observer exceptions do not change confirmed save outcome', async () => {
    const f = fixture(); assert.equal((await f.run('save', { changed: () => { throw Error('observer'); } })).status, 'applied_confirmed');
});

test('busy legacy generation blocks approved generation until completion', async () => {
    const wait = deferred(), f = fixture({ generate: () => wait.promise }); const legacy = f.system.generateSingleProfile('alice.png'); await tick();
    await assert.rejects(f.run(), /PROFILE_BUSY/); wait.resolve(JSON.stringify(profile())); await legacy; assert.equal(f.system.isGenerating(), false);
});

function portFixture(options = {}) {
    const f = fixture(options);
    f.target = { kind: 'chat', id: 'A' }; f.providers = [{ id: 'test', render: () => 'rendered' }]; f.task = 'task:1';
    f.port = createProfileGenerationPort({ getTarget: () => f.target, getSettings: () => f.settings,
        getContext: () => ({ chat: f.chat, chatMetadata: f.metadata, mainApi: f.mainApi }), getCharacters: () => f.characters,
        getProviders: () => f.providers, system: f.system, timeoutMs: options.timeout ?? 290000,
        saveChatConfirmed: async metadata => { f.calls.save++; assert.equal(metadata, f.metadata); if (options.save) await options.save(f); },
        changed: () => { f.calls.notify++; } });
    f.prepare = (mode = 'trial') => {
        const item = f.port.listTargets(f.target).items[0];
        return f.port.prepareExecution({ character: item.character, revision: item.revision, mode }, { target: f.target, taskId: f.task });
    };
    f.execute = (ticket, signal) => f.port.execute(ticket.executionId, { target: f.target, taskId: f.task, signal });
    return f;
}

test('profile directory and execution preparation expose no character body/settings or side effects', () => {
    const f = portFixture(); f.settings.agentConfigs.profile.apiKey = 'PRIVATE_KEY';
    const items = f.port.listTargets(f.target).items; assert.equal(items.length, 2); assert.equal(items[0].saveAvailable, true);
    const ticket = f.prepare('save'); assert.equal(ticket.mode, 'save'); assert.equal(ticket.oneShot, true);
    const text = JSON.stringify({ items, ticket }); assert.equal(text.includes('PRIVATE_KEY'), false); assert.equal(text.includes('description'), false);
    assert.deepEqual(f.metadata, {}); assert.equal(f.calls.render, 0); assert.equal(f.calls.model, 0);
});

test('one-shot profile execution caches success and never repeats model/save on replay', async () => {
    const f = portFixture(), ticket = f.prepare('save'), result = await f.execute(ticket);
    assert.equal(result.status, 'applied_confirmed'); assert.equal(result.outputUntrusted, true);
    assert.deepEqual(await f.execute(ticket), result); assert.equal(f.calls.model, 1); assert.equal(f.calls.save, 1);
});

test('duplicate pending profile execution is unknown rather than a second model call', async () => {
    const wait = deferred(), f = portFixture({ generate: () => wait.promise }), ticket = f.prepare(), work = f.execute(ticket);
    await tick(); assert.equal((await f.execute(ticket)).code, 'ALREADY_STARTED'); assert.equal(f.calls.model, 1);
    wait.resolve(JSON.stringify(profile())); assert.equal((await work).status, 'trial_completed');
});

test('profile preparation deduplicates exact task/role and rejects mode escalation', () => {
    const f = portFixture(), ticket = f.prepare(); assert.equal(f.prepare().executionId, ticket.executionId);
    assert.throws(() => f.prepare('save'), /PROFILE_CALL_ALREADY_PREPARED/); assert.equal(f.calls.model, 0);
});

for (const [name, mutate] of [
    ['Provider implementation', f => { f.providers[0].render = () => 'changed'; }],
    ['Provider identity', f => { f.providers = [{ ...f.providers[0] }]; }],
    ['role mapping', f => { f.characters.reverse(); }],
    ['business configuration', f => { f.settings.profileGeneratorPrompt = 'changed'; }],
    ['native destination', f => { f.mainApi = 'changed'; }],
]) test(`profile ticket rejects stale ${name} before any model call`, async () => {
    const f = portFixture(), ticket = f.prepare(); mutate(f);
    assert.equal(f.port.describeExecution(ticket.executionId, f.target), null);
    await assert.rejects(f.execute(ticket), /STALE_PROFILE_GENERATION/); assert.equal(f.calls.model, 0);
});

test('profile ticket is target/task-bound and forgotten tickets cannot be restored from descriptor', async () => {
    const f = portFixture(), ticket = f.prepare();
    await assert.rejects(f.port.execute(ticket.executionId, { target: f.target, taskId: 'another' }), /STALE_PROFILE_GENERATION/);
    f.port.forgetExecutions(f.task); assert.equal(f.port.describeExecution(ticket.executionId, f.target), null);
    await assert.rejects(f.execute(ticket), /STALE_PROFILE_GENERATION/); assert.equal(f.calls.model, 0);
});

test('profile ticket survives Muyu persistence changes without granting another execution', async () => {
    const f = portFixture(), ticket = f.prepare(); f.settings.muyuHistory = 'changed';
    assert.ok(f.port.describeExecution(ticket.executionId, f.target)); assert.equal((await f.execute(ticket)).status, 'trial_completed');
});

test('profile timeout returns safely but native request stays busy and late output cannot save', async () => {
    const wait = deferred(), f = portFixture({ generate: () => wait.promise, timeout: 15 }), ticket = f.prepare('save');
    const result = await f.execute(ticket); assert.equal(result.code, 'TIMEOUT'); assert.equal(result.modelCallAttempted, true);
    assert.equal(f.system.isGenerating(), true); assert.throws(() => f.prepare(), /PROFILE_BUSY/);
    wait.resolve(JSON.stringify(profile())); await tick(); assert.equal(f.system.isGenerating(), false); assert.equal(f.calls.save, 0);
    assert.deepEqual(await f.execute(ticket), result); assert.deepEqual(f.metadata, {});
});

test('profile ticket pre-cancellation is no-op and task retirement cancels in-flight work', async () => {
    const wait = deferred(), f = portFixture({ generate: () => wait.promise }), ticket = f.prepare('save'), abort = new AbortController(); abort.abort();
    assert.equal((await f.execute(ticket, abort.signal)).status, 'not_started'); assert.equal(f.calls.render, 0);
    const work = f.execute(ticket); await tick(); f.port.forgetExecutions(f.task); await work;
    assert.equal(f.system.isGenerating(), true); wait.resolve(JSON.stringify(profile())); await tick(); assert.equal(f.calls.save, 0);
});

test('failed profile business call returns a safe code without leaking raw exceptions or retrying', async () => {
    const f = portFixture({ generate: () => { throw Error('PRIVATE_KEY PRIVATE_BODY'); } }), ticket = f.prepare('save');
    const result = await f.execute(ticket); assert.equal(result.code, 'EXECUTION_ERROR'); assert.equal(result.chatSave, 'not_started');
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false); assert.equal(f.calls.model, 1); assert.deepEqual(f.metadata, {});
    assert.deepEqual(await f.execute(ticket), result); assert.equal(f.calls.model, 1);
});

test('long profile output is omitted only from tool DTO, not the confirmed persisted profile', async () => {
    const f = portFixture({ generate: () => JSON.stringify({ ...profile(), summary: '文'.repeat(3000) }) }), ticket = f.prepare('save');
    const result = await f.execute(ticket); assert.equal(result.status, 'applied_confirmed'); assert.equal(result.outputOmitted, true);
    assert.equal(Object.hasOwn(result, 'profile'), false); assert.equal(f.metadata.gd.characterProfiles['alice.png'].profile.summary.length, 3000);
});

test('directory revisions reject replaced roles; missing revision/task IDs fail before preparation', () => {
    const f = portFixture(), item = f.port.listTargets(f.target).items[0]; f.characters[0] = { ...f.characters[0] };
    assert.throws(() => f.port.prepareExecution({ character: item.character, revision: item.revision, mode: 'trial' }, { target: f.target, taskId: f.task }), /STALE_PROFILE_GENERATION/);
    assert.throws(() => f.port.prepareExecution({ character: item.character, mode: 'trial' }, { target: f.target, taskId: undefined }), /INVALID_PROFILE_GENERATION/);
});

test('profile target directory does not fingerprint huge chat bodies for each character', () => {
    const f = portFixture(); f.chat[0].mes = 'x'.repeat(17 * 1024 * 1024);
    assert.equal(f.port.listTargets(f.target).items.length, 2);
    assert.throws(() => f.prepare(), /PROFILE_CONTEXT_TOO_LARGE/); assert.equal(f.calls.render, 0);
});

test('profile save rejects a full store before paid generation', async () => {
    const f = fixture(); f.metadata.gd = { characterProfiles: Object.fromEntries(Array.from({ length: 512 }, (_, i) => ['other-' + i, {}])) };
    await assert.rejects(f.run('save'), /PROFILE_CAPACITY_EXCEEDED/); assert.equal(f.calls.model, 0);
});

test('concurrent store capacity exhaustion stops save after generation without discarding other entries', async () => {
    const wait = deferred(), f = fixture({ generate: () => wait.promise }); f.metadata.gd = { characterProfiles: {} };
    const store = f.metadata.gd.characterProfiles, work = f.run('save'); await tick();
    for (let i = 0; i < 512; i++) store['other-' + i] = {};
    wait.resolve(JSON.stringify(profile())); await assert.rejects(work, /PROFILE_CAPACITY_EXCEEDED/);
    assert.equal(Object.keys(store).length, 512); assert.equal(Object.hasOwn(store, 'alice.png'), false); assert.equal(f.calls.save, 0);
});

test('director becoming active during generation blocks late writes', async () => {
    const wait = deferred(), f = fixture({ generate: () => wait.promise }), work = f.run('save'); await tick(); f.round = true;
    wait.resolve(JSON.stringify(profile())); await assert.rejects(work, /PROFILE_BUSY/); assert.deepEqual(f.metadata, {});
});

test('Provider replacement while a profile model request waits prevents save', async () => {
    const wait = deferred(), f = portFixture({ generate: () => wait.promise }), ticket = f.prepare('save'), work = f.execute(ticket);
    await tick(); f.providers[0].render = () => 'changed'; wait.resolve(JSON.stringify(profile()));
    const result = await work; assert.equal(result.code, 'STALE_PROFILE_GENERATION'); assert.equal(result.resultWriteStarted, false);
    assert.equal(f.calls.save, 0); assert.deepEqual(f.metadata, {});
});
