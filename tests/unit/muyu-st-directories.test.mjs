import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderPort } from '../../muyu/host/providers.js';
import { createProviderModule } from '../../muyu/modules/providers/index.js';
import { createPermissions } from '../../muyu/application/permissions.js';
import { assistantToolAccess } from '../../muyu/application/capabilities.js';

function fixture() {
    const target = { kind: 'chat', userKey: 'u', chatKey: 'a' };
    let current = target, selectedPersona = 'alice-private.png';
    const presets = { openai: ['Default', 'Story'], context: ['Novel Context'] };
    const selection = { openai: 'Story', context: 'Novel Context' };
    let unsafeCalls = 0;
    const ctx = {
        mainApi: 'openai',
        getPresetManager: id => !presets[id] ? null : {
            getAllPresets: () => presets[id], getSelectedPresetName: () => selection[id],
            getPresetSettings: () => { unsafeCalls++; return { apiKey: 'PRIVATE_API_KEY' }; },
            getPresetList: () => { unsafeCalls++; return { content: 'PRIVATE_PRESET_BODY' }; },
        },
        powerUserSettings: { personas: { 'alice-private.png': 'Alice', 'bob-private.png': 'Bob' },
            default_persona: 'bob-private.png', persona_descriptions: { 'alice-private.png': { description: 'PRIVATE_PERSONA_PROMPT' } } },
        chatMetadata: { persona: 'alice-private.png' },
    };
    const extensionState = { names: ['third-party/GroupDirector', 'third-party/Other'],
        types: { 'third-party/GroupDirector': 'local', 'third-party/Other': 'global' },
        disabled: ['third-party/Other'], apiKey: 'PRIVATE_EXTENSION_KEY' };
    const port = createProviderPort({ getContext: () => ctx, getSettings: () => ({}), extensionKey: 'gd', bindings: [], getProviders: () => [],
        stDirectories: { getSelectedPersona: () => selectedPersona, getExtensions: () => extensionState } });
    const module = createProviderModule({ providerPort: port, currentTarget: () => current });
    const read = (id, selector = '', revision = '', runId = 'r') => module.handlers['muyu.provider.read']({ id, selector, revision, offset: 0 }, { runId, target });
    return { target, ctx, presets, selection, extensionState, port, module, read, unsafeCalls: () => unsafeCalls,
        selectPersona: value => { selectedPersona = value; }, switchChat: () => { current = { ...target, chatKey: 'b' }; } };
}

test('ST directory grants are independent, and Persona status requires a chat target', () => {
    const f = fixture(), permissions = createPermissions();
    const access = (id, target = f.target) => assistantToolAccess({ id: 'muyu.provider.read', effect: 'read' }, { id }, target, 'task', permissions, f.port);
    permissions.grant('chat', f.target);
    for (const id of ['stPresets', 'stPersonas', 'stExtensions']) assert.deepEqual(access(id).missingSources, [`source:${id}`]);
    permissions.decide({ source: 'stPresets', reason: 'List names', target: f.target, taskId: 'task' }, 'task', () => {});
    assert.equal(access('stPresets').decision, true);
    assert.deepEqual(access('stExtensions').missingSources, ['source:stExtensions']);
    assert.equal(access('stPersonas', { kind: 'global', userKey: 'u' }).decision, 'target_unavailable');
    f.module.dispose();
});

test('Preset directory reads only names and UI selection, with nested revision checks', () => {
    const f = fixture();
    const root = f.read('stPresets');
    assert.match(root.text, /currentApi=openai/);
    assert.match(root.text, /mode\[3\] openai status=available count=2 selected="Story"/);
    assert.match(root.text, /mode\[2\] textgenerationwebui status=unavailable/);
    assert.equal(f.read('stPresets', 'mode:2', root.revision).status, 'SOURCE_UNAVAILABLE');
    const mode = f.read('stPresets', 'mode:3', root.revision);
    assert.match(mode.text, /preset\[3:0\] "Default"/);
    const search = f.read('stPresets', 'search:3:story', mode.revision);
    assert.match(search.text, /preset\[3:1\] "Story"/);
    assert.equal(f.unsafeCalls(), 0);
    assert.doesNotMatch(JSON.stringify([root.text, mode.text, search.text]), /PRIVATE_|apiKey/);
    f.selection.openai = 'Default';
    assert.equal(f.read('stPresets', 'search:3:story', mode.revision).status, 'STALE_SOURCE');
    assert.equal(f.read('stPresets', 'search:3:story', '', 'other').status, 'STALE_SOURCE');
    f.module.dispose();
});

test('Oversized preset and extension directories report bounded or unknown results', () => {
    const f = fixture();
    f.presets.openai = Array.from({ length: 513 }, (_, index) => `Preset ${index}`);
    const root = f.read('stPresets');
    assert.match(root.text, /mode\[3\] openai status=SOURCE_TOO_LARGE/);
    assert.equal(f.read('stPresets', 'mode:3', root.revision).status, 'SOURCE_TOO_LARGE');
    f.extensionState.names = Array.from({ length: 1025 }, (_, index) => `extension-${index}`);
    assert.equal(f.read('stExtensions').status, 'SOURCE_TOO_LARGE');
    f.module.dispose();
});

test('Persona directory exposes names and selection flags, never avatar ids or descriptions', () => {
    const f = fixture();
    const root = f.read('stPersonas');
    assert.match(root.text, /persona\[0\] "Alice" flags=selected,chat-locked/);
    assert.match(root.text, /persona\[1\] "Bob" flags=default/);
    assert.doesNotMatch(root.text, /\.png|PRIVATE_PERSONA_PROMPT/);
    const search = f.read('stPersonas', 'search:Bob', root.revision);
    assert.match(search.text, /persona\[1\] "Bob"/);
    f.selectPersona('bob-private.png');
    assert.equal(f.read('stPersonas', 'search:Bob', root.revision).status, 'STALE_SOURCE');
    f.switchChat();
    assert.equal(f.read('stPersonas').status, 'TARGET_UNAVAILABLE');
    f.module.dispose();
});

test('Extension inventory distinguishes configured enablement from unknown runtime activation', () => {
    const f = fixture();
    const root = f.read('stExtensions');
    assert.match(root.text, /runtimeActive=unknown/);
    assert.match(root.text, /GroupDirector" type=local enabledConfigured=true/);
    assert.match(root.text, /Other" type=global enabledConfigured=false/);
    assert.doesNotMatch(root.text, /PRIVATE_EXTENSION_KEY|apiKey/);
    const search = f.read('stExtensions', 'search:Other', root.revision);
    assert.match(search.text, /extension\[1\]/);
    f.extensionState.disabled = null;
    assert.equal(f.read('stExtensions', 'search:Other', root.revision).status, 'STALE_SOURCE');
    const unknown = f.read('stExtensions', '', '', 'new');
    assert.match(unknown.text, /enabledConfigured=unknown/);
    f.module.dispose();
});
