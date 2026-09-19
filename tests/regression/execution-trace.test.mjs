import assert from 'node:assert/strict';
import test from 'node:test';
import { renderTraceStageHtml, summarizeTrace } from '../../ui/sections/execution-trace-helpers.js';

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

test('execution trace stage renderer encodes untrusted names, errors, and output keys', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const html = renderTraceStageHtml({
        name: payload,
        elapsed: 12,
        error: `failed: ${payload}`,
        outputSummary: { type: 'object', keys: [payload, 'safe'] },
    }, { output: 'out' });
    assert.equal(html.includes(payload), false);
    assert.equal(html.includes('&lt;img src=x onerror=alert(1)&gt;'), true);
    assert.equal((html.match(/&lt;img/g) || []).length, 3);
    assert.match(html, /12ms/);
    assert.match(html, /out: \{.*safe\}/);
});
