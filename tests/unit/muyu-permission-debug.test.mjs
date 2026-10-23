import test from 'node:test';
import assert from 'node:assert/strict';
import { tracePermission } from '../../muyu/core/permission-debug.js';
import { createSourcePermissions } from '../../muyu/permissions/store.js';

test('Permission trace is opt-in, redacts target identity, and observes task and chat grants', () => {
    const prior = globalThis.GD_MUYU_PERMISSION_DEBUG, log = console.log, rows = [];
    console.log = line => rows.push(line);
    const target = { kind: 'chat', userKey: 'PRIVATE_USER_KEY', chatKey: 'PRIVATE_CHAT_NAME' };
    try {
        globalThis.GD_MUYU_PERMISSION_DEBUG = false;
        tracePermission('disabled', { target }); assert.equal(rows.length, 0);
        globalThis.GD_MUYU_PERMISSION_DEBUG = true;
        const p = createSourcePermissions(), r = { source: 'recentMessages', reason: 'PRIVATE_REASON', target, taskId: 'task:test' };
        p.decide(r, 'task', () => assert.equal(p.allows('source:recentMessages', target, r.taskId), true));
        p.forgetTask(target, r.taskId);
        assert.equal(p.allows('source:recentMessages', target, r.taskId), false);
        p.decide(r, 'chat', () => assert.equal(p.allows('source:recentMessages', target, 'task:other'), true));
        const data = rows.map(line => JSON.parse(line.slice('[GD Muyu Permission] '.length)));
        assert.ok(data.some(row => row.event === 'store.check' && row.taskGrant === true));
        assert.ok(data.some(row => row.event === 'store.check' && row.chatGrant === true));
        assert.ok(data.every(row => row.target === 'target:1'));
        assert.doesNotMatch(rows.join('\n'), /PRIVATE_USER_KEY|PRIVATE_CHAT_NAME|PRIVATE_REASON/);
        console.log = () => { throw Error('Console unavailable'); };
        assert.equal(p.allows('source:recentMessages', target, r.taskId), true);
        assert.doesNotThrow(() => tracePermission('console.failed', { target }));
    } finally {
        console.log = log;
        if (prior === undefined) delete globalThis.GD_MUYU_PERMISSION_DEBUG;
        else globalThis.GD_MUYU_PERMISSION_DEBUG = prior;
    }
});
