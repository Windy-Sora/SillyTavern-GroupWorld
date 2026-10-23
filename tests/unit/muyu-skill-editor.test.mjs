import test from 'node:test';
import assert from 'node:assert/strict';
import { createSkillPort } from '../../muyu/host/skills.js';
import { createSkillWorkbench } from '../../muyu/skills/workbench.js';
import { skillEditorPackage } from '../../muyu/skills/editor.js';
import { parseSkillMarkdown } from '../../muyu/skills/contract.js';
import { createSkillModule } from '../../muyu/modules/skills/index.js';

const fields = (name = 'example') => ({ name, description: 'Read contracts before acting.', body: 'Private procedure.' });
const pack = name => skillEditorPackage({ ...fields(name), resources: [{ path: 'references/rules.md', text: 'Reference only.' }] });
async function fixture(saveSettings = async () => {}) {
    const settings = {}, port = createSkillPort({ getSettings: () => settings, saveSettings, loadBuiltins: async () => [{ revision: 1, package: pack('builtin') }] });
    await port.ready(); return { settings, port };
}
const create = (port, expectedRevision = 0, name = 'example') => port.preview({ operation: 'create', expectedRevision, fields: fields(name) });

test('Skill form quotes metadata without injecting frontmatter and preserves omitted resources', () => {
    const previous = pack('example'), next = skillEditorPackage({ description: 'line\nname: injected', body: 'New body.' }, previous);
    const meta = parseSkillMarkdown(next.files[0].text);
    assert.equal(meta.name, 'example'); assert.equal(meta.description, 'line\nname: injected');
    assert.deepEqual(next.files.slice(1), previous.files.slice(1));
});
test('Skill form rejects getters, unsupported fields and executable resource paths without evaluation', () => {
    let calls = 0;
    assert.throws(() => skillEditorPackage({ ...fields(), get body() { calls++; return 'bad'; } }), /SKILL_/);
    assert.throws(() => skillEditorPackage({ ...fields(), hooks: {} }), /SKILL_/);
    assert.throws(() => skillEditorPackage({ ...fields(), resources: [{ path: 'assets/code.js', text: 'bad' }] }), /SKILL_/);
    assert.throws(() => skillEditorPackage({ ...fields(), resources: [{ path: 'assets/data.txt', get text() { calls++; return 'bad'; } }] }), /SKILL_/);
    assert.equal(calls, 0);
});
test('Skill previews do not save or leak document bodies into artifacts; save is one-shot unconfirmed', async () => {
    let writes = 0; const { settings, port } = await fixture(async () => { writes++; });
    const content = create(port);
    assert.equal(writes, 0); assert.equal(settings.muyuSkillData, undefined);
    assert.ok(!JSON.stringify(content).includes('Private procedure'));
    assert.match(port.display(content).next.files[0].text, /Private procedure/);
    assert.deepEqual(await port.save(content), { status: 'saved_unconfirmed', persistence: 'unconfirmed' });
    assert.equal(writes, 1); assert.equal(settings.muyuSkillData.skills[0].enabled, false);
    await assert.rejects(port.save(content), /SKILL_STALE/);
});
test('Skill builtin originals are read-only but allow exact copy and independent disable', async () => {
    const { port } = await fixture();
    for (const operation of ['update', 'delete']) assert.throws(() => port.preview({ operation, id: 'builtin:builtin', revision: '1:0', expectedRevision: 0, ...(operation === 'update' ? { fields: { body: 'Changed.' } } : {}) }), /SKILL_READ_ONLY/);
    await port.save(port.preview({ operation: 'copy', id: 'builtin:builtin', revision: '1:0', expectedRevision: 0, newName: 'my-copy' }));
    const copy = (await port.list()).entries.find(row => row.id === 'user:my-copy');
    assert.equal(copy.enabled, false); assert.match(await port.export(copy.id, copy.revision), /Reference only/);
    await port.save(port.preview({ operation: 'enable', id: 'builtin:builtin', revision: '1:0', expectedRevision: 1, enabled: false }));
    assert.equal((await port.list()).entries[0].enabled, false);
});
test('Skill preview freshness includes store content, target version and unchanged enabled state', async () => {
    const { settings, port } = await fixture(); await port.save(create(port));
    const stale = port.preview({ operation: 'update', id: 'user:example', revision: 1, expectedRevision: 1, fields: { body: 'Edited.' } });
    await port.save(port.preview({ operation: 'enable', id: 'user:example', revision: 1, expectedRevision: 1, enabled: true }));
    await assert.rejects(port.save(stale), /SKILL_STALE/);
    const current = port.preview({ operation: 'update', id: 'user:example', revision: 2, expectedRevision: 2, fields: { body: 'Edited.' } });
    await port.save(current); assert.equal(settings.muyuSkillData.skills[0].enabled, true);
    const next = create(port, 3, 'other'); settings.muyuSkillData.skills[0].package.files[0].text += '\nConcurrent edit';
    await assert.rejects(port.save(next), /SKILL_STALE/);
});
test('Skill previews reject hidden modifiers, identity changes and duplicate stable names', async () => {
    const { port } = await fixture(); await port.save(create(port));
    const base = { operation: 'update', id: 'user:example', revision: 1, expectedRevision: 1, fields: { body: 'Edited.' } };
    assert.throws(() => port.preview({ ...base, enabled: true }), /SKILL_INVALID/);
    assert.throws(() => port.preview({ ...base, newName: 'other' }), /SKILL_INVALID/);
    assert.throws(() => port.preview({ ...base, fields: { name: 'other' } }), /SKILL_IDENTITY_CHANGE/);
    assert.throws(() => create(port, 1), /SKILL_DUPLICATE/);
});
test('Failed Skill save rolls back known state, consumes the ticket and never retries', async () => {
    let writes = 0; const { settings, port } = await fixture(async () => { writes++; throw Error('offline'); });
    const content = create(port); await assert.rejects(port.save(content), /SKILL_SAVE_UNKNOWN/);
    assert.equal(settings.muyuSkillData, undefined); assert.equal(writes, 1);
    await assert.rejects(port.save(content), /SKILL_STALE/); assert.equal(writes, 1);
});
test('Skill metadata and paged read preserve full long documents without activation', async () => {
    const { port } = await fixture(); const body = 'Large private procedure. '.repeat(1000);
    await port.save(port.preview({ operation: 'create', expectedRevision: 0, fields: { ...fields(), body } }));
    assert.ok(!JSON.stringify(await port.list()).includes(body));
    let result = '', offset = 0;
    do { const page = await port.read('user:example', 1, offset); assert.equal(page.untrusted, true); assert.ok(page.text.length <= 4000); result += page.text; offset = page.nextOffset; } while (offset >= 0);
    assert.equal(parseSkillMarkdown(JSON.parse(result).files[0].text).body, body);
});
test('Skill feature disable preserves per-document switches for later re-enable', async () => {
    const { port } = await fixture();
    await port.save(port.preview({ operation: 'feature', expectedRevision: 0, enabled: false }));
    const row = (await port.list()).entries[0]; assert.equal(row.enabled, true); assert.equal(row.effectiveEnabled, false);
    assert.match(await port.export(row.id, row.revision), /Reference only/);
});
test('Skill workbench retains unsaved editor across external model saves and refresh', async () => {
    const { port } = await fixture(), view = createSkillWorkbench({ port }); await view.load(); view.newSkill();
    view.setDraft(fields('draft')); await port.save(create(port)); await view.load();
    assert.equal(view.snapshot().draft.body, 'Private procedure.'); assert.equal(view.snapshot().draft.name, 'draft');
    await assert.rejects(view.save(), /SKILL_STALE/); assert.equal(view.snapshot().draft.name, 'draft');
    view.dispose();
});
test('Skill workbench import is an unsaved disabled draft; collision replacement is explicit', async () => {
    const { settings, port } = await fixture(), view = createSkillWorkbench({ port }); await view.load();
    view.importText(JSON.stringify(pack('example'))); assert.equal(settings.muyuSkillData, undefined); assert.equal(view.snapshot().draft.enabled, false);
    await view.save(); assert.equal(view.snapshot().draft.id, 'user:example');
    view.importText(JSON.stringify(pack('example'))); await assert.rejects(view.save(), /SKILL_DUPLICATE/);
    view.importText(JSON.stringify(pack('example')), 'replace'); await view.save();
    assert.equal(settings.muyuSkillData.skills.length, 1); assert.equal(settings.muyuSkillData.revision, 2);
    assert.throws(() => view.importText(JSON.stringify(pack('missing')), 'replace'), /SKILL_NOT_FOUND/); view.dispose();
});

