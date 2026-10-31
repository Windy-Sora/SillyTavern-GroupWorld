import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createProviderPort } from '../../muyu/host/providers.js';
import { createProviderModule } from '../../muyu/modules/providers/index.js';
import { createCharacterCardModule } from '../../muyu/modules/character-card/index.js';
import { createToolSelection } from '../../muyu/tools/selection.js';
import { sourceReadNavigation, sourceReadNavigationSchema } from '../../muyu/tools/read-navigation.js';
import { createBuiltins } from '../../muyu/modules/builtins.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createMuyuController } from '../../muyu/application/controller.js';
import { validateJson } from '../../muyu/core/json-contract.js';
import { createToolBroker } from '../../muyu/tools/broker.js';
import { scriptedModel, text, done, flush } from './helpers/muyu-subject.mjs';
const target = { kind: 'global', userKey: 'u' };
const chatTarget = { kind: 'chat', userKey: 'u', chatKey: 'A' };
function fixture() {
    let componentReads = 0, cardReads = 0, selected = 'private-avatar.png';
    const ctx = { powerUserSettings: { personas: { 'private-avatar.png': 'Synthetic Persona' },
        persona_descriptions: { 'private-avatar.png': { description: 'STORED_BODY' } } },
        groupId: 'g', chatId: 'A', chatMetadata: {}, eventSource: new EventEmitter(), eventTypes: { CHAT_CHANGED: 'changed' } };
    const cards = { list: () => ({ revision: 'card-directory', cards: [{ name: 'Synthetic', selector: 'card:0' }], nextOffset: -1 }),
        read: async () => { cardReads++; return { revision: 'card-value', text: '{"fields":{"description":"synthetic text only"}}', nextOffset: -1 }; }, clear() {} };
    const port = createProviderPort({ getContext: () => ctx, stDirectories: { getSelectedPersona: () => selected },
        characterComponents: { read: () => { componentReads++; return { text: '{"kind":"card-directory","cards":[]}', limited: false }; } } });
    const module = createProviderModule({ providerPort: port, globalTarget: target, currentTarget: () => chatTarget });
    const read = (id, selector = '', revision = '', offset = 0) => {
        const value = module.handlers['muyu.provider.read']({ id, selector, revision, offset }, { runId: 'r', target: chatTarget });
        validateJson(module.registry.get('muyu.provider.read').outputSchema, value); return value;
    };
    return { ctx, port, cards, module, read, componentReads: () => componentReads, cardReads: () => cardReads, select: value => { selected = value; } };
}
test('related source navigation is closed first-party metadata with fresh independent arguments', () => {
    const first = sourceReadNavigation('stCharacterComponents'); validateJson(sourceReadNavigationSchema, first);
    assert.deepEqual(first.args, { id: 'stCharacterComponents' }); first.args.id = 'INVALID';
    assert.equal(sourceReadNavigation('stCharacterComponents').args.id, 'stCharacterComponents');
    assert.equal(sourceReadNavigation('arbitrary-model-source'), null);
});
test('permission identifiers and invented Provider sources are rejected before authorization or host reads', async () => {
    const f = fixture(); let policyCalls = 0;
    const broker = createToolBroker({ registry: f.module.registry, handlers: f.module.handlers, runId: 'r', target: chatTarget,
        allowedTools: ['muyu.provider.read'], signal: new AbortController().signal,
        policy: () => { policyCalls++; return false; } });
    for (const [index, id] of ['stCharacterCardState', 'source:stPersonaContent', 'invented-user-provider'].entries()) {
        const result = await broker.call({ toolId: 'muyu.provider.read', version: 2, callId: 'bad' + index, args: { id } });
        assert.equal(result.error.code, 'INVALID_ARGUMENT');
    }
    assert.equal(policyCalls, 0); assert.equal(f.componentReads(), 0); assert.equal(f.cardReads(), 0);
    const valid = await broker.call({ toolId: 'muyu.provider.read', version: 2, callId: 'valid', args: { id: 'stCharacterComponents' } });
    assert.equal(valid.error.code, 'PERMISSION_DENIED'); assert.equal(policyCalls, 1);
});
test('old card list/read disclose an entry, not components, counts, authorization or an inherited revision', async () => {
    const f = fixture(), module = createCharacterCardModule({ port: f.cards, canReadComponents: () => f.port.available('stCharacterComponents') });
    const list = module.handlers['muyu.character_card.list']({}, { target, runId: 'r' });
    validateJson(module.registry.get('muyu.character_card.list').outputSchema, list);
    assert.deepEqual(list.relatedReads[0].args, { id: 'stCharacterComponents' }); assert.equal(f.componentReads(), 0);
    const body = await module.handlers['muyu.character_card.read']({ selector: 'card:0', revision: 'card-directory', offset: 0 }, { target, runId: 'r' });
    assert.equal(body.relatedReads[0].args.revision, undefined); assert.equal(f.componentReads(), 0); assert.equal(f.cardReads(), 1);
    const absent = createCharacterCardModule({ port: f.cards });
    assert.equal(absent.handlers['muyu.character_card.list']({}, { target, runId: 'r' }).relatedReads, undefined);
});
test('tool-group navigation distinguishes Provider catalog and never invents a missing catalog tool', () => {
    const f = fixture(), b = createBuiltins(createHostBridge({ getContext: () => f.ctx, getSettings: () => ({}), extensionKey: 'gd', characterCards: f.cards, providerPort: f.port }));
    const all = b.registry.list(), directory = createToolSelection(all, b.tasks.assistant.tools, b.toolGroups).list();
    const card = directory.groups.find(row => row.id === 'character-card'); assert.equal(card.readPath.source, 'stCharacterCardState'); assert.equal(card.relatedDirectory.tool, 'muyu.provider.list');
    const without = createToolSelection(all, b.tasks.assistant.tools.filter(id => id !== 'muyu.provider.list'), b.toolGroups).list();
    assert.equal(without.groups.find(row => row.id === 'character-card').relatedDirectory, undefined); assert.equal(f.componentReads(), 0); assert.equal(f.cardReads(), 0); b.dispose();
});
test('Persona names/search are metadata directories pointing to a separately supported description source', () => {
    const f = fixture(); let bodies = 0;
    Object.defineProperty(f.ctx.powerUserSettings, 'persona_descriptions', { get() { bodies++; throw Error('BODY_ACCESS_FORBIDDEN'); }, configurable: true });
    const root = f.read('stPersonas');
    for (const result of [root, f.read('stPersonas', 'search:Synthetic', root.revision)]) {
        assert.equal(result.readHint.kind, 'directory', JSON.stringify({ result, bodies })); assert.deepEqual(result.readHint.relatedReads[0].args, { id: 'stPersonaContent' });
        assert.doesNotMatch(result.text, /STORED_BODY|private-avatar/);
    }
    assert.equal(bodies, 0);
    const noPort = createProviderModule({ globalTarget: target, currentTarget: () => chatTarget, providerPort: { read: () => ({ text: 'names', limited: false }) } });
    const result = noPort.handlers['muyu.provider.read']({ id: 'stPersonas' }, { runId: 'r', target: chatTarget }); assert.equal(result.readHint.relatedReads, undefined);
});
test('current Persona failure suggests only the same source directory; stored content is not auto-read or substituted', () => {
    const f = fixture(), failed = f.read('stPersonaContent', 'current');
    assert.equal(failed.status, 'SOURCE_UNAVAILABLE'); assert.equal(failed.text, '');
    assert.deepEqual(failed.readHint.nextRead, { id: 'stPersonaContent', selector: '', revision: '', offset: 0 });
    assert.equal(failed.readHint.recovery, 'read_directory');
    const directory = f.read('stPersonaContent'); assert.equal(directory.readHint.nextRead.selector, 'persona:0'); assert.equal(directory.readHint.exampleSelector, 'persona:0');
    assert.doesNotMatch(directory.text, /STORED_BODY/);
    const stored = f.read('stPersonaContent', 'persona:0', directory.revision); assert.equal(JSON.parse(stored.text).kind, 'stored-persona'); assert.match(stored.text, /STORED_BODY/);
});
test('current and stored Persona choices retain the source version; unknown selection never chooses another persona', () => {
    const f = fixture(); f.ctx.powerUserSettings.persona_description = 'CURRENT_BODY';
    const directory = f.read('stPersonaContent'); assert.equal(directory.readHint.nextRead.selector, 'current'); assert.equal(directory.readHint.alternativeReads[0].selector, 'persona:0');
    assert.equal(directory.readHint.alternativeReads[0].revision, directory.revision);
    f.select(null); const unknown = f.read('stPersonaContent'); assert.equal(unknown.readHint.alternativeReads, undefined);
    delete f.ctx.powerUserSettings.persona_description;
    const missing = f.read('stPersonaContent'); assert.equal(missing.readHint.nextRead, undefined); assert.equal(missing.readHint.exampleSelector, '');
});
test('old source revisions are not accepted by body source; missing roots, unsupported values and budget failure stop', () => {
    const f = fixture(), names = f.read('stPersonas');
    assert.equal(f.read('stPersonaContent', 'persona:0', names.revision).status, 'STALE_SOURCE');
    f.ctx.powerUserSettings.persona_description = 7;
    const unsupported = f.read('stPersonaContent', 'current'); assert.equal(unsupported.status, 'SOURCE_UNSUPPORTED'); assert.equal(unsupported.readHint.recovery, 'stop'); assert.equal(unsupported.readHint.nextRead, undefined);
    f.module.bindRun('limited', 6000); f.module.charge('limited', 6000);
    const blocked = f.module.handlers['muyu.provider.read']({ id: 'stPersonaContent', selector: 'current', revision: '', offset: 0 }, { runId: 'limited', target });
    assert.equal(blocked.status, 'BUDGET_EXCEEDED'); assert.equal(blocked.readHint.recovery, 'stop'); assert.equal(blocked.readHint.nextRead, undefined);
    delete f.ctx.powerUserSettings.personas;
    const missing = f.read('stPersonaContent'); assert.equal(missing.status, 'SOURCE_UNAVAILABLE'); assert.equal(missing.readHint.recovery, 'stop'); assert.equal(missing.readHint.nextRead, undefined);
});
for (const origin of ['persona', 'card']) for (const decision of ['task', 'deny']) test(origin + ' navigation never replaces body authorization: ' + decision, async () => {
    const f = fixture(); let model;
    const result = id => model.requests.flatMap(r => r.messages).filter(m => m.role === 'tool' && m.callId === id).at(-1)?.result;
    const call = (toolId, version, args, callId) => ({ type: 'tool_call_complete', call: { toolId, version, args, callId } });
    const first = origin === 'persona' ? 'muyu.provider.read' : 'muyu.character_card.list', source = origin === 'persona' ? 'stPersonaContent' : 'stCharacterComponents';
    model = scriptedModel([[call(first, origin === 'persona' ? 2 : 1, origin === 'persona' ? { id: 'stPersonas' } : {}, 'origin'), done], () => {
        const navigation = origin === 'persona' ? result('origin').data.readHint.relatedReads[0] : result('origin').data.relatedReads[0];
        return [call(navigation.tool, 2, navigation.args, 'new-root'), done];
    }, [text('Done without changing anything'), done]]);
    const host = createHostBridge({ getContext: () => f.ctx, getSettings: () => ({}), extensionKey: 'gd', providerPort: f.port, characterCards: f.cards, permissionConfig: { read: () => ({ readAccess: 'ask' }) } });
    const controller = createMuyuController({ host, createModel: () => model });
    await controller.configure({ endpoint: 'https://fixture.invalid/chat/completions', apiKey: 'TEST', model: 'synthetic' }); controller.setInput('Inspect the relevant saved text, no changes'); await controller.send();
    for (let i = 0; i < 20; i++) await flush();
    assert.equal(controller.snapshot().interaction?.source, origin === 'persona' ? 'stPersonas' : 'stCharacters');
    controller.answerPermission(controller.snapshot().interaction.id, 'task'); for (let i = 0; i < 25; i++) await flush();
    assert.equal(controller.snapshot().interaction?.source, source); assert.equal(f.componentReads(), 0); assert.equal(f.cardReads(), 0);
    controller.answerPermission(controller.snapshot().interaction.id, decision); for (let i = 0; i < 25; i++) await flush();
    assert.equal(controller.snapshot().runs.at(-1).status, 'succeeded');
    if (decision === 'deny') assert.equal(result('new-root').error.code, 'PERMISSION_DENIED');
    else { assert.equal(result('new-root').data.status, 'ok'); assert.ok(JSON.parse(controller.exportHistory()).required.includes('source:' + source)); }
    assert.equal(f.componentReads(), origin === 'card' && decision === 'task' ? 1 : 0);
    await controller.dispose();
});

