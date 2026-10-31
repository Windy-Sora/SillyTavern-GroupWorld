import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSelfConfig, SELF_SECTIONS } from '../../muyu/self/config.js';
import { createSelfModule } from '../../muyu/modules/self/index.js';
import { createBuiltins } from '../../muyu/modules/builtins.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createPermissions } from '../../muyu/application/permissions.js';
import { assistantToolAccess, requiredSources } from '../../muyu/application/capabilities.js';
import { readSourceAllowed } from '../../muyu/permissions/read-policy.js';
import { permissionSource } from '../../muyu/permissions/contract.js';
import { createToolBroker } from '../../muyu/tools/broker.js';
import { validateJson } from '../../muyu/core/json-contract.js';
import { configFields, previewSettings } from '../../muyu/config/registry.js';
import { RUN_DEFAULTS } from '../../muyu/core/budget.js';
import { CONTEXT_DEFAULTS } from '../../muyu/context/policy.js';
import { identity } from './helpers/muyu-subject.mjs';

const ctx = (runId = identity.id, target = identity.target) => ({ runId, target, signal: new AbortController().signal });
const state = () => ({ configured: { run: { ...RUN_DEFAULTS }, context: { ...CONTEXT_DEFAULTS }, permission: { readAccess: 'ask' }, fullAccess: false,
    behavior: { enabled: false, length: 20, languageEnabled: true, language: 'Japanese' }, display: { processDetail: 'verbose', theme: 'dusk' } },
    effective: { run: { ...RUN_DEFAULTS, maxTokens: 1024 }, context: { ...CONTEXT_DEFAULTS, inputTokens: 50000 }, behavior: { injected: true, length: 10, languageEnabled: false } } });
const find = (body, key) => body.sections.flatMap(section => section.fields).find(row => row.key === key);
function fixture(options = {}) {
    const charges = [], calls = [];
    const module = createSelfModule({ read: c => { calls.push(c); return state(); }, charge: (id, bytes) => { charges.push([id, bytes]); return true; }, now: () => 0, ...options });
    module.bindRun(identity);
    return { module, charges, calls, call: args => module.handlers['muyu.self.read'](args, ctx()) };
}

