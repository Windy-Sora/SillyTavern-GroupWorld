import test from 'node:test';
import assert from 'node:assert/strict';
import { historyDatePresentation } from '../../muyu/ui/history-presentation.js';
import { processEventState } from '../../muyu/ui/process-view.js';

for (const lang of ['zh', 'en']) test('History groups local calendar days, including year boundaries / ' + lang, () => {
    const now = new Date(2026, 0, 1, 0, 30);
    assert.equal(historyDatePresentation(new Date(2026, 0, 1, 0, 10).getTime(), lang, now).group, 'today');
    const previous = historyDatePresentation(new Date(2025, 11, 31, 23, 59).getTime(), lang, now);
    assert.equal(previous.group, 'yesterday'); assert.equal(previous.label, lang === 'en' ? 'Yesterday' : '昨天');
    assert.equal(historyDatePresentation(new Date(2025, 11, 30).getTime(), lang, now).group, 'earlier');
    assert.equal(historyDatePresentation(new Date(2026, 0, 2).getTime(), lang, now).group, 'future');
    for (const invalid of [undefined, null, '2026-01-01', NaN, -1, 9e18]) {
        const result = historyDatePresentation(invalid, lang, now);
        assert.equal(result.group, 'unknown'); assert.equal(result.time, '');
    }
    assert.ok(historyDatePresentation(0, lang, now).full, 'epoch zero is a valid date');
});

test('Timeline maps observed events without declaring earlier or interrupted requests successful', () => {
    assert.equal(processEventState({ type: 'model.started' }, true), 'running');
    assert.equal(processEventState({ type: 'model.started' }, false), 'neutral');
    assert.equal(processEventState({ type: 'tool.requested' }, true), 'neutral');
    assert.equal(processEventState({ type: 'tool.completed' }), 'done');
    assert.equal(processEventState({ type: 'tool.reused' }), 'done');
    assert.equal(processEventState({ type: 'tool.failed' }), 'error');
    assert.equal(processEventState({ type: 'tool.completed', error: 'DENIED' }), 'error');
    assert.equal(processEventState({ type: 'tool.completed', read: { status: 'ok', truncated: true } }), 'warning');
    assert.equal(processEventState({ type: 'tool.completed', read: { status: 'INVALID_SELECTOR' } }), 'warning');
});