test('card text boundary is host metadata on every page, separate from untrusted body and counted in budget', async () => {
    const charges = [];
    const port = { list: () => ({ cards: [] }), read: async () => ({ text: '<div>loading</div>', evidence: { scope: 'runtime', meaning: 'all scripts failed' } }) };
    const module = createCharacterCardModule({ port, charge: (run, bytes) => { charges.push(bytes); return true; } });
    const ctx = { target, runId: 'r' };
    const names = module.handlers['muyu.character_card.list']({}, ctx);
    assert.equal(names.evidence.scope, 'card-directory');
    const page = await module.handlers['muyu.character_card.read']({ selector: 'card:0', revision: 'r', offset: 2000 }, ctx);
    validateJson(module.registry.get('muyu.character_card.read').outputSchema, page);
    assert.equal(page.evidence.scope, 'saved-card-text');
    assert.equal(JSON.parse(page.text).evidence.scope, 'runtime', 'untrusted body is retained as data, not promoted');
    assert.ok(charges[1] >= new TextEncoder().encode(page.text + JSON.stringify(page.evidence)).length);
    page.evidence.scope = 'runtime';
    const next = await module.handlers['muyu.character_card.read']({ selector: 'card:0', revision: 'r', offset: 4000 }, ctx);
    assert.equal(next.evidence.scope, 'saved-card-text', 'caller cannot mutate later boundary metadata');
    const denied = createCharacterCardModule({ port, charge: () => false });
    await assert.rejects(denied.handlers['muyu.character_card.read']({ selector: 'card:0', revision: 'r', offset: 0 }, ctx), /PROVIDER_BUDGET_EXCEEDED/);
});