for (const section of SELF_SECTIONS) test('self projection returns only the selected fixed sections: ' + section, () => {
    const value = projectSelfConfig(section, state());
    assert.equal(value.readOnly, true);
    assert.deepEqual(value.sections.map(row => row.id), section === 'overview' ? SELF_SECTIONS.slice(1) : [section]);
    for (const row of value.sections.flatMap(row => row.fields)) { assert.ok(row.label.zh && row.label.en); assert.ok(['known', 'unknown', 'not_applicable'].includes(row.configured.state)); }
    assert.ok(value.coverage.notIncluded.includes('unsaved-drafts'));
});
test('configured, effective and live policy have distinct footing, including request-body-only mode', () => {
    const input = state(); input.configured.context.inputTokens = null;
    const value = projectSelfConfig('overview', input);
    assert.equal(find(value, 'maxTokens').configured.text, '32768'); assert.equal(find(value, 'maxTokens').effective.text, '1024');
    assert.match(find(value, 'inputTokens').configured.text, /no estimated-token cap/); assert.equal(find(value, 'inputTokens').effective.text, '50000');
    assert.equal(find(value, 'theme').effective.state, 'not_applicable');
    assert.match(find(value, 'readAccess').note, /Live policy/);
});
test('unknown, malformed and oversized scalar values stay unknown rather than borrowing defaults', () => {
    const input = state(); input.configured.run.maxTokens = 'SECRET'; input.configured.run.timeMs = Infinity;
    input.effective.context.summaryTokens = 0; delete input.configured.context.inputTokens;
    const value = projectSelfConfig('overview', input);
    assert.equal(find(value, 'maxTokens').configured.state, 'unknown'); assert.equal(find(value, 'timeMs').configured.state, 'unknown');
    assert.equal(find(value, 'summaryTokens').effective.state, 'unknown'); assert.equal(find(value, 'inputTokens').configured.state, 'unknown');
    assert.doesNotMatch(JSON.stringify(value), /SECRET|Infinity/);
});
test('projection never serializes added secrets, raw free text, instructions, drafts or resource bodies', () => {
    const input = state(); input.configured.apiKey = 'SECRET_KEY'; input.configured.run.extra = 'SECRET_EXTRA';
    input.configured.behavior.text = 'SECRET_PROMPT'; input.configured.behavior.draft = 'SECRET_DRAFT'; input.configured.behavior.language = 'SECRET_LANGUAGE';
    input.configured.context.messages = ['SECRET_MESSAGE']; input.configured.display.theme = 'SECRET_THEME';
    input.configured.credentials = { endpoint: 'https://user:SECRET_PASSWORD@example.test/?token=SECRET_TOKEN', headers: { Authorization: 'SECRET_AUTH' } };
    input.configured.notes = ['SECRET_NOTE']; input.configured.skills = ['SECRET_SKILL']; input.effective.thinking = 'SECRET_THINKING';
    const before = structuredClone(input), value = projectSelfConfig('overview', input);
    assert.doesNotMatch(JSON.stringify(value), /SECRET_|"Authorization"|example\.test/); assert.deepEqual(input, before);
    assert.match(find(value, 'replyLanguage').configured.text, /Custom language/);
});
test('all display choices use GUI labels and do not leak arbitrary strings', () => {
    for (const [processDetail, expected] of [['compact', 'Compact'], ['standard', 'Standard'], ['detailed', 'Detailed'], ['verbose', 'Full']]) {
        const input = state(); input.configured.display.processDetail = processDetail;
        assert.match(find(projectSelfConfig('display', input), 'processDetail').configured.text, new RegExp(expected));
    }
});
test('self tool charges the whole UTF-8 result once and returns no candidate or writer', () => {
    const f = fixture(), result = f.call({});
    validateJson(f.module.registry.get('muyu.self.read').outputSchema, result);
    assert.equal(result.status, 'ok'); assert.deepEqual(f.charges, [[identity.id, Buffer.byteLength(JSON.stringify(result))]]);
    assert.equal(JSON.parse(result.text).readAt, '1970-01-01T00:00:00.000Z');
    assert.deepEqual(f.module.registry.list().map(d => [d.id, d.effect]), [['muyu.self.read', 'read']]);
    assert.equal(result.candidateId, undefined); f.module.dispose();
});
test('exhausted shared budget returns no data or partial result', () => {
    const f = fixture({ charge: () => false }); assert.deepEqual(f.call({ section: 'run' }), { status: 'budget_exceeded', text: '' }); f.module.dispose();
});
test('unbound, changed-target, disposed and cancelled reads never enter the trusted reader', () => {
    const f = fixture(), call = f.module.handlers['muyu.self.read'];
    assert.equal(call({}, ctx('missing')).status, 'unavailable');
    assert.equal(call({}, ctx(identity.id, { ...identity.target, chatKey: 'B' })).status, 'unavailable');
    const signal = new AbortController(); signal.abort(); assert.throws(() => call({}, { ...ctx(), signal: signal.signal }), /CANCELLED/);
    f.module.dispose(); assert.equal(f.call({}).status, 'unavailable'); assert.equal(f.calls.length, 0);
});
test('reader failures never expose raw causes and are not replaced by guessed state', () => {
    const f = fixture({ read: () => { throw Error('SECRET_READER_ERROR'); } });
    assert.deepEqual(f.call({}), { status: 'unavailable', text: '' }); f.module.dispose();
});
test('run transfer enforces identity and capacity without overwriting or rebinding disposed modules', () => {
    const f = fixture();
    assert.throws(() => f.module.bindRun(identity), /RUN_CAPACITY/);
    f.module.bindRun({ ...identity, id: 'occupied' });
    for (const next of [{ ...identity, id: 'occupied' }, { ...identity, id: 'next', taskId: 'wrong' }, { ...identity, id: 'next', target: { ...identity.target, chatKey: 'B' } }]) assert.throws(() => f.module.transferRun(identity.id, next), /RUN_NOT_BOUND/);
    const target = { ...identity.target }; f.module.transferRun(identity.id, { ...identity, id: 'next', target }); target.chatKey = 'B';
    assert.equal(f.module.handlers['muyu.self.read']({}, ctx('next')).status, 'ok'); assert.equal(f.call({}).status, 'unavailable');
    for (let i = 0; i < 126; i++) f.module.bindRun({ ...identity, id: 'extra' + i });
    assert.throws(() => f.module.bindRun({ ...identity, id: 'overflow' }), /RUN_CAPACITY/);
    f.module.forgetRun('occupied'); f.module.bindRun({ ...identity, id: 'freed' }); f.module.dispose();
    assert.throws(() => f.module.bindRun(identity), /RUN_CAPACITY/);
});
test('self configuration is a global read source, not a business write field', () => {
    assert.equal(permissionSource('muyuSelfConfig').scope, 'global'); assert.equal(readSourceAllowed('source:muyuSelfConfig'), true);
    assert.deepEqual(requiredSources('muyu.self.read', {}), ['source:muyuSelfConfig']);
    assert.equal(configFields.some(field => field.startsWith('muyu')), false);
    assert.throws(() => previewSettings({ baseline: {}, changes: { muyuRunConfig: { ...RUN_DEFAULTS } } }));
});
for (const mode of ['ask', 'all', 'full', 'denied']) test('self reads follow existing permission policy: ' + mode, () => {
    const permissions = createPermissions({ readAccess: () => mode === 'all' || mode === 'denied', fullAccess: () => mode === 'full' });
    if (mode === 'denied') permissions.decide({ source: 'muyuSelfConfig', reason: 'test', target: identity.target, taskId: identity.taskId }, 'deny', () => {});
    const f = fixture(), definition = f.module.registry.get('muyu.self.read');
    const access = assistantToolAccess(definition, {}, identity.target, identity.taskId, permissions);
    assert.equal(access.decision, mode === 'ask' ? 'permission_required' : mode === 'denied' ? 'user_denied' : true);
    if (mode === 'ask') { permissions.grantSource('source:muyuSelfConfig', identity.target); assert.equal(assistantToolAccess(definition, {}, identity.target, identity.taskId, permissions).decision, true); }
    f.module.dispose();
});
test('broker rejects write parameters and protected-section requests before invoking the reader', async () => {
    const f = fixture(), broker = createToolBroker({ registry: f.module.registry, handlers: f.module.handlers, runId: identity.id, target: identity.target,
        allowedTools: ['muyu.self.read'], maxCalls: 8, signal: ctx().signal, policy: () => true });
    for (const [i, args] of [{ apply: true }, { changes: {} }, { section: 'credentials' }, { section: 'rawConnection' }].entries()) {
        const result = await broker.call({ toolId: 'muyu.self.read', version: 1, callId: 'c' + i, args });
        assert.equal(result.ok, false); assert.equal(result.error.code, 'INVALID_ARGUMENT');
    }
    assert.equal(f.calls.length, 0); f.module.dispose();
});
test('module registration is conditional, grouped, shared-budgeted and never produces writable artifacts', () => {
    const host = createHostBridge({ getContext: () => ({}), getSettings: () => ({}), extensionKey: 'gd', pageId: 'test' });
    const absent = createBuiltins(host); assert.equal(absent.registry.get('muyu.self.read'), null); absent.dispose();
    const builtins = createBuiltins({ ...host, readSelfConfig: () => state() });
    builtins.tasks.assistant.bind(identity, {}); builtins.bindBudget(identity.id, 6000);
    const result = builtins.handlers['muyu.self.read']({ section: 'run' }, ctx());
    assert.equal(result.status, 'ok'); assert.ok(builtins.resourceUsage(identity.id).used > 0);
    assert.equal(builtins.toolGroups['muyu.self.read'].id, 'muyu-self'); assert.equal(builtins.candidateTool('muyu.self.read'), false);
    builtins.transferRun(identity.id, { ...identity, id: 'next' }, {}); builtins.bindBudget('next', 6000, identity.id);
    assert.equal(builtins.handlers['muyu.self.read']({ section: 'run' }, ctx('next')).status, 'ok'); builtins.dispose();
});
