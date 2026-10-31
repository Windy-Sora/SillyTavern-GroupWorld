import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSelfConfig, SELF_SECTIONS } from '../../muyu/self/config.js';
import { createSelfModule } from '../../muyu/modules/self/index.js';
import { createSkillPort } from '../../muyu/host/skills.js';
import { createSessionLibrary } from '../../muyu/sessions/library.js';
import { RUN_DEFAULTS } from '../../muyu/core/budget.js';
import { CONTEXT_DEFAULTS } from '../../muyu/context/policy.js';
import { validateJson } from '../../muyu/core/json-contract.js';

const field = (body, key) => body.sections.flatMap(section => section.fields).find(row => row.key === key);
test('routing distinguishes requested read source, live reader and independent writers without exposing paths', () => {
    const body = projectSelfConfig('storage', { configured: { storage: { autoSave: true, choice: 'auto', readSource: 'world-book', writeTargets: ['server', 'browser'], worldBookTargetMiB: 16, path: 'PRIVATE_PATH' } },
        effective: { storage: { enabled: false, readSource: 'account-settings', writeTargets: [], backend: 'account-settings', hasError: true, pending: 1, loading: false, rawError: 'PRIVATE_ERROR' } } });
    assert.equal(field(body, 'historyAutoSave').configured.text, '开启 / On'); assert.equal(field(body, 'historyAutoSave').effective.text, '关闭 / Off');
    assert.equal(field(body, 'historyReadSource').configured.text, '世界书 / World book'); assert.equal(field(body, 'historyReadSource').effective.text, '酒馆插件设置 / Extension settings');
    assert.match(field(body, 'historyWriteTargets').effective.text, /No write targets/); assert.equal(field(body, 'historyHasError').effective.text, '开启 / On');
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE_/);
});
for (const value of [null, ['PRIVATE_PATH'], [null], ['server', 'browser', 'world-book', 'account-settings', 'server']]) test('invalid routing is unknown and never echoed: ' + JSON.stringify(value), () => {
    const body = projectSelfConfig('storage', { configured: { storage: { readSource: 'PRIVATE_PATH', writeTargets: value } } });
    assert.equal(field(body, 'historyReadSource').configured.state, 'unknown'); assert.equal(field(body, 'historyWriteTargets').configured.state, 'unknown'); assert.doesNotMatch(JSON.stringify(body), /PRIVATE_/);
});
test('switches, cached detection and execution admission remain separate facts', () => {
    const body = projectSelfConfig('tools', { configured: { tools: { documents: true, pages: false, serviceStatus: 'available', skills: true, webLimits: { maxSearches: 3, maxResults: 5, resultBytes: 12000 } } },
        effective: { tools: { documents: false, pages: true, skillsLoaded: false, webLimits: { maxSearches: 1, maxResults: 2, resultBytes: 2000 } } } });
    assert.equal(field(body, 'documents').effective.text, '关闭 / Off'); assert.match(field(body, 'serviceStatus').configured.text, /Previously/);
    assert.equal(field(body, 'maxResults').configured.text, '5'); assert.equal(field(body, 'maxResults').effective.text, '2');
    assert.equal(field(body, 'skillsLoaded').effective.text, '关闭 / Off');
    const unknown = projectSelfConfig('tools', { configured: { tools: { serviceStatus: 'PRIVATE_REMOTE_STATUS', documents: 'PRIVATE_ON' } } });
    assert.equal(field(unknown, 'serviceStatus').configured.state, 'unknown'); assert.equal(field(unknown, 'documents').configured.state, 'unknown'); assert.doesNotMatch(JSON.stringify(unknown), /PRIVATE_/);
});
test('overview stays bounded and every operational section fits the tool and JSON envelope', () => {
    const data = { configured: { run: RUN_DEFAULTS, context: CONTEXT_DEFAULTS, permission: { readAccess: 'all' }, fullAccess: true,
        behavior: { enabled: true, length: 4000, languageEnabled: true, language: 'English' }, display: { processDetail: 'verbose', theme: 'dusk' },
        connection: { source: 'independent', profile: 'deepseek', thinking: true, remembered: true, autoConnect: true },
        storage: { autoSave: true, choice: 'auto', readSource: 'world-book', writeTargets: ['server', 'browser', 'world-book', 'account-settings'], worldBookTargetMiB: 16 },
        tools: { webSearch: true, documents: true, pages: true, workspace: true, json: true, serviceStatus: 'available', memory: true, skills: true, diagnostics: true, browserErrors: true, promptCapture: true,
            webLimits: { maxSearches: 8, maxResults: 10, resultBytes: 24000 } } },
        effective: { run: RUN_DEFAULTS, context: CONTEXT_DEFAULTS, storage: { enabled: true, backend: 'private-files', readSource: 'server', writeTargets: ['server', 'browser', 'world-book', 'account-settings'], loading: false, pending: 0, hasError: false },
            tools: { webSearch: true, documents: true, pages: true, workspace: true, json: true, skillsLoaded: true, webLimits: { maxSearches: 8, maxResults: 10, resultBytes: 24000 } } } };
    const module = createSelfModule({ read: () => data, charge: () => true }); module.bindRun({ id: 'r', taskId: 't', target: { kind: 'global', userKey: 'u' } });
    for (const section of SELF_SECTIONS) {
        const result = module.handlers['muyu.self.read']({ section }, { runId: 'r', target: { kind: 'global', userKey: 'u' }, signal: new AbortController().signal });
        assert.equal(result.status, 'ok', section); validateJson(module.registry.get('muyu.self.read').outputSchema, result);
    }
    const overview = projectSelfConfig('overview', data); assert.equal(overview.coverage.overviewIsSummary, true);
    assert.equal(field(overview, 'worldBookTargetMiB'), undefined); assert.ok(field(projectSelfConfig('storage', data), 'worldBookTargetMiB'));
});
test('connection metadata never traverses raw text, secrets or extension fields', () => {
    const connection = { source: 'st', profile: 'deepseek', thinking: false, remembered: false, autoConnect: true };
    for (const key of ['apiKey', 'endpoint', 'model', 'headers', 'draft']) Object.defineProperty(connection, key, { get() { throw Error('PRIVATE_GETTER'); } });
    const body = projectSelfConfig('connection', { configured: { connection } });
    assert.equal(field(body, 'connectionSource').configured.text, '酒馆当前连接 / Current ST connection'); assert.doesNotMatch(JSON.stringify(body), /PRIVATE_|"apiKey"|"endpoint"/);
});
test('Skill configuration metadata does not load builtins, inspect packages or save', () => {
    let loads = 0, saves = 0; const settings = {};
    const port = createSkillPort({ getSettings: () => settings, saveSettings: () => { saves++; }, loadBuiltins: () => { loads++; throw Error('DO_NOT_LOAD'); } });
    assert.deepEqual(port.selfState(), { enabled: true, loaded: false });
    settings.muyuSkillData = { version: 2, enabled: false, get skills() { throw Error('PRIVATE_PACKAGES'); } };
    assert.deepEqual(port.selfState(), { enabled: false, loaded: false });
    settings.muyuSkillData = { version: 99, enabled: true }; assert.equal(port.selfState().enabled, undefined);
    assert.deepEqual([loads, saves], [0, 0]); port.close(); assert.throws(() => port.selfState(), /SKILL_STORE_UNAVAILABLE/);
});
test('history metadata reads do not enable persistence or open a store', async () => {
    let opens = 0, setting = false; const library = createSessionLibrary({ port: { enabled: () => setting, open: () => { opens++; throw Error('DO_NOT_OPEN'); } } });
    await library.ready; assert.equal(library.selfState('missing').enabled, false); assert.equal(library.selfState('missing').readSource, undefined);
    setting = true; assert.equal(library.selfState('missing').enabled, false); assert.equal(opens, 0); await library.close();
});
