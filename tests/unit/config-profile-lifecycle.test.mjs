import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createConfigProfileSubject,
    jsonFile,
    manifest,
} from './helpers/config-profile-subject.mjs';

const drawers = { directorLlm: true };

test('saving a profile rolls the in-memory list back when persistence fails', () => {
    const { subject, settings } = createConfigProfileSubject(
        { llmMaxSpeakers: 2 },
        { ok: true },
        { saveError: new Error('disk full') },
    );

    assert.throws(() => subject.saveCurrentAsProfile('Broken', '', drawers), /disk full/);
    assert.deepEqual(settings.configProfiles, []);
});

test('deleting a profile rolls the in-memory list back when persistence fails', () => {
    const original = {
        id: 'keep-me', name: 'Keep', description: '', createdAt: 1,
        drawers: {}, settings: {},
    };
    const { subject, settings } = createConfigProfileSubject(
        { configProfiles: [original] },
        { ok: true },
        { saveError: new Error('disk full') },
    );

    assert.throws(() => subject.deleteProfile('keep-me'), /disk full/);
    assert.deepEqual(settings.configProfiles, [original]);
});

test('JSON import rolls the in-memory list back when persistence fails', async () => {
    const { subject, settings } = createConfigProfileSubject(
        {},
        { ok: true },
        { saveError: new Error('disk full') },
    );

    await assert.rejects(
        subject.importProfileFromJson(jsonFile(manifest())),
        /disk full/,
    );
    assert.deepEqual(settings.configProfiles, []);
});

test('ZIP import rolls the in-memory list back when persistence fails', async t => {
    const previousWindow = globalThis.window;
    t.after(() => { globalThis.window = previousWindow; });
    globalThis.window = {
        JSZip: class {
            static async loadAsync() {
                return {
                    file: name => name === 'manifest.json'
                        ? { async: async () => JSON.stringify(manifest({ type: 'config-profile' })) }
                        : null,
                    folder: () => null,
                };
            }
        },
    };
    const { subject, settings } = createConfigProfileSubject(
        {},
        { ok: true },
        { saveError: new Error('disk full') },
    );

    await assert.rejects(
        subject.importProfileFromZip({ arrayBuffer: async () => new ArrayBuffer(0) }),
        /disk full/,
    );
    assert.deepEqual(settings.configProfiles, []);
});

test('preset loading rolls the in-memory list back when persistence fails', async t => {
    const previousFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = previousFetch; });
    globalThis.fetch = async () => ({
        ok: true,
        json: async () => manifest({ type: 'config-profile' }),
    });
    const { subject, settings } = createConfigProfileSubject(
        {},
        { ok: true },
        { saveError: new Error('disk full') },
    );

    await assert.rejects(subject.loadPreset('starter'), /disk full/);
    assert.deepEqual(settings.configProfiles, []);
});
