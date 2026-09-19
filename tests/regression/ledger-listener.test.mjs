import assert from 'node:assert/strict';
import test from 'node:test';
import { bindLedgerMessageDeleted } from '../../ui/sections/ledger-helpers.js';
import { FakeEventSource } from '../harness/fake-event-source.mjs';

test('BUG-18: repeated ledger initialization keeps one MESSAGE_DELETED listener', async () => {
    const events = new FakeEventSource();
    const calls = [];
    bindLedgerMessageDeleted(events, 'MESSAGE_DELETED', () => calls.push('old'));
    bindLedgerMessageDeleted(events, 'MESSAGE_DELETED', () => calls.push('latest'));
    assert.equal(events.listenerCount('MESSAGE_DELETED'), 1);
    await events.emit('MESSAGE_DELETED');
    assert.deepEqual(calls, ['latest']);
});
