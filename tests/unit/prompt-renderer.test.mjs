import assert from 'node:assert/strict';
import test from 'node:test';
import { renderPrompt, setProviderTimeoutDefault } from '../../prompt-renderer.js';
import { registerProvider, unregisterProvider } from '../../provider-registry.js';
import { roundCounterSet } from '../../utils/counter.js';

function register(t, provider) {
    registerProvider({ placeholder: `{{${provider.id}}}`, ...provider });
    t.after(() => unregisterProvider(provider.id));
}

test('Prompt Renderer caches providers once and resolves simple, path, local, raw, and passthrough values', async t => {
    let calls = 0;
    let cache;
    register(t, {
        id: 'testRenderAlpha',
        async render(context) {
            calls++;
            assert.equal(context.marker, 7);
            return { content: 'A {{localValue}}', data: { nested: { value: 9 } } };
        },
    });
    const result = await renderPrompt(
        '{{testRenderAlpha}}|{{testRenderAlpha}}|{{?testRenderAlpha:nested.value}}|{{?testRenderAlpha:missing|fallback}}|{{localValue}}|{[{ {{testRenderAlpha}} }]}|{{User}}',
        { marker: 7 },
        {
            locals: { localValue: 'LOCAL' },
            passthrough: ['User'],
            onCache: value => { cache = value; },
        },
    );
    assert.equal(result, 'A LOCAL|A LOCAL|9|fallback|LOCAL| {{testRenderAlpha}} |{{User}}');
    assert.equal(calls, 1);
    assert.deepEqual({ ...cache.testRenderAlpha }, { content: 16, hasData: true });
    assert.deepEqual({ ...cache.localValue }, { content: 5, hasData: false });
});

test('Prompt Renderer expands deduplicated block values and variable paths', async t => {
    register(t, {
        id: 'testRenderItems',
        render: () => ({
            content: '',
            data: { keys: ['a', 'b', 'a'], values: { a: 'Alpha', b: 'Beta' }, empty: [] },
        }),
    });
    const result = await renderPrompt(
        '{{#testRenderItems:keys}}[{{?testRenderItems:values.$it}}]{{/testRenderItems}}|{{#testRenderItems:empty}}never{{/testRenderItems}}',
        {},
    );
    assert.equal(result, '[Alpha]\n[Beta]|');
});

test('Prompt Renderer starts providers concurrently and normalizes primitive results', async t => {
    let started = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    for (const id of ['testParallelOne', 'testParallelTwo']) {
        register(t, {
            id,
            async render() { started++; await gate; return id.endsWith('One') ? 'one' : 2; },
        });
    }
    const pending = renderPrompt('{{testParallelOne}}/{{testParallelTwo}}', {}, { providerTimeoutMs: 0 });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(started, 2);
    release();
    assert.equal(await pending, 'one/2');
});

test('Prompt Renderer isolates disabled, failed, and timed-out providers', async t => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    t.after(() => { console.warn = originalWarn; });
    register(t, { id: 'testDisabled', enabled: false, render: () => 'disabled' });
    register(t, { id: 'testFailure', render: () => { throw new Error('boom'); } });
    let timeoutReason;
    register(t, {
        id: 'testTimeout',
        timeoutMs: 10,
        render: (_context, signal) => new Promise((_, reject) => {
            signal.addEventListener('abort', () => { timeoutReason = signal.reason; reject(signal.reason); }, { once: true });
        }),
    });
    const result = await renderPrompt('{{testDisabled}}/{{testFailure}}/{{testTimeout}}/ok', {}, {
        providerTimeoutMs: 100,
    });
    assert.equal(result, '///ok');
    assert.equal(timeoutReason?.name, 'TimeoutError');
    assert.equal(warnings.some(value => value.includes('testFailure') && value.includes('render failed')), true);
    assert.equal(warnings.some(value => value.includes('testTimeout') && value.includes('timed out')), true);
});

test('Prompt Renderer propagates user cancellation and aborts active providers', async t => {
    const controller = new AbortController();
    let providerReason;
    register(t, {
        id: 'testAbortProvider',
        render: (_context, signal) => new Promise((_, reject) => {
            signal.addEventListener('abort', () => { providerReason = signal.reason; reject(signal.reason); }, { once: true });
        }),
    });
    const pending = renderPrompt('{{testAbortProvider}}', {}, { signal: controller.signal, providerTimeoutMs: 0 });
    controller.abort();
    await assert.rejects(pending, error => error.name === 'AbortError');
    assert.equal(providerReason?.name, 'AbortError');
    await assert.rejects(
        renderPrompt('unused', {}, { signal: controller.signal }),
        error => error.name === 'AbortError',
    );
});

test('Prompt Renderer controls recursion, unknown placeholders, counters, and observer failures', async () => {
    roundCounterSet(0);
    setProviderTimeoutDefault(null);
    const nonRecursive = await renderPrompt('{{localOuter}}/{{unknown}}', {}, {
        locals: { localOuter: '{{localInner}}', localInner: 'done' },
        recursive: false,
        debugPlaceholders: true,
    });
    assert.equal(nonRecursive, '{{localInner}}/{{unknown}}');
    const recursive = await renderPrompt('{{localOuter}}/{{unknown}}', {}, {
        locals: { localOuter: '{{localInner}}', localInner: 'done' },
        debugPlaceholders: false,
        onCache: () => { throw new Error('observer failure'); },
    });
    assert.equal(recursive, 'done/');
    assert.equal(await renderPrompt('{{counter}}/{{counter}}/{{counter0}}/{{counter0}}', {}), '0/1/0/1');
});
