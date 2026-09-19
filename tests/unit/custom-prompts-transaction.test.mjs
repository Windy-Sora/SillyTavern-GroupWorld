import assert from 'node:assert/strict';
import test from 'node:test';
import { createCustomPromptsSystem } from '../../systems/custom-prompts-system.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function createSubject(initial, saveSettings = () => {}) {
    const providers = new Map();
    const settings = { customPromptsEnabled: true, customPrompts: [], ...initial };
    const subject = createCustomPromptsSystem({
        settings,
        saveSettings,
        registerProvider(provider) {
            const current = providers.get(provider.id);
            if (current && (current._gdOwner !== provider._gdOwner || current._gdOwnerId !== provider._gdOwnerId)) {
                throw new Error(`Provider "${provider.id}" is already registered`);
            }
            providers.set(provider.id, provider);
        },
        unregisterProvider(id, owner) {
            const current = providers.get(id);
            if (!current) return false;
            if (owner && (current._gdOwner !== owner.owner || current._gdOwnerId !== owner.ownerId)) return false;
            return providers.delete(id);
        },
        getProviders: () => [...providers.values()],
        log: () => {},
    });
    return { subject, settings, providers };
}

test('later reserved or registered names reject a whole prompt import without partial writes', async () => {
    for (const blockedName of ['user', 'builtin']) {
        let saves = 0;
        const entry = { id: 'old', name: 'note', content: 'original', dataJson: '', scope: 'global', enabled: true };
        const { subject, settings, providers } = createSubject({ customPrompts: [entry] }, () => { saves++; });
        providers.set('builtin', { id: 'builtin', placeholder: '{{builtin}}' });
        subject.initAll();
        const before = structuredClone(settings);
        await assert.rejects(subject.importPrompts({ prompts: [
            { name: 'note', content: 'overwrite' },
            { name: 'fresh', content: 'new' },
            { name: blockedName, content: 'blocked' },
        ] }, true));
        assert.deepEqual(settings, before);
        assert.equal(providers.get('note').render().content, 'original');
        assert.equal(providers.has('fresh'), false);
        assert.equal(saves, 0);
    }
});

test('rejected async save rolls back add and rejects its caller', async () => {
    const pending = deferred();
    const { subject, settings, providers } = createSubject({}, () => pending.promise);
    const operation = subject.add('note', 'value');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settings.customPrompts.length, 1);
    pending.reject(new Error('save failed'));
    await assert.rejects(operation, /save failed/);
    assert.deepEqual(settings.customPrompts, []);
    assert.equal(providers.has('note'), false);
});

test('remove, toggle, and master mutations persist their complete provider lifecycle', async () => {
    const { subject, providers } = createSubject({
        customPrompts: [{ id: 'one', name: 'note', content: 'x', dataJson: '', scope: 'global', enabled: true }],
    });
    subject.initAll();
    assert.equal(await subject.toggle('missing'), undefined);
    assert.equal(await subject.remove('missing'), undefined);
    assert.equal(await subject.toggle('one'), false);
    assert.equal(providers.has('note'), false);
    assert.equal(await subject.toggle('one'), true);
    assert.equal(providers.has('note'), true);
    await subject.setMasterEnabled(false);
    assert.equal(providers.has('note'), false);
    await subject.setMasterEnabled(true);
    assert.equal(providers.has('note'), true);
    assert.equal((await subject.remove('one')).name, 'note');
    assert.equal(providers.has('note'), false);
});

test('failed master, toggle, and remove mutations restore their own state', async () => {
    const entry = { id: 'one', name: 'note', content: 'x', dataJson: '', scope: 'global', enabled: true };
    const { subject, settings, providers } = createSubject({ customPrompts: [entry] }, () => Promise.reject(new Error('save failed')));
    subject.initAll();
    await assert.rejects(subject.setMasterEnabled(false), /save failed/);
    assert.equal(settings.customPromptsEnabled, true);
    assert.equal(providers.has('note'), true);
    await assert.rejects(subject.toggle('one'), /save failed/);
    assert.equal(entry.enabled, true);
    await assert.rejects(subject.remove('one'), /save failed/);
    assert.strictEqual(settings.customPrompts[0], entry);
    assert.equal(providers.has('note'), true);
});

test('failed update compensates only unchanged fields and preserves concurrent edits', async () => {
    const pending = deferred();
    const entry = { id: 'one', name: 'note', content: 'before', dataJson: '{}', scope: 'global', enabled: true };
    const { subject } = createSubject({ customPrompts: [entry] }, () => pending.promise);
    subject.initAll();
    const operation = subject.update('one', { content: 'imported', dataJson: '{"new":true}' });
    await new Promise(resolve => setImmediate(resolve));
    entry.scope = 'character';
    pending.reject(new Error('save failed'));
    await assert.rejects(operation, /save failed/);
    assert.equal(entry.content, 'before');
    assert.equal(entry.dataJson, '{}');
    assert.equal(entry.scope, 'character');
});

