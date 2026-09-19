import assert from 'node:assert/strict';
import test from 'node:test';
import { createConfigProfileSubject } from './helpers/config-profile-subject.mjs';

function profile(settings, extra = {}) {
    return {
        id: 'profile-1',
        name: 'Profile',
        drawers: {},
        settings,
        ...extra,
    };
}

test('applying a profile merges defaults and preserves per-user agent credentials', async () => {
    const { subject, settings, calls, extensionSettings } = createConfigProfileSubject({
        profileLibraryAutoLoad: { enabled: false, fixedId: 'old' },
        configProfiles: [profile({
            llmMaxSpeakers: 4,
            profileLibraryAutoLoad: { enabled: true },
            agentConfigs: { director: { apiKey: 'replace-me' } },
            userProviders: [{ name: 'provider', source: 'export default {}' }],
            userCapabilities: [{ name: 'capability', source: 'export default {}' }],
        })],
    });

    const result = await subject.applyProfile('profile-1');

    assert.equal(settings.llmMaxSpeakers, 4);
    assert.equal(settings.profileLibraryAutoLoad.enabled, true);
    assert.equal(settings.profileLibraryAutoLoad.mode, 'best');
    assert.equal(settings.agentConfigs.director.apiKey, 'keep-me');
    assert.equal(settings.userProviders[0].name, 'provider');
    assert.equal(settings.userCapabilities[0].name, 'capability');
    assert.ok(result.changed.includes('llmMaxSpeakers'));
    assert.equal(calls.saves, 1);
    assert.equal(extensionSettings.gd, settings);
});

test('custom prompt merge modes have isolated replace, keep, and skip semantics', async () => {
    for (const [mode, expected] of [
        ['replace', ['new existing', 'new extra']],
        ['keep', ['old existing', 'new extra']],
        ['skip', ['old existing']],
    ]) {
        const { subject, settings } = createConfigProfileSubject({
            customPrompts: [{ name: 'same', content: 'old existing' }],
            configProfiles: [profile({ customPrompts: [
                { name: 'same', content: 'new existing' },
                { name: 'extra', content: 'new extra' },
            ] })],
        });
        const result = await subject.applyProfile('profile-1', mode);
        assert.deepEqual(settings.customPrompts.map(item => item.content), expected);
        assert.deepEqual(result.customPromptConflicts, ['same']);
    }
});

test('variable rejection leaves settings unchanged and does not save', async () => {
    const { subject, settings, calls } = createConfigProfileSubject({
        llmMaxSpeakers: 1,
        configProfiles: [profile({ llmMaxSpeakers: 5 }, {
            drawers: { contextLedger: true },
            variables: { defs: [], values: { global: {}, character: {} } },
        })],
    }, { ok: false, error: 'invalid variables' });
    const before = structuredClone(settings);

    await assert.rejects(subject.applyProfile('profile-1'), /Variable import failed/);
    assert.deepEqual(settings, before);
    assert.equal(calls.saves, 0);
    assert.equal(calls.logs.length, 0);
});

test('asynchronous variable persistence rejection aborts profile application', async () => {
    const { subject, settings, calls } = createConfigProfileSubject({
        llmMaxSpeakers: 1,
        configProfiles: [profile({ llmMaxSpeakers: 5 }, {
            drawers: { contextLedger: true },
            variables: { defs: [], values: { global: {}, character: {} } },
        })],
    }, async () => { throw new Error('variable save failed'); });
    const before = structuredClone(settings);

    await assert.rejects(subject.applyProfile('profile-1'), /variable save failed/);
    assert.deepEqual(settings, before);
    assert.equal(calls.saves, 0);
    assert.equal(calls.logs.length, 0);
});

test('malformed stored profiles fail before any live state mutation', async () => {
    const { subject, settings, calls } = createConfigProfileSubject({
        configProfiles: [profile({ customPrompts: [null] })],
    });
    const before = structuredClone(settings);

    await assert.rejects(subject.applyProfile('profile-1'), /customPrompts\[0\]/);
    assert.deepEqual(settings, before);
    assert.equal(calls.saves, 0);
});

test('save failure rolls live settings back to their previous values', async () => {
    const { subject, settings, calls } = createConfigProfileSubject({
        llmMaxSpeakers: 1,
        configProfiles: [profile({ llmMaxSpeakers: 5 })],
    }, { ok: true }, { saveError: new Error('disk unavailable') });
    const before = structuredClone(settings);

    await assert.rejects(subject.applyProfile('profile-1'), /disk unavailable/);
    assert.deepEqual(settings, before);
    assert.equal(calls.saves, 1);
    assert.equal(calls.logs.length, 0);
});

