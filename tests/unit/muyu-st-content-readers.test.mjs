import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderPort } from '../../muyu/host/providers.js';
import { createProviderModule } from '../../muyu/modules/providers/index.js';
import { readStPersonaContent } from '../../muyu/host/st-persona-content.js';
import { readStPresetFamilies } from '../../muyu/host/st-preset-families.js';
import { createPermissions } from '../../muyu/application/permissions.js';
import { assistantToolAccess } from '../../muyu/application/capabilities.js';
import { validateJson } from '../../muyu/core/json-contract.js';

const kinds = ['kobold', 'novel', 'textgenerationwebui', 'openai', 'context', 'instruct', 'sysprompt', 'reasoning'];
const stored = [
    { temp: 0.3, grammar: 'KOBOLD_BODY' }, { temperature: 0.4, preamble: 'NOVEL_BODY' }, { temp: 0.5, grammar: 'TC_BODY', sampler_order: [1, 0] }, {},
    { story_string: 'CTX_BODY {{char}}', story_string_depth: 2 }, { input_sequence: 'INSTRUCT_BODY', macro: true }, { content: 'SYSTEM_BODY', post_history: 'POST_BODY' }, { prefix: '<reason>', suffix: '</reason>', separator: '\n' },
];
function fixture() {
    const target = { kind: 'global', userKey: 'u' }; let currentTarget = null, selectedPersona = 'one.png', savedCalls = 0, currentCalls = 0, writes = 0;
    const names = kinds.map(() => ['One', 'Two']), selection = kinds.map(() => 'Two');
    const saved = stored.map(value => ({ ...value, apiKey: 'PRIVATE_KEY', endpoint: 'PRIVATE_ENDPOINT', extensions: { payload: 'PRIVATE_EXTENSION' } }));
    const ctx = { mainApi: 'textgenerationwebui', powerUserSettings: {
        personas: { 'one.png': 'First Persona', 'two.png': 'Second Persona' }, persona_descriptions: { 'one.png': { description: 'STORED_PERSONA {{getvar::gold}}', role: 0, position: 4, depth: 2, lorebook: 'Visible lore', connections: ['PRIVATE_CHAT_BINDING'], apiKey: 'PRIVATE_KEY' } },
        persona_description: 'LIVE_PERSONA', persona_description_role: 1, persona_description_position: 0, persona_description_depth: 3,
        context: { ...stored[4], story_string: 'LIVE_CTX' }, instruct: { ...stored[5], input_sequence: 'LIVE_INSTRUCT' }, sysprompt: { ...stored[6], content: 'LIVE_SYSTEM' }, reasoning: { ...stored[7], prefix: 'LIVE_REASONING' },
        secret: 'PRIVATE_POWER_FIELD',
    } };
    const managers = kinds.map((kind, index) => ({ getAllPresets: () => names[index], getSelectedPresetName: () => selection[index],
        getCompletionPresetByName(name) { savedCalls++; assert.ok(names[index].includes(name)); return saved[index]; },
        getPresetSettings() { currentCalls++; return { ...stored[index], temp: 0.9, temperature: 0.9, apiKey: 'PRIVATE_CURRENT_KEY' }; },
        savePreset() { writes++; }, selectPreset() { writes++; }, deletePreset() { writes++; },
    }));
    ctx.getPresetManager = kind => managers[kinds.indexOf(kind)];
    const port = createProviderPort({ getContext: () => ctx, getSettings: () => ({}), extensionKey: 'gd', stDirectories: { getSelectedPersona: () => selectedPersona } });
    const module = createProviderModule({ providerPort: port, globalTarget: target, currentTarget: () => currentTarget });
    const read = (id, selector = '', revision = '', offset = 0, runId = 'run') => module.handlers['muyu.provider.read']({ id, selector, revision, offset }, { runId, target });
    return { ctx, module, port, managers, names, selection, saved, target, read, writes: () => writes, currentCalls: () => currentCalls, savedCalls: () => savedCalls,
        selectPersona(value) { selectedPersona = value; }, switchChat() { currentTarget = { kind: 'chat', userKey: 'u', chatKey: 'B' }; } };
}
function content(f, id, selector, revision) { const r = f.read(id, selector, revision); assert.equal(r.status, 'ok'); assert.equal(r.nextOffset, -1); return { response: r, data: JSON.parse(r.text) }; }

