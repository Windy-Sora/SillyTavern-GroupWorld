import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLlmResponse, sanitizeJson } from '../../utils/json-utils.js';
import { parsePath, resolvePath } from '../../utils/path-resolver.js';
import { renderPrompt } from '../../prompt-renderer.js';
import { registerProvider, unregisterProvider } from '../../provider-registry.js';
import { createProfileExportSystem } from '../../systems/profile-export-system.js';
import { createChatSummarySystem } from '../../systems/chat-summary-system.js';
import { createMemoryExportSystem } from '../../systems/memory-export-system.js';
import { createVariableSystem } from '../../systems/variable-system.js';
import { createCustomAgentSystem } from '../../systems/custom-agent-system.js';
import { createProviderModule } from '../../muyu/modules/providers/index.js';
import { createVariableDraftPort } from '../../muyu/host/variable-draft.js';
import { createVariableWriter } from '../../muyu/host/variable-write.js';
import { normalizeDirectorScripts } from '../../systems/director-plan.js';
import { matchEnabledCharacter } from '../../utils/character-identity.js';

const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const target = { kind: 'chat', userKey: 'test', chatKey: 'A' };

test('review P3-11: valid JSON strings retain apostrophes, commas, fences and Unicode', () => {
    const value = { speakers: ['Alice'], reason: "He said: 'go away'; keep ,] and ```json hello ```; \u200b" };
    const text = JSON.stringify(value);
    assert.equal(sanitizeJson(text), text);
    assert.deepEqual(parseLlmResponse(`\`\`\`json\n${text}\n\`\`\``), value);
    assert.deepEqual(parseLlmResponse("{'speakers':['Alice',], 'reason':'ok',}"), { speakers: ['Alice'], reason: 'ok' });
});

test('BUG-D1D-01: single-quoted Unicode script keys still associate with the actual character', () => {
    const text = String.raw`{"speakers":["Alice Smith"], "reason":'first\nsecond', "scripts":{'Alice\u0020Smith':'one\ntwo'}}`;
    const parsed = parseLlmResponse(text);
    assert.deepEqual(parsed, { speakers: ['Alice Smith'], reason: 'first\nsecond', scripts: { 'Alice Smith': 'one\ntwo' } });
    const characters = [{ avatar: 'alice.png', name: 'Alice Smith' }];
    const enabledMembers = ['alice.png'];
    assert.deepEqual(normalizeDirectorScripts(parsed.scripts, {
        enabledMembers, characters,
        matchCharacterByName: ref => matchEnabledCharacter(ref, enabledMembers, characters),
    }), { 'Alice Smith': 'one\ntwo' });
});

test('single-quoted repair decodes standard escapes exactly once in keys and values', () => {
    const values = ['line\nnext\r\ttab\b\f', 'Alice Smith', '猫头鹰 🦉', '\ud800',
        'quote " and apostrophe \'', String.raw`C:\notes\n\u0041`, String.raw`slash\'quote`,
        'raw\nnewline', 'braces { }, comma ,], fences ```json, \u200b'];
    const asSingle = value => `'${JSON.stringify(value).slice(1, -1).replace(/'/g, "\\'")}'`;
    for (const value of values) {
        const text = `{${asSingle(value)}:${asSingle(value)},}`;
        assert.deepEqual(JSON.parse(sanitizeJson(text)), { [value]: value }, text);
        const standard = JSON.stringify({ [value]: value });
        assert.equal(sanitizeJson(standard), standard);
    }
    assert.deepEqual(JSON.parse(sanitizeJson(String.raw`{'\u0041':'\u732b\uD83E\uDD89', 'slash':'a\/b', 'quote':'a\"b'}`)),
        { A: '猫🦉', slash: 'a/b', quote: 'a"b' });
});

test('single-quoted repair does not silently turn invalid JSON escapes into literal text', () => {
    for (const raw of [String.raw`{'value':'bad\q'}`, String.raw`{'value':'bad\uZZZZ'}`, String.raw`{'value':'bad\u12'}`]) {
        assert.throws(() => JSON.parse(sanitizeJson(raw)), SyntaxError);
        assert.equal(parseLlmResponse(raw), null);
    }
});

test('review P3-8: recovery finds speakers, not a bracket in reason', () => {
    assert.deepEqual(parseLlmResponse('{"reason":"[Bob]","speakers":["Alice"],broken}'), { speakers: ['Alice'], reason: '' });
    assert.equal(parseLlmResponse('{"reason":"[Bob]",broken}'), null);
});

test('review P3-13: malformed quoted and unclosed path segments cannot promote later keys', () => {
    const data = { scripts: { name: 'WRONG' } };
    for (const path of ['scripts["bad\\q"].name', 'scripts["unclosed].name', 'scripts[abc].name', 'scripts[1oops].name']) {
        assert.equal(resolvePath(data, parsePath(path)), undefined);
    }
});

