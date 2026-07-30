import assert from 'node:assert/strict';
import test from 'node:test';
import { managedCall, withTimeout } from '../../systems/agent-runtime.js';

test('withTimeout aborts the request-scoped signal with TimeoutError', async () => {
    let observedReason;
    await assert.rejects(
        withTimeout(signal => new Promise((_, reject) => {
            signal.addEventListener('abort', () => {
                observedReason = signal.reason;
                reject(new DOMException('aborted', 'AbortError'));
            }, { once: true });
        }), 10),
        error => error.name === 'TimeoutError',
    );
    assert.equal(observedReason?.name, 'TimeoutError');
});

test('managedCall does not retry an externally aborted request', async () => {
    let starts = 0;
    const controller = new AbortController();
    const caller = {
        supportsAbort: true,
        generate(_prompt, { signal }) {
            starts++;
            return new Promise((_, reject) => {
                signal.addEventListener('abort', () => {
                    reject(new DOMException('aborted', 'AbortError'));
                }, { once: true });
            });
        },
    };
    const request = managedCall(caller, 'probe', {
        retries: 3,
        timeout: 1000,
        signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(request, error => error.name === 'AbortError');
    assert.equal(starts, 1);
});

test('managedCall refuses timeout retries for non-cancellable callers', async () => {
    let starts = 0;
    const caller = {
        supportsAbort: false,
        generate() {
            starts++;
            return new Promise(() => {});
        },
    };
    await assert.rejects(
        managedCall(caller, 'probe', { retries: 3, timeout: 10 }),
        error => error.name === 'TimeoutError',
    );
    assert.equal(starts, 1);
});
