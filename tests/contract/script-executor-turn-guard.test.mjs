import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('the interceptor does not apply an obsolete script decision after a turn reset', async () => {
    const source = await readFile(new URL('../../index.js', import.meta.url), 'utf8');
    const start = source.indexOf('// ─── Script Executor: decision trigger');
    const end = source.indexOf('// ─── Mode: LLM', start);
    const decisionHook = source.slice(start, end);

    assert.match(decisionHook, /const scriptTurnId = scriptExecutorSystem\.getTurnId\(\)/);
    assert.match(decisionHook, /await scriptExecutorSystem\.executeAllDecision/);
    assert.match(decisionHook, /if \(scriptExecutorSystem\.getTurnId\(\) !== scriptTurnId\) return/);
    assert.ok(decisionHook.indexOf('getTurnId() !== scriptTurnId') < decisionHook.indexOf('// Sync mutations back'));
});
