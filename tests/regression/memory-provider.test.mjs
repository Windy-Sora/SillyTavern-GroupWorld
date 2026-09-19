import assert from 'node:assert/strict';
import test from 'node:test';
import { register as registerCharMemory } from '../../assets/providers/char-memory.js';
import { getProviders, unregisterProvider } from '../../provider-registry.js';

test('BUG-1: current-character memory provider awaits asynchronous memory lookup', async t => {
    t.after(() => unregisterProvider('charMemoryCurrent'));
    t.after(() => unregisterProvider('charMemory'));
    registerCharMemory({
        getMemoriesForAll: () => ({}),
        getMemoriesForChar: async name => [{ event: `${name} remembered`, mood: 'calm' }],
        log: () => {},
    });
    const provider = getProviders().find(item => item.id === 'charMemoryCurrent');
    const rendered = await provider.render({ character: 'Alice' });
    assert.equal(rendered.content, '- Alice remembered [calm]');
    assert.equal(rendered.data.length, 1);
});
