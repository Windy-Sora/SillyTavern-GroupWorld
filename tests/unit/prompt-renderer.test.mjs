import assert from 'node:assert/strict';
import test from 'node:test';
import { renderPrompt, setProviderTimeoutDefault } from '../../prompt-renderer.js';
import { registerProvider, unregisterProvider } from '../../provider-registry.js';
import { roundCounterSet } from '../../utils/counter.js';

function register(t, provider) {
    registerProvider({ placeholder: `{{${provider.id}}}`, ...provider });
    t.after(() => unregisterProvider(provider.id));
}

function dynamicProviders(t) {
    let calls = 0;
    const loop = '{{#testDynamic:keys}}[{{?testDynamic:labels.$it|MISSING}}/{{counter0}}]{{/testDynamic}}';
    register(t, { id: 'testDynamic', render: () => {
        calls++;
        return { content: loop, data: { keys: ['A', 'B'], children: { A: ['x'], B: ['y'], seed: ['wrong'] },
            labels: { A: 'Alpha', B: 'Beta', x: 'X', y: 'Y', seed: 'Seed', wrong: 'Wrong' } } };
    } });
    register(t, { id: 'testFragment', render: () => ({ content: '{{#testDynamic:children.$it}}<{{?testDynamic:labels.$it|MISSING}}>{{/testDynamic}}' }) });
    register(t, { id: 'testDirectFragment', render: () => ({ content: '{{?testDynamic:labels.$it|MISSING}}' }) });
    return { loop, calls: () => calls };
}

test('nested and unclosed raw slots never render their inner placeholders or loop tails', async t => {
    let calls = 0;
    register(t, { id: 'testRawNested', render: () => { calls++; return { content: 'RENDERED', data: { keys: [1] } }; } });
    const inner = 'before {[{ {{testRawNested}} }]} {{#testRawNested:keys}}{{counter0}}{{/testRawNested}} after';
    assert.equal(await renderPrompt(`{[{${inner}}]}|{{counter0}}`, {}), inner + '|0');
    const unclosed = '{[{ {{testRawNested}} {[{ nested }]} {{counter0}}';
    assert.equal(await renderPrompt('start ' + unclosed, {}), 'start ' + unclosed);
    assert.equal(calls, 2);
});

test('Dynamic root loops defer queries and fresh counters until their iteration is bound', async t => {
    const fixture = dynamicProviders(t);
    for (const context of [{}, { it: 'seed' }]) {
        assert.equal(await renderPrompt('{{testDynamic}}', context), '[Alpha/0]\n[Beta/1]');
    }
    assert.equal(fixture.calls(), 2);
    for (const options of [{ recursive: false }, { maxPasses: 1 }]) {
        assert.equal(await renderPrompt('{{testDynamic}}', { it: 'seed' }, options), fixture.loop);
    }
});

test('Dynamic child loops retain parent sources and restore parent queries in either recursion mode', async t => {
    const fixture = dynamicProviders(t);
    for (const recursive of [false, true]) {
        for (const context of [{}, { it: 'seed' }]) {
            assert.equal(await renderPrompt('{{#testDynamic:keys}}{{testDirectFragment}}:{{testFragment}}:{{testDirectFragment}}{{/testDynamic}}', context, { recursive }),
                'Alpha:<X>:Alpha\nBeta:<Y>:Beta');
        }
    }
    assert.equal(fixture.calls(), 4);
});

test('Recursive Provider chains keep dynamic fragments in the enclosing iteration', async t => {
    dynamicProviders(t);
    register(t, { id: 'testChainA', render: () => '{{testChainB}}' });
    register(t, { id: 'testChainB', render: () => '{{testFragment}}' });
    assert.equal(await renderPrompt('{{#testDynamic:keys}}{{testChainA}}{{/testDynamic}}', { it: 'seed' }, { maxPasses: 3 }), '<X>\n<Y>');
});

test('Generated fragments share the static loop budget and never re-execute Providers', async t => {
    let calls = 0;
    const fragment = '{{#testCycle:keys}}{{testCycle}}{{/testCycle}}';
    register(t, { id: 'testCycle', render: () => { calls++; return { content: fragment, data: { keys: ['one'] } }; } });
    assert.equal(await renderPrompt('{{#testCycle:keys}}{{testCycle}}{{/testCycle}}', {}, { recursive: false }), fragment);
    assert.equal(calls, 1);
});

