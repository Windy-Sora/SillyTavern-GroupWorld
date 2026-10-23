import test from 'node:test';
import assert from 'node:assert/strict';
import { syncConfigPromptEditors } from '../../muyu/ui/config-prompt-editors.js';

function editor(defaultPrompt, value = '') {
    const element = {}, state = { value };
    return { 0: element, state,
        data: key => ['gdDefaultPrompt', 'gdDefaultSchema', 'gdDefaultTemplate'].includes(key) ? defaultPrompt : undefined,
        val(next) { state.value = next; },
    };
}

test('Config Prompt sync preserves focused draft and refreshes only changed idle editors', () => {
    const summary = editor('Default summary', 'draft in progress');
    const critique = editor('Default critique', 'old text');
    const calls = [];
    const getControl = id => { calls.push(id); return id === 'summary-prompt' ? summary : critique; };
    syncConfigPromptEditors({ fields: ['summaryPrompt', 'critiquePrompt'], settings: { summaryPrompt: 'new summary', critiquePrompt: 'new critique' }, getControl, activeElement: summary[0] });
    assert.equal(summary.state.value, 'draft in progress');
    assert.equal(critique.state.value, 'new critique');
    assert.deepEqual(calls, ['summary-prompt', 'critique-prompt']);
    calls.length = 0;
    syncConfigPromptEditors({ fields: ['critiquePrompt'], settings: { critiquePrompt: '' }, getControl, activeElement: null });
    assert.equal(critique.state.value, 'Default critique');
    assert.deepEqual(calls, ['critique-prompt']);
});

test('Critique output example sync keeps a focused draft and restores the built-in display on reset', () => {
    const schema = editor('{"directorCritique":{},"characterCritiques":{}}', 'draft');
    const getControl = id => id === 'critique-schema' ? schema : undefined;
    syncConfigPromptEditors({ fields: ['critiqueSchema'], settings: { critiqueSchema: '{"directorCritique":{"pacing":"ok"},"characterCritiques":{}}' }, getControl, activeElement: schema[0] });
    assert.equal(schema.state.value, 'draft');
    syncConfigPromptEditors({ fields: ['critiqueSchema'], settings: { critiqueSchema: '' }, getControl, activeElement: null });
    assert.equal(schema.state.value, '{"directorCritique":{},"characterCritiques":{}}');
});

test('Profile generator Prompt sync preserves the focused classic draft and shows default on reset', () => {
    const profile = editor('Built-in {{charName}}', 'unsaved draft');
    const getControl = id => id === 'profile-generator-prompt' ? profile : undefined;
    syncConfigPromptEditors({ fields: ['profileGeneratorPrompt'], settings: { profileGeneratorPrompt: 'New {{charName}}' }, getControl, activeElement: profile[0] });
    assert.equal(profile.state.value, 'unsaved draft');
    syncConfigPromptEditors({ fields: ['profileGeneratorPrompt'], settings: { profileGeneratorPrompt: 'New {{charName}}' }, getControl, activeElement: null });
    assert.equal(profile.state.value, 'New {{charName}}');
    syncConfigPromptEditors({ fields: ['profileGeneratorPrompt'], settings: { profileGeneratorPrompt: '' }, getControl, activeElement: null });
    assert.equal(profile.state.value, 'Built-in {{charName}}');
});

test('Profile JSON Schema sync preserves a focused draft and displays the built-in example for an empty setting', () => {
    const schema = editor('{"type":"object"}', 'unsaved schema');
    const getControl = id => id === 'profile-json-schema' ? schema : undefined;
    syncConfigPromptEditors({ fields: ['profileJsonSchema'], settings: { profileJsonSchema: '{"type":"object","properties":{}}' }, getControl, activeElement: schema[0] });
    assert.equal(schema.state.value, 'unsaved schema');
    syncConfigPromptEditors({ fields: ['profileJsonSchema'], settings: { profileJsonSchema: '{"type":"object","properties":{}}' }, getControl, activeElement: null });
    assert.equal(schema.state.value, '{"type":"object","properties":{}}');
    syncConfigPromptEditors({ fields: ['profileJsonSchema'], settings: { profileJsonSchema: '' }, getControl, activeElement: null });
    assert.equal(schema.state.value, '{"type":"object"}');
});