test('owner-aware init refuses collisions and hot reload removes stale owned providers', () => {
    const { subject, settings, providers } = createSubject({
        customPrompts: [{ id: 'old', name: 'old_prompt', content: 'old', dataJson: '', scope: 'global', enabled: true }],
    });
    subject.initAll();
    assert.equal(providers.has('old_prompt'), true);
    settings.customPrompts = [];
    subject.initAll();
    assert.equal(providers.has('old_prompt'), false);

    providers.set('shared', { id: 'shared', placeholder: '{{shared}}' });
    settings.customPrompts = [{ id: 'bad', name: 'shared', content: 'bad', dataJson: '', scope: 'global', enabled: true }];
    subject.initAll();
    assert.equal(providers.get('shared')._gdOwner, undefined);
});

test('failed import preserves in-place identity and concurrent fields while removing additions', async () => {
    const pending = deferred();
    const existing = { id: 'one', name: 'note', content: 'before', dataJson: '{}', scope: 'global', enabled: true };
    const { subject, settings } = createSubject({ customPrompts: [existing] }, () => pending.promise);
    const operation = subject.importPrompts({ prompts: [
        { name: 'note', content: 'imported', dataJson: '{"new":true}', scope: 'mixed', enabled: false },
        { name: 'added', content: 'temporary' },
    ] }, true);
    await new Promise(resolve => setImmediate(resolve));
    existing.scope = 'character';
    pending.reject(new Error('save failed'));
    await assert.rejects(operation, /save failed/);
    assert.strictEqual(settings.customPrompts[0], existing);
    assert.deepEqual(existing, {
        id: 'one', name: 'note', content: 'before', dataJson: '{}', scope: 'character', enabled: true,
    });
    assert.equal(settings.customPrompts.some(entry => entry.name === 'added'), false);
});

test('import parser rejects malformed envelopes and conflict skipping saves once', async () => {
    let saves = 0;
    const { subject } = createSubject({
        customPrompts: [{ id: 'one', name: 'note', content: 'before', dataJson: '', scope: 'global', enabled: true }],
    }, () => { saves += 1; });
    assert.equal(subject.parseImportFile('{').ok, false);
    assert.equal(subject.parseImportFile(JSON.stringify({ type: 'wrong', version: 1, prompts: [] })).ok, false);
    const parsed = subject.parseImportFile(JSON.stringify({
        type: 'custom-prompt-export', version: 1,
        prompts: [{ name: 'note', content: 'new' }, { name: 'added', content: 'new' }],
    }));
    assert.equal(parsed.ok, true);
    assert.deepEqual(await subject.importPrompts(parsed.data, false), {
        added: 1, overwritten: 0, conflicts: ['note'],
    });
    assert.equal(saves, 1);
});

test('export cleanup runs when the synthetic click throws', t => {
    const oldBlob = globalThis.Blob;
    const oldDocument = globalThis.document;
    const oldCreate = URL.createObjectURL;
    const oldRevoke = URL.revokeObjectURL;
    t.after(() => {
        globalThis.Blob = oldBlob;
        globalThis.document = oldDocument;
        URL.createObjectURL = oldCreate;
        URL.revokeObjectURL = oldRevoke;
    });
    const children = [];
    const revoked = [];
    globalThis.Blob = class {};
    globalThis.document = {
        createElement: () => ({ click() { throw new Error('download failed'); } }),
        body: {
            appendChild(node) { children.push(node); },
            removeChild(node) { children.splice(children.indexOf(node), 1); },
        },
    };
    URL.createObjectURL = () => 'blob:test';
    URL.revokeObjectURL = url => revoked.push(url);
    const { subject } = createSubject({
        customPrompts: [{ id: 'one', name: 'note', content: 'x', dataJson: '', scope: 'global', enabled: true }],
    });
    assert.throws(() => subject.exportPrompts(['one']), /download failed/);
    assert.deepEqual(children, []);
    assert.deepEqual(revoked, ['blob:test']);
});

test('export still revokes its URL when anchor removal throws', t => {
    const oldBlob = globalThis.Blob;
    const oldDocument = globalThis.document;
    const oldCreate = URL.createObjectURL;
    const oldRevoke = URL.revokeObjectURL;
    t.after(() => {
        globalThis.Blob = oldBlob;
        globalThis.document = oldDocument;
        URL.createObjectURL = oldCreate;
        URL.revokeObjectURL = oldRevoke;
    });
    const revoked = [];
    const anchor = { click() {}, parentNode: { removeChild() { throw new Error('remove failed'); } } };
    globalThis.Blob = class {};
    globalThis.document = { createElement: () => anchor, body: { appendChild() {} } };
    URL.createObjectURL = () => 'blob:test';
    URL.revokeObjectURL = url => revoked.push(url);
    const { subject } = createSubject({
        customPrompts: [{ id: 'one', name: 'note', content: 'x', dataJson: '', scope: 'global', enabled: true }],
    });
    assert.throws(() => subject.exportPrompts(['one']), /remove failed/);
    assert.deepEqual(revoked, ['blob:test']);
});
