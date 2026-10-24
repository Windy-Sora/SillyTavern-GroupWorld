import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { DEFAULT_SETTINGS, EXT_KEY, MODE_OFF, MODE_FORMULA, MODE_LLM } from '../../settings.js';
import { migrateLegacyDirectorOutputFormat } from '../../systems/director-output-format.js';
import { createVariableSystem } from '../../systems/variable-system.js';
import { createMemorySystem } from '../../systems/memory-system.js';
import { createProfileLibrarySystem } from '../../systems/profile-library-system.js';
import { createNpcLibrarySystem } from '../../systems/npc-library-system.js';
import { createStoryBlueprintLibrarySystem } from '../../systems/story-blueprint-library-system.js';
import { createUserProviderLoader, getTrustedProviderDigest } from '../../systems/user-provider-loader.js';
import { createConfigProfileSystem } from '../../systems/config-profile-system.js';

const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

async function upgrade(saved) {
    const source = await read('index.js');
    const start = source.indexOf('let loaded = extension_settings[EXT_KEY] || {};');
    const end = source.indexOf('// Wire the live provider timeout default', start);
    assert.ok(start >= 0 && end > start);
    const extension_settings = { [EXT_KEY]: structuredClone(saved), unrelated: { keep: true } };
    const context = vm.createContext({ extension_settings, EXT_KEY, DEFAULT_SETTINGS: structuredClone(DEFAULT_SETTINGS),
        MODE_OFF, MODE_FORMULA, MODE_LLM, migrateLegacyDirectorOutputFormat, structuredClone });
    vm.runInContext(source.slice(start, end), context);
    return extension_settings;
}

for (const [label, old, expected] of [
    ['existing LLM mode', { mode: 'llm' }, 'llm'],
    ['legacy disabled switch', { enabled: false, mode: 'top_n' }, 'off'],
    ['legacy LLM switch', { directorLlmEnabled: true, directorLlmPrompt: 'Original custom prompt' }, 'llm'],
    ['legacy Top-N mode', { mode: 'top_n' }, 'formula'],
]) test(`GW startup upgrades ${label} without resetting user parameters or private assets`, async () => {
    const stored = { ...old, autoMemoryInterval: 37, scoreWeights: { mention: 71 }, customExtensionField: { keep: 'old value' },
        agentConfigs: { director: { model: 'old-model', apiKey: 'TEST_ONLY_SECRET' } },
        userProviders: [{ name: 'legacy', source: 'Original user source', ids: ['oldProvider'] }],
        profileLibraries: [{ id: 'plib-old', name: 'Old profiles' }] };
    const root = await upgrade(stored), value = root[EXT_KEY];
    assert.equal(value.mode, expected);
    assert.equal(value.autoMemoryInterval, 37);
    assert.equal(value.scoreWeights.mention, 71);
    assert.equal(value.scoreWeights.keyword, DEFAULT_SETTINGS.scoreWeights.keyword);
    for (const key of ['customExtensionField', 'agentConfigs', 'userProviders', 'profileLibraries']) assert.deepEqual(value[key], stored[key]);
    if (old.directorLlmPrompt) assert.equal(value.llmPrompt, old.directorLlmPrompt);
    assert.equal(value.muyuHistoryReadSource, null);
    assert.equal(value.muyuHistoryWriteTargets, null);
    assert.equal(Object.hasOwn(root, 'group-world'), false);
    assert.deepEqual(root.unrelated, { keep: true });
});

test('GW variable, character memory and resource-library reads preserve legacy keys, values and metadata', () => {
    const metadata = { [EXT_KEY]: {
        variables: { defs: [{ id: 'gold', label: 'Gold', scope: 'global', type: 'number', defaultValue: 0, updateMode: 'delta' }],
            values: { global: { gold: 73 }, character: { 'owl.png': { trust: 9 } } }, log: [{ at: 1, source: 'legacy' }] },
        charMemories: { 'owl.png': [{ timestamp: 1, event: 'A saved event', mood: 'neutral', custom: 'keep' }] },
        storyBlueprint: { customLegacyField: 'unchanged' }, customChatField: { old: true },
    } };
    const settings = { profileLibraries: [{ id: 'plib_old', name: 'Profiles', exportData: { profiles: [] } }],
        npcLibraries: [{ id: 'npclib_old', name: 'NPCs', exportData: { npcs: [] } }],
        storyBlueprintLibraries: [{ id: 'sblib_old', name: 'Blueprint', exportData: { type: 'group-director-story-blueprint', version: 1 } }] };
    const beforeMetadata = structuredClone(metadata), beforeSettings = structuredClone(settings);
    const forbiddenSave = () => assert.fail('reading old data must not save it');
    const deps = { settings, EXT_KEY, getChatMetadata: () => metadata, chat_metadata: metadata,
        getCharacters: () => [{ avatar: 'owl.png', name: 'Owl' }], getChat: () => [],
        saveChatConditional: forbiddenSave, saveSettings: forbiddenSave, log: () => {} };
    const variables = createVariableSystem(deps), memories = createMemorySystem(deps);
    assert.deepEqual(variables.getExportData({ includeLog: true }), beforeMetadata[EXT_KEY].variables);
    assert.equal(variables.getDefs()[0].id, 'gold');
    assert.deepEqual(memories.getMemories('owl.png'), beforeMetadata[EXT_KEY].charMemories['owl.png']);
    for (const [create, field] of [[createProfileLibrarySystem, 'profileLibraries'], [createNpcLibrarySystem, 'npcLibraries'], [createStoryBlueprintLibrarySystem, 'storyBlueprintLibraries']]) {
        const system = create({ ...deps, extension_settings: { [EXT_KEY]: settings } });
        assert.deepEqual(system.getLibraries(), beforeSettings[field]);
    }
    assert.deepEqual(metadata, beforeMetadata);
    assert.deepEqual(settings, beforeSettings);
});