test('Profile render template sync preserves a focused draft and displays the built-in template for an empty setting', () => {
    const template = editor('{{name}}: {{summary}}', 'unsaved template');
    const getControl = id => id === 'profile-render-template' ? template : undefined;
    syncConfigPromptEditors({ fields: ['profileRenderTemplate'], settings: { profileRenderTemplate: '{{name}} / {{tags}}' }, getControl, activeElement: template[0] });
    assert.equal(template.state.value, 'unsaved template');
    syncConfigPromptEditors({ fields: ['profileRenderTemplate'], settings: { profileRenderTemplate: '{{name}} / {{tags}}' }, getControl, activeElement: null });
    assert.equal(template.state.value, '{{name}} / {{tags}}');
    syncConfigPromptEditors({ fields: ['profileRenderTemplate'], settings: { profileRenderTemplate: '' }, getControl, activeElement: null });
    assert.equal(template.state.value, '{{name}}: {{summary}}');
});

test('PostSpeech Prompt sync preserves a focused draft and displays each built-in default on reset', () => {
    const message = editor('Default message policy', 'unsaved message draft');
    const round = editor('Default round policy', 'old round policy');
    const getControl = id => id === 'ps-msg-prompt' ? message : id === 'ps-round-prompt' ? round : undefined;
    syncConfigPromptEditors({ fields: ['postSpeechMessagePrompt', 'postSpeechRoundPrompt'], settings: {
        postSpeechMessagePrompt: 'new message policy', postSpeechRoundPrompt: 'new round policy',
    }, getControl, activeElement: message[0] });
    assert.equal(message.state.value, 'unsaved message draft');
    assert.equal(round.state.value, 'new round policy');
    syncConfigPromptEditors({ fields: ['postSpeechMessagePrompt', 'postSpeechRoundPrompt'], settings: {
        postSpeechMessagePrompt: '', postSpeechRoundPrompt: '',
    }, getControl, activeElement: null });
    assert.equal(message.state.value, 'Default message policy');
    assert.equal(round.state.value, 'Default round policy');
});

test('Memory Prompt sync preserves a focused draft and displays both built-in defaults on reset', () => {
    const extraction = editor('Extract {{newRecentMessages}}', 'local draft');
    const compression = editor('Compress {{memories}}', 'old compression');
    const getControl = id => id === 'memory-prompt' ? extraction : id === 'memory-compress-prompt' ? compression : undefined;
    syncConfigPromptEditors({ fields: ['memoryPrompt', 'memoryCompressPrompt'], settings: {
        memoryPrompt: 'New {{newRecentMessages}}', memoryCompressPrompt: 'New {{memories}}',
    }, getControl, activeElement: extraction[0] });
    assert.equal(extraction.state.value, 'local draft');
    assert.equal(compression.state.value, 'New {{memories}}');
    syncConfigPromptEditors({ fields: ['memoryPrompt', 'memoryCompressPrompt'], settings: {
        memoryPrompt: '', memoryCompressPrompt: '',
    }, getControl, activeElement: null });
    assert.equal(extraction.state.value, 'Extract {{newRecentMessages}}');
    assert.equal(compression.state.value, 'Compress {{memories}}');
});

