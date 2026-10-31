import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createCharacterCardPort } from '../../muyu/host/character-cards.js';
import { createProviderPort } from '../../muyu/host/providers.js';
import { createProviderModule } from '../../muyu/modules/providers/index.js';
import { createPermissions } from '../../muyu/application/permissions.js';
import { assistantToolAccess } from '../../muyu/application/capabilities.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createMuyuController } from '../../muyu/application/controller.js';
import { scriptedModel, text, done, flush } from './helpers/muyu-subject.mjs';
const id = 'stCharacterComponents', target = { kind: 'global', userKey: 'u' };
function fixture() {
    let rows = [{ name: 'Synthetic card', avatar: 'private-avatar.png' }], loads = 0, writes = 0, actual = target, onLoad;
    const data = { name: 'Synthetic card', extensions: {
        world: '', unrelated: { secret: 'PRIVATE_EXTENSION' },
        regex_scripts: [{ id: 'PRIVATE_REGEX_ID', scriptName: 'Status renderer', findRegex: 'STATE', replaceString: '<div>REGEX_BODY</div>', disabled: false, minDepth: null, trimStrings: [], placement: [2] }],
        tavern_helper: { scripts: [{ type: 'folder', name: 'Folder', enabled: false, scripts: [{ type: 'script', id: 'PRIVATE_SCRIPT_ID', name: 'UI script', enabled: true,
            content: 'SCRIPT_BODY {{getvar::gold}}', info: 'INFO_BODY', data: { secret: 'PRIVATE_SCRIPT_DATA' }, button: { enabled: true, buttons: [{ name: 'Inspect', visible: true }] } }] }], variables: { secret: 'PRIVATE_VARIABLE_VALUE' } },
    }, character_book: { name: 'Embedded settings', description: 'BOOK_DESCRIPTION', scan_depth: 4, entries: [{ keys: ['status'], comment: 'Rules', content: 'BOOK_BODY', enabled: true, extensions: { depth: 4, private: 'PRIVATE_BOOK_EXTENSION' } }] } };
    const saved = { spec: 'chara_card_v2', data };
    const cards = createCharacterCardPort({ getTarget: () => actual, getDirectory: () => rows,
        load: async avatar => { loads++; await onLoad?.(); return { name: 'Synthetic card', avatar, data: { ...data, extensions: { regex_scripts: [{ replaceString: 'CACHE_BODY_MUST_NOT_LEAK' }] } }, json_data: JSON.stringify(saved) }; },
        save: () => { writes++; }, syncCache: () => { writes++; }, isBusy: () => false, isEditing: () => true });
    const port = createProviderPort({ getContext: () => ({}), characterComponents: { read: selector => cards.inspectComponents(actual, selector) } });
    const module = createProviderModule({ providerPort: port, globalTarget: target, currentTarget: () => actual?.kind === 'chat' ? actual : null });
    const read = (selector = '', revision = '', offset = 0, runId = 'run') => module.handlers['muyu.provider.read']({ id, selector, revision, offset }, { runId, target });
    return { saved, data, cards, port, module, read, loads: () => loads, writes: () => writes,
        rows: value => { rows = value; }, onLoad: value => { onLoad = value; }, actual: value => { actual = value; } };
}
async function content(f, selector, revision) {
    let result = await f.read(selector, revision), all = result.text;
    assert.equal(result.status, 'ok', JSON.stringify(result));
    while (result.nextOffset >= 0) { result = await f.read(selector, result.revision, result.nextOffset); assert.equal(result.status, 'ok'); all += result.text; }
    return { result, value: JSON.parse(all), raw: all };
}
test('component root is names only without fetching cards; directory separates embedded book, scripts and regex', async () => {
    const f = fixture(), root = await content(f, ''); assert.equal(f.loads(), 0); assert.equal(root.result.readHint.kind, 'directory');
    assert.doesNotMatch(root.raw, /private-avatar|BODY|PRIVATE_/);
    const card = await content(f, 'card:0', root.result.revision);
    assert.equal(card.value.regex.items[0].disabled, false);
    assert.equal(card.value.helper.items[1].enabled, true); assert.deepEqual(card.value.helper.items[1].ancestorEnabled, [false]);
    assert.equal(card.value.helper.variables.count, 1); assert.equal(card.value.helper.variables.valuesIncluded, false);
    assert.equal(card.value.embeddedBook.status, 'available'); assert.equal(card.value.embeddedBook.items[0].contentChars, 9);
    assert.doesNotMatch(card.raw, /REGEX_BODY|SCRIPT_BODY|INFO_BODY|BOOK_BODY|BOOK_DESCRIPTION|PRIVATE_|private-avatar|CACHE_BODY/);
    assert.equal(card.result.readHint.parentRead.revision, root.result.revision); assert.equal(f.writes(), 0);
});
for (const [type, expected] of [['regex', 'REGEX_BODY'], ['script', 'SCRIPT_BODY'], ['book', 'BOOK_BODY']]) test(type + ' content is saved whitelist only, not raw cache, scripts or other sections', async () => {
    const f = fixture(), root = await f.read(), card = await f.read('card:0', root.revision), body = await content(f, `card:0:${type}:0`, card.revision);
    assert.match(body.raw, new RegExp(expected)); assert.equal(body.result.readHint.kind, 'content');
    assert.equal(body.result.sourceLimited, false); assert.equal(body.result.nextOffset, -1);
    assert.doesNotMatch(body.raw, /PRIVATE_|CACHE_BODY/); assert.equal(f.writes(), 0);
});
test('known helper pair-array and legacy formats are read without migration, merging or invented enabled defaults', async () => {
    const f = fixture(); f.data.extensions.tavern_helper = [['scripts', [{ content: 'PAIR_SCRIPT' }]], ['variables', {}]];
    f.data.extensions.TavernHelper_scripts = [{ content: 'SHADOWED_SCRIPT' }];
    let root = await f.read(), card = await content(f, 'card:0', root.revision);
    assert.equal(card.value.helper.legacyShadowed, true); assert.equal(card.value.helper.items[0].enabled, null);
    assert.match((await content(f, 'card:0:script:0', card.result.revision)).raw, /PAIR_SCRIPT/);
    delete f.data.extensions.tavern_helper;
    f.data.extensions.TavernHelper_scripts = [{ type: 'folder', name: 'Old folder', value: [{ name: 'Old script', content: 'LEGACY_BODY', buttons: [{ name: 'Run', visible: true }] }] }];
    root = await f.read(); card = await content(f, 'card:0', root.revision);
    assert.equal(card.value.helper.format, 'legacy'); assert.deepEqual(card.value.helper.items[1].ancestorEnabled, [null]);
    assert.match((await content(f, 'card:0:script:0', card.result.revision)).raw, /LEGACY_BODY/); assert.equal(f.writes(), 0);
});
test('malformed modern helper does not fallback to legacy; absent, empty, unsupported sections differ', async () => {
    const f = fixture(); f.data.extensions.tavern_helper = [['scripts', []], ['scripts', []]];
    f.data.extensions.TavernHelper_scripts = [{ content: 'DO_NOT_FALLBACK' }]; f.data.extensions.regex_scripts = {};
    f.data.character_book = { entries: [] };
    const root = await f.read(), card = await content(f, 'card:0', root.revision);
    assert.equal(card.value.helper.status, 'unsupported'); assert.equal(card.value.regex.status, 'unsupported');
    assert.equal(card.value.embeddedBook.status, 'available'); assert.deepEqual(card.value.embeddedBook.items, []);
    assert.equal((await f.read('card:0:script:0', card.result.revision)).status, 'SOURCE_UNSUPPORTED');
    delete f.data.character_book; delete f.data.extensions.regex_scripts;
    const next = await content(f, 'card:0', root.revision); assert.equal(next.value.embeddedBook.status, 'absent'); assert.equal(next.value.regex.status, 'absent');
});
test('component pages retain exact versions and Unicode boundaries; saved edits reject old continuations', async () => {
    const f = fixture(); f.module.bindRun('run', 24000); f.data.extensions.regex_scripts[0].replaceString = '🦉'.repeat(2400);
    const root = await f.read(), card = await f.read('card:0', root.revision), first = await f.read('card:0:regex:0', card.revision);
    assert.ok(first.nextOffset > 0); assert.doesNotMatch(first.text.slice(-1), /[\uD800-\uDBFF]/);
    const next = await f.module.handlers['muyu.provider.read']({ id, continuationToken: first.readHint.continuation.token }, { runId: 'run', target });
    assert.equal(next.status, 'ok');
    f.data.extensions.regex_scripts[0].replaceString += '!';
    assert.equal((await f.read('card:0:regex:0', first.revision, first.nextOffset)).status, 'STALE_SOURCE');
    const fresh = await f.read('card:0', root.revision); assert.notEqual(fresh.revision, card.revision);
    assert.equal((await f.read('card:0:regex:0', fresh.revision)).status, 'ok');
});
test('directory and target changes during asynchronous load never return old card content', async () => {
    const f = fixture(), root = await f.read(); f.onLoad(() => f.rows([{ name: 'Other', avatar: 'other.png' }]));
    assert.equal((await f.read('card:0', root.revision)).status, 'STALE_SOURCE');
    f.onLoad(() => f.actual({ kind: 'global', userKey: 'other' }));
    assert.equal((await f.read('card:0', root.revision)).status, 'TARGET_UNAVAILABLE');
});
test('unsupported selectors, oversize structures and missing ports fail closed without execution or writes', async () => {
    const f = fixture(), root = await f.read();
    for (const selector of ['card:0:script:999', 'card:0:execute:0', '../private.png', 'card:01']) assert.equal((await f.read(selector, root.revision)).status, 'INVALID_SELECTOR');
    f.data.extensions.regex_scripts = Array.from({ length: 513 }, () => ({}));
    let card = await content(f, 'card:0', root.revision); assert.equal(card.value.regex.status, 'too-large');
    assert.equal((await f.read('card:0:regex:0', card.result.revision)).status, 'SOURCE_TOO_LARGE');
    f.data.extensions.tavern_helper.scripts = [{ type: 'unknown', content: 'not read' }];
    card = await content(f, 'card:0', root.revision); assert.equal(card.value.helper.status, 'unsupported');
    const absent = createProviderPort({ getContext: () => ({}) }); assert.equal(absent.available(id), false); assert.throws(() => absent.read(id, ''), /SOURCE_UNAVAILABLE/);
    assert.equal(f.writes(), 0);
});
test('byte budget is shared and card-directory pagination never exposes avatar IDs', async () => {
    const f = fixture(); f.rows(Array.from({ length: 41 }, (_, index) => ({ name: 'Card ' + index, avatar: index + '.png' })));
    const root = await content(f, ''); assert.equal(root.value.cards.length, 40); assert.equal(root.value.nextSelector, 'cards:40');
    const more = await content(f, 'cards:40', root.result.revision); assert.equal(more.value.cards[0].selector, 'card:40'); assert.equal(more.value.nextSelector, null);
    f.module.bindRun('limited', 6000); f.module.charge('limited', 5999);
    assert.equal((await f.read('', '', 0, 'limited')).status, 'BUDGET_EXCEEDED'); assert.equal(f.loads(), 0);
});
test('card text grants never authorize components; denial crosses related saved-card routes', () => {
    const p = createPermissions(), chat = { kind: 'chat', userKey: 'u', chatKey: 'A' }, tool = { id: 'muyu.provider.read', effect: 'read' };
    p.grantSource('source:stCharacterCardState', chat);
    assert.equal(assistantToolAccess(tool, { id }, chat, 'task', p).decision, 'permission_required');
    p.decide({ source: 'stCharacterCardState', reason: 'deny card', target: chat, taskId: 'task' }, 'deny', () => {});
    assert.equal(assistantToolAccess(tool, { id }, chat, 'task', p).decision, 'user_denied');
});
test('inherited book options and boolean recursion delay remain readable without inventing defaults', async () => {
    const f = fixture(); f.data.character_book.entries[0].extensions = { case_sensitive: null, scan_depth: null, delay_until_recursion: false };
    const root = await f.read(), card = await f.read('card:0', root.revision), body = await content(f, 'card:0:book:0', card.revision);
    assert.equal(body.value.value.extensions.case_sensitive, null); assert.equal(body.value.value.extensions.delay_until_recursion, false);
    assert.equal(Object.hasOwn(body.value.value.extensions, 'probability'), false);
});
test('old helper tree wrappers inside pair settings are inspected, not silently replaced by an empty script', async () => {
    const f = fixture(); f.data.extensions.tavern_helper = [['scripts', [{ type: 'folder', name: 'Old', value: [{ type: 'script', value: { content: 'WRAPPED_BODY' } }] }]]];
    const root = await f.read(), card = await f.read('card:0', root.revision), body = await content(f, 'card:0:script:0', card.revision);
    assert.match(body.raw, /WRAPPED_BODY/); assert.equal(f.writes(), 0);
});
test('deep helper trees are explicitly too large; cancelling the module discards an in-flight card result', async () => {
    const f = fixture(); let tree = { type: 'script', content: 'DEEP_BODY' };
    for (let i = 0; i < 10; i++) tree = { type: 'folder', scripts: [tree] };
    f.data.extensions.tavern_helper.scripts = [tree];
    const root = await f.read(), card = await content(f, 'card:0', root.revision);
    assert.equal(card.value.helper.status, 'too-large');
    assert.equal((await f.read('card:0:script:0', card.result.revision)).status, 'SOURCE_TOO_LARGE');
    f.onLoad(() => f.module.dispose());
    const cancelled = await f.read('card:0', root.revision); assert.equal(cancelled.status, 'TARGET_UNAVAILABLE'); assert.equal(cancelled.text, '');
});
for (const decision of ['task', 'deny']) test('controller component consent ' + decision + ' resumes without extra approval or code execution', async () => {
    const f = fixture(), ctx = { groupId: 'g', chatId: 'A', chatMetadata: {}, eventSource: new EventEmitter(), eventTypes: { CHAT_CHANGED: 'changed' } }, settings = {};
    const tool = (args, callId) => ({ type: 'tool_call_complete', call: { toolId: 'muyu.provider.read', version: 2, args: { id, ...args }, callId } });
    let model;
    const result = callId => model.requests.flatMap(r => r.messages).filter(m => m.role === 'tool' && m.callId === callId).at(-1)?.result;
    model = scriptedModel([[tool({}, 'root'), done], () => decision === 'deny' ? [text('Stopped'), done] : [tool({ selector: 'card:0', revision: result('root').data.revision, offset: 0 }, 'card'), done],
        () => [tool({ selector: 'card:0:script:0', revision: result('card').data.revision, offset: 0 }, 'script'), done], [text('Read saved script only'), done]]);
    const host = createHostBridge({ getContext: () => ctx, getSettings: () => settings, extensionKey: 'gd', providerPort: f.port, permissionConfig: { read: () => ({ readAccess: 'ask' }) } });
    const controller = createMuyuController({ host, createModel: () => model });
    await controller.configure({ endpoint: 'https://fixture.invalid/chat/completions', apiKey: 'TEST', model: 'synthetic' }); controller.setInput('Inspect card rendering; do not run or modify anything'); await controller.send();
    for (let i = 0; i < 20; i++) await flush();
    const pending = controller.snapshot().interaction; assert.equal(pending?.source, id); assert.equal(f.loads(), 0);
    controller.answerPermission(pending.id, decision); for (let i = 0; i < 30; i++) await flush();
    assert.equal(controller.snapshot().runs.at(-1).status, 'succeeded');
    if (decision === 'task') { assert.match(result('script').data.text, /SCRIPT_BODY/); assert.ok(JSON.parse(controller.exportHistory()).required.includes('source:' + id)); }
    else assert.equal(f.loads(), 0);
    assert.doesNotMatch(JSON.stringify(model.requests), /PRIVATE_|CACHE_BODY/); assert.equal(f.writes(), 0); await controller.dispose();
});

test('component metadata does not claim global runtime coverage and body scope survives long first pages', async () => {
    const f = fixture(), root = await f.read();
    const card = await content(f, 'card:0', root.revision);
    assert.equal(card.value.evidence.scope, 'saved-card');
    assert.equal(card.value.evidence.bodyCoverage, 'component-metadata-only');
    assert.ok(card.value.evidence.notObserved.includes('current-variable-values'));
    assert.ok(card.value.evidence.notObserved.includes('global-or-preset-regex'));
    f.data.extensions.regex_scripts[0].replaceString = 'LONG_REPLACEMENT'.repeat(500);
    const fresh = await f.read('', '', 0, 'fresh');
    const directory = await f.read('card:0', fresh.revision, 0, 'fresh');
    const page = await f.read('card:0:regex:0', directory.revision, 0, 'fresh');
    assert.equal(page.status, 'ok'); assert.ok(page.nextOffset > 0);
    assert.match(page.text, /"bodyCoverage":"selected-component-only"/);
    assert.match(page.text, /"notObserved":/);
    assert.doesNotMatch(page.text, /PRIVATE_/);
    assert.equal(f.writes(), 0);
});
