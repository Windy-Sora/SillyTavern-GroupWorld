import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { randomUUID, sha256 } from '../../muyu/runtime/crypto.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createHistoryPort } from '../../muyu/host/history.js';
import { createMemoryHistoryStore } from '../../muyu/sessions/memory-store.js';
import { createAgentMemoryPort } from '../../muyu/host/agent-memory.js';
import { createSessionLibrary } from '../../muyu/sessions/library.js';
import { historyScope } from '../../muyu/sessions/contract.js';
import { createInteractionStore } from '../../muyu/interactions/store.js';

async function withCrypto(value, work) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value });
    try { return await work(); }
    finally { if (previous) Object.defineProperty(globalThis, 'crypto', previous); else delete globalThis.crypto; }
}
const lanCrypto = { getRandomValues: values => webcrypto.getRandomValues(values) };
const hex = bytes => Buffer.from(bytes).toString('hex');

test('LAN HTTP UUID fallback creates unique RFC 4122 v4 IDs without modifying global crypto', async () => {
    await withCrypto(lanCrypto, () => {
        const ids = Array.from({ length: 1000 }, randomUUID);
        assert.equal(new Set(ids).size, ids.length);
        for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        assert.equal(globalThis.crypto.randomUUID, undefined);
    });
});

test('UUID uses native API when available and fails closed without cryptographic randomness', async () => {
    await withCrypto({ randomUUID: () => 'native-id' }, () => assert.equal(randomUUID(), 'native-id'));
    await withCrypto(undefined, () => assert.throws(randomUUID, /CRYPTO_UNAVAILABLE/));
});

test('HTTP SHA-256 matches native digest across Unicode and padding/block boundaries', async () => {
    for (const text of ['', 'abc', '暮羽🦉', ...[55,56,63,64,65,119,120,1000].map(n => 'x'.repeat(n)),
        'gd-muyu-history-v1:["single-user"]', 'gd-muyu-notes-v1:["account","用户",123]']) {
        const expected = createHash('sha256').update(text).digest('hex');
        await withCrypto(lanCrypto, async () => assert.equal(hex(await sha256(text)), expected));
        await withCrypto(webcrypto, async () => assert.equal(hex(await sha256(text)), expected));
    }
});

test('LAN HTTP can initialize host, open existing history namespace and read existing account notes', async () => {
    const historyText = 'gd-muyu-history-v1:["single-user"]';
    const hash = createHash('sha256').update(historyText).digest('hex').slice(0, 32);
    const expected = `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20)}`;
    const settings = { muyuAgentMemoryData: { version: 1,
        namespace: createHash('sha256').update('gd-muyu-notes-v1:["single-user"]').digest('hex'), notes: [] } };
    await withCrypto(lanCrypto, async () => {
        const host = createHostBridge({ getContext: () => ({}), getSettings: () => settings, extensionKey: 'gd' });
        assert.match(host.globalTarget.userKey, /^page:[0-9a-f-]{36}$/);
        const interactions = createInteractionStore();
        const permission = interactions.create({ sessionId: 's', taskId: 't', target: host.globalTarget },
            { kind: 'permission', source: 'recentMessages', reason: '分析当前聊天' });
        assert.match(permission.id, /^request:[0-9a-f-]{36}$/);
        interactions.resolve(permission.id, 'approved');
        const history = createHistoryPort({ getAccount: () => ({ enabled: false }), getSettings: () => settings,
            saveSettings: async () => {}, openServer: async () => null,
            openStore: async ({ namespace }) => { assert.equal(namespace, expected); return createMemoryHistoryStore(); } });
        const store = await history.open(); assert.deepEqual(await store.list(), []); store.close();
        const library = createSessionLibrary({ port: history });
        const id = library.create(historyScope('chat', { kind: 'chat', chatKey: 'A' }));
        assert.match(id, /^[0-9a-f-]{36}$/); await library.close();
        const notes = createAgentMemoryPort({ getAccount: () => ({ enabled: false }), getSettings: () => settings, saveSettings: async () => {} });
        assert.deepEqual(await notes.list(null), []);
        const saved = await notes.save({ title: '偏好', content: '回答简洁', scope: 'account' });
        assert.match(saved.id, /^[0-9a-f-]{36}$/);
        assert.equal((await notes.list(null))[0].content, '回答简洁');
    });
});
