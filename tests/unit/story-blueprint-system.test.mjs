import test from 'node:test';
import assert from 'node:assert/strict';

import { createStoryBlueprintSystem } from '../../systems/story-blueprint-system.js';

function fixture(overrides = {}) {
    const metadata = {};
    const chat = [{ mes: 'start' }, { mes: 'next' }];
    const definitions = new Map();
    const values = new Map();
    const calls = { saved: 0, setValues: [], definitions: [], logs: [] };
    const settings = {
        lang: 'en',
        storyBlueprintEnabled: true,
        storyBlueprintCompletionVariable: ' Chapter Done! ',
        storyBlueprintProgressionMode: 'leaf',
        storyBlueprintProgressionLevel: 0,
        storyBlueprintMaxNodes: 8,
        agentConfigs: {},
    };
    const variableSystem = {
        getDefinition: id => definitions.get(id),
        upsertDefinition: definition => {
            definitions.set(definition.id, definition);
            calls.definitions.push(definition);
        },
        getValue: id => values.get(id),
        setValue: (id, value, context) => {
            values.set(id, value);
            calls.setValues.push([id, value, context]);
        },
    };
    const dependencies = {
        settings,
        getChatMetadata: () => metadata,
        getChat: () => chat,
        EXT_KEY: 'gd',
        saveChatConditional: () => { calls.saved++; },
        renderPrompt: async prompt => prompt,
        generateRaw: async () => '',
        createCaller: () => ({ generate: async () => ({}) }),
        parseJson: value => value,
        variableSystem,
        getCurrentGroup: () => ({ members: ['alice.png'], disabled_members: [] }),
        log: (...args) => calls.logs.push(args),
        ...overrides,
    };
    return { system: createStoryBlueprintSystem(dependencies), settings, metadata, chat, definitions, values, calls, variableSystem };
}

function nestedBlueprint() {
    return {
        title: 'Quest',
        meta: { premise: 'Save the town' },
        nodes: [
            {
                id: 'chapter', type: 'chapter', title: 'Chapter', content: {},
                children: [
                    { id: 'scene-1', title: 'Scene 1', content: { purpose: 'Meet' } },
                    { id: 'scene-2', title: 'Scene 2', content: { purpose: 'Fight' } },
                ],
            },
            { id: 'ending', title: 'Ending', content: { purpose: 'Return' } },
        ],
    };
}

test('Story Blueprint normalizes chapters, duplicate ids, content, and completion variable ids', () => {
    const { system } = fixture();
    const blueprint = system.setBlueprint({
        title: '',
        chapters: [
            { id: 'same', title: 'One', content: 'text' },
            { id: 'same', title: 'Two', content: null },
            null,
        ],
    });
    assert.equal(blueprint.title, 'Story Blueprint');
    assert.equal(blueprint.nodes.length, 3);
    assert.deepEqual(blueprint.nodes.map(node => node.id), ['same', 'same_dup_1', 'node_2']);
    assert.equal(blueprint.nodes[0].content.text, 'text');
    assert.deepEqual(blueprint.nodes[1].content, {});
    assert.equal(system.getCompletionVariable(), 'chapter_done');
    assert.equal(system.normalizeCompletionVariable(' __Bad Value!! '), 'bad_value');
});

test('Story Blueprint exposes leaf, level, and all-node progression modes', () => {
    const { system, settings } = fixture();
    system.setBlueprint(nestedBlueprint());
    assert.deepEqual(system.getSteps().map(step => step.id), ['scene-1', 'scene-2', 'ending']);
    settings.storyBlueprintProgressionMode = 'level';
    settings.storyBlueprintProgressionLevel = 0;
    assert.deepEqual(system.getSteps().map(step => step.id), ['chapter', 'ending']);
    settings.storyBlueprintProgressionMode = 'all';
    assert.deepEqual(system.getSteps().map(step => step.id), ['chapter', 'scene-1', 'scene-2', 'ending']);
});

test('completion variables are created, repaired, cleared, and diagnosed when locked', () => {
    const { system, definitions, values, calls } = fixture();
    system.ensureCompletionVariable();
    const created = definitions.get('chapter_done');
    assert.equal(created.type, 'boolean');
    assert.equal(created.injectMode, 'manual');

    definitions.set('chapter_done', { ...created, injectMode: 'prompt', autoUpdate: false });
    system.ensureCompletionVariable();
    assert.equal(definitions.get('chapter_done').injectMode, 'manual');
    assert.equal(definitions.get('chapter_done').autoUpdate, true);

    definitions.set('chapter_done', { ...created, locked: true });
    system.ensureCompletionVariable();
    assert.equal(calls.logs.length, 1);
    values.set('chapter_done', true);
    system.clearCompletionSignal('test');
    assert.deepEqual(calls.setValues.at(-1), ['chapter_done', false, { source: 'story-blueprint', reason: 'test' }]);
});