test('review P1-7/P3-10: nested queries and runtime backslash keys resolve without parent dumps', async t => {
    registerProvider({ id: 'reviewBook', placeholder: '{{reviewBook}}', render: () => ({ content: '', data: {
        entries: [{ comment: 'Alice', content: 'RIGHT' }], scripts: { 'A\\q.name': 'ESCAPED' },
    } }) });
    registerProvider({ id: 'reviewName', placeholder: '{{reviewName}}', render: () => ({ content: '', data: { name: 'Alice' } }) });
    t.after(() => { unregisterProvider('reviewBook'); unregisterProvider('reviewName'); });
    assert.equal(await renderPrompt('{{?reviewBook:entries[comment={{?reviewName:name}}].content}}', {}, { maxPasses: 1 }), 'RIGHT');
    assert.equal(await renderPrompt('{{?reviewBook:scripts.$character|FALLBACK}}', { character: 'A\\q.name' }), 'ESCAPED');
});

function profileFixture(saveChatConditional = async () => {}) {
    let profiles = { 'alice.png': { avatar: 'alice.png', name: 'Alice', profile: { tags: ['before'], summary: 'before' } } };
    const settings = {};
    const system = createProfileExportSystem({ settings, getProfiles: () => profiles, saveChatConditional, saveSettings: () => {},
        getDefaultProfileGeneratorPrompt: () => '', getDefaultProfileSchema: () => '', getDefaultProfileRenderTemplate: () => '',
        getCurrentGroup: () => ({}), getCharacters: () => [], log: () => {} });
    return { system, settings, get profiles() { return profiles; }, switchChat() { profiles = {}; } };
}
const profileData = tags => ({ type: 'profile-export', version: 1, template: {}, profiles: [
    { avatar: 'alice.png', name: 'Imported', profile: { tags, summary: 'imported' } },
] });

test('review P1-6: malformed profile tags fail at parse and apply boundaries', async () => {
    const f = profileFixture();
    for (const tags of ['A, B', {}, [42]]) {
        assert.equal(f.system.parseImportFile(JSON.stringify(profileData(tags))).ok, false);
        await assert.rejects(f.system.applyImport(profileData(tags), ['alice.png']), /Invalid profile tags/);
    }
    assert.deepEqual(f.profiles['alice.png'].profile.tags, ['before']);
});

test('review P2-12: failed profile import restores owned data while retaining same-profile and unrelated edits', async () => {
    const gate = deferred(), f = profileFixture(() => gate.promise);
    const pending = f.system.applyImport(profileData(['imported']), ['alice.png']);
    f.profiles['alice.png'].profile.tags.push('concurrent');
    f.profiles['alice.png'].profile.summary = 'concurrent summary';
    f.profiles['bob.png'] = { name: 'Concurrent Bob' };
    gate.reject(Error('save failed'));
    await assert.rejects(pending, /save failed/);
    assert.equal(f.profiles['alice.png'].name, 'Alice');
    assert.deepEqual(f.profiles['alice.png'].profile.tags, ['before', 'concurrent']);
    assert.equal(f.profiles['alice.png'].profile.summary, 'concurrent summary');
    assert.equal(f.profiles['bob.png'].name, 'Concurrent Bob');
});

test('review P2-12: a successful old-chat save is not rolled back or presented as current', async () => {
    const gate = deferred(), f = profileFixture(() => gate.promise), old = f.profiles;
    const pending = f.system.applyImport(profileData([]), ['alice.png']);
    f.switchChat(); gate.resolve();
    await assert.rejects(pending, /chat changed/);
    assert.equal(old['alice.png'].name, 'Imported');
    assert.deepEqual(f.profiles, {});
});

test('review P2-10: pruning remaps summary ancestors and regeneration never uses itself', async () => {
    const first = { content: 'old', active: false, rangeEnd: 1, basedOn: null };
    const last = { content: 'current', active: true, rangeEnd: 2, basedOn: 0 };
    const metadata = { gd: { summaries: [first, last] } }, chat = [{ name: 'User', mes: 'one' }, { name: 'A', mes: 'two' }];
    let prompt;
    const system = createChatSummarySystem({ settings: { lang: 'en', summaryEnabled: true }, EXT_KEY: 'gd', getChatMetadata: () => metadata,
        getChat: () => chat, saveChatConditional: async () => {}, renderPrompt: async x => x, generateRaw: async () => '',
        inject_ids: {}, extension_prompt_types: {}, setExtensionPrompt: () => {}, log: () => {},
        createCaller: () => ({ generate: async text => { prompt = text; return 'new'; } }) });
    await system.pruneDisabledSummaries();
    assert.equal(metadata.gd.summaries[0].basedOn, null);
    await system.regenerateLastSummary();
    assert.match(prompt, /User: one/);
    assert.doesNotMatch(prompt, /\[Previous summary\]/);
    chat.length = 0;
    await system.pruneSummaries();
    assert.equal(metadata.gd.summaries[0].active, false);
});