test('Memory Schema and render template sync preserve focused drafts and display defaults on reset', () => {
    const schema = editor('{"type":"object"}', 'local schema draft');
    const template = editor('{{#charMemory:groups}}default{{/charMemory:groups}}', 'old template');
    const getControl = id => id === 'memory-json-schema' ? schema : id === 'memory-render-template' ? template : undefined;
    syncConfigPromptEditors({ fields: ['memoryJsonSchema', 'memoryRenderTemplate'], settings: {
        memoryJsonSchema: '{"type":"object","required":["memories"]}', memoryRenderTemplate: 'new template',
    }, getControl, activeElement: schema[0] });
    assert.equal(schema.state.value, 'local schema draft');
    assert.equal(template.state.value, 'new template');
    syncConfigPromptEditors({ fields: ['memoryJsonSchema', 'memoryRenderTemplate'], settings: {
        memoryJsonSchema: '', memoryRenderTemplate: '',
    }, getControl, activeElement: null });
    assert.equal(schema.state.value, '{"type":"object"}');
    assert.equal(template.state.value, '{{#charMemory:groups}}default{{/charMemory:groups}}');
});

test('Story Blueprint Prompt sync preserves a focused draft and restores language-specific defaults', () => {
    const generation = editor('Generate default EN', 'unfinished draft');
    const continuation = editor('Continue default EN', 'old saved value');
    const getControl = id => id === 'story-blueprint-prompt' ? generation : id === 'story-blueprint-continue-prompt' ? continuation : undefined;
    syncConfigPromptEditors({ fields: ['storyBlueprintPrompt', 'storyBlueprintContinuePrompt'], settings: {
        storyBlueprintPrompt: 'New generation', storyBlueprintContinuePrompt: 'New continuation',
    }, getControl, activeElement: generation[0] });
    assert.equal(generation.state.value, 'unfinished draft');
    assert.equal(continuation.state.value, 'New continuation');
    syncConfigPromptEditors({ fields: ['storyBlueprintPrompt', 'storyBlueprintContinuePrompt'], settings: {
        storyBlueprintPrompt: '', storyBlueprintContinuePrompt: '',
    }, getControl, activeElement: null });
    assert.equal(generation.state.value, 'Generate default EN');
    assert.equal(continuation.state.value, 'Continue default EN');
});

test('Story Blueprint output format and Provider template sync preserve focused drafts and display defaults', () => {
    const schema = editor('Built-in nodes example', 'unsaved format');
    const template = editor('{{current.nodeJson}} / {{completionVariable}}', 'old template');
    const getControl = id => id === 'story-blueprint-schema' ? schema : id === 'story-blueprint-template' ? template : undefined;
    syncConfigPromptEditors({ fields: ['storyBlueprintJsonSchema', 'storyBlueprintProviderTemplate'], settings: {
        storyBlueprintJsonSchema: 'New nodes format', storyBlueprintProviderTemplate: '{{current.nodeJson}} new',
    }, getControl, activeElement: schema[0] });
    assert.equal(schema.state.value, 'unsaved format');
    assert.equal(template.state.value, '{{current.nodeJson}} new');
    syncConfigPromptEditors({ fields: ['storyBlueprintJsonSchema', 'storyBlueprintProviderTemplate'], settings: {
        storyBlueprintJsonSchema: '', storyBlueprintProviderTemplate: '',
    }, getControl, activeElement: null });
    assert.equal(schema.state.value, 'Built-in nodes example');
    assert.equal(template.state.value, '{{current.nodeJson}} / {{completionVariable}}');
});

test('Director script editors sync independent leaves while preserving focused drafts and literal empty values', () => {
    const prompt = editor('unused default', 'unsaved style');
    const wrapper = editor('unused default', 'old wrapper');
    const getControl = id => id === 'llm-script-prompt' ? prompt : id === 'llm-script-wrapper' ? wrapper : undefined;
    syncConfigPromptEditors({ fields: ['llmScriptPrompt', 'llmScriptWrapper'], settings: {
        llmScriptPrompt: 'New style', llmScriptWrapper: '[{{script}}]',
    }, getControl, activeElement: prompt[0] });
    assert.equal(prompt.state.value, 'unsaved style');
    assert.equal(wrapper.state.value, '[{{script}}]');
    syncConfigPromptEditors({ fields: ['llmScriptPrompt', 'llmScriptWrapper'], settings: {
        llmScriptPrompt: '', llmScriptWrapper: '',
    }, getControl, activeElement: null });
    assert.equal(prompt.state.value, '');
    assert.equal(wrapper.state.value, '');
});

