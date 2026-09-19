import assert from 'node:assert/strict';
import test from 'node:test';
import { createCritiqueExecution } from '../../systems/critique-execution.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    return { promise, resolve, reject };
}

test('critique execution shares one lock and always clears the quiet prompt', async () => {
    const pending = deferred();
    const clears = [];
    const execution = createCritiqueExecution({
        createCaller: () => ({ generate: () => pending.promise }),
        setExtensionPrompt: (...args) => clears.push(args),
        quietPromptId: 'quiet',
        inPromptType: 'prompt',
    });
    const first = execution.execute('inspect');
    await assert.rejects(execution.execute('again'), /already in progress/);
    pending.resolve('done');
    assert.equal(await first, 'done');
    assert.equal(clears.length, 2);
    assert.equal(execution.isRunning(), false);
});

test('critique execution clears the quiet prompt after generation failure', async () => {
    let clears = 0;
    const execution = createCritiqueExecution({
        createCaller: () => ({ generate: async () => { throw new Error('provider failed'); } }),
        setExtensionPrompt: () => { clears++; },
        quietPromptId: 'quiet',
        inPromptType: 'prompt',
    });
    await assert.rejects(execution.execute('inspect'), /provider failed/);
    assert.equal(clears, 2);
    assert.equal(execution.isRunning(), false);
});
