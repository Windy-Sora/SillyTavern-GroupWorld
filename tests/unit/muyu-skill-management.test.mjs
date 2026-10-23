import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSkillStore } from '../../muyu/host/skill-store.js';
import { createSkillManagement } from '../../muyu/skills/management.js';
import { loadBuiltinSkills } from '../../muyu/skills/builtin-loader.js';
import { BUILTIN_SKILL_MANIFEST } from '../../muyu/skills/builtin-manifest.js';
import { validateSkillData } from '../../muyu/skills/contract.js';

const pack = (name = 'example') => ({ format: 'muyu-skill-package', version: 1, files: [{ path: 'SKILL.md', text: `---\nname: ${name}\ndescription: Example procedure.\n---\nRead contracts.` }, { path: 'references/rules.md', text: 'Do not grant permissions.' }] });
function fixture(data, saveSettings = async () => {}) {
    const settings = data === undefined ? {} : { muyuSkillData: data };
    const store = createSkillStore({ getSettings: () => settings, saveSettings });
    const service = createSkillManagement({ store, builtins: [{ revision: 3, package: pack() }] });
    return { settings, store, service };
}

test('Skill v1 migration is pure, preserves documents and saves v2 only upon mutation', async () => {
    const old = { version: 1, revision: 9, skills: [{ id: 'user:example', revision: 8, enabled: false, package: pack() }] };
    const f = fixture(old), data = await f.store.read();
    assert.equal(data.version, 2); assert.equal(data.enabled, true); assert.deepEqual(data.skills, old.skills);
    assert.equal(f.settings.muyuSkillData, old); assert.equal(old.version, 1);
    await f.service.setFeatureEnabled(9, false);
    assert.equal(f.settings.muyuSkillData.version, 2); assert.equal(f.settings.muyuSkillData.revision, 10);
    assert.deepEqual(f.settings.muyuSkillData.skills, old.skills);
});

test('Skill v2 rejects malformed policies, future versions, null and accessors without resetting data', () => {
    const valid = validateSkillData();
    for (const bad of [null, { ...valid, version: 3 }, { ...valid, enabled: 'yes' }, { ...valid, builtinPolicies: [{ id: 'user:x', enabled: false, revision: 0 }] }, { ...valid, unexpected: true }]) assert.throws(() => validateSkillData(bad), /SKILL_/);
    let calls = 0;
    assert.throws(() => validateSkillData({ get version() { calls++; return 2; } }), /SKILL_VERSION/);
    assert.equal(calls, 0);
});

test('Skill creates disabled by default; explicit enabled and exact store version are required', async () => {
    const f = fixture();
    const row = await f.service.create(pack(), { expectedRevision: 0 });
    assert.equal(row.enabled, false);
    await assert.rejects(f.service.registry.snapshot({ id: row.id, revision: row.revision, invocation: 'user' }), /SKILL_DISABLED/);
    assert.ok(await f.service.read({ id: row.id, revision: row.revision }));
    assert.throws(() => f.service.create(pack('other')), /SKILL_INVALID/);
    await assert.rejects(f.service.create(pack('other'), { expectedRevision: 0 }), /SKILL_STALE/);
    const next = await f.service.create(pack('other'), { expectedRevision: 1, enabled: true });
    assert.equal(next.enabled, true);
});

test('Builtin enable policy preserves exact old snapshot, invalidates old versions and never edits content', async () => {
    const f = fixture(), list = await f.service.list(), original = await f.service.registry.snapshot({ id: 'builtin:example', revision: '3:0', invocation: 'model' });
    assert.equal(list.revision, 0);
    await f.service.setEnabled('builtin:example', '3:0', false, 0);
    assert.equal((await f.service.list()).entries[0].enabled, false);
    await assert.rejects(f.service.registry.snapshot({ id: 'builtin:example', revision: '3:0', invocation: 'model' }), /SKILL_STALE/);
    await assert.rejects(f.service.registry.snapshot({ id: 'builtin:example', revision: '3:1', invocation: 'model' }), /SKILL_DISABLED/);
    assert.match(f.service.registry.resource(original), /Read contracts/);
    assert.match(await f.service.export({ id: 'builtin:example', revision: '3:1' }), /Do not grant permissions/);
    await assert.rejects(f.service.update('builtin:example', '3:1', pack(), 1), /SKILL_READ_ONLY/);
    await assert.rejects(f.service.remove('builtin:example', '3:1', 1), /SKILL_READ_ONLY/);
    await assert.rejects(f.service.setEnabled('builtin:missing', '3:0', false, 1), /SKILL_NOT_FOUND/);
});