test('Director output-format editor preserves a draft and shows an effective empty value as empty', () => {
    const schema = editor('Built-in example', 'unsaved text');
    const getControl = id => id === 'llm-json-schema' ? schema : undefined;
    syncConfigPromptEditors({ fields: ['llmJsonSchema'], settings: { llmJsonSchema: 'Custom speakers text' },
        getControl, activeElement: schema[0] });
    assert.equal(schema.state.value, 'unsaved text');
    syncConfigPromptEditors({ fields: ['llmJsonSchema'], settings: { llmJsonSchema: '' },
        getControl, activeElement: null });
    assert.equal(schema.state.value, '');
    syncConfigPromptEditors({ fields: ['llmJsonSchema'], settings: { llmJsonSchema: 'Built-in example' },
        getControl, activeElement: null });
    assert.equal(schema.state.value, 'Built-in example');
});

test('Director continuity wrapper editors keep focused drafts and display literal empty values', () => {
    const last = editor('unused default', 'unsaved last wrapper');
    const history = editor('unused default', 'old history wrapper');
    const getControl = id => id === 'llm-script-continuity-wrapper' ? last
        : id === 'llm-script-continuity-history-wrapper' ? history : undefined;
    syncConfigPromptEditors({ fields: ['llmScriptContinuityWrapper', 'llmScriptContinuityHistoryWrapper'], settings: {
        llmScriptContinuityWrapper: 'Last {{previousPlan}}', llmScriptContinuityHistoryWrapper: 'All {{previousPlans}}',
    }, getControl, activeElement: last[0] });
    assert.equal(last.state.value, 'unsaved last wrapper');
    assert.equal(history.state.value, 'All {{previousPlans}}');
    syncConfigPromptEditors({ fields: ['llmScriptContinuityWrapper', 'llmScriptContinuityHistoryWrapper'], settings: {
        llmScriptContinuityWrapper: '', llmScriptContinuityHistoryWrapper: '',
    }, getControl, activeElement: null });
    assert.equal(last.state.value, ''); assert.equal(history.state.value, '');
});

test('World-info wrapper editor preserves a focused draft and displays a literal empty value', () => {
    const wrapper = editor('unused default', 'unsaved world-info wrapper');
    const getControl = id => id === 'llm-world-info-wrapper' ? wrapper : undefined;
    syncConfigPromptEditors({ fields: ['llmWorldInfoWrapper'], settings: { llmWorldInfoWrapper: '[{{worldInfo}}]' },
        getControl, activeElement: wrapper[0] });
    assert.equal(wrapper.state.value, 'unsaved world-info wrapper');
    syncConfigPromptEditors({ fields: ['llmWorldInfoWrapper'], settings: { llmWorldInfoWrapper: '' },
        getControl, activeElement: null });
    assert.equal(wrapper.state.value, '');
});

test('Four text editors preserve a focused draft and show each effective empty value', () => {
    const names = ['forceSpeakPrompt', 'knowledgeText', 'identityPrompt', 'npcPrompt'];
    const controls = ['force-speak-prompt', 'knowledge-text', 'identity-prompt', 'npc-prompt'];
    const defaults = ['Default force', '', 'Default identity', 'Default NPC'];
    const editors = controls.map((_, i) => editor(defaults[i], `draft ${i}`));
    const getControl = id => editors[controls.indexOf(id)];
    syncConfigPromptEditors({ fields: names, settings: Object.fromEntries(names.map(id => [id, 'saved'])),
        getControl, activeElement: editors[0][0] });
    assert.equal(editors[0].state.value, 'draft 0');
    for (const control of editors.slice(1)) assert.equal(control.state.value, 'saved');
    syncConfigPromptEditors({ fields: names, settings: Object.fromEntries(names.map(id => [id, ''])),
        getControl, activeElement: null });
    assert.deepEqual(editors.map(control => control.state.value), defaults);
});
