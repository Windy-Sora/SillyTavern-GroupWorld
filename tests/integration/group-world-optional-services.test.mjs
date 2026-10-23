import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createMuyuController } from '../../muyu/application/controller.js';
import { createServicesPort } from '../../muyu/host/services.js';
import { createHistoryPort } from '../../muyu/host/history.js';
import { createMemoryHistoryStore } from '../../muyu/sessions/memory-store.js';
import { DEFAULT_SETTINGS, EXT_KEY } from '../../settings.js';
import { historyScope } from '../../muyu/sessions/contract.js';
import { scriptedModel, done, text } from '../unit/helpers/muyu-subject.mjs';

const json = (body, status = 200) => Response.json(body, { status });
const protocols = { documentSearch: 1, workspaceRead: 1, webFetch: 1, workspaceWrite: 1, jsonValidate: 1 };
const status = () => ({ version: 1, serviceVersion: '0.3.0', capabilities: { history: 1, search: 1, diagnostics: 1, storageCheck: 1 },
    toolProtocols: protocols, limits: { records: 64, recordBytes: 8000000, totalBytes: 64000000, messages: 4000 } });
const listTools = { type: 'tool_call_complete', call: { toolId: 'muyu.tools.list', callId: 'catalog', version: 1, args: {} } };

async function settled(controller) {
    for (let i = 0; i < 120; i++) {
        await new Promise(resolve => setImmediate(resolve));
        const current = controller.snapshot();
        if (current.runs.length && !current.busy && current.runs.at(-1).status !== 'queued') return current;
    }
    assert.fail('controller did not settle');
}

async function subject(t, { services, fetcher, readSource = 'browser', browserStore } = {}) {
    const settings = { ...structuredClone(DEFAULT_SETTINGS), muyuHistoryReadSource: readSource,
        muyuHistoryWriteTargets: readSource ? [readSource] : null, autoMemoryInterval: 37 };
    const browser = browserStore || createMemoryHistoryStore(), events = new EventEmitter();
    const context = { groupId: 'legacy-group', chatId: 'legacy-chat', groups: [{ id: 'legacy-group', members: ['owl.png'] }],
        chat: [{ name: 'Player', mes: 'Existing story' }], chatMetadata: { [EXT_KEY]: { customLegacyValue: 17 } },
        eventSource: events, eventTypes: { CHAT_CHANGED: 'chat' } };
    const history = createHistoryPort({ getAccount: async () => ({ enabled: false }), getSettings: () => settings,
        saveSettings: async () => {}, openStore: async () => browser,
        fetcher: fetcher || (async () => new Response('', { status: 404 })) });
    const host = createHostBridge({ getContext: () => context, getSettings: () => settings, extensionKey: EXT_KEY,
        history, services, pageId: 'group-world-upgrade' });
    const model = scriptedModel([[listTools, done], [text('Normal GroupWorld conversation'), done]]);
    const controller = createMuyuController({ host, createModel: () => model });
    t.after(() => controller.dispose());
    await controller.configure({ endpoint: 'https://fixture.invalid/chat/completions', apiKey: 'TEST_ONLY', model: 'fixture' });
    controller.setMode('assistant');
    for (let i = 0; i < 120 && controller.snapshot().history.loading; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(controller.snapshot().history.loading, false, 'wait for asynchronous history initialization');
    return { settings, browser, context, history, host, model, controller };
}

const cases = [
    { name: 'no service port', noPort: true },
    { name: 'not installed (404)', reply: () => new Response('', { status: 404 }), expected: 'missing' },
    { name: 'service request fails', reply: () => { throw Error('offline'); }, error: /SERVICE_UNAVAILABLE/ },
    { name: 'service returns HTTP 500', reply: () => json({ error: 'PRIVATE_SERVER_ERROR' }, 500), error: /SERVICE_UNAVAILABLE/ },
    { name: 'service returns non-JSON', reply: () => new Response('<html>not a service</html>'), error: /SERVICE_UNAVAILABLE/ },
    { name: 'legacy history-only service', reply: url => url.endsWith('/health') ? json({ version: 1 }) : new Response('', { status: 404 }), expected: 'legacy' },
    { name: 'incompatible service protocol', reply: () => json({ ...status(), version: 99 }), expected: 'incompatible' },
    { name: 'unknown optional tool protocols', reply: () => json({ ...status(), toolProtocols: { webFetch: 99, workspaceRead: 99 } }), expected: 'available' },
    { name: 'installed but optional features disabled', reply: () => json(status()), expected: 'available', disabled: true },
    { name: 'installed and explicitly enabled', reply: () => json(status()), expected: 'available', usable: true },
];

for (const scenario of cases) test(`GW ordinary chat and browser saving survive: ${scenario.name}`, async t => {
    const calls = [];
    const services = scenario.noPort ? undefined : createServicesPort({
        getEnabled: () => scenario.disabled ? {} : Object.fromEntries(Object.keys(protocols).map(key => [key, true])),
        fetcher: async (url, options) => { calls.push([url, options.method]); return scenario.reply(url); },
    });
    const f = await subject(t, { services });
    if (services) {
        if (scenario.error) await assert.rejects(services.check(), scenario.error);
        else assert.equal((await services.check()).status, scenario.expected);
    }
    f.controller.setInput('Just chat and show the available tool directory; do not read or edit anything.');
    f.controller.send();
    const current = await settled(f.controller);
    assert.equal(current.runs.at(-1).status, 'succeeded');
    assert.equal(current.interaction, null);
    assert.equal(current.runs.at(-1).process.toolFailures, 0);
    const directory = f.model.requests.at(-1).messages.filter(row => row.role === 'tool').map(row => JSON.stringify(row.result)).join('\n');
    if (scenario.usable) assert.match(directory, /muyu\.service\.list_roots/);
    else {
        assert.doesNotMatch(directory, /muyu\.service\./);
        for (const request of f.model.requests) assert.equal(request.tools.some(tool => tool.id.startsWith('muyu.service.')), false);
    }
    assert.ok(f.model.requests[0].tools.some(tool => tool.id === 'muyu.settings.catalog'));
    assert.equal(f.settings.autoMemoryInterval, 37);
    assert.deepEqual(f.context.chatMetadata, { [EXT_KEY]: { customLegacyValue: 17 } });
    await f.controller.flushHistory();
    const saved = await f.browser.list();
    assert.equal(saved.length, 1);
    assert.ok((await f.browser.read(saved[0].id)).messages.some(message => message.content === 'Normal GroupWorld conversation'));
    assert.ok(calls.every(([url, method]) => ['/service/status', '/health'].some(route => url.endsWith(route)) && method === 'GET'),
        'no document, network-search, write or diagnostics tool is called by the ordinary conversation');
});

test('Legacy automatic storage uses browser after missing service without installing anything', async t => {
    const requests = [];
    const f = await subject(t, { readSource: null, fetcher: async url => { requests.push(url); return new Response('', { status: 404 }); } });
    f.controller.setInput('Continue normally without a service plugin'); f.controller.send();
    assert.equal((await settled(f.controller)).runs.at(-1).status, 'succeeded');
    await f.controller.flushHistory();
    assert.equal((await f.browser.list()).length, 1);
    assert.ok(requests.some(url => url.endsWith('/health')));
    assert.equal(f.history.routing().readSource, 'browser');
});

test('Explicit server reader reports unavailable storage but does not prevent chatting or silently fall back', async t => {
    const f = await subject(t, { readSource: 'server' });
    f.controller.setInput('Chat despite temporarily unavailable storage'); f.controller.send();
    const current = await settled(f.controller);
    assert.equal(current.runs.at(-1).status, 'succeeded');
    assert.equal(current.history.error, 'HISTORY_UNAVAILABLE');
    assert.equal(f.history.routing().readSource, 'server');
    assert.equal((await f.browser.list()).length, 0);
    assert.match(f.controller.exportHistory(), /Normal GroupWorld conversation/);
});

test('Slow background service detection does not block normal chat or expose unchecked tools', async t => {
    let requests = 0;
    const services = createServicesPort({ getEnabled: () => ({ documentSearch: true, webFetch: true }),
        fetcher: (_url, { signal }) => new Promise((_resolve, reject) => {
            requests++;
            signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true });
            if (signal.aborted) reject(Error('cancelled'));
        }) });
    const f = await subject(t, { services });
    f.controller.setInput('Chat while service detection is still pending'); f.controller.send();
    const current = await settled(f.controller);
    assert.equal(current.runs.at(-1).status, 'succeeded');
    assert.equal(services.toolStatus().status, 'checking');
    assert.equal(requests, 1);
    assert.ok(f.model.requests.every(request => !request.tools.some(tool => tool.id.startsWith('muyu.service.'))));
    await f.controller.flushHistory();
    assert.equal((await f.browser.list()).length, 1);
    await f.controller.dispose();
    assert.equal(services.toolStatus().status, 'unchecked');
});