test('Skill feature switch gates user and builtin loading but not management reads', async () => {
    const f = fixture(), row = await f.service.create(pack('user'), { enabled: true, expectedRevision: 0 });
    await f.service.setFeatureEnabled(1, false);
    assert.ok((await f.service.list()).entries.every(row => !row.modelInvocable && !row.userInvocable));
    await assert.rejects(f.service.registry.snapshot({ id: row.id, revision: 1, invocation: 'model' }), /SKILL_DISABLED/);
    assert.ok(await f.service.read({ id: row.id, revision: 1 }));
    await f.service.setFeatureEnabled(2, true);
    assert.ok(await f.service.registry.snapshot({ id: row.id, revision: 1, invocation: 'model' }));
});

test('Copying exact builtin package changes stable name, preserves resources and defaults disabled', async () => {
    const f = fixture();
    const copy = await f.service.copy('builtin:example', '3:0', 'my-copy', { expectedRevision: 0 });
    assert.equal(copy.id, 'user:my-copy'); assert.equal(copy.enabled, false);
    assert.equal(copy.package.files[1].text, pack().files[1].text);
    await assert.rejects(f.service.copy('builtin:example', '3:0', 'second-copy', { expectedRevision: 0 }), /SKILL_STALE/);
    const updated = await f.service.update(copy.id, copy.revision, pack('my-copy'), 1);
    await f.service.remove(updated.id, updated.revision, 2);
    assert.equal((await f.service.list()).entries.length, 1);
});

test('Concurrent management edits cannot both use the same store baseline', async () => {
    const f = fixture();
    const results = await Promise.allSettled([f.service.create(pack('first'), { expectedRevision: 0 }), f.service.create(pack('second'), { expectedRevision: 0 })]);
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
    assert.match(results.find(row => row.status === 'rejected').reason.message, /SKILL_STALE/);
});

test('Failed migration/save retains original v1 settings; unknown outcome does not auto retry', async () => {
    const old = { version: 1, revision: 0, skills: [] }; let calls = 0;
    const f = fixture(old, async () => { calls++; throw Error('network'); });
    await assert.rejects(f.service.setFeatureEnabled(0, false), /SKILL_SAVE_UNKNOWN/);
    assert.equal(f.settings.muyuSkillData, old); assert.equal(calls, 1);
});

test('Builtin resources load exclusively shipped static paths and preserve complete text', async () => {
    const paths = [];
    const builtins = await loadBuiltinSkills({ readText: async path => { paths.push(path); return readFile(new URL(`../../assets/muyu-skills/${path}`, import.meta.url), 'utf8'); } });
    assert.deepEqual(paths, BUILTIN_SKILL_MANIFEST.flatMap(row => row.files.map(path => `${row.name}/${path}`)));
    assert.equal(builtins.length, BUILTIN_SKILL_MANIFEST.length); assert.match(builtins[0].package.files[0].text, /整体配置检查/);
    const f = fixture();
    const service = createSkillManagement({ store: f.store, builtins });
    assert.equal((await service.list()).entries[0].id, 'builtin:config-review');
});

