import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createMuyuController } from '../../muyu/application/controller.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { scriptedModel, text, done, flush } from './helpers/muyu-subject.mjs';

const tool = (toolId, args, callId) => ({ type: 'tool_call_complete', call: { toolId, args, version: 1, callId } });
const select = [tool('muyu.tools.select', { groups: ['storage-inspection'] }, 'select'), done];
const settle = async () => { for (let i = 0; i < 16; i++) await flush(); };
const result = (model, id) => model.requests.flatMap(request => request.messages).filter(message => message.role === 'tool' && message.callId === id).at(-1)?.result;
function fixture(resource, decision) {
    let noteReads = 0;
    const events = new EventEmitter(), context = { groupId: 'g', chatId: 'A', chatMetadata: { gd: { summaries: [{ active: false, content: 'SAVED_SUMMARY' }] } }, eventSource: events, eventTypes: { CHAT_CHANGED: 'changed' } };
    const settings = { summaryEnabled: false, muyuAgentMemoryEnabled: false };
    const notes = { enabled: () => false, subscribe: () => () => {}, list: async () => { noteReads++; return [{ id: 'saved-note', title: 'Saved note', scope: 'account', revision: 1, content: 'SAVED_NOTE' }]; } };
    const model = scriptedModel([select, [tool('muyu.storage.list', { resource }, 'inventory'), done], input => {
        const read = result(model, 'inventory');
        if (decision === 'deny') return [text('Denied; did not inspect'), done];
        const inventory = JSON.parse(read.data.text);
        return [tool('muyu.storage.read', { resource, id: inventory.items[0].id, revision: inventory.revision }, 'body'), done];
    }, [text('Checked saved records without enabling anything'), done]]);
    const host = createHostBridge({ getContext: () => context, getSettings: () => settings, extensionKey: 'gd', agentMemory: notes,
        permissionConfig: { read: () => ({ readAccess: 'ask' }) }, pageId: 'test' });
    const controller = createMuyuController({ host, createModel: () => model });
    return { controller, model, settings, context, noteReads: () => noteReads };
}

for (const resource of ['notes', 'summaries']) for (const decision of ['task', 'deny']) test('disabled ' + resource + ' management uses one exact permission, then ' + decision, async () => {
    const f = fixture(resource, decision), before = JSON.stringify([f.settings, f.context.chatMetadata]);
    await f.controller.configure({ endpoint: 'https://fixture.invalid/chat/completions', apiKey: 'TEST_KEY', model: 'synthetic' });
    f.controller.setInput('Inspect my saved ' + resource + '; do not enable, regenerate or modify anything');
    await f.controller.send(); await settle();
    const request = f.controller.snapshot().interaction;
    assert.equal(request?.source, resource === 'notes' ? 'muyuNoteStorage' : 'chatSummaryStorage');
    assert.equal(f.noteReads(), 0); assert.equal(result(f.model, 'inventory'), undefined);
    f.controller.answerPermission(request.id, decision); await settle();
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
    assert.notEqual(f.controller.snapshot().interaction?.status, 'pending');
    if (decision === 'task') {
        assert.equal(result(f.model, 'body').data.status, 'ok');
        const value = JSON.parse(result(f.model, 'body').data.text);
        assert.equal(value.text, resource === 'notes' ? 'SAVED_NOTE' : 'SAVED_SUMMARY');
        assert.equal(value.runtimeEnabled, false); assert.equal(value.persistence, 'unknown');
        assert.equal(f.model.requests.length, 4, 'approval resumes the same call; body read reuses the exact task grant');
        assert.ok(JSON.parse(f.controller.exportHistory()).required.includes(resource === 'notes' ? 'source:muyuNoteStorage' : 'source:chatSummaryStorage'));
        await f.controller.revokePermission(resource === 'notes' ? 'source:muyuNoteStorage' : 'source:chatSummaryStorage');
        assert.equal(f.controller.snapshot().messages.length, 0);
    } else {
        assert.equal(result(f.model, 'inventory').ok, false); assert.equal(result(f.model, 'inventory').error.code, 'PERMISSION_DENIED');
        assert.equal(result(f.model, 'body'), undefined); assert.equal(f.noteReads(), 0);
    }
    assert.equal(JSON.stringify([f.settings, f.context.chatMetadata]), before);
    assert.equal(f.controller.snapshot().artifacts.length, 0); await f.controller.dispose();
});
