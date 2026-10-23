import test from 'node:test';
import assert from 'node:assert/strict';

import { createStoryBlueprintSystem, projectStoryBlueprintProgress } from '../../systems/story-blueprint-system.js';

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

test('guarded completion variable never reuses a colliding user variable', () => {
    const metadata = { gd: { variables: { defs: [{ id: 'new_done', type: 'boolean', scope: 'global' }] } } };
    const definition = { id: 'new_done', type: 'boolean', scope: 'global', injectMode: 'manual' };
    const calls = [];
    const settings = { storyBlueprintEnabled: true, storyBlueprintCompletionVariable: 'new_done',
        storyBlueprintCompletionVariableGuard: 'new_done', storyBlueprintProgressionMode: 'leaf' };
    const system = createStoryBlueprintSystem({ settings, getChatMetadata: () => metadata, getChat: () => [], EXT_KEY: 'gd',
        saveChatConditional: () => calls.push('save'), variableSystem: {
            getDefinition: () => definition, getValue: () => true,
            upsertDefinition: () => calls.push('upsert'), setValue: () => calls.push('set'),
        }, log: () => {} });
    system.setBlueprint(nestedBlueprint());
    assert.equal(system.ensureCompletionVariable(), false);
    assert.equal(system.renderCurrent(), '');
    assert.throws(() => system.consumeCompletionSignal(), /conflicts/);
    assert.equal(system.consumeCompletionSignal().reason, 'variable-conflict');
    assert.equal(system.getProgress().doneCount, 0);
    assert.equal(calls.includes('upsert'), false);
    assert.equal(calls.includes('set'), false);
    settings.storyBlueprintEnabled = false;
    system.clearCompletionSignal('disabled-reset');
    assert.equal(calls.includes('set'), false);
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

test('progression impact projection reads raw state without pruning or saving it', () => {
    const { system, metadata, calls, chat } = fixture();
    system.setBlueprint(nestedBlueprint());
    metadata.gd.storyBlueprint.doneSignals = [{ nodeId: 'scene-1', chatLength: 1, time: 1 }];
    const before = JSON.stringify(metadata.gd.storyBlueprint);
    const saves = calls.saved;
    const current = projectStoryBlueprintProgress({ blueprint: metadata.gd.storyBlueprint.blueprint,
        doneSignals: metadata.gd.storyBlueprint.doneSignals, chatLength: chat.length, mode: 'leaf', level: 0 });
    const projected = projectStoryBlueprintProgress({ blueprint: metadata.gd.storyBlueprint.blueprint,
        doneSignals: metadata.gd.storyBlueprint.doneSignals, chatLength: chat.length, mode: 'level', level: 0 });
    assert.equal(current.doneCount, 1);
    assert.equal(current.currentNodeId, 'scene-2');
    assert.deepEqual(projected.stepIds, ['chapter', 'ending']);
    assert.equal(projected.doneCount, 0);
    assert.equal(projected.inactiveSignalCount, 1);
    assert.equal(JSON.stringify(metadata.gd.storyBlueprint), before);
    assert.equal(calls.saved, saves);
    // The existing runtime getter still prunes on read; a draft preview must use the pure projector.
});

test('progress tracks retain independent completion and notices across mode and level switches', () => {
    const { system, settings, metadata } = fixture();
    system.setBlueprint(nestedBlueprint());
    system.setCurrentStep(1);
    assert.equal(system.getProgress().current?.id, 'scene-2');

    settings.storyBlueprintProgressionMode = 'level';
    settings.storyBlueprintProgressionLevel = 0;
    assert.equal(system.getProgress().doneCount, 0);
    system.setCurrentStep(1);
    assert.equal(system.getProgress().current?.id, 'ending');

    settings.storyBlueprintProgressionLevel = 1;
    assert.equal(system.getProgress().doneCount, 0);
    system.setCurrentStep(2);
    settings.storyBlueprintProgressionMode = 'all';
    assert.equal(system.getProgress().doneCount, 0);
    system.setCurrentStep(1);

    settings.storyBlueprintProgressionMode = 'leaf';
    assert.equal(system.getProgress().doneCount, 1);
    settings.storyBlueprintProgressionMode = 'level';
    settings.storyBlueprintProgressionLevel = 0;
    assert.equal(system.getProgress().doneCount, 1);
    settings.storyBlueprintProgressionLevel = 1;
    assert.equal(system.getProgress().doneCount, 2);
    settings.storyBlueprintProgressionMode = 'all';
    assert.equal(system.getProgress().doneCount, 1);
    assert.deepEqual(Object.keys(metadata.gd.storyBlueprint.progressTracks).sort(), ['all', 'leaf', 'level:0', 'level:1']);
    const projected = projectStoryBlueprintProgress({ blueprint: metadata.gd.storyBlueprint.blueprint,
        progressTracks: metadata.gd.storyBlueprint.progressTracks, chatLength: 2, mode: 'level', level: 1 });
    assert.equal(projected.doneCount, 2);

    system.resetProgress();
    settings.storyBlueprintProgressionMode = 'leaf';
    assert.equal(system.getProgress().doneCount, 1);
    system.resetBlueprint();
    assert.deepEqual(Object.keys(metadata.gd.storyBlueprint.progressTracks), ['leaf']);
});

test('legacy progress is retained in the active mode with a recovery copy', () => {
    const { system, metadata, settings } = fixture();
    system.setBlueprint(nestedBlueprint());
    metadata.gd.storyBlueprint = {
        blueprint: metadata.gd.storyBlueprint.blueprint,
        doneSignals: [{ nodeId: 'scene-1', chatLength: 1, time: 1 }],
        completeNoticeKey: '',
    };
    assert.equal(system.getProgress().doneCount, 1);
    assert.deepEqual(metadata.gd.storyBlueprint.legacyDoneSignals.map(s => s.nodeId), ['scene-1']);
    settings.storyBlueprintProgressionMode = 'all';
    assert.equal(system.getProgress().doneCount, 0);
    settings.storyBlueprintProgressionMode = 'leaf';
    assert.equal(system.getProgress().doneCount, 1);
});

test('export and import round-trip every progress track while clean export excludes them', () => {
    const source = fixture();
    source.system.setBlueprint(nestedBlueprint());
    source.system.setCurrentStep(1);
    source.settings.storyBlueprintProgressionMode = 'all';
    source.system.setCurrentStep(2);
    const full = source.system.buildExportFile(true);
    const clean = source.system.buildExportFile(false);
    assert.equal(Object.keys(full.storyBlueprint.progressTracks).length, 2);
    assert.deepEqual(clean.storyBlueprint.progressTracks, {});

    const target = fixture();
    assert.deepEqual(target.system.applyImportText(JSON.stringify(full), { includeProgress: true }), { ok: true });
    assert.equal(target.system.getProgress().doneCount, 1);
    target.settings.storyBlueprintProgressionMode = 'all';
    assert.equal(target.system.getProgress().doneCount, 2);
    target.system.applyImportText(JSON.stringify(clean), { includeProgress: false });
    assert.equal(target.system.getProgress().doneCount, 0);
    target.settings.storyBlueprintProgressionMode = 'leaf';
    assert.equal(target.system.getProgress().doneCount, 0);
});

test('blueprint imports sanitize sparse legacy recovery signals without promoting them into active progress', () => {
    const { system, metadata } = fixture();
    const blueprint = { nodes: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] };
    assert.deepEqual(system.applyImportText(JSON.stringify({ blueprint, doneSignals: [], legacyDoneSignals: [
        null, 'bad', 4, { nodeId: 'missing' },
        { nodeId: 'b', stepIndex: 99, chatLength: -2, time: { valueOf: 1, toString: 1 }, source: { bad: true }, extra: 'drop' },
        { nodeId: 'b', time: 99 }, { nodeId: 'a', chatLength: 999, time: 12, source: 'manual' },
    ] }), { includeProgress: true }), { ok: true });
    const legacy = metadata.gd.storyBlueprint.legacyDoneSignals;
    assert.deepEqual(legacy.map(s => s.nodeId), ['b', 'a']);
    assert.equal(legacy[0].stepIndex, 1);
    assert.equal(legacy[0].chatLength, 0);
    assert.equal(legacy[0].source, 'import');
    assert.ok(Number.isFinite(legacy[0].time));
    assert.equal('extra' in legacy[0], false);
    assert.deepEqual(legacy[1], { nodeId: 'a', stepIndex: 0, chatLength: 2, time: 12, source: 'manual' });
    assert.equal(system.getProgress().doneCount, 0);
    system.applyImportText(JSON.stringify({ blueprint, doneSignals: [], legacyDoneSignals: [{ nodeId: 'a' }] }), { includeProgress: false });
    assert.equal(metadata.gd.storyBlueprint.legacyDoneSignals, undefined);
});

test('failed blueprint import restores all mode-specific tracks', async () => {
    let attempts = 0;
    const { system, settings } = fixture({ saveChatConfirmed: async () => {
        if (++attempts === 1) throw Error('save failed');
    } });
    system.setBlueprint(nestedBlueprint());
    system.setCurrentStep(1);
    settings.storyBlueprintProgressionMode = 'all';
    system.setCurrentStep(2);
    const before = system.buildExportFile(true).storyBlueprint.progressTracks;
    await assert.rejects(system.applyImportTextAndSave(JSON.stringify({ nodes: [{ id: 'new', title: 'New' }] }),
        { includeProgress: false }), /save failed/);
    assert.deepEqual(system.getState().progressTracks, before);
    settings.storyBlueprintProgressionMode = 'leaf';
    assert.equal(system.getProgress().doneCount, 1);
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

test('Story Blueprint Provider template replaces dot paths only and empty value restores its default', () => {
    const { system, settings } = fixture();
    system.setBlueprint(nestedBlueprint());
    settings.storyBlueprintProviderTemplate = '{{current.nodeJson}} / {{completionVariable}} / {{missing.path}}';
    const rendered = system.renderCurrent();
    assert.match(rendered, /"title": "Scene 1"/);
    assert.match(rendered, /chapter_done/);
    assert.doesNotMatch(rendered, /missing\.path/);
    assert.doesNotMatch(rendered, /undefined/);
    settings.storyBlueprintProviderTemplate = '';
    assert.match(system.renderCurrent(), /Story Blueprint/);
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
