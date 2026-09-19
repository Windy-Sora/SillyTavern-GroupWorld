import assert from 'node:assert/strict';
import test from 'node:test';

import { createChatSummarySystem } from '../../systems/chat-summary-system.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    return { promise, resolve, reject };
}

async function settle() {
    await new Promise(resolve => setTimeout(resolve, 0));
}

function fixture(overrides = {}) {
    let metadata = overrides.metadata || {};
    const chat = overrides.chat || [{ name: 'User', mes: 'one', is_user: true }];
    let save = overrides.saveChatConditional || (async () => {});
    let response = overrides.response || 'generated';
    const calls = { saves: 0, prompts: [] };
    const system = createChatSummarySystem({
        settings: { lang: 'en', summaryEnabled: true, summaryReusePrevious: false, agentConfigs: {}, ...overrides.settings },
        getChatMetadata: () => metadata,
        getChat: () => chat,
        EXT_KEY: 'gd',
        saveChatConditional: async () => { calls.saves++; return await save(); },
        renderPrompt: async text => text,
        generateRaw: async () => '',
        inject_ids: { QUIET_PROMPT: 'quiet' },
        extension_prompt_types: { IN_PROMPT: 0 },
        setExtensionPrompt: () => {},
        log: () => {},
        createCaller: () => ({ generate: async prompt => { calls.prompts.push(prompt); return await response; } }),
    });
    return {
        system, chat, calls,
        get metadata() { return metadata; },
        set metadata(value) { metadata = value; },
        set save(value) { save = value; },
        set response(value) { response = value; },
    };
}

function summary(content, active = true, basedOn = null, rangeEnd = 1) {
    return { rangeEnd, content, active, basedOn, promptUsed: 'prompt', timestamp: 1 };
}

test('failed summary generation removes only its entry and preserves concurrent edits', async () => {
    const gate = deferred();
    const h = fixture({ saveChatConditional: () => gate.promise });
    const original = summary('old');
    h.metadata.gd = { summaries: [original] };
    const pending = h.system.generateSummary();
    await settle();
    original.content = 'concurrent edit';
    const concurrent = summary('concurrent', false);
    h.metadata.gd.summaries.push(concurrent);
    gate.reject(new Error('chat save failed'));
    await assert.rejects(pending, /chat save failed/);
    assert.deepEqual(h.metadata.gd.summaries, [original, concurrent]);
    assert.equal(original.active, true);
    assert.equal(original.content, 'concurrent edit');
});

test('failed summary generation preserves an edited new entry and reports incomplete rollback', async () => {
    const gate = deferred();
    const h = fixture({ saveChatConditional: () => gate.promise });
    h.metadata.gd = { summaries: [] };
    const pending = h.system.generateSummary();
    await settle();
    h.metadata.gd.summaries[0].content = 'concurrent edit';
    gate.reject(new Error('chat save failed'));
    await assert.rejects(pending, error => error.rollbackIncomplete === true && /chat save failed/.test(error.message));
    assert.equal(h.metadata.gd.summaries[0].content, 'concurrent edit');
});

test('unknown summary persistence preserves the possibly saved in-memory mutation', async () => {
    const unknown = Object.assign(new Error('verification unavailable'), { persistenceUnknown: true });
    const h = fixture({ saveChatConditional: async () => { throw unknown; } });
    h.metadata.gd = { summaries: [summary('old')] };
    await assert.rejects(
        h.system.updateSummaryContents([{ index: 0, content: 'possibly saved' }]),
        error => error === unknown,
    );
    assert.equal(h.metadata.gd.summaries[0].content, 'possibly saved');
});

test('failed regeneration restores owned fields while preserving another field edit', async () => {
    const gate = deferred();
    const h = fixture({ saveChatConditional: () => gate.promise });
    const original = summary('old');
    h.metadata.gd = { summaries: [original] };
    const pending = h.system.regenerateLastSummary();
    await settle();
    original.active = false;
    gate.reject(new Error('chat save failed'));
    await assert.rejects(pending, /chat save failed/);
    assert.equal(original.content, 'old');
    assert.equal(original.promptUsed, 'prompt');
    assert.equal(original.active, false);
});

