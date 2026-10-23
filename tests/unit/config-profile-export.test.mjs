import assert from 'node:assert/strict';
import test from 'node:test';
import { createConfigProfileSubject } from './helpers/config-profile-subject.mjs';
import { sanitizeImportedSettings } from '../../systems/config-profile-validation.js';

function installDownloadEnvironment(t) {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const previousCreateObjectURL = URL.createObjectURL;
    const previousRevokeObjectURL = URL.revokeObjectURL;
    const downloads = [];
    const zipInstances = [];

    class FakeZip {
        constructor() {
            this.files = new Map();
            zipInstances.push(this);
        }
        file(name, content) {
            this.files.set(name, content);
            return this;
        }
        folder(name) {
            return { file: (child, content) => this.file(`${name}/${child}`, content) };
        }
        async generateAsync() { return new Blob(['zip']); }
    }

    globalThis.window = { JSZip: FakeZip };
    globalThis.document = {
        createElement: () => ({ click() { downloads.push(this.download); } }),
        body: { appendChild() {}, removeChild() {} },
    };
    URL.createObjectURL = blob => {
        downloads.push(blob);
        return 'blob:test';
    };
    URL.revokeObjectURL = url => { downloads.push(url); };
    t.after(() => {
        globalThis.window = previousWindow;
        globalThis.document = previousDocument;
        URL.createObjectURL = previousCreateObjectURL;
        URL.revokeObjectURL = previousRevokeObjectURL;
    });
    return { downloads, zipInstances };
}

function storedProfile(overrides = {}) {
    return {
        id: 'profile-1',
        name: 'Export / Profile',
        description: 'shareable',
        createdAt: 1,
        drawers: { assetManager: true, agentsTools: true, contextLedger: true },
        settings: {
            agentConfigs: { director: { endpoint: 'https://local', apiKey: 'secret' } },
            userProviders: [{ name: 'provider', displayName: 'Provider', source: 'provider code' }],
            userCapabilities: [{ name: 'capability.js', displayName: 'Capability', source: 'capability code' }],
        },
        variables: { defs: [], values: { global: { score: 1 }, character: {} } },
        ...overrides,
    };
}

test('Muyu remembered credential is stripped from configuration profile snapshots and exports', t => {
    installDownloadEnvironment(t);
    const { subject, settings } = createConfigProfileSubject({ muyuContextConfig: { inputTokens: 64000, recentTurns: 8, autoSummary: true }, muyuHistoryEnabled: true, agentConfigs: { 'muyu-assistant': { endpoint: 'https://example.test/chat/completions', model: 'model', apiKey: 'MUYU_FAKE_SECRET' } } });
    const profile = subject.saveCurrentAsProfile('Muyu', '', { agentsTools: true });
    assert.equal(profile.settings.agentConfigs['muyu-assistant'].apiKey, '');
    assert.equal(Object.hasOwn(profile.settings, 'muyuHistoryEnabled'), false);
    assert.equal(Object.hasOwn(profile.settings, 'muyuContextConfig'), false);
    // Defense in depth also sanitizes an already-stored profile carrying a key.
    profile.settings.agentConfigs['muyu-assistant'].apiKey = 'MUYU_FAKE_SECRET';
    assert.doesNotMatch(JSON.stringify(subject.exportProfileAsJson(profile.id)), /MUYU_FAKE_SECRET/);
    assert.equal(settings.agentConfigs['muyu-assistant'].apiKey, 'MUYU_FAKE_SECRET');
});

test('saving and deleting profiles cover selected drawers without storing credentials', () => {
    const { subject, settings, calls } = createConfigProfileSubject({
        llmMaxSpeakers: 3,
        agentConfigs: { director: { endpoint: 'https://local', apiKey: 'secret' } },
    });

    const profile = subject.saveCurrentAsProfile(
        'Local',
        'description',
        { directorLlm: true, agentsTools: true, contextLedger: true },
    );
    assert.equal(profile.settings.llmMaxSpeakers, 3);
    assert.equal(profile.settings.agentConfigs.director.apiKey, '');
    assert.deepEqual(profile.variables, { defs: [], values: { global: {}, character: {} } });
    assert.equal(calls.saves, 1);

    subject.deleteProfile(profile.id);
    subject.deleteProfile('missing');
    assert.deepEqual(settings.configProfiles, []);
    assert.equal(calls.saves, 2);
});

