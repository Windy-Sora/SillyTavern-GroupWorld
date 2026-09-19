import assert from 'node:assert/strict';
import test from 'node:test';
import { createCaller } from '../../utils/custom-api.js';

function installGlobals(t, fetchImpl, windowValue) {
    const hadFetch = Object.prototype.hasOwnProperty.call(globalThis, 'fetch');
    const oldFetch = globalThis.fetch;
    const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
    const oldWindow = globalThis.window;
    globalThis.fetch = fetchImpl;
    if (windowValue === undefined) delete globalThis.window;
    else globalThis.window = windowValue;
    t.after(() => {
        if (hadFetch) globalThis.fetch = oldFetch;
        else delete globalThis.fetch;
        if (hadWindow) globalThis.window = oldWindow;
        else delete globalThis.window;
    });
}

function response({ ok = true, status = 200, json = {}, text = '' } = {}) {
    return {
        ok,
        status,
        async json() { return json; },
        async text() { return text; },
    };
}

test('native caller normalizes host results and never uses global stop for cancellation', async () => {
    let stops = 0;
    let received;
    const caller = createCaller({ useCustom: false }, async options => {
        received = options;
        return 42;
    }, () => { stops++; });
    assert.equal(caller.supportsAbort, false);
    assert.equal(await caller.generate('native prompt'), '42');
    assert.deepEqual(received, { prompt: 'native prompt' });
    assert.deepEqual(await caller.test(), { ok: true });
    assert.equal(stops, 0);

    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(caller.generate('cancelled', { signal: aborted.signal }), error => error.name === 'AbortError');
    assert.equal(stops, 0);
});

test('native caller rejects a response completed after external cancellation', async () => {
    let release;
    const pendingHost = new Promise(resolve => { release = resolve; });
    const caller = createCaller({}, () => pendingHost);
    const controller = new AbortController();
    const pending = caller.generate('prompt', { signal: controller.signal });
    controller.abort();
    release('late response');
    await assert.rejects(pending, error => error.name === 'AbortError');
});

test('OpenAI caller builds requests, trims endpoint slashes, and supports reasoning output', async t => {
    const requests = [];
    const replies = [
        response({ json: { choices: [{ message: { content: 'answer' } }] } }),
        response({ json: { choices: [{ message: { content: '', reasoning_content: 'reasoning' } }] } }),
    ];
    installGlobals(t, async (url, options) => { requests.push({ url, options }); return replies.shift(); }, { csrfToken: 'local-token' });
    const caller = createCaller({
        useCustom: true,
        protocol: 'openai',
        endpoint: 'https://api.example.com///',
        apiKey: 'secret-key',
        model: 'model-a',
    });
    const controller = new AbortController();
    assert.equal(await caller.generate('hello', { signal: controller.signal }), 'answer');
    assert.equal(await caller.generate('think'), 'reasoning');
    assert.equal(requests[0].url, 'https://api.example.com/v1/chat/completions');
    assert.equal(requests[0].options.signal, controller.signal);
    assert.equal(requests[0].options.headers.Authorization, 'Bearer secret-key');
    assert.equal('X-CSRF-Token' in requests[0].options.headers, false);
    assert.deepEqual(JSON.parse(requests[0].options.body), {
        model: 'model-a',
        messages: [{ role: 'user', content: 'hello' }],
        temperature: 0.7,
        max_tokens: 4096,
    });
});

test('OpenAI caller sends CSRF only to local hosts and reports HTTP and empty test responses', async t => {
    const requests = [];
    const replies = [
        response({ ok: false, status: 429, text: 'rate limited' }),
        response({ json: { choices: [{ message: { content: '' } }] } }),
    ];
    installGlobals(t, async (url, options) => { requests.push({ url, options }); return replies.shift(); }, { csrfToken: 'csrf-value' });
    const caller = createCaller({
        useCustom: true,
        protocol: 'openai',
        endpoint: 'http://127.0.0.1:8000/',
        apiKey: 'key',
        model: 'local',
    });
    await assert.rejects(caller.generate('hello'), /API error 429: rate limited/);
    assert.equal(requests[0].options.headers['X-CSRF-Token'], 'csrf-value');
    const status = await caller.test();
    assert.equal(status.ok, false);
    assert.match(status.error, /Empty response/);
    const body = JSON.parse(requests[1].options.body);
    assert.equal(body.temperature, 0);
    assert.equal(body.max_tokens, 50);
});

test('OpenAI caller test converts transport failures into status objects', async t => {
    installGlobals(t, async () => { throw new Error('offline'); });
    const caller = createCaller({
        useCustom: true,
        protocol: 'openai',
        endpoint: 'not a valid url',
        apiKey: 'key',
        model: 'model',
    });
    assert.deepEqual(await caller.test(), { ok: false, error: 'offline' });
});

test('Anthropic caller builds protocol-specific requests and parses responses', async t => {
    const requests = [];
    const replies = [
        response({ json: { content: [{ text: 'anthropic answer' }] } }),
        response({ json: { content: [{ text: 'ok' }] } }),
    ];
    installGlobals(t, async (url, options) => { requests.push({ url, options }); return replies.shift(); });
    const caller = createCaller({
        useCustom: true,
        protocol: 'anthropic',
        endpoint: 'https://anthropic.example/',
        apiKey: 'anthropic-key',
        model: 'claude-test',
    });
    const controller = new AbortController();
    assert.equal(caller.supportsAbort, true);
    assert.equal(await caller.generate('hello', { signal: controller.signal }), 'anthropic answer');
    assert.equal(requests[0].url, 'https://anthropic.example/v1/messages');
    assert.equal(requests[0].options.signal, controller.signal);
    assert.equal(requests[0].options.headers['x-api-key'], 'anthropic-key');
    assert.equal(requests[0].options.headers['anthropic-version'], '2023-06-01');
    assert.deepEqual(JSON.parse(requests[0].options.body), {
        model: 'claude-test',
        max_tokens: 4096,
        messages: [{ role: 'user', content: 'hello' }],
    });
    assert.deepEqual(await caller.test(), { ok: true });
});

test('Anthropic caller distinguishes HTTP, empty, and transport test failures', async t => {
    const replies = [
        response({ ok: false, status: 400, text: 'bad request' }),
        response({ json: { content: [] } }),
        new Error('network down'),
    ];
    installGlobals(t, async () => {
        const next = replies.shift();
        if (next instanceof Error) throw next;
        return next;
    });
    const caller = createCaller({
        useCustom: true,
        protocol: 'anthropic',
        endpoint: 'https://anthropic.example',
        apiKey: 'key',
        model: 'model',
    });
    await assert.rejects(caller.generate('hello'), /Anthropic API error 400: bad request/);
    assert.deepEqual(await caller.test(), { ok: false, error: 'Empty response' });
    assert.deepEqual(await caller.test(), { ok: false, error: 'network down' });
});
