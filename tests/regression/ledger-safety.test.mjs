import assert from 'node:assert/strict';
import test from 'node:test';
import { createLedgerTitle } from '../../ui/sections/ledger-helpers.js';

test('BUG-12: ledger title renders untrusted names and reasons through text()', () => {
    const calls = [];
    const element = {
        text(value) { calls.push(['text', value]); return this; },
        html(value) { calls.push(['html', value]); return this; },
    };
    const $ = markup => { calls.push(['create', markup]); return element; };
    const payload = '<img src=x onerror=alert(1)>';
    createLedgerTitle($, { speakers: [payload], reason: payload }, 0);
    assert.equal(calls.some(([method]) => method === 'html'), false);
    assert.equal(calls.filter(([method]) => method === 'text').length, 1);
    assert.match(calls.find(([method]) => method === 'text')[1], /<img src=x/);
});
