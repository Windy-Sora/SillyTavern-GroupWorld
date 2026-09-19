import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorldInfoSystem } from '../../systems/world-info-system.js';

function create(overrides = {}) {
    const calls = [];
    const logs = [];
    const settings = { llmWorldInfoEnabled: true, ...overrides.settings };
    const system = createWorldInfoSystem({
        settings,
        getChat: () => [{ name: 'User', mes: 'hello' }, { is_system: true, name: 'System', mes: 'hidden' }, { name: 'Alice', mes: 'reply' }],
        getCharacters: () => [{ avatar: 'a', name: 'Alice', description: 'Mage', personality: 'Calm', scenario: 'Tower' }],
        checkWorldInfo: async (...args) => { calls.push(args); return overrides.activated ?? { allActivatedEntries: [] }; },
        world_info_include_names: overrides.includeNames ?? true,
        getContext: () => ({ maxContext: '4096' }),
        power_user: { persona_description: 'Persona' },
        log: (...args) => logs.push(args),
        ...overrides.dependencies,
    });
    return { system, calls, logs, settings };
}

test('world info system builds host input and formats activated entries', async () => {
    const h = create({ activated: { allActivatedEntries: new Set([
        { uid: 1, comment: 'Lore', content: 'Magic exists' },
        { uid: 2, content: 'Second' },
    ]) } });
    const result = await h.system.buildDirectorWorldInfo(['a', 'missing']);
    assert.equal(result.text, '[Lore]\nMagic exists\n[2]\nSecond');
    assert.equal(result.entries.length, 2);
    assert.deepEqual(h.calls[0][0], ['Alice: reply', 'User: hello']);
    assert.equal(h.calls[0][1], 4096);
    assert.equal(h.calls[0][3].personaDescription, 'Persona');
    assert.equal(h.calls[0][3].characterDescription, 'Mage Calm Tower');
    assert.equal(h.calls[0][3].characterPersonality, 'Calm');
    assert.equal(h.logs.length, 1);
});

test('world info system honors disabled mode, fallback text, and host failures', async t => {
    const disabled = create({ settings: { llmWorldInfoEnabled: false } });
    assert.deepEqual(await disabled.system.buildDirectorWorldInfo(['a']), { text: '', entries: [] });
    assert.equal(disabled.calls.length, 0);

    const fallback = create({ includeNames: false, activated: { worldInfoBefore: 'before', worldInfoAfter: 'after' } });
    assert.equal((await fallback.system.buildDirectorWorldInfo(['a'])).text, 'beforeafter');
    assert.deepEqual(fallback.calls[0][0], ['reply', 'hello']);

    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    t.after(() => { console.warn = original; });
    const failed = create({ dependencies: { checkWorldInfo: async () => { throw new Error('host down'); } } });
    assert.deepEqual(await failed.system.buildDirectorWorldInfo(['a']), { text: '', entries: [] });
    assert.equal(warnings.some(message => message.includes('host down')), true);
});