test('revert, reset, and message pruning roll back their active flags on save failure', async () => {
    for (const operation of ['revert', 'reset', 'prune']) {
        const gate = deferred();
        const h = fixture({ saveChatConditional: () => gate.promise, chat: [] });
        const first = summary('first', false, null, 0);
        const second = summary('second', true, 0, 2);
        h.metadata.gd = { summaries: [first, second] };
        const pending = operation === 'revert' ? h.system.revertLastSummary()
            : operation === 'reset' ? h.system.resetAll()
                : h.system.pruneSummaries();
        await settle();
        first.content = `${operation} concurrent`;
        gate.reject(new Error(`${operation} save failed`));
        await assert.rejects(pending, new RegExp(`${operation} save failed`));
        assert.equal(first.active, false, operation);
        assert.equal(second.active, true, operation);
        assert.equal(first.content, `${operation} concurrent`);
    }
});

test('content updates serialize and a failed edit cannot undo a later edit', async () => {
    const gate = deferred();
    let saves = 0;
    const h = fixture({ saveChatConditional: () => ++saves === 1 ? gate.promise : Promise.resolve() });
    h.metadata.gd = { summaries: [summary('old')] };
    const failed = h.system.updateSummaryContents([{ index: 0, content: 'failed' }]);
    const later = h.system.updateSummaryContents([{ index: 0, content: 'later' }]);
    await settle();
    assert.equal(h.metadata.gd.summaries[0].content, 'failed');
    gate.reject(new Error('chat save failed'));
    await assert.rejects(failed, /chat save failed/);
    assert.equal(await later, 1);
    assert.equal(h.metadata.gd.summaries[0].content, 'later');
});

test('queued content updates retain their target when a failed prune restores earlier entries', async () => {
    const gate = deferred();
    let saves = 0;
    const h = fixture({ saveChatConditional: () => ++saves === 1 ? gate.promise : Promise.resolve() });
    const inactive = summary('inactive', false);
    const active = summary('active', true);
    h.metadata.gd = { summaries: [inactive, active] };
    const pruning = h.system.pruneDisabledSummaries();
    await settle();
    const editing = h.system.updateSummaryContents([{ index: 0, content: 'edited active' }]);
    gate.reject(new Error('prune save failed'));
    await assert.rejects(pruning, /prune save failed/);
    assert.equal(await editing, 1);
    assert.deepEqual(h.metadata.gd.summaries, [inactive, active]);
    assert.equal(active.content, 'edited active');
});

test('prune-disabled and clear restore removed entries around concurrent additions', async () => {
    for (const operation of ['prune', 'clear']) {
        const gate = deferred();
        const h = fixture({ saveChatConditional: () => gate.promise });
        const first = summary('first', true);
        const second = summary('second', false);
        h.metadata.gd = { summaries: [first, second] };
        const pending = operation === 'prune' ? h.system.pruneDisabledSummaries() : h.system.clearSummaries();
        await settle();
        const concurrent = summary('concurrent', true);
        h.metadata.gd.summaries.push(concurrent);
        gate.reject(new Error('chat save failed'));
        await assert.rejects(pending, /chat save failed/);
        assert.deepEqual(h.metadata.gd.summaries, [first, second, concurrent]);
    }
});

test('a chat switch after successful persistence is stale and keeps old-chat state', async () => {
    const gate = deferred();
    const h = fixture({ saveChatConditional: () => gate.promise });
    const oldMetadata = h.metadata;
    oldMetadata.gd = { summaries: [summary('old')] };
    const pending = h.system.updateSummaryContents([{ index: 0, content: 'saved' }]);
    await settle();
    h.metadata = {};
    gate.resolve();
    await assert.rejects(pending, { name: 'StaleExecutionError' });
    assert.equal(oldMetadata.gd.summaries[0].content, 'saved');
    assert.equal(h.metadata.gd, undefined);
});

test('public summary reads are snapshots and cannot bypass transactions', () => {
    const h = fixture();
    h.metadata.gd = { summaries: [summary('old')] };
    h.system.getSummaries()[0].content = 'mutated';
    h.system.getLatestActive().content = 'also mutated';
    assert.equal(h.metadata.gd.summaries[0].content, 'old');
});
