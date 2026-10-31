import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createMuyuController } from '../../muyu/application/controller.js';
import { createHistoryPort } from '../../muyu/host/history.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createMemoryHistoryStore } from '../../muyu/sessions/memory-store.js';
import { scriptedModel, text, done, flush } from './helpers/muyu-subject.mjs';

const tool = (toolId, args, callId) => ({ type: 'tool_call_complete', call: { toolId, args, version: 1, callId } });
const result = (model, id) => model.requests.flatMap(request => request.messages).filter(message => message.role === 'tool' && message.callId === id).at(-1)?.result;
const settle = async () => { for (let i = 0; i < 32; i++) { await flush(); await new Promise(resolve => setImmediate(resolve)); } };
for (const decision of ['task', 'deny']) test('archive consent ' + decision + ' resumes exactly once without requiring services or exposing stored bodies', async () => {
    let reads = 0, writes = 0;
    const store = createMemoryHistoryStore();
    await store.create({ version: 5, id: crypto.randomUUID(), revision: 0, scope: '["assistant","global",null]', title: 'Old record', createdAt: 1, updatedAt: 1, messages: [{ role: 'user', content: 'PRIVATE_ARCHIVE_BODY', runId: 'old' }], required: ['source:memoryConfig'], status: 'succeeded', archived: false, imported: false, receipts: [], contextSummary: null });
    const settings = { muyuHistoryEnabled: false, muyuHistoryReadSource: 'world-book', muyuHistoryWriteTargets: ['server'] };
    const history = createHistoryPort({ getAccount: async () => ({ enabled: false }), getSettings: () => settings, saveSettings: async () => { writes++; }, openArchiveBrowser: async () => { reads++; return store; } });
    const events = new EventEmitter(), context = { groupId: 'g', chatId: 'A', chatMetadata: {}, eventSource: events, eventTypes: { CHAT_CHANGED: 'changed' } };
    const model = scriptedModel([
        [tool('muyu.tools.select', { groups: ['archive-inspection'] }, 'select'), done],
        [tool('muyu.archives.list', { source: 'browser' }, 'inventory'), done],
        () => {
            if (decision === 'deny') return [text('Not inspected'), done];
            const inventory = JSON.parse(result(model, 'inventory').data.text);
            return [tool('muyu.archives.inspect', { source: 'browser', id: inventory.items[0].id, revision: inventory.revision }, 'checked'), done];
        }, [text('Found the record; did not restore anything'), done],
    ]);
    const host = createHostBridge({ getContext: () => context, getSettings: () => settings, extensionKey: 'gd', history,
        permissionConfig: { read: () => ({ readAccess: 'ask' }) } });
    const controller = createMuyuController({ host, createModel: () => model });
    const before = JSON.stringify(settings);
    await controller.configure({ endpoint: 'https://fixture.invalid/chat/completions', apiKey: 'TEST', model: 'synthetic' });
    controller.setInput('Inspect browser archives only, do not restore or change sources'); await controller.send(); await settle();
    const request = controller.snapshot().interaction;
    assert.equal(request?.source, 'muyuArchiveBrowser'); assert.equal(reads, 0);
    controller.answerPermission(request.id, decision); await settle();
    assert.equal(controller.snapshot().runs.at(-1).status, 'succeeded');
    if (decision === 'task') {
        assert.equal(result(model, 'checked').data.status, 'ok'); assert.equal(reads, 2);
        assert.equal(model.requests.length, 4); assert.ok(JSON.parse(controller.exportHistory()).required.includes('source:muyuArchiveBrowser'));
        assert.equal(JSON.parse(controller.exportHistory()).required.includes('source:memoryConfig'), false, 'old grants are not restored');
        assert.doesNotMatch(JSON.stringify(model.requests), /PRIVATE_ARCHIVE_BODY/);
        await controller.revokePermission('source:muyuArchiveBrowser'); assert.equal(controller.snapshot().messages.length, 0);
    } else { assert.equal(result(model, 'inventory').error.code, 'PERMISSION_DENIED'); assert.equal(reads, 0); }
    assert.equal(writes, 0); assert.equal(JSON.stringify(settings), before); assert.equal(controller.snapshot().artifacts.length, 0);
    await controller.dispose();
});