test('JSON profile export strips executable sources and credentials', async t => {
    const { downloads } = installDownloadEnvironment(t);
    const { subject } = createConfigProfileSubject({ configProfiles: [storedProfile()] });

    const exported = subject.exportProfileAsJson('profile-1');
    assert.equal(exported.type, 'config-profile-manifest');
    assert.equal(exported.settings.agentConfigs.director.apiKey, '');
    assert.deepEqual(exported.settings.userProviders, [{ name: 'provider', displayName: 'Provider' }]);
    assert.deepEqual(exported.settings.userCapabilities, [{ name: 'capability.js', displayName: 'Capability' }]);
    assert.deepEqual(exported.variables.values.global, { score: 1 });
    assert.match(downloads.find(value => typeof value === 'string' && value.endsWith('.json')), /^group-director-manifest-/);
    const blob = downloads.find(value => value instanceof Blob);
    assert.deepEqual(JSON.parse(await blob.text()).settings.userProviders, exported.settings.userProviders);
});

test('ZIP profile export packages trusted asset source files but strips credentials', async t => {
    const { downloads, zipInstances } = installDownloadEnvironment(t);
    const { subject } = createConfigProfileSubject({ configProfiles: [storedProfile()] });

    const exported = await subject.exportProfileAsZip('profile-1');
    const files = zipInstances[0].files;
    const archivedManifest = JSON.parse(files.get('manifest.json'));
    assert.equal(exported.settings.agentConfigs.director.apiKey, '');
    assert.equal(archivedManifest.settings.agentConfigs.director.apiKey, '');
    assert.equal(files.get('user-providers/provider.js'), 'provider code');
    assert.equal(files.get('user-capabilities/capability.js'), 'capability code');
    assert.match(downloads.find(value => typeof value === 'string' && value.endsWith('.zip')), /^group-director-config-/);
});

test('current settings export supports isolated JSON and ZIP manifests', async t => {
    const { downloads, zipInstances } = installDownloadEnvironment(t);
    const initial = {
        userProviders: [{ name: 'provider', source: 'provider code' }],
        userCapabilities: [{ name: 'capability', source: 'capability code' }],
    };
    const { subject } = createConfigProfileSubject(initial);
    const drawers = { assetManager: true, contextLedger: true };

    const json = await subject.exportCurrentSettings(drawers, 'json', 'Current', 'JSON');
    assert.equal(json.type, 'config-profile-manifest');
    assert.deepEqual(json.settings.userProviders, [{ name: 'provider', displayName: '' }]);
    assert.ok(json.variables);

    const zip = await subject.exportCurrentSettings(drawers, 'zip', 'Current', 'ZIP');
    assert.equal(zip.type, 'config-profile');
    assert.equal(zipInstances[0].files.get('user-providers/provider.js'), 'provider code');
    assert.equal(zipInstances[0].files.get('user-capabilities/capability.js'), 'capability code');
    assert.ok(downloads.includes('group-director-config.json'));
    assert.ok(downloads.includes('group-director-config.zip'));
});

test('profile export rejects unknown ids before creating a download', async () => {
    const { subject } = createConfigProfileSubject();
    assert.throws(() => subject.exportProfileAsJson('missing'), /Profile not found/);
    await assert.rejects(subject.exportProfileAsZip('missing'), /Profile not found/);
});

test('Personal Muyu instructions cannot travel through JSON/ZIP profiles or be applied from stored profiles', async t => {
    installDownloadEnvironment(t);
    const personal = { enabled: true, text: 'PRIVATE_STYLE' }, foreign = { enabled: true, text: 'FOREIGN_STYLE' };
    const { subject, settings } = createConfigProfileSubject({ muyuInstructionConfig: personal });
    const profile = subject.saveCurrentAsProfile('Personal', '', { agentsTools: true });
    assert.equal(Object.hasOwn(profile.settings, 'muyuInstructionConfig'), false);
    profile.settings.muyuInstructionConfig = foreign;
    assert.equal(Object.hasOwn(subject.exportProfileAsJson(profile.id).settings, 'muyuInstructionConfig'), false);
    assert.equal(Object.hasOwn((await subject.exportProfileAsZip(profile.id)).settings, 'muyuInstructionConfig'), false);
    await subject.applyProfile(profile.id); assert.deepEqual(settings.muyuInstructionConfig, personal);
    for (const source of ['json', 'zip']) assert.equal(Object.hasOwn(sanitizeImportedSettings({ muyuInstructionConfig: foreign }, { source }), 'muyuInstructionConfig'), false);
});