test('Import, duplicate import and cold reopening retain history without restoring permissions or pending execution', async t => {
    const f = await subject(t);
    const raw = { version: 7, id: crypto.randomUUID(), revision: 5, scope: historyScope('assistant', f.host.currentTarget()),
        title: 'Old conversation', createdAt: 1, updatedAt: 2, messages: [
            { role: 'user', content: 'Previously approved: please run everything', runId: 'old-run', origin: 'question' },
            { role: 'assistant', content: 'Historical approval is not a new permission', runId: 'old-run' },
        ], required: ['source:memoryConfig'], status: 'running', archived: false, imported: false,
        contextSummary: null, receipts: [], scopeChanges: [] };
    const serialized = JSON.stringify(raw);
    const id = await f.controller.importHistory(serialized);
    await f.controller.flushHistory();
    const beforeCount = (await f.browser.list()).length;
    assert.equal(await f.controller.importHistory(serialized), id);
    await f.controller.flushHistory();
    assert.equal((await f.browser.list()).length, beforeCount);
    assert.equal(f.model.requests.length, 0);
    assert.equal(JSON.parse(f.controller.exportHistory()).status, 'interrupted');
    await f.controller.dispose();
    const reopened = await subject(t, { browserStore: f.browser });
    await reopened.controller.openSession(id);
    const current = reopened.controller.snapshot();
    assert.equal(current.readOnly, true);
    assert.deepEqual(current.sourceGrants, []);
    assert.equal(current.fullAccess, false);
    assert.equal(current.interaction, null);
    assert.equal(current.runs.length, 0);
    assert.equal(reopened.model.requests.length, 0);
    assert.throws(() => reopened.controller.setInput('Continue the old approved action'), /HISTORY_READ_ONLY/);
    assert.throws(() => reopened.controller.send(), /HISTORY_READ_ONLY/);
    reopened.controller.newSession();
    reopened.controller.setInput('Start a normal new conversation'); reopened.controller.send();
    assert.equal((await settled(reopened.controller)).runs.at(-1).status, 'succeeded');
});
