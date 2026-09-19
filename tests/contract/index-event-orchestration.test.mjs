import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../../index.js', import.meta.url), 'utf8');

function listenerStarts(eventName) {
    const needle = `eventSource.on(event_types.${eventName}`;
    const starts = [];
    let cursor = 0;
    while ((cursor = source.indexOf(needle, cursor)) >= 0) {
        starts.push(cursor);
        cursor += needle.length;
    }
    return starts;
}

function listenerBlock(eventName, occurrence = 0) {
    const start = listenerStarts(eventName)[occurrence];
    assert.notEqual(start, undefined, `missing ${eventName} listener #${occurrence + 1}`);
    const next = source.indexOf('eventSource.on(event_types.', start + 1);
    return source.slice(start, next < 0 ? source.length : next);
}

function assertOrdered(block, fragments) {
    let cursor = -1;
    for (const fragment of fragments) {
        const next = block.indexOf(fragment);
        assert.ok(next >= 0, `missing orchestration fragment: ${fragment}`);
        assert.ok(next > cursor, `fragment is out of order: ${fragment}`);
        cursor = next;
    }
}

test('index registers the complete SillyTavern event surface exactly once', () => {
    const expected = {
        GROUP_WRAPPER_STARTED: 1,
        GROUP_WRAPPER_FINISHED: 1,
        GENERATION_STOPPED: 1,
        CHARACTER_MESSAGE_RENDERED: 2,
        MESSAGE_DELETED: 1,
        CHAT_CHANGED: 1,
        APP_READY: 1,
        SETTINGS_UPDATED: 1,
    };
    const registrations = [...source.matchAll(/eventSource\.on\(event_types\.([A-Z_]+)/g)]
        .map(match => match[1]);
    assert.deepEqual(
        Object.fromEntries(Object.keys(expected).map(name => [name, registrations.filter(value => value === name).length])),
        expected,
    );
    assert.deepEqual([...new Set(registrations)].sort(), Object.keys(expected).sort());
});

test('library settings adapter requires a host save success event and removes its listener', async () => {
    const adapter = source.match(/async function saveSettingsConfirmed\(\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(adapter);
    const listeners = new Set();
    const eventSource = {
        on(_event, listener) { listeners.add(listener); },
        removeListener(_event, listener) { listeners.delete(listener); },
        async emit() { for (const listener of listeners) listener(); },
    };
    const context = {
        settings: { npcLibraries: [{ id: 'pack' }] }, extension_settings: {}, EXT_KEY: 'gd',
        event_types: { SETTINGS_UPDATED: 'settings_updated' }, eventSource,
        setProviderTimeoutDefault() {},
        saveSettingsHost: async () => { await eventSource.emit(); },
    };
    vm.runInNewContext(adapter, context);
    await context.saveSettingsConfirmed();
    assert.equal(context.extension_settings.gd, context.settings);
    assert.equal(listeners.size, 0);

    context.saveSettingsHost = async () => {}; // Host catches its own network failure.
    await assert.rejects(context.saveSettingsConfirmed(), /not confirmed/);
    assert.equal(listeners.size, 0);
});

test('all reusable libraries use confirmed settings persistence', () => {
    assert.match(source, /createProfileLibrarySystem\(\{[\s\S]*?saveSettings: saveSettingsConfirmed/);
    assert.match(source, /createStoryBlueprintLibrarySystem\(\{[\s\S]*?saveSettings: saveSettingsConfirmed/);
    assert.match(source, /createNpcLibrarySystem\(\{[\s\S]*?saveSettings: saveSettingsConfirmed/);
});

test('NPC mutations and imports use the confirmed chat persistence adapter', () => {
    assert.match(source, /const saveNpcChatConfirmed = createConfirmedNpcChatSave\(/);
    assert.match(source, /createNpcExportSystem\(\{[\s\S]*?saveChatConditional: saveNpcChatConfirmed/);
    assert.match(source, /createNpcSystem\(\{[\s\S]*?saveChatConditional: saveNpcChatConfirmed/);
});

test('PostSpeech decisions use confirmed chat persistence', () => {
    assert.match(source, /const savePostSpeechChatConfirmed = createConfirmedPostSpeechChatSave\(/);
    assert.match(source, /createPostSpeechSystem\(\{[\s\S]*?saveChatConditional: savePostSpeechChatConfirmed/);
});

test('Chat Summary and Story Blueprint imports use confirmed chat persistence', () => {
    assert.match(source, /const saveSummaryChatConfirmed = createConfirmedChatMetadataSave\(/);
    assert.match(source, /const saveStoryBlueprintChatConfirmed = createConfirmedChatMetadataSave\(/);
    assert.match(source, /createStoryBlueprintSystem\(\{[\s\S]*?saveChatConfirmed: saveStoryBlueprintChatConfirmed/);
    assert.match(source, /createChatSummarySystem\(\{[\s\S]*?saveChatConditional: saveSummaryChatConfirmed/);
});

test('PostSpeech claims intents before message, round, and queued capability execution', () => {
    const message = listenerBlock('CHARACTER_MESSAGE_RENDERED', 1);
    assertOrdered(message, [
        'postSpeechSystem.reserveExecution(intentContexts)',
        'postSpeechExecutor.run(',
        'postSpeechSystem.trackExecution(execResult, activeContexts, reservation)',
    ]);
    assert.match(message, /if \(execResult\.deferred\.length\) \{[\s\S]*?reservation\.release\(\)/);

    const round = listenerBlock('GROUP_WRAPPER_FINISHED');
    assertOrdered(round, [
        'postSpeechSystem.reserveExecution(contexts, { allowPending: true })',
        'postSpeechExecutor.run(',
        'postSpeechSystem.trackExecution(execResult, reservation.contexts, reservation)',
    ]);

    const drain = source.slice(source.indexOf('async function drainPostSpeechRoundQueue()'), source.indexOf('// Custom extension prompt key'));
    assertOrdered(drain, [
        'postSpeechSystem.reserveExecution(job.contexts',
        'postSpeechExecutor.executeDeferred(plans)',
        'postSpeechSystem.trackExecution(execResult, reservation.contexts, reservation)',
    ]);
});

test('new group rounds reset stale runtime state before clearing persisted counters', () => {
    const block = listenerBlock('GROUP_WRAPPER_STARTED');
    assertOrdered(block, [
        'roundOrchestrator.startWrapper',
        "wrapperTransition.kind === 'preserve_nested'",
        "wrapperTransition.kind === 'retry_failed'",
        "wrapperTransition.kind === 'reuse_or_restore_plan'",
        'roundScores = {}',
        'roundOrchestrator.reset()',
        'scriptExecutorSystem.resetTurnShared()',
        "setExtensionPrompt(DIRECTOR_SCRIPT_KEY, ''",
        'roundCounterReset()',
        'scriptCounterSnapshots.clear()',
        'delete chat_metadata[EXT_KEY]._counterSnapshots',
    ]);
});

test('stop cleanup aborts every active LLM path before the disabled-mode return', () => {
    const block = listenerBlock('GENERATION_STOPPED');
    assertOrdered(block, [
        'generationStopped = true',
        'postSpeechAbortController.abort()',
        'postSpeechMessageAbortController.abort()',
        'directorAbortController.abort()',
        'if (settings.mode === MODE_OFF) return',
    ]);
});

test('message rollback invalidates execution state before pruning dependent stores', () => {
    const block = listenerBlock('MESSAGE_DELETED');
    assertOrdered(block, [
        'customAgentSystem.invalidateExecutions()',
        'roundOrchestrator.reset()',
        'scriptCounterSnapshots.clear()',
        'await pruneDirectorHistory()',
        'await chatSummarySystem.pruneSummaries()',
        'await postSpeechSystem.pruneAfter(newChatLength - 1)',
    ]);
});

test('chat changes reset transient PostSpeech work and automatic counters without deleting decisions', () => {
    const block = listenerBlock('CHAT_CHANGED');
    assertOrdered(block, [
        'invalidatePostSpeechRoundQueue()',
        'postSpeechSystem.resetPending()',
        'customAgentSystem.invalidateExecutions()',
        'profileLibrarySystem.resetAutoLoadDedup?.()',
        'await pruneDirectorHistory()',
        'await chatSummarySystem.pruneSummaries()',
        'await critiqueSystem.pruneCritiques()',
        "delete chat_metadata[EXT_KEY]._autoCheckLength",
        "key.startsWith('_autoCAG_')",
        "profileLibrarySystem.autoLoadForCurrentGroup('chat-changed')",
    ]);
    assert.equal(block.includes('postSpeechSystem.clearAll()'), false);
});

test('APP_READY builds UI before restoring user modules and capability persistence hooks', () => {
    const block = listenerBlock('APP_READY');
    assertOrdered(block, [
        'await loadSettingsUI(deps)',
        "profileLibrarySystem.autoLoadForCurrentGroup('app-ready')",
        "userProviderLoader.restoreAll('provider'",
        "userProviderLoader.restoreAll('capability'",
        'CapabilityRegistry.setEnabled = function',
        'CapabilityRegistry.setScope = function',
    ]);
});
