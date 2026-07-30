import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeTrace } from '../../ui/sections/execution-trace-helpers.js';
import {
    bindLedgerMessageDeleted,
    createLedgerTitle,
} from '../../ui/sections/ledger-helpers.js';
import { getWorldBookSourceLabel } from '../../ui/sections/quick-start-helpers.js';
import { hasVariableIdCollision } from '../../ui/sections/variable-helpers.js';
import { FakeEventSource } from '../harness/fake-event-source.mjs';

test('BUG-12: ledger title renders untrusted names and reasons through text()', () => {
    const calls = [];
    const element = {
        text(value) {
            calls.push(['text', value]);
            return this;
        },
        html(value) {
            calls.push(['html', value]);
            return this;
        },
    };
    const $ = markup => {
        calls.push(['create', markup]);
        return element;
    };
    const payload = '<img src=x onerror=alert(1)>';

    createLedgerTitle($, { speakers: [payload], reason: payload }, 0);

    assert.equal(calls.some(([method]) => method === 'html'), false);
    assert.equal(calls.filter(([method]) => method === 'text').length, 1);
    assert.match(calls.find(([method]) => method === 'text')[1], /<img src=x/);
});

test('BUG-14: variable rename collision is detected before destructive replacement', () => {
    const definitions = new Map([['old', {}], ['occupied', {}]]);
    const variableSystem = {
        getDefinition: id => definitions.get(id),
    };
    assert.equal(hasVariableIdCollision(variableSystem, 'old', 'occupied'), true);
    assert.equal(hasVariableIdCollision(variableSystem, 'old', 'old'), false);
    assert.equal(hasVariableIdCollision(variableSystem, 'old', 'free'), false);
});

test('BUG-15: execution trace accepts script name/elapsed fields and excludes sentinels', () => {
    const summary = summarizeTrace({
        stages: [
            { stage: '_start', elapsed: 99 },
            { name: 'script-A', elapsed: 12 },
            { id: 'executor-B', duration: 8, error: 'boom' },
            { stage: '_done', elapsed: 99 },
        ],
    });
    assert.deepEqual(summary.realStages.map(stage => stage.name || stage.id), ['script-A', 'executor-B']);
    assert.equal(summary.totalMs, 20);
    assert.equal(summary.stageSummary, 'script-A → executor-B');
    assert.equal(summary.hasError, true);
});

test('BUG-16: Chinese quick-start identifies the active SillyTavern world-book source', () => {
    assert.equal(getWorldBookSourceLabel('zh'), '跟随 ST 当前激活世界书');
    assert.equal(getWorldBookSourceLabel('en'), 'Following ST active world books');
});

test('BUG-18: repeated ledger initialization keeps one MESSAGE_DELETED listener', async () => {
    const events = new FakeEventSource();
    const calls = [];
    bindLedgerMessageDeleted(events, 'MESSAGE_DELETED', () => calls.push('old'));
    bindLedgerMessageDeleted(events, 'MESSAGE_DELETED', () => calls.push('latest'));

    assert.equal(events.listenerCount('MESSAGE_DELETED'), 1);
    await events.emit('MESSAGE_DELETED');
    assert.deepEqual(calls, ['latest']);
});