test('review P3-17: invalid memory template values are rejected before memory mutation', async () => {
    const metadata = {}, settings = {};
    const system = createMemoryExportSystem({ settings, EXT_KEY: 'gd', getChatMetadata: () => metadata, getCharacters: () => [],
        getCurrentGroup: () => ({}), saveChatConditional: async () => {}, saveSettings: () => {}, log: () => {} });
    const data = { type: 'memory-export', version: 1, memories: {}, template: { memoryPrompt: {} } };
    assert.equal(system.parseImportFile(JSON.stringify(data)).ok, false);
    await assert.rejects(system.applyMemoryImport(data, {}, { importTemplate: true }), /Invalid template field/);
    assert.deepEqual(settings, {}); assert.deepEqual(metadata, {});
});

test('review P3-18/P2-11: typed imports reject objects, avoid applying deltas and cap replace logs', async () => {
    const metadata = { gd: { variables: { defs: [{ id: 'gold', type: 'number', scope: 'global', updateMode: 'delta' }],
        values: { global: { gold: 20 }, character: {} }, log: [] } } };
    let saves = 0;
    const system = createVariableSystem({ EXT_KEY: 'gd', getChatMetadata: () => metadata, saveChatConditional: async () => { saves++; } });
    const bad = await system.applyImportData({ defs: [], values: { global: { gold: {} }, character: {} } });
    assert.equal(bad.ok, false); assert.equal(saves, 0); assert.equal(metadata.gd.variables.values.global.gold, 20);
    assert.equal((await system.applyImportData({ defs: [], values: { global: { gold: '12' }, character: {} } })).ok, true);
    assert.equal(metadata.gd.variables.values.global.gold, 12);
    await system.applyImportData({ defs: [], values: { global: {}, character: {} }, log: Array.from({ length: 150 }, (_, i) => ({ i })) }, { mode: 'replace' });
    assert.equal(metadata.gd.variables.log.length, 100);
    assert.equal(metadata.gd.variables.log[0].i, 50);
});

test('review P2-4: conflicting persisted agents cannot prevent healthy providers from restoring', () => {
    const providers = new Map([['reserved', { id: 'reserved' }]]);
    const settings = { customAgents: ['reserved', 'healthy'].map(providerName => ({ id: providerName, name: providerName, providerName, prompt: '', enabled: true })) };
    const system = createCustomAgentSystem({ settings, getChatMetadata: () => ({}), getChat: () => [], EXT_KEY: 'gd',
        getProviders: () => [...providers.values()], registerProvider: p => providers.set(p.id, p), unregisterProvider: id => providers.delete(id), log: () => {} });
    assert.doesNotThrow(() => system.refreshProviders());
    assert.equal(providers.get('reserved')._gdOwner, undefined);
    assert.equal(providers.get('healthy')._gdOwner, 'group-director/custom-agent');
});

test('review P2-13: small output budget preserves bounded evidence and filled slots reject before rendering', async () => {
    let calls = 0;
    const module = createProviderModule({ currentTarget: () => target, providerPort: {
        describe: () => ({}), execute: async () => { calls++; return 'x'.repeat(8000); },
    } });
    module.bindRun('small', 6000);
    const first = await module.handlers['muyu.provider.execute']({ id: 'p', revision: 'r' }, { runId: 'small', target });
    assert.equal(first.status, 'ok'); assert.equal(first.executed, true); assert.ok(first.resultId);
    assert.ok(first.text.length > 0 && first.text.length <= 6000); assert.equal(first.truncated, true);
    module.bindRun('slots', 500000);
    for (let i = 0; i < 4; i++) assert.equal((await module.handlers['muyu.provider.execute']({ id: 'p', revision: 'r' }, { runId: 'slots', target })).executed, true);
    const before = calls;
    const fifth = await module.handlers['muyu.provider.execute']({ id: 'p', revision: 'r' }, { runId: 'slots', target });
    assert.equal(fifth.executed, false); assert.equal(calls, before);
    module.dispose();
});

test('review P3-23: host generation blocks both legacy preview and approved write', async () => {
    let busy = false, saves = 0;
    const metadata = {}, draftPort = createVariableDraftPort({ getTarget: () => target, getMetadata: () => metadata, extensionKey: 'gd', isBusy: () => busy });
    const input = { action: 'create', id: 'gold', label: 'Gold', initialValue: 0, rule: 'Track money', autoUpdate: true, injectMode: 'always', updateMode: 'delta' };
    const draft = draftPort.prepare(target, input);
    const writer = createVariableWriter({ draftPort, getTarget: () => target, getMetadata: () => metadata, extensionKey: 'gd', isBusy: () => busy, saveChatConfirmed: async () => { saves++; } });
    busy = true;
    assert.throws(() => draftPort.prepare(target, input), /VARIABLE_BUSY/);
    await assert.rejects(writer.apply(draft), /VARIABLE_BUSY/);
    assert.equal(saves, 0); assert.deepEqual(metadata, {});
    busy = false; assert.equal((await writer.apply(draft)).status, 'applied_confirmed');
});
