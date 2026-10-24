import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createFileStore } = require('../../muyu/server-plugin/index.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
async function fixture(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'muyu-corruption-'));
    t.after(async () => {
        assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(dir).startsWith('muyu-corruption-'));
        await fs.rm(dir, { recursive: true, force: true });
    });
    const issues = [];
    return { dir, store: createFileStore(dir, () => issues.push('HISTORY_INVALID')), issues };
}
function record() { return { version: 7, id: randomUUID(), revision: 0, scope: 'test', title: 'Healthy', messages: [], required: [], status: 'idle' }; }

test('Corrupt history does not block healthy listing, writes or deletion and is preserved', async t => {
    const { dir, store, issues } = await fixture(t), bad = randomUUID();
    const saved = await store.create(record());
    const file = path.join(dir, bad + '.json');
    await fs.writeFile(file, '{broken', 'utf8');
    assert.equal((await store.list()).length, 1);
    const updated = await store.update({ ...saved, title: 'Updated' }, saved.revision);
    assert.equal(updated.revision, 2);
    assert.equal((await store.create(record())).revision, 1);
    await store.remove(updated.id, updated.revision);
    assert.equal(await store.read(updated.id), null);
    assert.equal(await fs.readFile(file, 'utf8'), '{broken');
    assert.ok(issues.length >= 2);
    await assert.rejects(store.read(bad));
});

test('Unknown-version records remain untouched and cannot be overwritten', async t => {
    const { dir, store } = await fixture(t), future = { ...record(), version: 8, revision: 42 };
    const raw = JSON.stringify(future), file = path.join(dir, future.id + '.json');
    await fs.writeFile(file, raw, 'utf8');
    assert.deepEqual(await store.list(), []);
    await assert.rejects(store.create({ ...future, version: 7 }), /HISTORY_INVALID/);
    assert.equal(await fs.readFile(file, 'utf8'), raw);
    assert.equal((await store.create(record())).revision, 1);
});

test('Corrupt files still count toward history record capacity', async t => {
    const { dir, store } = await fixture(t);
    await Promise.all(Array.from({ length: 64 }, () => fs.writeFile(path.join(dir, randomUUID() + '.json'), '{', 'utf8')));
    assert.deepEqual(await store.list(), []);
    await assert.rejects(store.create(record()), /HISTORY_CAPACITY/);
    assert.equal((await fs.readdir(dir)).length, 64);
});

test('Corrupt-file disk bytes cannot bypass the history byte quota', async t => {
    const { dir, store } = await fixture(t), file = path.join(dir, randomUUID() + '.json');
    await fs.writeFile(file, '{', 'utf8');
    const stat = fs.stat;
    t.mock.method(fs, 'stat', async (candidate, ...args) => candidate === file ? { size: 256 * 1024 * 1024 } : stat(candidate, ...args));
    await assert.rejects(store.create(record()), /HISTORY_CAPACITY/);
    assert.equal(await fs.readFile(file, 'utf8'), '{');
});
