import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from '../../assets/providers/world-info.js';
import { providers, unregisterProvider } from '../../provider-registry.js';
import { inspectDirectorWorldInfoTemplate } from '../../muyu/config/director-world-info-template.js';

test('World-info wrapper inspection follows first-only runtime replacement', () => {
    assert.deepEqual(inspectDirectorWorldInfoTemplate(''), { empty: true, placeholderCount: 0, otherPlaceholders: false });
    assert.deepEqual(inspectDirectorWorldInfoTemplate('{{worldInfo}} / {{worldInfo}} / {{custom}}'),
        { empty: false, placeholderCount: 2, otherPlaceholders: true });
});

test('World-info Provider applies wrapper only when enabled and activation produced text', async t => {
    t.after(() => unregisterProvider('worldInfo'));
    const settings = { llmWorldInfoEnabled: true, llmWorldInfoWrapper: '[{{worldInfo}}] {{worldInfo}}' };
    let result = { text: 'Lore', entries: [{ name: 'entry' }] }, calls = 0;
    const state = { text: '', entries: [] };
    register(settings, state, async () => { calls++; return result; });
    const render = () => providers.get('worldInfo').render({ enabledMembers: ['alice.png'] });
    assert.equal((await render()).content, '[Lore] {{worldInfo}}');
    assert.equal(calls, 1);
    settings.llmWorldInfoWrapper = '';
    assert.equal((await render()).content, 'Lore');
    settings.llmWorldInfoWrapper = 'No placeholder';
    assert.equal((await render()).content, 'No placeholder');
    settings.llmWorldInfoEnabled = false;
    assert.equal((await render()).content, '');
    settings.llmWorldInfoEnabled = true;
    state.text = '';
    result = { text: '', entries: [] };
    assert.equal((await render()).content, '');
});
