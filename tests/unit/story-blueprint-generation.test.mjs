import test from 'node:test';
import assert from 'node:assert/strict';

import { createStoryBlueprintSystem } from '../../systems/story-blueprint-system.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

async function settle() {
    await new Promise(resolve => setTimeout(resolve, 0));
}

function fixture(overrides = {}) {
    const metadata = {};
    const chat = [{ mes: 'one' }, { mes: 'two' }];
    const calls = { saved: 0, rendered: [], generated: [] };
    const settings = {
        lang: 'en',
        storyBlueprintEnabled: true,
        storyBlueprintMaxNodes: 5,
        storyBlueprintPrompt: 'NEW max={{storyBlueprintMaxNodes}} {{recentMessages}}',
        storyBlueprintContinuePrompt: 'CONTINUE max={{storyBlueprintMaxNodes}} {{storyBlueprintProgress}}',
        storyBlueprintJsonSchema: '{"schema":true}',
        templateMaxPasses: 3,
        templateRecursive: true,
        templateDebugPlaceholders: false,
        agentConfigs: { 'story-blueprint': { provider: 'native' } },
    };
    const dependencies = {
        settings,
        getChatMetadata: () => metadata,
        getChat: () => chat,
        EXT_KEY: 'gd',
        saveChatConditional: () => { calls.saved++; },
        renderPrompt: async (...args) => { calls.rendered.push(args); return `rendered:${args[0]}`; },
        generateRaw: async options => { calls.generated.push(options); return options; },
        createCaller: (_config, generateRaw) => ({ generate: prompt => generateRaw({ prompt }) }),
        parseJson: raw => raw,
        variableSystem: { getValue: () => false, setValue: () => {}, getDefinition: () => ({ injectMode: 'manual' }) },
        getCurrentGroup: () => ({ members: ['alice.png', 'disabled.png'], disabled_members: ['disabled.png'] }),
        log: () => {},
        ...overrides,
    };
    return { system: createStoryBlueprintSystem(dependencies), settings, metadata, chat, calls };
}

function blueprint(id = 'first') {
    return {
        title: 'Quest',
        meta: { premise: 'Old', style: 'classic' },
        nodes: [{ id, title: 'First', content: { purpose: 'Begin' }, children: [] }],
    };
}

test('Story Blueprint prompt rendering carries host context, settings, and local blueprint data', async () => {
    const { system, calls } = fixture();
    system.setBlueprint(blueprint());
    const prompt = await system.renderGenerationPrompt('continue');
    assert.match(prompt, /^rendered:CONTINUE max=5/);
    assert.match(calls.rendered[0][0], /\[Output Format\]\n\{"schema":true\}/);
    assert.deepEqual(calls.rendered[0][1].enabledMembers, ['alice.png']);
    assert.equal(calls.rendered[0][2].maxPasses, 3);
    assert.match(calls.rendered[0][2].locals.storyBlueprintFullJson, /"Quest"/);
    assert.match(calls.rendered[0][2].locals.storyBlueprintProgress, /0\/1/);
});

test('new blueprint generation owns its busy flag and stores normalized output', async () => {
    const gate = deferred();
    const { system, metadata } = fixture({
        createCaller: () => ({ generate: () => gate.promise }),
    });
    const request = system.generateBlueprint('new');
    await settle();
    assert.equal(system.isGenerating(), true);
    await assert.rejects(system.generateBlueprint('new'), /already in progress/);
    gate.resolve({ title: 'Generated', chapters: [{ id: 'node', title: 'Node', content: 'text' }] });
    const result = await request;
    assert.equal(result.title, 'Generated');
    assert.equal(result.nodes[0].content.text, 'text');
    assert.equal(system.isGenerating(), false);
    assert.equal(metadata.gd.storyBlueprint.continuePending, false);
    assert.equal(metadata.gd.storyBlueprint.lastError, '');
});

