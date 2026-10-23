import test from 'node:test';
import assert from 'node:assert/strict';
import { SKILL_LIMITS, importSkillPackage, exportSkillPackage, parseSkillMarkdown, validateSkillData, validateSkillPackage } from '../../muyu/skills/contract.js';
import { createSkillRegistry } from '../../muyu/skills/registry.js';
import { createSkillStore } from '../../muyu/host/skill-store.js';
import { sanitizeImportedSettings } from '../../systems/config-profile-validation.js';
import { createConfigProfileSubject } from './helpers/config-profile-subject.mjs';

const markdown = (name = 'gold-system', extra = '', body = 'Read the field contract before previewing a change.') => `---\nname: ${name}\ndescription: Build a coin system when requested.\n${extra}---\n${body}`;
const pack = (name = 'gold-system', extra = '', body) => ({ format: 'muyu-skill-package', version: 1, files: [{ path: 'SKILL.md', text: markdown(name, extra, body) }, { path: 'references/rules.md', text: 'Current values must be read through tools.' }] });
const gate = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(save = async () => {}) {
    let settings = { other: 7 };
    const store = createSkillStore({ getSettings: () => settings, saveSettings: save });
    return { store, get settings() { return settings; }, replace(value) { settings = value; } };
}

test('Skill Markdown and JSON package import/export preserve complete documents', () => {
    const text = '\uFEFF' + markdown().replaceAll('\n', '\r\n');
    const single = importSkillPackage(text);
    assert.equal(parseSkillMarkdown(single.files[0].text).name, 'gold-system');
    assert.deepEqual(importSkillPackage(exportSkillPackage(pack())), pack());
    const long = pack('long', '', '中文'.repeat(30000));
    assert.deepEqual(importSkillPackage(exportSkillPackage(long)), long);
});
test('Skill frontmatter supports explicit invocation policy, quoted and block descriptions', () => {
    const meta = parseSkillMarkdown(markdown('manual-only', 'display-name: "金币系统"\nversion: "1.2"\ndisable-model-invocation: true\nuser-invocable: false\n'));
    assert.equal(meta.displayName, '金币系统'); assert.equal(meta.contentVersion, '1.2');
    assert.equal(meta.modelInvocable, false); assert.equal(meta.userInvocable, false);
    const block = markdown().replace('description: Build a coin system when requested.', 'description: >-\n  Build coins.\n  Read contracts.');
    assert.equal(parseSkillMarkdown(block).description, 'Build coins. Read contracts.');
    assert.equal(parseSkillMarkdown(markdown().replace('Build a coin system when requested.', "'It''s a workflow.'")).description, "It's a workflow.");
});
for (const extra of ['hooks: {}\n', 'allowed-tools: all\n', 'context: fork\n', 'model: other\n', 'name: duplicate\n', 'user-invocable: maybe\n', 'description: &alias text\n']) {
    test(`Skill frontmatter rejects unsupported or ambiguous input: ${extra.trim()}`, () => assert.throws(() => parseSkillMarkdown(markdown('gold', extra)), /SKILL_/));
}
test('Skill package paths stay inside explicitly imported document resources', () => {
    for (const path of ['../outside.md', '/etc/test.md', 'C:/a.md', 'references/../a.md', 'references\\a.md', 'references/%2e%2e/a.md', 'references/a.md?x', 'references/CON.txt', 'references/a.', 'scripts/run.js', 'assets/a.html', 'https://host/a.md']) {
        const input = pack(); input.files[1].path = path;
        assert.throws(() => validateSkillPackage(input), /SKILL_/);
    }
    const duplicate = pack(); duplicate.files.push({ path: 'REFERENCES/RULES.md', text: '' });
    assert.throws(() => validateSkillPackage(duplicate), /SKILL_DUPLICATE_RESOURCE/);
    const missing = pack(); missing.files.shift(); assert.throws(() => validateSkillPackage(missing), /SKILL_MISSING_MAIN/);
});
test('Skill packages reject getters, polluted keys, sparse arrays and size overflow', () => {
    let getterCalls = 0;
    assert.throws(() => validateSkillPackage({ format: 'muyu-skill-package', version: 1, get files() { getterCalls++; return []; } }), /SKILL_INVALID/);
    assert.equal(getterCalls, 0);
    const sparse = pack(); sparse.files = new Array(2); assert.throws(() => validateSkillPackage(sparse), /SKILL_/);
    assert.throws(() => importSkillPackage('{"format":"muyu-skill-package","version":1,"files":[],"__proto__":{}}'), /SKILL_INVALID/);
    const large = pack(); large.files[1].text = '中'.repeat(SKILL_LIMITS.fileBytes / 2); assert.throws(() => validateSkillPackage(large), /SKILL_CAPACITY/);
    const many = pack(); many.files = Array.from({ length: 33 }, (_, i) => ({ path: `assets/${i}.txt`, text: '' })); assert.throws(() => validateSkillPackage(many), /SKILL_CAPACITY/);
});
test('Skill registry separates same-name builtins/users and never runs document code', async () => {
    const f = fixture(), body = 'globalThis.__skillExecuted = true; !`dangerous command`';
    await f.store.create(pack('gold', '', body), true);
    const registry = createSkillRegistry({ builtins: [pack('gold')], store: f.store });
    const list = await registry.list(); assert.deepEqual(list.map(row => row.id), ['builtin:gold', 'user:gold']);
    assert.ok(list.every(row => !Object.hasOwn(row, 'package') && !Object.hasOwn(row, 'body')));
    const snapshot = await registry.snapshot({ id: 'user:gold', revision: 1, invocation: 'model' });
    assert.ok(Object.isFrozen(snapshot.package.files[0]));
    assert.match(registry.resource(snapshot), /dangerous command/); assert.equal(globalThis.__skillExecuted, undefined);
    assert.equal(registry.resource(snapshot, 'references/rules.md'), 'Current values must be read through tools.');
    assert.throws(() => registry.resource(snapshot, 'assets/missing.json'), /SKILL_RESOURCE_NOT_FOUND/);
    assert.throws(() => createSkillRegistry({ builtins: [pack(), pack()], store: f.store }), /SKILL_DUPLICATE/);
    await assert.rejects(registry.snapshot({ id: 'gold', revision: 1, invocation: 'model' }), /SKILL_NOT_FOUND/);
});
test('Skill snapshots retain exact old documents while new requests use updated revisions', async () => {
    const f = fixture(), row = await f.store.create(pack(), true);
    const registry = createSkillRegistry({ store: f.store });
    const old = await registry.snapshot({ id: row.id, revision: row.revision, invocation: 'user' });
    const changed = await f.store.update(row.id, row.revision, pack('gold-system', '', 'New workflow.'));
    await assert.rejects(registry.snapshot({ id: row.id, revision: row.revision, invocation: 'user' }), /SKILL_STALE/);
    assert.match(registry.resource(old), /Read the field contract/);
    assert.match(registry.resource(await registry.snapshot({ id: row.id, revision: changed.revision, invocation: 'user' })), /New workflow/);
});
test('Skill invocation flags and enable state are enforced independently', async () => {
    const f = fixture(), row = await f.store.create(pack('manual', 'disable-model-invocation: true\n'), true);
    const registry = createSkillRegistry({ store: f.store });
    await assert.rejects(registry.snapshot({ id: row.id, revision: row.revision, invocation: 'model' }), /SKILL_DISABLED/);
    assert.ok(await registry.snapshot({ id: row.id, revision: row.revision, invocation: 'user' }));
    const disabled = await f.store.setEnabled(row.id, row.revision, false);
    await assert.rejects(registry.snapshot({ id: row.id, revision: disabled.revision, invocation: 'user' }), /SKILL_DISABLED/);
    await assert.rejects(registry.snapshot({ id: row.id, revision: disabled.revision, invocation: 'other' }), /SKILL_INVALID_INVOCATION/);
});
test('Skill store provides versioned CRUD, prevents duplicate/rename/builtin writes and ABA', async () => {
    let saves = 0; const f = fixture(async () => { saves++; });
    assert.deepEqual(await f.store.read(), { version: 2, revision: 0, skills: [], enabled: true, builtinPolicies: [] });
    const row = await f.store.create(pack());
    await assert.rejects(f.store.create(pack()), /SKILL_DUPLICATE/);
    assert.throws(() => f.store.update(row.id, row.revision, pack('rename')), /SKILL_IDENTITY_CHANGE/);
    await assert.rejects(f.store.remove('builtin:gold', 1), /SKILL_STALE/);
    await f.store.remove(row.id, row.revision);
    const recreated = await f.store.create(pack()); assert.ok(recreated.revision > row.revision);
    await assert.rejects(f.store.remove(row.id, row.revision), /SKILL_STALE/);
    assert.equal(saves, 3); assert.equal(f.settings.other, 7);
    const read = await f.store.read(); read.skills.length = 0; assert.equal((await f.store.read()).skills.length, 1);
});
test('Skill store serializes concurrent edits and reads only settled settings', async () => {
    const f = fixture(), row = await f.store.create(pack());
    const outcomes = await Promise.allSettled([f.store.update(row.id, row.revision, pack('gold-system', '', 'First')), f.store.update(row.id, row.revision, pack('gold-system', '', 'Second'))]);
    assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
    assert.match(outcomes.find(row => row.status === 'rejected').reason.message, /SKILL_STALE/);
    const pending = gate(), entered = gate(), g = fixture(async () => { entered.resolve(); await pending.promise; });
    const write = g.store.create(pack()); await entered.promise;
    let readDone = false; const read = g.store.read().then(value => { readDone = true; return value; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(readDone, false);
    pending.resolve(); await write; assert.equal((await read).skills.length, 1);
});
test('Skill failed save restores previous data without changing unrelated settings', async () => {
    const f = fixture(async () => { f.settings.other = 9; throw Error('save rejected'); });
    await assert.rejects(f.store.create(pack()), /SKILL_SAVE_UNKNOWN/);
    assert.equal(Object.hasOwn(f.settings, 'muyuSkillData'), false); assert.equal(f.settings.other, 9);
});
for (const inPlace of [false, true]) test(`Skill failed save preserves concurrent ${inPlace ? 'in-place edit' : 'replacement'}`, async () => {
    const pending = gate(), entered = gate(), f = fixture(async () => { entered.resolve(); await pending.promise; });
    const write = f.store.create(pack(), true); await entered.promise;
    if (inPlace) f.settings.muyuSkillData.skills[0].enabled = false;
    else f.settings.muyuSkillData = { version: 1, revision: 99, skills: [] };
    pending.reject(Error('network')); await assert.rejects(write, /SKILL_SAVE_UNKNOWN/);
    if (inPlace) assert.equal(f.settings.muyuSkillData.skills[0].enabled, false);
    else assert.equal(f.settings.muyuSkillData.revision, 99);
});
test('Skill successful save with concurrent edit is reported unknown rather than saved', async () => {
    const f = fixture(async () => { f.settings.muyuSkillData.skills[0].enabled = false; });
    await assert.rejects(f.store.create(pack(), true), /SKILL_SAVE_UNKNOWN/);
    assert.equal(f.settings.muyuSkillData.skills[0].enabled, false);
});
test('Skill save with concurrent non-JSON replacement content stays unknown without overwriting it', async () => {
    const f = fixture(async () => { f.settings.muyuSkillData.loop = f.settings.muyuSkillData; });
    await assert.rejects(f.store.create(pack()), /SKILL_SAVE_UNKNOWN/);
    assert.equal(f.settings.muyuSkillData.loop, f.settings.muyuSkillData);
});
test('Skill store refuses settings identity replacement or disposal and never resets corrupt data', async () => {
    const f = fixture(); f.settings.muyuSkillData = { version: 3, revision: 0, skills: [] };
    await assert.rejects(f.store.read(), /SKILL_VERSION/);
    await assert.rejects(f.store.create(pack()), /SKILL_VERSION/);
    assert.equal(f.settings.muyuSkillData.version, 3);
    f.replace({}); await assert.rejects(f.store.read(), /SKILL_STORE_UNAVAILABLE/);
    const g = fixture(); g.store.close(); assert.throws(() => g.store.create(pack()), /SKILL_STORE_UNAVAILABLE/);
});
test('Skill store capacity rejects addition but allows deletion and recovery', async () => {
    const f = fixture();
    f.settings.muyuSkillData = { version: 1, revision: 128, skills: Array.from({ length: 128 }, (_, i) => ({ id: `user:s${i}`, revision: i + 1, enabled: true, package: pack(`s${i}`) })) };
    await assert.rejects(f.store.create(pack()), /SKILL_CAPACITY/);
    await f.store.remove('user:s127', 128); await f.store.create(pack());
    assert.equal((await f.store.read()).skills.length, 128);
    assert.throws(() => validateSkillData({ version: 1, revision: 0, skills: [{ id: 'user:gold-system', revision: 1, enabled: true, package: pack() }] }), /SKILL_INVALID/);
});
test('Skill packages cannot be imported through story config profiles', () => {
    for (const source of ['json', 'zip']) assert.equal(Object.hasOwn(sanitizeImportedSettings({ muyuSkillData: { private: true }, topN: 2 }, { source }), 'muyuSkillData'), false);
});
test('Skill packages stay out of config profile snapshots, JSON exports and applications', async t => {
    const previous = globalThis.document;
    globalThis.document = { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } };
    t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
    const privateData = { version: 1, revision: 0, skills: [] };
    const f = createConfigProfileSubject({ muyuSkillData: privateData });
    const saved = f.subject.saveCurrentAsProfile('test', '', { agentsTools: true, contextLedger: true });
    assert.equal(Object.hasOwn(saved.settings, 'muyuSkillData'), false);
    saved.settings.muyuSkillData = { injected: true };
    assert.doesNotMatch(JSON.stringify(f.subject.exportProfileAsJson(saved.id)), /muyuSkillData/);
    await f.subject.applyProfile(saved.id);
    assert.deepEqual(f.settings.muyuSkillData, privateData);
});
test('Skill import copies caller documents before a queued save starts', async () => {
    const f = fixture(), input = pack(), write = f.store.create(input);
    input.files[0].text = markdown('replacement'); input.files.length = 0;
    const row = await write; assert.equal(row.id, 'user:gold-system');
    row.package.files.length = 0;
    assert.equal((await f.store.read()).skills[0].package.files.length, 2);
});
test('Skill store closes or changes identity during save without writing into the new settings owner', async () => {
    for (const replace of [false, true]) {
        const pending = gate(), entered = gate(), f = fixture(async () => { entered.resolve(); await pending.promise; });
        const write = f.store.create(pack()); await entered.promise;
        if (replace) f.replace({ other: 'new owner' }); else f.store.close();
        pending.resolve(); await assert.rejects(write, /SKILL_SAVE_UNKNOWN/);
        assert.equal(Object.hasOwn(f.settings, 'muyuSkillData'), false);
        if (replace) assert.equal(f.settings.other, 'new owner');
    }
});
test('Skill package aggregate and store aggregate byte limits are checked before saving', async () => {
    const oversized = pack(); oversized.files.push({ path: 'assets/a.txt', text: 'a'.repeat(256000) }, { path: 'assets/b.txt', text: 'b'.repeat(256000) });
    oversized.files[1].text = 'c'.repeat(16000);
    assert.throws(() => validateSkillPackage(oversized), /SKILL_CAPACITY/);
    let saves = 0; const f = fixture(async () => { saves++; });
    const input = pack('large', '', 'a'.repeat(240000));
    f.settings.muyuSkillData = { version: 1, revision: 17, skills: Array.from({ length: 17 }, (_, i) => ({ id: `user:s${i}`, revision: i + 1, enabled: true, package: pack(`s${i}`, '', 'a'.repeat(240000)) })) };
    await assert.rejects(f.store.create(input), /SKILL_CAPACITY/);
    assert.equal(saves, 0); assert.equal((await f.store.read()).skills.length, 17);
});
