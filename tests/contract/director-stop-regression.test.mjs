import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createRoundOrchestrator } from '../../systems/round-orchestrator.js';

const source = await readFile(new URL('../../index.js', import.meta.url), 'utf8');
const functionStart = source.indexOf('async function runManualOrderedGeneration()');
const functionEnd = source.indexOf('/**\n * Story Blueprint completion', functionStart);
const takeoverSource = source.slice(functionStart, functionEnd < 0 ? source.indexOf('function handleStoryBlueprintAdvance', functionStart) : functionEnd);

for (const phase of ['render', 'delay', 'generate', 'empty', 'success']) {
    test(`review P2-1: takeover ${phase} respects stop and does not mark empty output complete`, async () => {
        let generates = 0;
        const context = { characterId: 0 };
        const sandbox = {
            generationStopped: false, manualGenInProgress: false, llmPickedAvatars: ['a', 'b'],
            takeoverOwner: null, takeoverWrapperPending: false, directorRoundEpoch: 0, chat_metadata: {}, AbortController,
            characters: [{ name: 'Alice', avatar: 'a' }, { name: 'Bob', avatar: 'b' }], chat: [],
            roundOrchestrator: createRoundOrchestrator(),
            getContext: () => context,
            setCharacterId: id => { context.characterId = id; }, setCharacterName: () => {},
            getScriptForChar: async () => { if (phase === 'render') sandbox.generationStopped = true; return ''; },
            setExtensionPrompt: () => {}, getScriptPosition: () => 0,
            setTimeout: callback => { if (phase === 'delay') sandbox.generationStopped = true; callback(); },
            console: { warn() {}, error() {}, log() {} },
        };
        context.generate = async () => {
            generates++;
            if (phase === 'generate') sandbox.generationStopped = true;
            if (phase !== 'empty') sandbox.chat.push({ name: sandbox.characters[context.characterId].name, mes: 'reply' });
        };
        const run = vm.runInNewContext(`${takeoverSource}\nrunManualOrderedGeneration`, sandbox);
        await run();
        assert.equal(generates, phase === 'success' ? 2 : phase === 'render' || phase === 'delay' ? 0 : 1);
        assert.equal(sandbox.manualGenInProgress, false);
        const snapshot = sandbox.roundOrchestrator.getSnapshot();
        assert.equal(snapshot.takeoverFailed, phase !== 'success');
        assert.equal(snapshot.takeoverCompleted.length, phase === 'success' ? 2 : 0);
    });
}

test('review P2-3: explicit retry and reroll clear a previous stop before reusing the plan', () => {
    const start = source.indexOf('eventSource.on(event_types.GROUP_WRAPPER_STARTED');
    const end = source.indexOf('eventSource.on(event_types.GROUP_WRAPPER_FINISHED', start);
    const listenerSource = source.slice(start, end);
    for (const kind of ['retry_failed', 'reuse_or_restore_plan']) {
        let listener;
        const sandbox = {
            eventSource: { on(_event, fn) { listener = fn; } }, event_types: { GROUP_WRAPPER_STARTED: 'start' },
            generationStopped: true, roundGenerateType: 'normal', roundInitialized: false,
            takeoverOwner: null, takeoverWrapperPending: false, directorRoundEpoch: 0,
            roundOrchestrator: { startWrapper: () => ({ kind }), retryFailed() {} },
            settings: { mode: 'llm', llmRespectOrder: true }, MODE_LLM: 'llm',
            llmPickedSet: null, getDirectorHistory: () => [], window: {}, log() {}, console: { warn() {} },
        };
        vm.runInNewContext(listenerSource, sandbox);
        listener({ type: 'swipe' });
        assert.equal(sandbox.generationStopped, false);
        assert.equal(sandbox.roundInitialized, true);
    }
});