test('continuation appends unique nodes, merges metadata, and preserves progress', async () => {
    const { system } = fixture({
        createCaller: () => ({
            generate: async () => ({
                meta: { style: 'modern', newField: 'kept' },
                nodes: [
                    { id: 'first', title: 'Second', content: {} },
                    { id: 'extra', title: 'Third', content: {}, children: [{ id: 'first', title: 'Child', content: {} }] },
                ],
            }),
        }),
    });
    system.setBlueprint(blueprint());
    system.setCurrentStep(1);
    const result = await system.generateBlueprint('continue');
    assert.equal(result.nodes.length, 3);
    assert.equal(new Set([result.nodes[0].id, result.nodes[1].id, result.nodes[2].children[0].id]).size, 3);
    assert.equal(result.meta.premise, 'Old');
    assert.equal(result.meta.style, 'modern');
    assert.equal(result.meta.newField, 'kept');
    assert.equal(system.getProgress().doneCount, 1);
});

test('generation failures persist a useful error and always clear pending state', async () => {
    const missing = fixture().system;
    await assert.rejects(missing.generateBlueprint('continue'), /No Story Blueprint to continue/);

    const { system, metadata } = fixture({ parseJson: () => null });
    await assert.rejects(system.generateBlueprint('new'), /no valid JSON blueprint/i);
    assert.match(metadata.gd.storyBlueprint.lastError, /no valid JSON blueprint/i);
    assert.equal(metadata.gd.storyBlueprint.continuePending, false);

    const empty = fixture({ createCaller: () => ({ generate: async () => ({ nodes: [] }) }) }).system;
    await assert.rejects(empty.generateBlueprint('new'), /returned no nodes/i);

    const continued = fixture({ createCaller: () => ({ generate: async () => ({ nodes: [] }) }) }).system;
    continued.setBlueprint(blueprint());
    await assert.rejects(continued.generateBlueprint('continue'), /continuation returned no nodes/i);
});

test('Story Blueprint export optionally includes progress without sharing live state', () => {
    const { system, metadata } = fixture();
    system.setBlueprint(blueprint());
    system.setCurrentStep(1);
    const full = system.buildExportFile(true);
    const clean = system.buildExportFile(false);
    assert.equal(full.type, 'group-director-story-blueprint');
    assert.equal(full.storyBlueprint.doneSignals.length, 1);
    assert.equal(clean.storyBlueprint.doneSignals.length, 0);
    full.storyBlueprint.blueprint.title = 'Mutated export';
    assert.equal(metadata.gd.storyBlueprint.blueprint.title, 'Quest');
});

test('Story Blueprint import validates raw and wrapped forms and sanitizes imported progress', () => {
    const { system, metadata } = fixture();
    assert.equal(system.applyImportText('{').ok, false);
    assert.equal(system.applyImportText('{}').ok, false);
    assert.equal(system.validateBlueprintInput({ nodes: [] }).ok, false);

    const raw = { chapters: [{ id: 'raw', title: 'Raw', content: {} }] };
    assert.equal(system.validateBlueprintInput(raw).ok, true);
    assert.equal(system.applyImportText(JSON.stringify(raw)).ok, true);
    assert.equal(system.getBlueprint().nodes[0].id, 'raw');

    const wrapped = {
        type: 'group-director-story-blueprint',
        storyBlueprint: {
            blueprint: {
                nodes: [
                    { id: 'one', title: 'One', content: {} },
                    { id: 'two', title: 'Two', content: {} },
                ],
            },
            doneSignals: [
                { nodeId: 'one', chatLength: 99, time: 1 },
                { nodeId: 'two', chatLength: 1, time: 2 },
                { nodeId: 'one', chatLength: 1, time: 3 },
            ],
        },
    };
    assert.equal(system.applyImportText(JSON.stringify(wrapped), { includeProgress: true }).ok, true);
    assert.deepEqual(metadata.gd.storyBlueprint.doneSignals.map(signal => signal.nodeId), ['one', 'two']);
    assert.equal(metadata.gd.storyBlueprint.doneSignals[0].chatLength, 2);
    assert.equal(metadata.gd.storyBlueprint.completeNoticeKey, '');
});