test('Persona body has separate permission; metadata/body denials cross routes but grants do not', () => {
    const f = fixture(), permissions = createPermissions(), chat = { ...f.target, kind: 'chat', chatKey: 'A' };
    permissions.grantSource('source:stPersonas', chat);
    assert.equal(assistantToolAccess({ id: 'muyu.provider.read', effect: 'read' }, { id: 'stPersonaContent' }, chat, 'task', permissions).decision, 'permission_required');
    permissions.decide({ source: 'stPersonas', reason: 'no persona data', target: chat, taskId: 'task' }, 'deny', () => {});
    assert.equal(assistantToolAccess({ id: 'muyu.provider.read', effect: 'read' }, { id: 'stPersonaContent' }, chat, 'task', permissions).decision, 'user_denied');
});

test('Persona directory hides paths/body/connections and distinguishes stored and current descriptions', () => {
    const f = fixture(), root = f.read('stPersonaContent');
    assert.equal(root.readHint.kind, 'directory'); assert.equal(root.readHint.nextRead.selector, 'current');
    assert.doesNotMatch(root.text, /\.png|STORED_PERSONA|LIVE_PERSONA|PRIVATE_/);
    const stored = content(f, 'stPersonaContent', 'persona:0', root.revision).data;
    assert.equal(stored.kind, 'stored-persona'); assert.equal(stored.fields.description.value, 'STORED_PERSONA {{getvar::gold}}');
    assert.equal(stored.fields.depth.value, 2); assert.equal(stored.fields.lorebook.value, 'Visible lore');
    assert.doesNotMatch(JSON.stringify(stored), /PRIVATE_|\.png/); assert.equal(Object.hasOwn(stored.fields, 'connections'), false);
    const current = content(f, 'stPersonaContent', 'current', root.revision), live = current.data;
    assert.equal(live.kind, 'current-memory'); assert.equal(live.fields.description.value, 'LIVE_PERSONA'); assert.equal(live.fields.role.value, 1);
    assert.equal(live.fields.lorebook, undefined); assert.equal(f.writes(), 0);
    const leaf = current.response;
    assert.equal(leaf.sourceLimited, false); assert.equal(leaf.truncated, false); assert.equal(leaf.readHint.pageState, 'last');
    assert.equal(leaf.readHint.parentRead.revision, root.revision);
});

test('missing Persona body stays unavailable instead of empty or silently using a different Persona', () => {
    const f = fixture(), root = f.read('stPersonaContent');
    assert.equal(f.read('stPersonaContent', 'persona:1', root.revision).status, 'SOURCE_UNAVAILABLE');
    delete f.ctx.powerUserSettings.persona_description;
    assert.equal(f.read('stPersonaContent', 'current', root.revision).status, 'SOURCE_UNAVAILABLE');
    assert.throws(() => readStPersonaContent('persona:100', () => f.ctx), /INVALID_SELECTOR/);
    assert.throws(() => readStPersonaContent('raw', () => f.ctx), /INVALID_SELECTOR/);
});

