import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createMuyuController } from '../../muyu/application/controller.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createProviderPort } from '../../muyu/host/providers.js';
import { scriptedModel, text, done, flush } from './helpers/muyu-subject.mjs';

const tool = (args, callId) => ({ type: 'tool_call_complete', call: { toolId: 'muyu.provider.read', version: 2, args, callId } });
const result = (model, id) => model.requests.flatMap(request => request.messages).filter(message => message.role === 'tool' && message.callId === id).at(-1)?.result;
const settle = async () => { for (let i = 0; i < 20; i++) await flush(); };
for (const source of ['stPersonaContent', 'stPresetFamilies']) for (const decision of ['task', 'deny']) test(source + ' approval ' + decision + ' binds all nested reads without writes or secret leakage', async () => {
    let exports = 0, writes = 0;
    const events = new EventEmitter(), context = { groupId: 'g', chatId: 'A', chatMetadata: {}, eventSource: events, eventTypes: { CHAT_CHANGED: 'changed' },
        mainApi: 'textgenerationwebui', powerUserSettings: { personas: { 'private-avatar.png': 'Synthetic user' }, persona_description: 'LIVE_PERSONA_BODY', apiKey: 'PRIVATE_STORED_KEY' },
        getPresetManager: kind => kind !== 'textgenerationwebui' ? null : ({ getAllPresets: () => ['Saved'], getSelectedPresetName: () => 'Saved',
            getCompletionPresetByName: () => { exports++; return { temp: 0.5, grammar: 'SAVED_FORMAT_BODY', apiKey: 'PRIVATE_SAVED_KEY' }; },
            getPresetSettings: () => { throw Error('not a saved reader'); }, savePreset: () => { writes++; }, selectPreset: () => { writes++; } }),
    };
    const settings = {}, before = JSON.stringify(context.powerUserSettings);
    const provider = createProviderPort({ getContext: () => context, getSettings: () => settings, extensionKey: 'gd', stDirectories: { getSelectedPersona: () => 'private-avatar.png' } });
    let model;
    const read = (selector, previous, id) => [tool({ id: source, selector, revision: result(model, previous).data.revision, offset: 0 }, id), done];
    const steps = [[tool({ id: source }, 'root'), done], () => {
        if (decision === 'deny') return [text('Reading denied; stopped'), done];
        return read(source === 'stPersonaContent' ? 'current' : 'mode:2', 'root', 'level1');
    }];
    if (source === 'stPresetFamilies') steps.push(() => read('mode:2:saved:0', 'level1', 'overview'), () => read('mode:2:saved:0:field:0', 'overview', 'body'));
    steps.push([text('Checked; nothing changed'), done]); model = scriptedModel(steps);
    const host = createHostBridge({ getContext: () => context, getSettings: () => settings, extensionKey: 'gd', providerPort: provider, permissionConfig: { read: () => ({ readAccess: 'ask' }) } });
    const controller = createMuyuController({ host, createModel: () => model });
    await controller.configure({ endpoint: 'https://fixture.invalid/chat/completions', apiKey: 'TEST', model: 'synthetic' });
    controller.setInput('Read the relevant stored text; do not change settings or execute macros'); await controller.send(); await settle();
    const pending = controller.snapshot().interaction; assert.equal(pending?.source, source, JSON.stringify({ runs: controller.snapshot().runs, root: result(model, 'root') })); assert.equal(exports, 0);
    controller.answerPermission(pending.id, decision); await settle();
    assert.equal(controller.snapshot().runs.at(-1).status, 'succeeded');
    if (decision === 'task') {
        const last = result(model, source === 'stPersonaContent' ? 'level1' : 'body'); assert.equal(last.ok, true);
        assert.match(last.data.text, source === 'stPersonaContent' ? /LIVE_PERSONA_BODY/ : /SAVED_FORMAT_BODY/);
        assert.ok(JSON.parse(controller.exportHistory()).required.includes('source:' + source));
        assert.doesNotMatch(JSON.stringify(model.requests), /PRIVATE_STORED_KEY|PRIVATE_SAVED_KEY|private-avatar\.png/);
        await controller.revokePermission('source:' + source); assert.equal(controller.snapshot().messages.length, 0);
    } else { assert.equal(result(model, 'root').error.code, 'PERMISSION_DENIED'); assert.equal(exports, 0); }
    assert.equal(writes, 0); assert.equal(JSON.stringify(context.powerUserSettings), before); assert.deepEqual(settings, {});
    assert.equal(controller.snapshot().artifacts.length, 0); await controller.dispose();
});