function takeoverFixture() {
    const listeners = new Map(), requests = [], prompts = [];
    let generated = 0, resolveGeneration;
    const context = { characterId: 0 };
    const sandbox = {
        eventSource: { on(event, callback) { listeners.set(event, callback); } },
        event_types: { GENERATION_STARTED: 'generation', GROUP_WRAPPER_STARTED: 'start', GROUP_WRAPPER_FINISHED: 'finish' },
        directorRoundEpoch: 0, takeoverOwner: null, takeoverWrapperPending: false, AbortController,
        generationStopped: false, manualGenInProgress: false, llmPickedAvatars: ['a', 'b'], llmPickedSet: new Set(['a', 'b']),
        characters: [{ name: 'Alice', avatar: 'a' }, { name: 'Bob', avatar: 'b' }], chat: [], chat_metadata: {}, EXT_KEY: 'test',
        roundOrchestrator: createRoundOrchestrator(), roundGenerateType: 'normal', isGroupChat: false,
        settings: { mode: 'llm', llmRespectOrder: true }, MODE_LLM: 'llm',
        getContext: () => context,
        setCharacterId: id => { context.characterId = id; }, setCharacterName() {},
        getScriptForChar: async () => 'script', getScriptPosition: () => 0, DIRECTOR_SCRIPT_KEY: 'script',
        setExtensionPrompt: (_key, text) => { prompts.push(text); },
        setTimeout: callback => callback(),
        roundTriggeredAvatars: new Set(), scriptCounterSnapshots: new Map(), wiState: {},
        scriptExecutorSystem: { resetTurnShared() {}, executeAll: async () => {} }, roundCounterReset() {},
        postSpeechRoundQueue: [], postSpeechRoundRan: false, scriptExecutorRoundRan: false,
        getDirectorHistory: () => [], getCurrentGroup: () => ({ members: ['a', 'b'] }), window: {}, log() {},
        console: { warn() {}, error() {}, log() {} },
    };
    const start = source.indexOf('eventSource.on(event_types.GENERATION_STARTED');
    const end = source.indexOf('eventSource.on(event_types.GROUP_WRAPPER_FINISHED', start);
    vm.runInNewContext(source.slice(start, end), sandbox);
    const finishedEnd = source.indexOf('// When messages are deleted', end);
    vm.runInNewContext(source.slice(end, finishedEnd), sandbox);
    const run = vm.runInNewContext(`${takeoverSource}\nrunManualOrderedGeneration`, sandbox);
    const hooks = {};
    context.generate = async (type, params) => {
        generated++;
        requests.push(params);
        // Host emits the outer start with our signal, then a wrapper start,
        // then its inner Generate with a different host-owned signal.
        listeners.get('generation')(type, params, false);
        listeners.get('start')({ type });
        listeners.get('generation')(type, { ...params, signal: new AbortController().signal }, false);
        const decision = sandbox.roundOrchestrator.decideTakeoverTurn({ avatar: sandbox.characters[params.force_chid].avatar, plannedAvatars: sandbox.llmPickedAvatars });
        assert.equal(decision.action, 'allow');
        await hooks.during?.();
        if (hooks.hold) await new Promise(resolve => { resolveGeneration = resolve; });
        sandbox.chat.push({ name: sandbox.characters[params.force_chid].name, mes: 'reply' });
        await listeners.get('finish')({ type });
    };
    return { sandbox, listeners, run, requests, prompts, hooks, get generated() { return generated; }, release: () => resolveGeneration?.() };
}

test('official generation event identity preserves GD wrappers through the last planned speaker', async () => {
    const f = takeoverFixture();
    await f.run();
    assert.equal(f.generated, 2);
    assert.equal(f.sandbox.directorRoundEpoch, 0);
    assert.deepEqual(f.sandbox.roundOrchestrator.getSnapshot().takeoverCompleted, ['a', 'b']);
    assert.equal(f.sandbox.manualGenInProgress, false);
});

for (const outcome of ['resolve', 'reject']) {
    test(`new user wrapper invalidates old takeover; late ${outcome} cannot clear the new plan or identity`, async () => {
        const f = takeoverFixture();
        let newOwner;
        f.hooks.during = async () => {
            const oldOwner = f.sandbox.takeoverOwner;
            f.listeners.get('generation')('normal', {}, false);
            f.listeners.get('start')({ type: 'normal' });
            assert.equal(oldOwner.controller.signal.aborted, true);
            assert.equal(f.sandbox.roundInitialized, false);
            f.sandbox.roundOrchestrator.beginTakeover(['b'], { knownAvatars: new Set(['b']) });
            newOwner = { controller: new AbortController(), characterId: 1 };
            f.sandbox.takeoverOwner = newOwner;
            f.sandbox.manualGenInProgress = true;
            f.sandbox.llmPickedAvatars = ['b'];
            f.sandbox.setCharacterId(1);
            f.sandbox.setExtensionPrompt('script', 'new script');
            if (outcome === 'reject') throw new Error('old request rejected');
        };
        await f.run();
        assert.equal(f.generated, 1);
        assert.equal(f.sandbox.takeoverOwner, newOwner);
        assert.equal(f.sandbox.manualGenInProgress, true);
        assert.equal(f.sandbox.roundOrchestrator.getSnapshot().takeoverRemaining, 1);
        assert.equal(f.sandbox.roundOrchestrator.getSnapshot().takeoverFailed, false);
        assert.deepEqual(f.sandbox.roundOrchestrator.getSnapshot().takeoverCompleted, []);
        assert.equal(f.sandbox.getContext().characterId, 1);
        assert.deepEqual(f.prompts, ['script', '', 'new script']);
    });
}

test('old wrapper finish does not clear a replacement round pending flag after awaiting takeover', async () => {
    const f = takeoverFixture();
    const started = Promise.withResolvers();
    const pending = Promise.withResolvers();
    f.sandbox.runManualOrderedGeneration = async () => { started.resolve(); await pending.promise; };
    f.sandbox.roundOrchestrator.setPending(true);
    const finishing = f.listeners.get('finish')();
    await started.promise;
    f.listeners.get('generation')('normal', {}, false);
    f.listeners.get('start')({ type: 'normal' });
    f.sandbox.roundOrchestrator.setPending(true);
    pending.resolve(); await finishing;
    assert.equal(f.sandbox.roundOrchestrator.getSnapshot().takeoverPending, true);
});

test('duplicate takeover entry cannot replace the owner of an in-flight generation', async () => {
    const f = takeoverFixture();
    const started = Promise.withResolvers();
    f.hooks.hold = true; f.hooks.during = () => started.resolve();
    const running = f.run();
    await started.promise;
    const owner = f.sandbox.takeoverOwner;
    await f.run();
    assert.equal(f.generated, 1);
    assert.equal(f.sandbox.takeoverOwner, owner);
    // Let context.generate reach the hold before releasing its gate.
    await Promise.resolve();
    f.hooks.hold = false; f.release();
    await running;
    assert.equal(f.generated, 2);
});