test('checked parent navigation can refresh an existing child at offset zero without splicing old body pages', () => {
    const f = fixture(), id = 'stPresetFamilies'; f.module.bindRun('run', 24000);
    const root = f.read(id), directory = f.read(id, 'mode:4', root.revision), overview = f.read(id, 'mode:4:current', directory.revision);
    const old = f.read(id, 'mode:4:current:field:0', overview.revision); assert.equal(old.status, 'ok');
    assert.equal(f.read(id, 'mode:4:current', directory.revision).revision, overview.revision);
    f.ctx.powerUserSettings.context.story_string = 'new '.repeat(1000);
    const fresh = f.read(id, 'mode:4:current', directory.revision); assert.equal(fresh.status, 'ok'); assert.notEqual(fresh.revision, overview.revision);
    assert.equal(f.read(id, 'mode:4:current:field:0', old.revision).status, 'STALE_SOURCE');
    const page = f.read(id, 'mode:4:current:field:0', fresh.revision); assert.equal(page.status, 'ok'); assert.ok(page.nextOffset > 0);
    assert.equal(f.read(id, 'mode:4:current:field:0', overview.revision, page.nextOffset).status, 'STALE_SOURCE');
});

test('Persona body edits/selection changes invalidate pages; UTF-16 continuation survives run transfer without reauthorization', () => {
    const f = fixture(); f.module.bindRun('run', 24000); f.ctx.powerUserSettings.persona_descriptions['one.png'].description = 'a'.repeat(1999) + '🦉'.repeat(800);
    const root = f.read('stPersonaContent'), first = f.read('stPersonaContent', 'persona:0', root.revision);
    assert.equal(first.readHint.pageState, 'more'); assert.ok(first.nextOffset > 0);
    f.module.transferRun('run', 'next', 24000);
    const next = f.module.handlers['muyu.provider.read']({ id: 'stPersonaContent', continuationToken: first.readHint.continuation.token }, { runId: 'next', target: f.target }); assert.equal(next.status, 'ok');
    f.ctx.powerUserSettings.persona_descriptions['one.png'].description += '!';
    assert.equal(f.read('stPersonaContent', 'persona:0', first.revision, first.nextOffset, 'next').status, 'STALE_SOURCE');
    const fresh = f.read('stPersonaContent', '', '', 0, 'new'); f.selectPersona('two.png');
    assert.equal(f.read('stPersonaContent', 'persona:0', fresh.revision, 0, 'new').status, 'STALE_SOURCE');
});

test('preset-family root is metadata only and never calls exporters, saved readers or OpenAI manager', () => {
    const f = fixture(); f.managers[3] = null;
    const root = f.read('stPresetFamilies'); assert.equal(root.readHint.kind, 'directory');
    assert.doesNotMatch(root.text, /TC_BODY|CTX_BODY|PRIVATE_/); assert.equal(f.savedCalls(), 0); assert.equal(f.currentCalls(), 0);
    assert.match(root.text, /stPresetContent/);
});

for (const index of [0, 1, 2, 4, 5, 6, 7]) test('saved family ' + kinds[index] + ' uses saved getter rather than current export, without writes', () => {
    const f = fixture(), id = 'stPresetFamilies', root = f.read(id);
    const directory = f.read(id, 'mode:' + index, root.revision); assert.equal(directory.status, 'ok');
    const overview = content(f, id, 'mode:' + index + ':saved:0', directory.revision);
    assert.equal(overview.data.kind, 'saved-resource'); assert.equal(overview.data.savedName, 'One');
    assert.equal(f.savedCalls(), 1); assert.equal(f.currentCalls(), 0); assert.equal(overview.response.readHint.kind, 'directory');
    assert.doesNotMatch(overview.response.text, /PRIVATE_|_BODY|<reason>/);
    const field = content(f, id, 'mode:' + index + ':saved:0:field:0', overview.response.revision);
    assert.equal(field.data.text, index === 0 ? 'KOBOLD_BODY' : index === 1 ? 'NOVEL_BODY' : index === 2 ? 'TC_BODY' : index === 4 ? 'CTX_BODY {{char}}' : index === 5 ? 'INSTRUCT_BODY' : index === 6 ? 'SYSTEM_BODY' : '<reason>');
    assert.doesNotMatch(JSON.stringify(field), /PRIVATE_/); assert.equal(f.writes(), 0);
});

