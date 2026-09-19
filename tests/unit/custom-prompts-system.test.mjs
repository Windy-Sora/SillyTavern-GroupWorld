import assert from 'node:assert/strict';
import test from 'node:test';
import { createCustomPromptsSystem } from '../../systems/custom-prompts-system.js';

function createSubject(initial = {}) {
    const providers = new Map();
    const settings = { customPromptsEnabled: true, customPrompts: [], ...initial };
    let saves = 0;
    const subject = createCustomPromptsSystem({
        settings,
        saveSettings: () => { saves += 1; },
        registerProvider: provider => providers.set(provider.id, provider),
        unregisterProvider: id => providers.delete(id),
        getProviders: () => [...providers.values()],
        log: () => {},
    });
    return { subject, settings, providers, getSaves: () => saves };
}

test('custom prompts register a renderable provider and replace its old name on update', async () => {
    const { subject, providers, getSaves } = createSubject();
    const { entry } = await subject.add('scene_note', 'Scene: {{char}}', true, { dataJson: '{"phase":1}' });

    assert.equal(providers.has('scene_note'), true);
    assert.deepEqual(providers.get('scene_note').render(), {
        content: 'Scene: {{char}}',
        data: { phase: 1 },
    });

    await subject.update(entry.id, { name: 'chapter_note', content: 'Chapter two' });
    assert.equal(providers.has('scene_note'), false);
    assert.deepEqual(providers.get('chapter_note').render(), {
        content: 'Chapter two',
        data: { phase: 1 },
    });
    assert.equal(getSaves(), 2);
});

test('custom prompts master switch unregisters all providers and restores enabled entries only', async () => {
    const { subject, providers } = createSubject();
    await subject.add('enabled_prompt', 'on');
    await subject.add('disabled_prompt', 'off', false);
    assert.deepEqual([...providers.keys()], ['enabled_prompt']);

    await subject.setMasterEnabled(false);
    assert.equal(providers.size, 0);
    await subject.setMasterEnabled(true);
    assert.deepEqual([...providers.keys()], ['enabled_prompt']);
});

test('custom prompts reject macro collisions and invalid JSON without changing settings', async () => {
    const { subject, settings, providers } = createSubject();

    await assert.rejects(subject.add('user', 'bad'), /ST/);
    await assert.rejects(subject.add('good_name', 'bad', true, { dataJson: '{' }), /JSON/);
    assert.deepEqual(settings.customPrompts, []);
    assert.equal(providers.size, 0);
    assert.deepEqual(subject.validateDataJson('[]'), { ok: true });
    assert.equal(subject.hasSelfReference('good_name', 'include {{good_name}}'), true);
});