test('Skill workbench dirty state tracks edits, imports and successful saves without rebasing on refresh', async () => {
    const { port } = await fixture(), workbench = createSkillWorkbench({ port }); await workbench.load(); workbench.newSkill();
    assert.equal(workbench.snapshot().dirty, false);
    workbench.setDraft(fields()); assert.equal(workbench.snapshot().dirty, true);
    await workbench.load(); assert.equal(workbench.snapshot().dirty, true);
    await workbench.save(); assert.equal(workbench.snapshot().dirty, false);
    workbench.setDraft({ body: 'Edited' }); assert.equal(workbench.snapshot().dirty, true);
    workbench.setDraft({ body: 'Private procedure.' }); assert.equal(workbench.snapshot().dirty, false);
    workbench.importText(JSON.stringify(pack('example')), 'replace'); assert.equal(workbench.snapshot().dirty, true);
    workbench.dispose();
});

test('Skill failed save retains dirty draft', async () => {
    const { port } = await fixture(async () => { throw Error('offline'); }), workbench = createSkillWorkbench({ port }); await workbench.load(); workbench.newSkill();
    workbench.setDraft(fields()); await assert.rejects(workbench.save(), /SKILL_SAVE_UNKNOWN/);
    assert.equal(workbench.snapshot().dirty, true); assert.equal(workbench.snapshot().draft.body, 'Private procedure.'); workbench.dispose();
});
test('Skill module cancellation during builtin loading cannot create orphan candidates', async () => {
    let resolve; const loading = new Promise(r => { resolve = r; }); let previews = 0;
    const port = { ready: () => loading, preview: () => { previews++; return {}; }, clear() {} };
    const module = createSkillModule({ port }), target = { kind: 'global', userKey: 'u' }; module.bindRun({ id: 'r', taskId: 't', target });
    const pending = module.handlers['muyu.skills.preview']({ requestJson: '{}' }, { runId: 'r', target });
    module.forgetRun('r'); resolve(); await assert.rejects(pending, /RUN_NOT_BOUND/); assert.equal(previews, 0);
});
test('Skill module charges actual bytes and refuses over-budget reads', async () => {
    const { port } = await fixture(); let charged = 0;
    const module = createSkillModule({ port, charge: (_, bytes) => { charged = bytes; return false; } });
    await assert.rejects(module.handlers['muyu.skills.list']({}, { runId: 'r' }), /PROVIDER_BUDGET_EXCEEDED/);
    assert.ok(charged > 0); module.dispose();
});