test('current family exports are identified as memory and formatting state is never replaced with saved copies', () => {
    const f = fixture();
    const tc = JSON.parse(readStPresetFamilies('mode:2:current', () => f.ctx).text);
    assert.equal(tc.parameters.find(p => p.field === 'temp').value, 0.9); assert.equal(f.currentCalls(), 1); assert.equal(f.savedCalls(), 0);
    assert.equal(JSON.parse(readStPresetFamilies('mode:4:current:field:0', () => f.ctx).text).text, 'LIVE_CTX');
    assert.equal(JSON.parse(readStPresetFamilies('mode:5:current:field:0', () => f.ctx).text).text, 'LIVE_INSTRUCT');
    assert.equal(JSON.parse(readStPresetFamilies('mode:6:current:field:0', () => f.ctx).text).text, 'LIVE_SYSTEM');
    assert.equal(f.currentCalls(), 1);
    const compare = JSON.parse(readStPresetFamilies('mode:6:compare:0', () => f.ctx).text);
    assert.deepEqual(compare.changedBodyFields, ['content']); assert.equal(compare.bodyIncluded, false); assert.doesNotMatch(JSON.stringify(compare), /SYSTEM_BODY|LIVE_SYSTEM/);
});

test('nested family revisions reject preset reorder, body edits and unsafe selectors', () => {
    const f = fixture(), id = 'stPresetFamilies';
    const root = f.read(id), directory = f.read(id, 'mode:2', root.revision), overview = f.read(id, 'mode:2:saved:0', directory.revision);
    assert.equal(f.read(id, 'mode:2:saved:0:field:0', root.revision).status, 'STALE_SOURCE');
    const first = f.read(id, 'mode:2:saved:0:field:0', overview.revision); assert.equal(first.status, 'ok');
    assert.deepEqual(first.readHint.parentRead, { id, selector: 'mode:2:saved:0', revision: overview.revision, offset: 0 });
    assert.equal(first.sourceLimited, false); assert.equal(first.truncated, false);
    f.saved[2].grammar += '!'; assert.equal(f.read(id, 'mode:2:saved:0:field:0', first.revision).status, 'STALE_SOURCE');
    f.names[2].reverse(); assert.equal(f.read(id, 'mode:2:saved:0', directory.revision).status, 'STALE_SOURCE');
    assert.throws(() => readStPresetFamilies('mode:3:current', () => f.ctx), /SOURCE_UNSUPPORTED/);
    assert.throws(() => readStPresetFamilies('mode:2:compare:0:field:0', () => f.ctx), /INVALID_SELECTOR/);
});

test('unsupported/missing host methods are not replaced with current exports or fabricated empty saved data', () => {
    const f = fixture(); delete f.managers[2].getCompletionPresetByName;
    assert.equal(JSON.parse(readStPresetFamilies('mode:2', () => f.ctx).text).savedReadAvailable, false);
    assert.throws(() => readStPresetFamilies('mode:2:saved:0', () => f.ctx), /SOURCE_UNAVAILABLE/); assert.equal(f.currentCalls(), 0);
    f.managers[4].getCompletionPresetByName = () => undefined;
    assert.throws(() => readStPresetFamilies('mode:4:saved:0', () => f.ctx), /SOURCE_UNAVAILABLE/);
    f.ctx.powerUserSettings.context.story_string = 42;
    assert.throws(() => readStPresetFamilies('mode:4:current', () => f.ctx), /SOURCE_UNSUPPORTED/);
});

test('body denial cannot be bypassed through family metadata; OpenAI still requires its original source', () => {
    const f = fixture(), permissions = createPermissions({ readAccess: () => true });
    permissions.decide({ source: 'stPresetFamilies', reason: 'denied', target: f.target, taskId: 'task' }, 'deny', () => {});
    assert.equal(assistantToolAccess({ id: 'muyu.provider.read', effect: 'read' }, { id: 'stPresets' }, f.target, 'task', permissions).decision, 'user_denied');
    permissions.decide({ source: 'stPresetContent', reason: 'no OpenAI', target: f.target, taskId: 'other' }, 'deny', () => {});
    assert.throws(() => readStPresetFamilies('mode:3:saved:0', () => f.ctx), /SOURCE_UNSUPPORTED/);
});

