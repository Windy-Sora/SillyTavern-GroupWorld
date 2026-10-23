import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverableQuestion } from '../../muyu/application/recovery.js';

const record = { status: 'failed', archived: false, imported: false, messages: [{ role: 'user', runId: 'r1', content: 'Please inspect this.' }] };
const failed = { id: 'r1', status: 'failed', process: { rows: [{ type: 'model.started' }, { type: 'model.failed' }], dropped: 0 } };

test('A failed question is copyable but never represented as a resumable run', () => {
    assert.deepEqual(recoverableQuestion({ record, runs: [failed] }), { runId: 'r1', status: 'failed', possibleEffects: false });
    assert.equal(recoverableQuestion({ record, runs: [failed], busy: true }), null);
    assert.equal(recoverableQuestion({ record, runs: [failed], readOnly: true }), null);
    assert.equal(recoverableQuestion({ record: { ...record, archived: true }, runs: [failed] }), null);
});

test('Potential tool effects and cold-reloaded interruptions must be reviewed', () => {
    const tool = { ...failed, process: { rows: [{ type: 'tool.started' }], dropped: 0 } };
    assert.equal(recoverableQuestion({ record, runs: [tool] }).possibleEffects, true);
    assert.equal(recoverableQuestion({ record: { ...record, status: 'interrupted' }, runs: [] }).possibleEffects, true);
    assert.equal(recoverableQuestion({ record: { ...record, messages: [...record.messages, { role: 'user', runId: 'r2', content: 'Permission answer' }] } }), null);
    assert.equal(recoverableQuestion({ record: { ...record, messages: [...record.messages, { role: 'assistant', runId: 'r1', content: 'answer' }] } }), null);
    assert.equal(recoverableQuestion({ record, runs: [{ ...failed, id: 'other' }] }), null);
});
