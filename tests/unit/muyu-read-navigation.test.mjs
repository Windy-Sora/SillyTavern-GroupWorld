import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createToolSelection } from '../../muyu/tools/selection.js';
import { createBuiltins } from '../../muyu/modules/builtins.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createMuyuController } from '../../muyu/application/controller.js';
import { scriptedModel, done, text, flush } from './helpers/muyu-subject.mjs';
const routes = [
    ['libraries', 'profileLibraries', 'muyu.libraries.', 'profileLibraryAssets'],
    ['npc-libraries', 'npcLibraries', 'muyu.npc_libraries.', 'npcLibraryAssets'],
    ['blueprint-libraries', 'blueprintLibraries', 'muyu.blueprint_libraries.', 'blueprintLibraryAssets'],
    ['prompts', 'customPrompts', 'muyu.prompts.', 'customPromptAssets'],
];
function fixture() {
    let lists = 0, reads = 0, writes = 0;
    const port = { list: () => { lists++; return { items: [{ id: 'saved', revision: 'v1', name: 'Synthetic saved resource' }], nextOffset: -1 }; },
        read: (id, revision, offset) => { reads++; assert.equal(id, 'saved'); assert.equal(revision, 'v1'); assert.equal(offset, 0); return { id, revision, text: 'SYNTHETIC_SAVED_BODY', nextOffset: -1 }; },
        preview: () => { writes++; throw Error('WRITE_FORBIDDEN'); }, clear() {}, retain() {}, release() {} };
    const events = new EventEmitter(), settings = {};
    const host = createHostBridge({ getContext: () => ({ groupId: 'g', chatId: 'A', chatMetadata: {}, eventSource: events, eventTypes: { CHAT_CHANGED: 'changed' } }),
        getSettings: () => settings, extensionKey: 'gd', ...Object.fromEntries(routes.map(([, field]) => [field, port])), permissionConfig: { read: () => ({ readAccess: 'ask' }) } });
    return { host, lists: () => lists, reads: () => reads, writes: () => writes };
}
test('live optional groups expose exact existing read routes without reading host resources', () => {
    const f = fixture(), b = createBuiltins(f.host), selection = createToolSelection(b.registry.list(), b.tasks.assistant.tools, b.toolGroups);
    const directory = selection.list();
    for (const [group, , prefix, source] of routes) {
        const row = directory.groups.find(row => row.id === group); assert.ok(row); assert.equal(row.readPath.list, prefix + 'list'); assert.equal(row.readPath.read, prefix + 'read');
        assert.equal(row.readPath.source, source); assert.equal(row.readPath.scope, 'global');
        for (const name of ['list', 'read']) assert.ok(row.tools.includes(row.readPath[name]));
    }
    assert.equal(f.lists(), 0); assert.equal(f.reads(), 0); assert.equal(f.writes(), 0);
    directory.groups.find(row => row.id === 'libraries').readPath.source = 'MUTATED';
    assert.equal(selection.list().groups.find(row => row.id === 'libraries').readPath.source, 'profileLibraryAssets');
    assert.ok(JSON.stringify(directory).length < 24000);
    b.dispose();
});
test('absent hosts or incomplete allowed groups never advertise unavailable next reads', () => {
    const f = fixture(), b = createBuiltins(f.host), definitions = b.registry.list();
    for (const [group, , prefix] of routes) {
        const selection = createToolSelection(definitions, definitions.filter(d => d.id !== prefix + 'read').map(d => d.id), b.toolGroups);
        assert.equal(selection.list().groups.find(row => row.id === group)?.readPath, undefined);
    }
    const absent = createBuiltins(createHostBridge({ getContext: () => ({}), getSettings: () => ({}), extensionKey: 'gd' }));
    const directory = createToolSelection(absent.registry.list(), absent.tasks.assistant.tools, absent.toolGroups).list();
    assert.equal(directory.groups.some(row => routes.some(([id]) => row.id === id)), false); b.dispose(); absent.dispose();
});
for (const [group, , prefix, source] of routes) for (const decision of ['task', 'deny']) test(group + ' discovery does not grant body access: ' + decision, async () => {
    const f = fixture(); let model;
    const result = callId => model.requests.flatMap(r => r.messages).filter(m => m.role === 'tool' && m.callId === callId).at(-1)?.result;
    const tool = (toolId, args, callId) => ({ type: 'tool_call_complete', call: { toolId, version: 1, args, callId } });
    model = scriptedModel([[tool('muyu.tools.list', {}, 'tools'), done], () => {
        const row = JSON.parse(result('tools').data.text).groups.find(row => row.id === group); assert.equal(row.readPath.source, source);
        return [tool('muyu.tools.select', { groups: [group] }, 'select'), done];
    }, [tool(prefix + 'list', {}, 'list'), done], () => {
        if (decision === 'deny') return [text('Read denied; no other source used'), done];
        const row = JSON.parse(result('list').data.text).items[0]; return [tool(prefix + 'read', { id: row.id, revision: row.revision, offset: 0 }, 'body'), done];
    }, [text('Saved resource checked without applying it'), done]]);
    const controller = createMuyuController({ host: f.host, createModel: () => model });
    await controller.configure({ endpoint: 'https://fixture.invalid/chat/completions', apiKey: 'TEST', model: 'synthetic' });
    controller.setInput('Find and read the saved resource; no changes or execution'); await controller.send();
    for (let i = 0; i < 20; i++) await flush();
    assert.equal(controller.snapshot().interaction?.source, source); assert.equal(f.lists(), 0); assert.equal(f.reads(), 0);
    controller.answerPermission(controller.snapshot().interaction.id, decision); for (let i = 0; i < 30; i++) await flush();
    assert.equal(controller.snapshot().runs.at(-1).status, 'succeeded');
    assert.equal(f.lists(), decision === 'task' ? 1 : 0); assert.equal(f.reads(), decision === 'task' ? 1 : 0); assert.equal(f.writes(), 0);
    if (decision === 'task') { assert.match(result('body').data.text, /SYNTHETIC_SAVED_BODY/); assert.ok(JSON.parse(controller.exportHistory()).required.includes('source:' + source)); }
    else assert.equal(result('list').error.code, 'PERMISSION_DENIED');
    await controller.dispose();
});