test('All shipped skills load complete main and referenced instructions with distinct stable identities', async () => {
    const builtins = await loadBuiltinSkills({ readText: path => readFile(new URL(`../../assets/muyu-skills/${path}`, import.meta.url), 'utf8') });
    const f = fixture(), service = createSkillManagement({ store: f.store, builtins });
    const rows = (await service.list()).entries;
    assert.deepEqual(rows.map(row => row.id), BUILTIN_SKILL_MANIFEST.map(row => `builtin:${row.name}`));
    for (const row of rows) {
        const snapshot = await service.registry.snapshot({ id: row.id, revision: row.revision, invocation: 'model' });
        const main = snapshot.package.files.find(file => file.path === 'SKILL.md').text;
        const reference = main.match(/references\/[a-z-]+\.md/)[0];
        assert.ok(snapshot.package.files.some(file => file.path === reference && file.text.length > 300));
        assert.equal(row.modelInvocable, true); assert.equal(row.userInvocable, true);
    }
    assert.match(builtins[1].package.files[1].text, /global 是聊天共享值/);
    assert.match(builtins[2].package.files[1].text, /passed 不是功能正确/);
});

test('Builtin loading rejects missing/oversized/wrong-identity resources and respects cancellation', async () => {
    await assert.rejects(loadBuiltinSkills({ readText: async () => { throw Error('missing'); } }), /missing/);
    await assert.rejects(loadBuiltinSkills({ readText: async () => '中'.repeat(100000) }), /SKILL_CAPACITY/);
    await assert.rejects(loadBuiltinSkills({ readText: async path => path.endsWith('SKILL.md') ? pack('wrong').files[0].text : '' }), /SKILL_IDENTITY_CHANGE/);
    const controller = new AbortController(); controller.abort(); let calls = 0;
    await assert.rejects(loadBuiltinSkills({ signal: controller.signal, readText: async () => { calls++; return ''; } }), /abort/i);
    assert.equal(calls, 0);
});

test('Default builtin reader uses bounded static fetch, no redirects, and complete UTF-8 decoding', async t => {
    const previous = globalThis.fetch, paths = [];
    t.after(() => { globalThis.fetch = previous; });
    globalThis.fetch = async (url, options) => {
        paths.push(url.pathname);
        assert.equal(options.redirect, 'error');
        const text = await readFile(url, 'utf8'), bytes = new TextEncoder().encode(text);
        return new Response(new ReadableStream({ start(controller) {
            for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.slice(offset, offset + 7));
            controller.close();
        } }));
    };
    const result = await loadBuiltinSkills();
    assert.equal(result.length, BUILTIN_SKILL_MANIFEST.length); assert.ok(paths.every(path => path.includes('/assets/muyu-skills/')));
    assert.match(result[0].package.files[0].text, /整体配置检查/);
});

test('Default builtin reader refuses failed response, malformed UTF-8 and streaming overflow', async t => {
    const previous = globalThis.fetch;
    t.after(() => { globalThis.fetch = previous; });
    globalThis.fetch = async () => new Response('missing', { status: 404 });
    await assert.rejects(loadBuiltinSkills(), /SKILL_RESOURCE_UNAVAILABLE/);
    globalThis.fetch = async () => new Response(new Uint8Array([255]));
    await assert.rejects(loadBuiltinSkills(), /encoded data|encoding/i);
    let canceled = false;
    globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new Uint8Array(262145));
    }, cancel() { canceled = true; } }));
    await assert.rejects(loadBuiltinSkills(), /SKILL_CAPACITY/);
    assert.equal(canceled, true);
});

test('Failed builtin policy save preserves concurrent policy changes and rejects stale toggle', async () => {
    const f = fixture(undefined, async () => { f.settings.muyuSkillData.builtinPolicies[0].enabled = true; throw Error('network'); });
    await assert.rejects(f.service.setEnabled('builtin:example', '3:0', false, 0), /SKILL_SAVE_UNKNOWN/);
    assert.equal(f.settings.muyuSkillData.builtinPolicies[0].enabled, true);
    await assert.rejects(f.service.setEnabled('builtin:example', '3:0', false, 1), /SKILL_STALE/);
});
