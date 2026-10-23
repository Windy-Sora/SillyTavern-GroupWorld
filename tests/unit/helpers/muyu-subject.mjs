import { createToolRegistry } from '../../../muyu/tools/registry.js';

export function createClock() {
    let now = 0, id = 0;
    const timers = new Map();
    return {
        now: () => now,
        setTimeout(fn, ms) { timers.set(++id, { fn, at: now + ms }); return id; },
        clearTimeout(key) { timers.delete(key); },
        advance(ms) { now += ms; for (const [key, t] of [...timers]) if (t.at <= now) { timers.delete(key); t.fn(); } },
        get pending() { return timers.size; },
    };
}
export async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
export function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
export const identity = { id: 'r1', sessionId: 's1', taskId: 't1', target: { kind: 'chat', userKey: 'u1', chatKey: 'A' } };
export const toolId = 'muyu.test.read';
export function registry(overrides = {}) {
    const r = createToolRegistry();
    r.register({ id: toolId, version: 1, description: 'Synthetic read', inputSchema: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'], additionalProperties: false }, outputSchema: { type: 'integer' }, scope: 'chat', effect: 'read', dataClasses: ['synthetic'], resourceKeys: [], confirmation: 'policy', timeoutMs: 50, retryPolicy: { kind: 'none', maxAttempts: 1 }, ...overrides });
    r.seal(); return r;
}
export const call = (callId = 'c1', args = { n: 1 }) => ({ callId, toolId, version: 1, args });
export const request = c => ({ type: 'tool_call_complete', call: c });
export const done = { type: 'done' };
export const text = value => ({ type: 'text_delta', text: value });
export function scriptedModel(steps) {
    const requests = [];
    return { requests, async *run(input, { signal }) {
        const step = steps[requests.length]; requests.push(input);
        if (!step) throw new Error('Unexpected model request');
        const events = typeof step === 'function' ? await step(input, signal) : step;
        for (const event of events) yield event;
    } };
}
