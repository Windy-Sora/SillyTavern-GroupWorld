import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createConfigProfileSubject,
    jsonFile,
    manifest,
} from './helpers/config-profile-subject.mjs';

test('config profile JSON import rejects malformed manifests without saving', async () => {
    const cases = [
        [null, /root must be an object/],
        [[], /root must be an object/],
        ['"text"', /root must be an object/],
        [manifest({ version: 2 }), /Unsupported version/],
        [manifest({ settings: null }), /settings must be an object/],
        [manifest({ settings: [] }), /settings must be an object/],
        [manifest({ drawers: [] }), /drawers must be an object/],
        [manifest({ drawers: { assetManager: 1 } }), /must be boolean/],
        [manifest({ variables: [] }), /variables must be an object/],
        [manifest({ variables: {} }), /variables.defs must be an array/],
        [manifest({ variables: { defs: [null], values: {} } }), /variables.defs\[0\] must be an object/],
        [manifest({ settings: { customPrompts: [null] } }), /customPrompts\[0\] must be an object/],
        [manifest({ settings: { customPrompts: [{ name: 'broken', dataJson: '{' }] } }), /valid JSON/],
        [manifest({ settings: { customPrompts: [{ name: 'broken', scope: 'unknown' }] } }), /scope is invalid/],
        [manifest({ settings: { userProviders: [{ name: '' }] } }), /name must be a non-empty string/],
        [manifest({ settings: { userCapabilities: 'bad' } }), /must be an array/],
        [manifest({ settings: { scriptExecutors: [null] } }), /scriptExecutors\[0\] must be an object/],
        [manifest({ settings: { scriptExecutors: [{ name: 'bad', priority: 101 }] } }), /priority/],
        [manifest({ settings: { scriptExecutors: [{ name: 'bad', params: [{ key: '__proto__' }] }] } }), /key is not allowed/],
        [manifest({ settings: { customAgents: [{}] } }), /customAgents\[0\].name/],
    ];

    for (const [value, error] of cases) {
        const { subject, settings, calls } = createConfigProfileSubject();
        await assert.rejects(subject.importProfileFromJson(jsonFile(value)), error);
        assert.deepEqual(settings.configProfiles, []);
        assert.equal(calls.saves, 0);
    }
});

test('config profile import normalizes script executors and replaces external ids', async () => {
    const { subject } = createConfigProfileSubject();
    const profile = await subject.importProfileFromJson(jsonFile(manifest({
        settings: { scriptExecutors: [{ id: 'external', name: ' Hook ' }] },
    })));

    assert.equal(profile.settings.scriptExecutors[0].name, 'Hook');
    assert.notEqual(profile.settings.scriptExecutors[0].id, 'external');
    assert.match(profile.settings.scriptExecutors[0].id, /^se_/);
    assert.equal(profile.settings.scriptExecutors[0].triggerOn, 'both');
});

test('config profile import validates and disables custom agents with fresh ids', async () => {
    const { subject } = createConfigProfileSubject();
    const profile = await subject.importProfileFromJson(jsonFile(manifest({
        settings: { customAgents: [{
            id: 'external', name: 'Agent', providerName: 'agent_result',
            enabled: true, autoEnabled: true,
        }] },
    })));
    const imported = profile.settings.customAgents[0];
    assert.match(imported.id, /^ca_/);
    assert.notEqual(imported.id, 'external');
    assert.equal(imported.enabled, false);
    assert.equal(imported.autoEnabled, false);
});

test('config profile import validates custom prompts and replaces external ids', async () => {
    const { subject } = createConfigProfileSubject();
    const profile = await subject.importProfileFromJson(jsonFile(manifest({
        settings: { customPrompts: [{
            id: 'external', name: 'note', content: 'safe', dataJson: '{"kind":"note"}',
            scope: 'mixed', enabled: true,
        }] },
    })));
    const imported = profile.settings.customPrompts[0];
    assert.match(imported.id, /^cp_/);
    assert.notEqual(imported.id, 'external');
    assert.equal(imported.name, 'note');
    assert.equal(imported.scope, 'mixed');
});

test('JSON import strips credentials and executable asset stubs before storage', async () => {
    const { subject, settings, calls } = createConfigProfileSubject();
    const profile = await subject.importProfileFromJson(jsonFile(manifest({
        settings: {
            llmMaxSpeakers: 2,
            agentConfigs: { director: { endpoint: 'https://evil', apiKey: 'secret' } },
            userProviders: [{ name: 'provider', displayName: 'Provider' }],
            userCapabilities: [{ name: 'capability', displayName: 'Capability' }],
        },
    })));

    assert.deepEqual(profile.settings, { llmMaxSpeakers: 2 });
    assert.equal(settings.configProfiles.length, 1);
    assert.equal(calls.saves, 1);
});

test('config profile ZIP import validates the shared manifest contract', async t => {
    const previousWindow = globalThis.window;
    t.after(() => { globalThis.window = previousWindow; });
    const files = new Map();
    const zip = {
        file: name => files.get(name) || null,
        folder: name => ({ file: child => files.get(`${name}/${child}`) || null }),
    };
    globalThis.window = {
        JSZip: class { static async loadAsync() { return zip; } },
    };
    const file = { arrayBuffer: async () => new ArrayBuffer(0) };
    const { subject, settings, calls } = createConfigProfileSubject();

    await assert.rejects(subject.importProfileFromZip(file), /missing manifest.json/);
    files.set('manifest.json', { async: async () => JSON.stringify({
        ...manifest({ type: 'config-profile' }),
        settings: { userProviders: [null] },
    }) });
    await assert.rejects(subject.importProfileFromZip(file), /userProviders\[0\] must be an object/);
    assert.deepEqual(settings.configProfiles, []);
    assert.equal(calls.saves, 0);
});

test('ZIP import restores matching asset sources but strips agent connections', async t => {
    const previousWindow = globalThis.window;
    t.after(() => { globalThis.window = previousWindow; });
    const files = new Map([
        ['manifest.json', { async: async () => JSON.stringify(manifest({
            type: 'config-profile',
            settings: {
                agentConfigs: { director: { apiKey: 'secret' } },
                userProviders: [{ name: 'provider' }],
                userCapabilities: [{ name: 'capability.js' }],
            },
        })) }],
        ['user-providers/provider.js', { async: async () => 'provider source' }],
        ['user-capabilities/capability.js', { async: async () => 'capability source' }],
    ]);
    globalThis.window = { JSZip: class {
        static async loadAsync() {
            return {
                file: name => files.get(name) || null,
                folder: name => ({ file: child => files.get(`${name}/${child}`) || null }),
            };
        }
    } };
    const { subject } = createConfigProfileSubject();
    const profile = await subject.importProfileFromZip({ arrayBuffer: async () => new ArrayBuffer(0) });

    assert.equal(profile.settings.agentConfigs, undefined);
    assert.equal(profile.settings.userProviders[0].source, 'provider source');
    assert.equal(profile.settings.userCapabilities[0].source, 'capability source');
});
