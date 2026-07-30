import assert from 'node:assert/strict';
import test from 'node:test';
import { FakeSillyTavernHost } from './fake-st-host.mjs';

export function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

export async function flushMicrotasks(turns = 3) {
    for (let i = 0; i < turns; i++) await Promise.resolve();
}

export async function eventually(assertion, {
    timeoutMs = 1000,
    intervalMs = 5,
} = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() <= deadline) {
        try {
            return await assertion();
        } catch (error) {
            lastError = error;
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
    }
    throw lastError || new Error(`Assertion did not pass within ${timeoutMs}ms`);
}

/**
 * Register a test with a fresh fake SillyTavern host and common helpers.
 */
export function scenario(name, options, run) {
    if (typeof options === 'function') {
        run = options;
        options = {};
    }
    const {
        timeout = 5000,
        host: hostOptions = {},
        ...testOptions
    } = options || {};

    return test(name, { timeout, ...testOptions }, async t => {
        const host = new FakeSillyTavernHost(hostOptions);
        t.after(() => host.dispose());
        await run({
            t,
            assert,
            host,
            context: host.getContext(),
            deferred,
            eventually,
            flushMicrotasks,
        });
    });
}