test('custom agent provider refresh failure rolls profile settings back', async () => {
    let refreshes = 0;
    const customAgentSystem = {
        validateList: () => {},
        refreshProviders: () => {
            refreshes++;
            if (refreshes === 1) throw new Error('provider collision');
        },
    };
    const { subject, settings, calls } = createConfigProfileSubject({
        customAgents: [],
        configProfiles: [profile({ customAgents: [{
            id: 'ca_profile', name: 'Agent', providerName: 'agent_result',
        }] })],
    }, { ok: true }, { customAgentSystem });
    const before = structuredClone(settings);

    await assert.rejects(subject.applyProfile('profile-1'), /provider collision/);
    assert.deepEqual(settings, before);
    assert.equal(refreshes, 2);
    assert.equal(calls.saves, 0);
});

test('profile application preserves unrelated settings changed while variable import is pending', async () => {
    let finishImport;
    const variableResult = () => new Promise(resolve => { finishImport = resolve; });
    const { subject, settings } = createConfigProfileSubject({
        llmMaxSpeakers: 1,
        memoryEnabled: false,
        configProfiles: [profile({ llmMaxSpeakers: 2 }, {
            drawers: { contextLedger: true },
            variables: { defs: [], values: { global: {}, character: {} } },
        })],
    }, variableResult);

    const applying = subject.applyProfile('profile-1');
    settings.memoryEnabled = true;
    finishImport({ ok: true });
    await applying;

    assert.equal(settings.llmMaxSpeakers, 2);
    assert.equal(settings.memoryEnabled, true);
});

test('failed variable import does not roll back unrelated concurrent setting changes', async () => {
    let failImport;
    let importCount = 0;
    const variableResult = () => {
        importCount++;
        if (importCount > 1) return { ok: true };
        return new Promise((resolve, reject) => { failImport = reject; });
    };
    const { subject, settings, calls } = createConfigProfileSubject({
        llmMaxSpeakers: 1,
        memoryEnabled: false,
        configProfiles: [profile({ llmMaxSpeakers: 2 }, {
            drawers: { contextLedger: true },
            variables: { defs: [], values: { global: {}, character: {} } },
        })],
    }, variableResult);

    const applying = subject.applyProfile('profile-1');
    settings.memoryEnabled = true;
    failImport(new Error('disk full'));
    await assert.rejects(applying, /disk full/);

    assert.equal(settings.llmMaxSpeakers, 1);
    assert.equal(settings.memoryEnabled, true);
    assert.equal(calls.variableImports.length, 1);
});

test('later settings failure uses concurrency-safe variable import compensation', async () => {
    const transaction = { previous: { marker: 'before' }, applied: { marker: 'imported' } };
    const rollbacks = [];
    const variableSystem = {
        getExportData: () => ({ defs: [], values: { global: {}, character: {} } }),
        applyImportData: async () => ({ ok: true, transaction }),
        rollbackImportTransaction: async value => { rollbacks.push(value); },
    };
    const { subject, settings } = createConfigProfileSubject({
        llmMaxSpeakers: 1,
        configProfiles: [profile({ llmMaxSpeakers: 2 }, {
            drawers: { contextLedger: true },
            variables: { defs: [], values: { global: {}, character: {} } },
        })],
    }, { ok: true }, {
        variableSystem,
        saveError: new Error('settings save failed'),
    });

    await assert.rejects(subject.applyProfile('profile-1'), /settings save failed/);

    assert.equal(settings.llmMaxSpeakers, 1);
    assert.deepEqual(rollbacks, [transaction]);
});

test('variable compensation failure preserves the original settings transaction error', async () => {
    const variableSystem = {
        getExportData: () => ({ defs: [], values: { global: {}, character: {} } }),
        applyImportData: async () => ({ ok: true, transaction: { previous: {}, applied: {} } }),
        rollbackImportTransaction: async () => { throw new Error('rollback failed'); },
    };
    const { subject, settings } = createConfigProfileSubject({
        llmMaxSpeakers: 1,
        configProfiles: [profile({ llmMaxSpeakers: 2 }, {
            drawers: { contextLedger: true },
            variables: { defs: [], values: { global: {}, character: {} } },
        })],
    }, { ok: true }, {
        variableSystem,
        saveError: new Error('settings save failed'),
    });

    await assert.rejects(subject.applyProfile('profile-1'), /settings save failed/);
    assert.equal(settings.llmMaxSpeakers, 1);
});
