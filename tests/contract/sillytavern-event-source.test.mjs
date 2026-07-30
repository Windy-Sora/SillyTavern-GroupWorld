import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { FakeEventSource } from '../harness/fake-event-source.mjs';

const stRoot = process.env.GD_TEST_ST_ROOT;

test('fake event source preserves the real SillyTavern listener ordering contract', {
    skip: !stRoot && 'Set GD_TEST_ST_ROOT or pass --st-root to enable this contract test',
}, async () => {
    const emitterPath = path.resolve(stRoot, 'public/lib/eventemitter.js');
    await access(emitterPath);

    globalThis.localStorage ||= { getItem: () => null };
    const { EventEmitter } = await import(pathToFileURL(emitterPath).href);

    for (const EventSource of [EventEmitter, FakeEventSource]) {
        const events = new EventSource();
        const order = [];
        events.on('probe', async () => {
            order.push('first:start');
            await Promise.resolve();
            order.push('first:end');
        });
        events.on('probe', () => order.push('second'));
        await events.emit('probe');
        assert.deepEqual(order, ['first:start', 'first:end', 'second']);
    }
});
