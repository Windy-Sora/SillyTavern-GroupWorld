import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createStDiagnostics } from '../../muyu/host/st-diagnostics.js';
import { createProviderPort } from '../../muyu/host/providers.js';
import { createProviderModule } from '../../muyu/modules/providers/index.js';
import { createPermissions } from '../../muyu/application/permissions.js';
import { assistantToolAccess } from '../../muyu/application/capabilities.js';
import { createStDiagnosticsView } from '../../muyu/ui/st-diagnostics-view.js';
import { createHostModelConnection } from '../../muyu/host/model-connection.js';

function fixture() {
    let time = 1000, target = { kind: 'chat', userKey: 'u', chatKey: 'PRIVATE_CHAT' }, fail = false;
    const settings = {}, eventSource = new EventEmitter(), browser = new EventEmitter();
    browser.addEventListener = browser.on.bind(browser); browser.removeEventListener = browser.removeListener.bind(browser);
    const eventTypes = Object.fromEntries(['GENERATION_STARTED', 'GENERATION_STOPPED', 'GENERATION_ENDED', 'MAIN_API_CHANGED', 'CHATCOMPLETION_SOURCE_CHANGED', 'CHATCOMPLETION_MODEL_CHANGED', 'OAI_PRESET_CHANGED_AFTER'].map(s => [s, s]));
    const ctx = { eventSource, eventTypes };
    const service = createStDiagnostics({ getContext: () => ctx, getTarget: () => target, getSettings: () => settings,
        saveSettings: async () => { if (fail) { settings.unrelated = 'kept'; throw Error('PRIVATE_KEY'); } }, browser, now: () => time });
    const port = createProviderPort({ getContext: () => ctx, stDiagnostics: service });
    const module = createProviderModule({ providerPort: port, currentTarget: () => target });
    const read = (selector = '', revision = '', offset = 0) => module.handlers['muyu.provider.read']({ id: 'stDiagnostics', selector, revision, offset }, { runId: 'r', target });
    return { service, module, port, read, settings, eventSource, browser, target: () => target, switch: () => { target = { ...target, chatKey: 'OTHER_PRIVATE_CHAT' }; },
        restore: () => { target = { ...target, chatKey: 'PRIVATE_CHAT' }; }, advance: ms => { time += ms; }, fail: () => { fail = true; }, close: () => { service.dispose(); module.dispose(); } };
}
test('Diagnostics default off; collection controls persist but records never do', async () => {
    const f = fixture(); assert.equal(f.read().status, 'SOURCE_DISABLED');
    f.eventSource.emit('GENERATION_STARTED', 'PRIVATE_PROMPT'); assert.equal(f.service.snapshot().records.length, 0);
    await f.service.save({ enabled: true, browserErrors: false }); f.eventSource.emit('GENERATION_ENDED', 'PRIVATE_BODY');
    assert.equal(f.service.snapshot().records[0].kind, 'generation_ended'); assert.match(f.service.snapshot().notice, /不证明成功/);
    assert.doesNotMatch(JSON.stringify(f.settings), /generation_ended|PRIVATE_/); f.close();
});
test('Names and broad diagnostic grants cannot authorize ST diagnostics; exact task grant expires', async () => {
    const f = fixture(), permissions = createPermissions(); await f.service.save({ enabled: true, browserErrors: false });
    permissions.grant('diagnostics', f.target());
    const access = () => assistantToolAccess({ id: 'muyu.provider.read', effect: 'read' }, { id: 'stDiagnostics' }, f.target(), 't', permissions, f.port);
    assert.deepEqual(access().missingSources, ['source:stDiagnostics']);
    permissions.decide({ source: 'stDiagnostics', reason: 'inspect', taskId: 't', target: f.target() }, 'task', () => {});
    assert.equal(access().decision, true); permissions.forgetTask(f.target(), 't'); assert.deepEqual(access().missingSources, ['source:stDiagnostics']); f.close();
});
test('Closed model and HTTP error categories exclude secrets, URL, stack, cause and arbitrary tags', async () => {
    const f = fixture(); await f.service.save({ enabled: true, browserErrors: true });
    for (const [status, code] of [[401, 'MODEL_AUTH_ERROR'], [403, 'MODEL_AUTH_ERROR'], [429, 'MODEL_RATE_LIMIT'], [503, 'MODEL_SERVICE_ERROR'], [400, 'MODEL_HTTP_ERROR']]) {
        f.service.recordHostFailure({ status, message: 'PRIVATE_KEY', body: 'PRIVATE_BODY', stack: 'PRIVATE_STACK' }, null);
        assert.equal(f.service.snapshot().records.at(-1).code, code);
    }
    f.service.recordHostFailure({ code: 'MODEL_NETWORK_ERROR' }, null);
    f.service.recordHostFailure({}, { aborted: true, reason: 'TIMEOUT' });
    f.service.recordHostFailure({}, { aborted: true, reason: 'PRIVATE_REASON' });
    f.service.recordModelFailure({ error: 'PRIVATE_KEY', diagnosticStage: 'PRIVATE_URL', attemptId: 999, cause: 'PRIVATE_BODY' });
    f.browser.emit('error', { message: 'PRIVATE_KEY' }); f.browser.emit('unhandledrejection', { reason: 'PRIVATE_BODY' });
    const text = JSON.stringify(f.service.snapshot()); assert.doesNotMatch(text, /PRIVATE_|cause|stack|message|reason/);
    assert.match(text, /MODEL_NETWORK_ERROR/); assert.match(text, /TIMEOUT/); assert.match(text, /CANCELLED/); f.close();
});
test('Browser capture is opt-in; no preventDefault, console or fetch replacement', async () => {
    const f = fixture(); assert.equal(f.browser.listenerCount('error'), 0);
    await f.service.save({ enabled: true, browserErrors: false }); assert.equal(f.browser.listenerCount('error'), 0);
    await f.service.save({ enabled: true, browserErrors: true }); assert.equal(f.browser.listenerCount('error'), 1);
    await f.service.save({ enabled: true, browserErrors: true }); assert.equal(f.browser.listenerCount('error'), 1);
    f.browser.emit('error', { preventDefault() { throw Error('must not suppress'); } });
    await f.service.save({ enabled: false, browserErrors: true }); assert.equal(f.browser.listenerCount('error'), 0);
    assert.equal(f.service.snapshot().records.length, 0); f.close(); assert.equal(f.eventSource.listenerCount('GENERATION_STARTED'), 0);
});
test('Ring capacity, retention, clear and disposal bound memory and invalidate old evidence', async () => {
    const f = fixture(); await f.service.save({ enabled: true, browserErrors: false });
    for (let i = 0; i < 205; i++) f.eventSource.emit('GENERATION_STARTED');
    assert.equal(f.service.snapshot().records.length, 200); assert.equal(f.service.snapshot().dropped, 5);
    const root = f.read(); f.service.clear(); assert.equal(f.read('event:6', root.revision).status, 'INVALID_SELECTOR');
    f.eventSource.emit('GENERATION_STARTED'); f.advance(1800000); assert.equal(f.service.snapshot().records.length, 0);
    f.close(); f.close(); f.eventSource.emit('GENERATION_STARTED'); assert.throws(() => f.service.read(''), /SOURCE_DISABLED/);
});
test('Chat isolation preserves old request origin, excludes another chat and labels unattributed browser events', async () => {
    const f = fixture(); await f.service.save({ enabled: true, browserErrors: true });
    const origin = f.service.captureTarget(); f.eventSource.emit('GENERATION_STARTED'); f.switch();
    f.service.recordModelFailure({ error: 'TIMEOUT' }, origin);
    assert.equal(f.service.snapshot().records.length, 0);
    f.eventSource.emit('GENERATION_ENDED'); f.browser.emit('error');
    const state = f.service.snapshot(); assert.equal(state.records.length, 2);
    assert.deepEqual(state.records.map(r => r.scope), ['observed-current-chat', 'page-unattributed']);
    assert.doesNotMatch(JSON.stringify(state), /PRIVATE_CHAT/); f.close();
});
test('Provider reads require directory revision; pages account for budget and do not create log events', async () => {
    const f = fixture(); await f.service.save({ enabled: true, browserErrors: false });
    f.service.recordModelFailure({ error: 'MODEL_AUTH_ERROR', diagnosticStage: 'transport', attemptId: 1 });
    assert.equal(f.read('event:1').status, 'STALE_SOURCE'); const root = f.read();
    assert.equal(root.readHint.kind, 'directory');
    const row = f.read('event:1', root.revision); assert.equal(row.status, 'ok'); assert.match(row.text, /MODEL_AUTH_ERROR/);
    assert.ok(f.module.usage('r').used > 0); assert.equal(f.service.snapshot().records.length, 1);
    const range = f.read('range:0:20', root.revision); assert.equal(range.status, 'ok');
    f.eventSource.emit('GENERATION_ENDED'); assert.equal(f.read('event:1', row.revision).status, 'STALE_SOURCE'); f.close();
});
test('Official host request failure is recorded without changing error contract or old-chat ownership', async () => {
    const f = fixture(); await f.service.save({ enabled: true, browserErrors: false });
    const ctx = { mainApi: 'openai', chatCompletionSettings: { chat_completion_source: 'deepseek', reverse_proxy: '' },
        getChatCompletionModel: () => 'deepseek-chat', ChatCompletionService: { async sendRequest() { f.switch(); throw Object.assign(Error('PRIVATE_KEY'), { status: 401 }); } } };
    const port = createHostModelConnection({ getContext: () => ctx, stDiagnostics: f.service });
    const model = port.bind().model;
    await assert.rejects(async () => { for await (const event of model.run({ messages: [{ role: 'user', content: 'PRIVATE_INPUT' }], tools: [] }, { signal: new AbortController().signal, context: {} })) void event; }, /HOST_MODEL_REQUEST_FAILED/);
    assert.equal(f.service.snapshot().records.length, 0); f.restore();
    assert.equal(f.service.snapshot().records[0].code, 'MODEL_AUTH_ERROR');
    assert.doesNotMatch(JSON.stringify(f.service.snapshot()), /PRIVATE_KEY|PRIVATE_INPUT/); f.close();
});
test('Diagnostic directory pagination obeys shared read budget and cannot be bypassed by smaller selectors', async () => {
    const f = fixture(); await f.service.save({ enabled: true, browserErrors: false });
    for (let i = 0; i < 100; i++) f.eventSource.emit('GENERATION_STARTED');
    f.module.bindRun('r', 6000); let page = f.read(); assert.equal(page.status, 'ok');
    while (page.status === 'ok' && page.nextOffset >= 0) page = f.read('', page.revision, page.nextOffset);
    assert.equal(page.status, 'BUDGET_EXCEEDED'); assert.equal(f.read('event:1', page.revision).status, 'BUDGET_EXCEEDED'); f.close();
});
test('Failed configuration persistence does not change capture or discard existing records', async () => {
    const f = fixture(); await f.service.save({ enabled: true, browserErrors: false }); f.eventSource.emit('GENERATION_STARTED'); f.fail();
    await assert.rejects(f.service.save({ enabled: false, browserErrors: true }), /DIAGNOSTICS_CONFIG_SAVE_FAILED/);
    assert.equal(f.service.snapshot().config.enabled, true); assert.equal(f.service.snapshot().records.length, 1); assert.equal(f.settings.unrelated, 'kept');
    await assert.rejects(f.service.save({ enabled: true, browserErrors: false, apiKey: 'PRIVATE_KEY' }), /DIAGNOSTICS_CONFIG_INVALID/); f.close();
});
test('Local GUI view uses text, save and clear do not invoke model reads', async () => {
    const f = fixture(); const doc = { createElement: tag => ({ tag, style: {}, children: [], append(...items) { this.children.push(...items); } }) };
    const settings = doc.createElement('section'); let state = f.service.snapshot();
    const view = createStDiagnosticsView({ doc, settings, lang: 'zh', act: fn => fn(), controller: {
        diagnosticsSnapshot: () => f.service.snapshot(), saveDiagnosticsConfig: value => f.service.save(value), clearDiagnostics: () => f.service.clear(),
    } }); view.render({ diagnostics: state });
    const all = node => [node, ...node.children.flatMap(all)], nodes = all(settings);
    nodes.find(n => n.tag === 'input').checked = true; nodes.find(n => n.tag === 'input').onchange();
    await nodes.find(n => n.textContent === '保存诊断设置').onclick();
    f.eventSource.emit('GENERATION_STARTED'); await nodes.find(n => n.textContent === '查看本地记录').onclick();
    assert.match(nodes.find(n => n.tag === 'pre').textContent, /generation_started/);
    await nodes.find(n => n.textContent === '清空本地记录').onclick(); assert.equal(f.service.snapshot().records.length, 0); f.close();
});