test('completion signals advance once per step, deduplicate completion, and roll back', () => {
    const { system, values } = fixture();
    system.setBlueprint(nestedBlueprint());
    for (const expectedDone of [1, 2, 3]) {
        values.set('chapter_done', true);
        const result = system.consumeCompletionSignal('director');
        assert.equal(result.advanced, true);
        assert.equal(result.progress.doneCount, expectedDone);
    }
    assert.equal(system.getProgress().complete, true);
    values.set('chapter_done', true);
    assert.equal(system.consumeCompletionSignal().reason, 'duplicate');
    assert.equal(system.rollbackOne(), true);
    assert.equal(system.getProgress().doneCount, 2);
    assert.equal(system.rollbackOne(), true);
    assert.equal(system.rollbackOne(), true);
    assert.equal(system.rollbackOne(), false);
});

test('completion consumption handles disabled, unset, and missing-progress states', () => {
    const { system, settings, values } = fixture();
    assert.equal(system.consumeCompletionSignal().reason, 'not-set');
    values.set('chapter_done', true);
    assert.equal(system.consumeCompletionSignal().reason, 'no-progress-step');
    settings.storyBlueprintEnabled = false;
    values.set('chapter_done', true);
    assert.equal(system.consumeCompletionSignal().reason, 'disabled');
    assert.equal(values.get('chapter_done'), false);
});

test('manual progress controls jump, reset, edit, and delete normalized steps', () => {
    const { system } = fixture();
    system.setBlueprint(nestedBlueprint());
    assert.equal(system.setCurrentStep(2).doneCount, 2);
    assert.throws(() => system.setCurrentStep(4), /Invalid Story Blueprint step index/);
    assert.equal(system.updateStepTitle(1, 'Battle').steps[1].node.title, 'Battle');
    assert.throws(() => system.updateStepTitle(1, ' '), /Title cannot be empty/);
    assert.equal(system.deleteStep(0).total, 2);
    assert.throws(() => system.deleteStep(9), /Invalid Story Blueprint step index/);
    system.resetProgress();
    assert.equal(system.getProgress().doneCount, 0);
    system.resetBlueprint();
    assert.equal(system.getBlueprint(), null);
});

test('Story Blueprint prunes non-contiguous and future progress after chat rollback', () => {
    const { system, metadata, chat } = fixture();
    system.setBlueprint(nestedBlueprint());
    metadata.gd.storyBlueprint.doneSignals = [
        { nodeId: 'scene-1', chatLength: 1, time: 1 },
        { nodeId: 'scene-2', chatLength: 99, time: 2 },
        { nodeId: 'ending', chatLength: 1, time: 3 },
    ];
    system.getProgress();
    assert.deepEqual(metadata.gd.storyBlueprint.doneSignals.map(signal => signal.nodeId), ['scene-1']);
    chat.splice(0);
    assert.equal(system.getProgress().doneCount, 0);
});

test('provider rendering exposes current data and emits a completion notice once', () => {
    const { system, settings } = fixture();
    settings.storyBlueprintProviderTemplate = '{{progress.done}}/{{progress.total}} {{current.path}} {{current.content.purpose}}';
    system.setBlueprint(nestedBlueprint());
    assert.equal(system.renderCurrent(), '0/3 Chapter > Scene 1 Meet');
    assert.equal(system.renderProgress(), '0/3 Chapter > Scene 1');
    system.setCurrentStep(3);
    assert.match(system.renderCurrent({ consumeCompleteNotice: true }), /blueprint is complete/i);
    assert.equal(system.renderCurrent({ consumeCompleteNotice: true }), '');
    assert.equal(system.getProviderData().progress.complete, true);
});

test('blank blueprint helpers create and append unique chapters', () => {
    const { system } = fixture();
    const first = system.createBlankBlueprint();
    assert.equal(first.nodes.length, 1);
    const second = system.appendBlankChapter();
    assert.equal(second.nodes.length, 2);
    assert.equal(new Set(second.nodes.map(node => node.id)).size, 2);

    system.resetBlueprint();
    assert.equal(system.appendBlankChapter().nodes.length, 1);
});

test('health checks distinguish missing, empty, and usable blueprints', () => {
    const { system } = fixture();
    assert.deepEqual(system.healthCheck(), { ok: false, issues: ['Missing blueprint'] });
    system.setBlueprint({ nodes: [] });
    assert.equal(system.healthCheck().ok, false);
    system.setBlueprint(nestedBlueprint());
    assert.deepEqual(system.healthCheck(), { ok: true, issues: [] });
});
