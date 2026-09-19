import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistorySystem } from '../../systems/history-system.js';

function harness({ chat = [], metadata = {}, prompt = 'script' } = {}) {
    let saves = 0;
    const logs = [];
    const system = createHistorySystem({
        getChatMetadata: () => metadata,
        getChat: () => chat,
        EXT_KEY: 'gd',
        saveChatConditional: async () => { saves++; },
        settings: { llmScriptPrompt: prompt },
        log: message => logs.push(message),
    });
    return { system, metadata, logs, saves: () => saves };
}

test('history system owns add, edit, clear, and metadata preservation', async () => {
    const h = harness({ chat: [{ send_date: 10 }, { send_date: 20 }] });
    assert.deepEqual(h.system.getDirectorHistory(), []);
    const entry = { speakers: ['A'], reason: 'first' };
    await h.system.addToDirectorHistory(entry);
    assert.equal(entry._anchorDate, 20);
    assert.equal(entry._chatLength, 2);
    assert.equal(h.metadata.gd.historyMeta.scriptPrompt, 'script');
    assert.equal(h.saves(), 1);

    assert.equal(await h.system.updateEntry(0, { speakers: ['B'] }), true);
    assert.deepEqual(h.system.getDirectorHistory()[0], { speakers: ['B'], _anchorDate: 20, _chatLength: 2 });
    assert.equal(await h.system.updateEntry(4, {}), false);
    assert.equal(await h.system.clearEntry(0), true);
    assert.deepEqual(h.system.getDirectorHistory()[0], { _anchorDate: 20, _chatLength: 2 });
    assert.equal(await h.system.clearEntry(-1), false);
    assert.equal(h.saves(), 3);
});

test('history pruning uses immutable anchors and legacy chat lengths', async () => {
    const metadata = { gd: { directorHistory: [
        { name: 'kept-anchor', _anchorDate: 2, _chatLength: 99 },
        { name: 'gone-anchor', _anchorDate: 3, _chatLength: 1 },
        { name: 'kept-legacy', _chatLength: 2 },
        { name: 'gone-legacy', _chatLength: 4 },
    ] } };
    const h = harness({ chat: [{ send_date: 1 }, { send_date: 2 }], metadata });
    await h.system.pruneDirectorHistory();
    assert.deepEqual(h.system.getDirectorHistory().map(entry => entry.name), ['kept-anchor', 'kept-legacy']);
    assert.equal(h.saves(), 1);
    assert.match(h.logs[0], /Pruned 2 stale/);
    await h.system.pruneDirectorHistory();
    assert.equal(h.saves(), 1);
});
