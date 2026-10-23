import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MEMORY_RENDER } from '../../agents/memory.js';
import { inspectMemoryRenderTemplate, renderMemoryTemplate } from '../../assets/providers/memory-template.js';
import { register as registerCharMemory } from '../../assets/providers/char-memory.js';
import { getProviders, unregisterProvider } from '../../provider-registry.js';

const all = {
    Alice: [{ event: 'Found a key', mood: 'happy' }, { event: '{{untrusted}}', mood: 'neutral' }],
    Bob: [{ event: 'Left town', mood: 'sad' }],
};

test('Memory render template preserves grouped default and supports a flat custom layout', () => {
    assert.equal(renderMemoryTemplate(DEFAULT_MEMORY_RENDER, all),
        '=== Alice ===\n- Found a key [happy]\n- {{untrusted}} [neutral]\n\n=== Bob ===\n- Left town [sad]');
    const flat = '{{#charMemory:all}}{{?charMemory:all[$it].character}}: {{?charMemory:all[$it].event}} ({{?charMemory:all[$it].mood}})\n{{/charMemory:all}}';
    assert.equal(renderMemoryTemplate(flat, all), 'Alice: Found a key (happy)\nAlice: {{untrusted}} (neutral)\nBob: Left town (sad)');
    assert.equal(inspectMemoryRenderTemplate(flat).containsMemoryLoop, true);
    const previousDisplayedDefault = '{{#charMemory:all}}\n  {{?charMemory:all[$it].event}} ({{?charMemory:all[$it].mood}})\n{{/charMemory:all}}';
    assert.match(renderMemoryTemplate(previousDisplayedDefault, all), /Found a key \(happy\)/);
    assert.equal(inspectMemoryRenderTemplate('').custom, false);
    assert.equal(renderMemoryTemplate(DEFAULT_MEMORY_RENDER, {}), '');
});

test('Invalid memory templates fail closed while the Provider keeps its legacy output', async t => {
    const bad = '{{#charMemory:all}}{{?charMemory:all[$it].event}}{{/charMemory}}';
    assert.throws(() => inspectMemoryRenderTemplate(bad), /INVALID_MEMORY_RENDER_TEMPLATE/);
    const warnings = [], oldWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    t.after(() => { console.warn = oldWarn; unregisterProvider('charMemory'); unregisterProvider('charMemoryCurrent'); });
    let template = '';
    registerCharMemory({ getMemoriesForAll: () => all, getMemoriesForChar: async () => all.Alice, getRenderTemplate: () => template, log: () => {} });
    const provider = getProviders().find(item => item.id === 'charMemory');
    const legacy = await provider.render({});
    assert.match(legacy.content, /^=== Alice ===/);
    assert.equal(legacy.data.all.length, 3);
    template = '{{#charMemory:all}}{{?charMemory:all[$it].event}}\n{{/charMemory:all}}';
    assert.equal((await provider.render({})).content, 'Found a key\n{{untrusted}}\nLeft town');
    template = bad;
    assert.equal((await provider.render({})).content, legacy.content);
    assert.equal(warnings.length, 1);
    assert.equal((await getProviders().find(item => item.id === 'charMemoryCurrent').render({ character: 'Alice' })).content,
        '- Found a key [happy]\n- {{untrusted}} [neutral]');
});