test('new source results validate wire contracts, share byte budgets and reject changed targets', () => {
    const f = fixture(); f.module.bindRun('run', 6000);
    const root = f.read('stPersonaContent');
    validateJson(f.module.registry.get('muyu.provider.read').outputSchema, root);
    assert.equal(f.module.usage('run').used, new TextEncoder().encode(root.text).length);
    assert.equal(f.module.charge('run', 6000 - f.module.usage('run').used), true);
    assert.equal(f.read('stPersonaContent', 'current', root.revision).status, 'BUDGET_EXCEEDED');
    const other = fixture(); const directory = other.read('stPersonaContent');
    other.switchChat(); // A global read remains bound to the original global context; it cannot follow a chat target.
    const value = other.module.handlers['muyu.provider.read']({ id: 'stPersonaContent', selector: 'current', revision: directory.revision, offset: 0 }, { runId: 'run', target: { kind: 'chat', userKey: 'u', chatKey: 'A' } });
    assert.equal(value.status, 'TARGET_UNAVAILABLE');
});

// Coverage is checked against the real projections, including absent versus empty fields.
test('Persona evidence distinguishes absent allowed fields, empty text and runtime/history gaps', () => {
    const f = fixture(), root = f.read('stPersonaContent');
    const live = content(f, 'stPersonaContent', 'current', root.revision).data;
    assert.deepEqual(live.evidence.absentFields, ['lorebook']);
    assert.equal(live.evidence.scope, 'current-memory');
    assert.ok(live.evidence.notObserved.includes('selection-history'));
    f.ctx.powerUserSettings.persona_descriptions['one.png'].description = '';
    const saved = JSON.parse(readStPersonaContent('persona:0', () => f.ctx).text);
    assert.equal(saved.fields.description.value, '');
    assert.equal(saved.evidence.absentFields.includes('description'), false);
    assert.equal(saved.evidence.scope, 'host-loaded-saved-persona');
    assert.equal(f.writes(), 0);
});

test('preset comparison preserves each snapshots field presence without claiming historical edits', () => {
    const f = fixture(); delete f.saved[2].temp;
    const result = JSON.parse(readStPresetFamilies('mode:2:compare:0', () => f.ctx).text);
    assert.equal(result.evidence.scope, 'snapshot-comparison');
    assert.ok(result.evidence.saved.absentFields.includes('temp'));
    assert.equal(result.evidence.current.absentFields.includes('temp'), false);
    assert.equal(result.parameters.find(row => row.field === 'temp').savedPresent, false);
    assert.equal(result.evidence.bodyCoverage, 'changed-field-names-only');
    assert.deepEqual(result.evidence.notObserved, ['final-request', 'execution-history', 'persistence']);
    assert.equal(f.writes(), 0);
});

test('long Persona and preset body first pages retain evidence scope before untrusted text', () => {
    const f = fixture();
    f.ctx.powerUserSettings.persona_description = 'LONG_PERSONA'.repeat(500);
    f.ctx.powerUserSettings.context.story_string = 'LONG_TEMPLATE'.repeat(500);
    for (const [id, selector, scope] of [['stPersonaContent', 'current', 'current-memory'], ['stPresetFamilies', 'mode:4:current:field:0', 'current-memory']]) {
        const root = f.read(id);
        const directory = id === 'stPresetFamilies' ? f.read(id, 'mode:4', root.revision) : root;
        const parent = id === 'stPresetFamilies' ? f.read(id, 'mode:4:current', directory.revision) : root;
        const page = f.read(id, selector, parent.revision);
        assert.equal(page.status, 'ok'); assert.ok(page.nextOffset > 0);
        assert.match(page.text, new RegExp('"scope":"' + scope + '"'));
        assert.match(page.text, /"notObserved":/);
        assert.doesNotMatch(page.text, /PRIVATE_/);
    }
});