test('Story Blueprint transactional import awaits one save and rolls back around concurrent edits', async () => {
    const gate = deferred();
    let saves = 0;
    const { system } = fixture({ saveChatConditional: () => ++saves === 1 ? gate.promise : Promise.resolve() });
    system.setBlueprint(blueprint(), { persist: false });
    const incoming = {
        blueprint: {
            title: 'Imported',
            meta: { premise: 'Imported premise' },
            nodes: [{ id: 'imported', title: 'Imported', content: {}, children: [] }],
        },
    };
    const pending = system.applyImportTextAndSave(JSON.stringify(incoming));
    await Promise.resolve();
    system.getBlueprint().meta.concurrent = 'kept';
    system.getBlueprint().nodes.push({ id: 'concurrent', title: 'Concurrent', content: {}, children: [] });
    gate.reject(new Error('chat save failed'));
    await assert.rejects(pending, /chat save failed/);
    assert.equal(saves, 2);
    assert.equal(system.getBlueprint().title, 'Quest');
    assert.equal(system.getBlueprint().meta.premise, 'Old');
    assert.equal(system.getBlueprint().meta.concurrent, 'kept');
    assert.deepEqual(system.getBlueprint().nodes.map(node => node.id), ['first', 'concurrent']);
});

test('Story Blueprint transactional import reports failed rollback persistence', async () => {
    const { system } = fixture({ saveChatConditional: async () => { throw new Error('chat save failed'); } });
    system.setBlueprint(blueprint(), { persist: false });
    const incoming = { nodes: [{ id: 'imported', title: 'Imported', content: {}, children: [] }] };
    await assert.rejects(
        system.applyImportTextAndSave(JSON.stringify(incoming)),
        error => error.rollbackIncomplete === true && /rollback persistence failed/.test(error.message),
    );
    assert.equal(system.getBlueprint().title, 'Quest');
});

test('Story Blueprint import preserves possibly saved state when verification is unavailable', async () => {
    const unknown = Object.assign(new Error('verification unavailable'), { persistenceUnknown: true });
    const { system, calls } = fixture({ saveChatConfirmed: async () => { throw unknown; } });
    system.setBlueprint(blueprint(), { persist: false });
    const incoming = { nodes: [{ id: 'imported', title: 'Imported', content: {}, children: [] }] };
    await assert.rejects(
        system.applyImportTextAndSave(JSON.stringify(incoming)),
        error => error === unknown,
    );
    assert.equal(system.getBlueprint().nodes[0].id, 'imported');
    assert.equal(calls.saved, 0);
});

test('Story Blueprint transactional import reports a chat switch without undoing saved old-chat state', async () => {
    const gate = deferred();
    const oldMetadata = {};
    const newMetadata = {};
    let currentMetadata = oldMetadata;
    const { system } = fixture({
        getChatMetadata: () => currentMetadata,
        saveChatConditional: () => gate.promise,
    });
    system.setBlueprint(blueprint(), { persist: false });
    const incoming = { nodes: [{ id: 'imported', title: 'Imported', content: {}, children: [] }] };
    const pending = system.applyImportTextAndSave(JSON.stringify(incoming));
    await Promise.resolve();
    currentMetadata = newMetadata;
    gate.resolve();
    await assert.rejects(pending, { name: 'StaleExecutionError' });
    assert.equal(oldMetadata.gd.storyBlueprint.blueprint.nodes[0].id, 'imported');
    assert.equal(newMetadata.gd, undefined);
});

test('Story Blueprint transactional import returns validation failures without saving', async () => {
    const { system, calls } = fixture();
    assert.equal((await system.applyImportTextAndSave('{')).ok, false);
    assert.equal(calls.saved, 0);
});

test('Story Blueprint exposes stable language defaults and schema/template contracts', () => {
    const { system } = fixture();
    assert.match(system.getDefaultPrompt(), /story blueprint/i);
    assert.match(system.getDefaultContinuePrompt(), /continue/i);
    assert.match(system.getDefaultTemplate(), /Story Blueprint/);
    assert.match(system.getDefaultSchema(), /"nodes"/);
});