test('Dynamic fragments retain textual counter order and passthrough/raw controls', async t => {
    dynamicProviders(t);
    register(t, { id: 'testCounterFragment', render: () => '{{#testDynamic:children.$it}}{{counter0}}/{{User}}/{{?testDynamic:labels.$it}}{{/testDynamic}}' });
    assert.equal(await renderPrompt('{{#testDynamic:keys}}{{counter0}}:{{testCounterFragment}}:{{counter0}}:{[{ {{testFragment}} }]}{{/testDynamic}}', {}, { passthrough: ['User'] }),
        '0:1/{{User}}/X:2: {{testFragment}} \n3:4/{{User}}/Y:5: {{testFragment}} ');
});

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

for (const recursive of [false, true]) test(`Nested loops bind dependent sources to the parent iteration (recursive=${recursive})`, async t => {
    let calls = 0;
    register(t, { id: 'testNestedScope', render: () => {
        calls++;
        return { content: '', data: { outer: ['one', 'two'], lookup: { one: ['X'], two: ['Y'], seed: ['WRONG'] }, labels: { one: 'ONE', two: 'TWO', X: 'XX', Y: 'YY', seed: 'SEED', WRONG: 'WRONG' } } };
    } });
    const context = { it: 'seed' };
    const result = await renderPrompt('{{#testNestedScope:outer}}before={{?testNestedScope:labels.$it}};{{#testNestedScope:lookup.$it}}inner={{?testNestedScope:labels.$it}}{{/testNestedScope}};after={{?testNestedScope:labels.$it}}{{/testNestedScope}}|{{?testNestedScope:labels.$it}}', context, { recursive });
    assert.equal(result, 'before=ONE;inner=XX;after=ONE\nbefore=TWO;inner=YY;after=TWO|SEED');
    assert.equal(calls, 1); assert.deepEqual(context, { it: 'seed' });
});

test('Nested static sources and sibling loops retain their own iteration scopes', async t => {
    register(t, { id: 'testNestedStatic', render: () => ({ content: '', data: { outer: ['ONE', 'TWO'], fixed: ['A', 'B'], labels: { ONE: 'ONE', TWO: 'TWO', A: 'AA', B: 'BB' } } }) });
    const result = await renderPrompt('{{#testNestedStatic:outer}}outer={{?testNestedStatic:labels.$it}};{{#testNestedStatic:fixed}}inner={{?testNestedStatic:labels.$it}}{{/testNestedStatic}}{{/testNestedStatic}}|{{#testNestedStatic:fixed}}{{?testNestedStatic:labels.$it}}{{/testNestedStatic}}', {}, { recursive: false });
    assert.equal(result, 'outer=ONE;inner=AA\ninner=BB\nouter=TWO;inner=AA\ninner=BB|AA\nBB');
});

test('Dependent nesting works across providers, three levels and punctuated iteration keys', async t => {
    register(t, { id: 'testNestedRoot', render: () => ({ content: '', data: { keys: ['a.b', 'q"\\ name'], labels: { 'a.b': 'A', 'q"\\ name': 'Q' } } }) });
    register(t, { id: 'testNestedChild', render: () => ({ content: '', data: { children: { 'a.b': ['X'], 'q"\\ name': ['Y'] }, leaves: { X: [1, 1, 2], Y: [3] }, labels: { 1: 'one', 2: 'two', 3: 'three', X: 'x', Y: 'y' } } }) });
    const result = await renderPrompt('{{#testNestedRoot:keys}}{{?testNestedRoot:labels.$it}}:{{#testNestedChild:children.$it}}{{?testNestedChild:labels.$it}}[{{#testNestedChild:leaves.$it}}{{?testNestedChild:labels.$it}}{{/testNestedChild}}]{{?testNestedChild:labels.$it}}{{/testNestedChild}}{{/testNestedRoot}}', {}, { recursive: false });
    assert.equal(result, 'A:x[one\ntwo]x\nQ:y[three]y');
});

test('Empty and missing dependent arrays disappear without consuming outer or sibling bodies', async t => {
    register(t, { id: 'testNestedEmpty', render: () => ({ content: '', data: { keys: ['none', 'empty', 'has', 'has'], children: { empty: [], has: ['X', 'X', 'Y'] }, labels: { none: 'NONE', empty: 'EMPTY', has: 'HAS', X: 'x', Y: 'y' } } }) });
    assert.equal(await renderPrompt('{{#testNestedEmpty:keys}}{{?testNestedEmpty:labels.$it}}[{{#testNestedEmpty:children.$it}}{{?testNestedEmpty:labels.$it}}{{/testNestedEmpty}}]{{?testNestedEmpty:labels.$it}}{{/testNestedEmpty}}', {}, { recursive: false }), 'NONE[]NONE\nEMPTY[]EMPTY\nHAS[x\ny]HAS');
});