test('Legacy user Provider source restores with the same ID and compatible ownership, leaving system Providers alone', async t => {
    const source = 'export function register({registerProvider}) { registerProvider({id:"legacyGold",placeholder:"{{legacyGold}}",render:()=>({content:"17",data:{gold:17}})}); }';
    const settings = { userProviders: [{ name: 'legacy-provider', source, ids: ['legacyGold'] }], userCapabilities: [] };
    const registry = new Map([['systemProvider', { id: 'systemProvider', render: () => 'system' }]]);
    const originalSystem = registry.get('systemProvider');
    let writes = 0;
    const loader = createUserProviderLoader({ extension_settings: { [EXT_KEY]: settings }, EXT_KEY,
        saveSettings: () => { writes++; }, log: () => {},
        getRegisteredProviderIds: () => [...registry.keys()], getRegisteredProvider: id => registry.get(id),
        unregisterProvider: id => registry.delete(id) });
    const OriginalBlob = globalThis.Blob;
    globalThis.Blob = class { constructor(parts) { this.source = parts.join(''); } };
    t.after(() => { globalThis.Blob = OriginalBlob; });
    t.mock.method(URL, 'createObjectURL', blob => `data:text/javascript,${encodeURIComponent(blob.source)}`);
    t.mock.method(URL, 'revokeObjectURL', () => {});
    const result = await loader.restoreAll('provider', { registerProvider: provider => { registry.set(provider.id, provider); return provider; } });
    assert.deepEqual(result, { loaded: ['legacy-provider'], failed: [] });
    assert.equal(settings.userProviders[0].source, source);
    assert.deepEqual(settings.userProviders[0].ids, ['legacyGold']);
    assert.equal(registry.get('systemProvider'), originalSystem);
    const provider = registry.get('legacyGold');
    assert.equal(provider._gdOwner, 'group-director/user-provider');
    assert.equal(provider._gdOwnerId, 'legacy-provider');
    assert.match(getTrustedProviderDigest(provider), /^[0-9a-f]{64}$/);
    assert.deepEqual(await provider.render(), { content: '17', data: { gold: 17 } });
    assert.equal(writes, 0);
});

test('Existing GW default profile remains listed; snapshots and exports exclude private Muyu state', t => {
    const previousDocument = globalThis.document;
    globalThis.document = { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } };
    t.after(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; });
    t.mock.method(URL, 'createObjectURL', () => 'blob:isolated-test');
    t.mock.method(URL, 'revokeObjectURL', () => {});
    const settings = { mode: 'llm', autoMemoryInterval: 37, configProfiles: [], customPrompts: [],
        agentConfigs: { 'muyu-assistant': { apiKey: 'TEST_ONLY_SECRET', model: 'fixture' } },
        muyuHistoryData: { private: 'history' }, muyuAgentMemoryData: { private: 'notes' },
        muyuPermissionConfig: { readAccess: 'all' }, muyuSkillData: { private: 'skills' } };
    const system = createConfigProfileSystem({ settings, EXT_KEY, extension_settings: { [EXT_KEY]: settings },
        saveSettingsDebounced: () => {}, log: () => {} });
    assert.deepEqual(system.getPresetNames(), ['group-world-default']);
    const profile = system.saveCurrentAsProfile('Safe backup', '', { agentsTools: true });
    const exported = JSON.stringify(system.exportProfileAsJson(profile.id));
    assert.doesNotMatch(exported, /TEST_ONLY_SECRET|muyuHistoryData|muyuAgentMemoryData|muyuPermissionConfig|muyuSkillData/);
    assert.equal(settings.autoMemoryInterval, 37);
    assert.equal(settings.agentConfigs['muyu-assistant'].apiKey, 'TEST_ONLY_SECRET');
});
