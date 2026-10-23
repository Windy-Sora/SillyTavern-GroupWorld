import test from 'node:test';
import assert from 'node:assert/strict';
import { createVariableDraftPort } from '../../muyu/host/variable-draft.js';
import { createVariableWriter } from '../../muyu/host/variable-write.js';

const target = { kind: 'chat', userKey: 'page:test', chatKey: 'group:A' };
const request = { action: 'create', id: 'party_gold', label: '队伍金币', initialValue: 0, min: 0,
    rule: '有明确收支时更新', autoUpdate: true, injectMode: 'always', updateMode: 'delta' };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function fixture(saveChatConfirmed) {
    let current = target, metadata = {};
    const getTarget = () => current, getMetadata = () => metadata;
    const draftPort = createVariableDraftPort({ getTarget, getMetadata, extensionKey: 'gd' });
    const writer = createVariableWriter({ draftPort, getTarget, getMetadata, extensionKey: 'gd', saveChatConfirmed });
    return { draftPort, writer, get metadata() { return metadata; }, switchChat: id => { current = { ...target, chatKey: `group:${id}` }; },
        replaceMetadata: value => { metadata = value; } };
}

test('One approved numeric variable writes only this chat and reports confirmed persistence', async () => {
    let saves = 0; const f = fixture(async () => { saves++; });
    const draft = f.draftPort.prepare(target, request);
    assert.equal(f.metadata.gd, undefined);
    const result = await f.writer.apply(draft);
    assert.equal(result.status, 'applied_confirmed'); assert.equal(result.chatSave, 'confirmed'); assert.equal(saves, 1);
    assert.equal(f.metadata.gd.variables.defs[0].id, 'party_gold');
    assert.equal(f.metadata.gd.variables.values.global.party_gold, 0);
    assert.throws(() => f.draftPort.assertFresh(draft), /STALE_VARIABLE_DRAFT/);
});

test('Variable save failure remains unknown in memory; concurrent unrelated edits are not rolled back', async () => {
    const gate = deferred(), f = fixture(() => gate.promise);
    const pending = f.writer.apply(f.draftPort.prepare(target, request));
    f.metadata.gd.variables.values.global.other = 7;
    gate.reject(Error('save failed'));
    const result = await pending;
    assert.equal(result.status, 'outcome_unknown'); assert.equal(result.chatSave, 'unknown'); assert.equal(result.saveError, true);
    assert.equal(f.metadata.gd.variables.values.global.party_gold, 0);
    assert.equal(f.metadata.gd.variables.values.global.other, 7);
});

test('Stale baseline blocks dispatch; chat switch during save is reported without writing the new chat', async () => {
    const gate = deferred(), f = fixture(() => gate.promise);
    const draft = f.draftPort.prepare(target, request);
    f.replaceMetadata({});
    await assert.rejects(f.writer.apply(draft), /STALE_VARIABLE_DRAFT/);
    const current = f.draftPort.prepare(target, request);
    const pending = f.writer.apply(current);
    f.switchChat('B'); gate.resolve();
    const result = await pending;
    assert.equal(result.status, 'partial'); assert.equal(result.chatSave, 'confirmed'); assert.equal(result.changed, true);
});