test('Nested counters follow output order and raw/passthrough bodies remain protected', async t => {
    roundCounterSet(0);
    register(t, { id: 'testNestedCounter', render: () => ({ content: '', data: { outer: ['a', 'b'], children: { a: ['X'], b: ['Y'] } } }) });
    const result = await renderPrompt('{{#testNestedCounter:outer}}{{counter}}/{{counter0}}:{{#testNestedCounter:children.$it}}{{counter}}/{{counter0}}{{/testNestedCounter}}:{{counter}}/{{counter0}}:{{User}}:{[{ {{#testNestedCounter:outer}}raw{{/testNestedCounter}} }]}{{/testNestedCounter}}', {}, { passthrough: ['User'] });
    assert.equal(result, '0/0:1/1:2/2:{{User}}: {{#testNestedCounter:outer}}raw{{/testNestedCounter}} \n3/3:4/4:5/5:{{User}}: {{#testNestedCounter:outer}}raw{{/testNestedCounter}} ');
});

test('Malformed crossing tags cannot swallow a subsequent balanced sibling', async t => {
    register(t, { id: 'testBrokenA', render: () => ({ content: '', data: { values: [1] } }) });
    register(t, { id: 'testBrokenB', render: () => ({ content: '', data: { values: [1] } }) });
    const malformed = '{{#testBrokenA:values}}{{#testBrokenB:values}}BAD{{/testBrokenA}}{{/testBrokenB}}';
    assert.equal(await renderPrompt(malformed + '|{{#testBrokenA:values}}GOOD{{/testBrokenA}}', {}, { recursive: false }), malformed + '|GOOD');
});

test('Nested loop expansion shares the 200-block pass budget and bounds recursive depth', async t => {
    register(t, { id: 'testNestedLimit', render: () => ({ content: '', data: { one: ['X'] } }) });
    const open = '{{#testNestedLimit:one}}', close = '{{/testNestedLimit}}';
    const result = await renderPrompt(open.repeat(250) + 'end' + close.repeat(250), {}, { recursive: false });
    assert.equal(result, open.repeat(50) + 'end' + close.repeat(50));
    assert.equal(await renderPrompt(result, {}, { recursive: false }), 'end');
});

test('Nested expansion budget is shared across outer iterations, not reset for each element', async t => {
    register(t, { id: 'testIterationLimit', render: () => ({ content: '', data: { outer: Array.from({ length: 250 }, (_, i) => i), one: ['X'] } }) });
    const inner = '{{#testIterationLimit:one}}ok{{/testIterationLimit}}';
    const result = await renderPrompt('{{#testIterationLimit:outer}}' + inner + '{{/testIterationLimit}}', {}, { recursive: false });
    assert.equal(result, [...Array(199).fill('ok'), ...Array(51).fill(inner)].join('\n'));
});

test('An empty outer loop never evaluates inner counters or emits inner content', async t => {
    roundCounterSet(0);
    register(t, { id: 'testEmptyOuter', render: () => ({ content: '', data: { empty: [], one: ['X'] } }) });
    assert.equal(await renderPrompt('{{#testEmptyOuter:empty}}{{#testEmptyOuter:one}}{{counter}}{{/testEmptyOuter}}{{/testEmptyOuter}}{{counter}}', {}, { recursive: false }), '0');
});

test('Provider-generated loops are expanded by subsequent passes without re-running providers', async t => {
    let calls = 0;
    register(t, { id: 'testGeneratedLoop', render: () => { calls++; return { content: '{{#testGeneratedLoop:keys}}[ok]{{/testGeneratedLoop}}', data: { keys: ['A'] } }; } });
    assert.equal(await renderPrompt('{{testGeneratedLoop}}', {}, { maxPasses: 2 }), '[ok]');
    assert.equal(calls, 1);
});

test('Loops generated while rendering a block retain same-pass expansion with recursion disabled', async t => {
    register(t, { id: 'testGeneratedBody', render: () => ({ content: '{{#testGeneratedBody:one}}GENERATED{{/testGeneratedBody}}', data: { one: ['X'] } }) });
    assert.equal(await renderPrompt('{{#testGeneratedBody:one}}{{testGeneratedBody}}{{/testGeneratedBody}}', {}, { recursive: false }), 'GENERATED');
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
