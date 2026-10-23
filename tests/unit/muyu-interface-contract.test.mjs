import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as rawReadFile } from 'node:fs/promises';
const readFile = async (...args) => { const data = await rawReadFile(...args); return typeof data === 'string' ? data.replace(/\r\n/g, '\n') : data; };
import { createContextModule } from '../../muyu/modules/context/index.js';
import { navigationDocument, SETTINGS_PAGES, UI_LABELS } from '../../muyu/ui/navigation-metadata.js';
import { configPresentation } from '../../muyu/config/presentation.js';
import { validateJson } from '../../muyu/core/json-contract.js';
import { configFields, fieldDefinition } from '../../muyu/config/registry.js';
import { bundleFieldPolicy, BUNDLE_LIMITS } from '../../muyu/config/bundle-policy.js';
import { createTaskBundleDraftPort, taskBundleSchema } from '../../muyu/host/task-bundle-draft.js';
import { createSettingsModule } from '../../muyu/modules/settings/index.js';
import { composeInstructions } from '../../muyu/instructions/compose.js';
import { loadBuiltinSkills } from '../../muyu/skills/builtin-loader.js';

test('Public GUI document is bounded, discoverable and uses the UI labels without host reads', () => {
    const m = createContextModule(), list = m.handlers['muyu.context.list']({});
    assert.equal(list.length, 7); assert.ok(list.some(row => row.id === 'muyu.interface'));
    assert.ok(list.every(row => !Object.hasOwn(row, 'text')));
    const result = m.handlers['muyu.context.read']({ ids: ['muyu.interface'] });
    assert.equal(result.complete, true); assert.ok(result.documents[0].text.length <= 4000);
    assert.deepEqual(validateJson(m.registry.get('muyu.context.read').outputSchema, result), result);
    const doc = JSON.parse(result.documents[0].text);
    assert.deepEqual(doc.buttons, UI_LABELS);
    assert.deepEqual(doc.pages.map(row => row.label.zh), SETTINGS_PAGES.map(row => row[1]));
    assert.deepEqual(doc.pages.map(row => row.description.zh), SETTINGS_PAGES.map(row => row[3]));
    assert.match(doc.pages.find(row => row.id === 'storage').description.zh, /不修改角色记忆/);
    assert.match(doc.characterMemory.location.zh, /经典设置 → 角色记忆$/);
    assert.deepEqual(doc.characterMemory.controls.autoMemoryInterval.label, configPresentation('autoMemoryInterval').label);
    assert.equal(Object.hasOwn(doc.characterMemory.controls.autoMemoryInterval, 'section'), false);
    assert.match(doc.characterMemory.intervalMeaning, /减少触发频率应增大间隔/);
    assert.match(doc.characterMemory.boundary, /不在暮羽齿轮/);
    assert.deepEqual(doc.connection.sources, ['使用酒馆当前连接（推荐）', '使用暮羽独立接口']);
    assert.equal(doc.connection.defaultForNewUsers, 'st');
    assert.equal(doc.connection.stDoesNotInheritRoleplayContext, true);
    assert.equal(doc.connection.autoEnableOptional, true);
    assert.equal(doc.connection.noAutomaticPathAppend, true);
    assert.match(doc.connection.deepseekEndpointExample, /\/chat\/completions$/);
    assert.equal(doc.skills.importOnlyFillsUnsavedEditor, true);
    assert.match(doc.historyExport.location, /⋯/);
    assert.equal(navigationDocument().text, result.documents[0].text);
});

test('Preview guidance separates requested direction, numeric target and historical draft validity', () => {
    for (const mode of ['assistant', 'draft']) {
        const instructions = composeInstructions(mode);
        assert.match(instructions.task, /减少自动提取频率应增大间隔/);
        assert.match(instructions.task, /未指定数值先简短询问/);
        assert.match(instructions.task, /不等于宿主作废旧草稿/);
        assert.match(instructions.task, /不能据旧基线断言当前值/);
        assert.ok(instructions.base.length <= 4000 && instructions.task.length <= 4000);
    }
});

test('Field contract and bundle validator share the registered-setting boundary', () => {
    for (const id of configFields) assert.deepEqual(fieldDefinition(id).bundle, bundleFieldPolicy(id));
    for (const id of ['memoryEnabled', 'autoMemoryEnabled', 'autoMemoryInterval', 'autoMemorySpeakers']) assert.equal(fieldDefinition(id).bundle.supported, true);
    for (const id of ['memoryMaxEntries', 'storyBlueprintEnabled', 'storyBlueprintCompletionVariable', 'customPromptsEnabled', 'profileLibraryAutoLoad.enabled']) assert.equal(fieldDefinition(id).bundle.supported, false);
    assert.equal(taskBundleSchema.properties.variables.maxItems, BUNDLE_LIMITS.numericVariables);
    assert.equal(taskBundleSchema.properties.scripts.maxItems, BUNDLE_LIMITS.scripts);
    const catalog = createSettingsModule({ getSettings: () => ({}), getTarget: () => null });
    const bundle = JSON.parse(catalog.handlers['muyu.settings.catalog']({}, { signal: new AbortController().signal }).text).bundle;
    assert.equal(bundle.variableScope, 'global'); assert.match(bundle.variableMeaning, /no character selector/);
    assert.deepEqual(bundle.sections, ['variables', 'settings', 'scripts']); catalog.dispose();
    const target = { kind: 'chat', chatKey: 'test', userKey: 'test' };
    const settings = { memoryEnabled: true, autoMemoryEnabled: false, autoMemoryInterval: 10, autoMemorySpeakers: false };
    const p = createTaskBundleDraftPort({ getTarget: () => target, getSettings: () => settings });
    const draft = p.prepare(target, { settings: { autoMemoryEnabled: true, autoMemoryInterval: 15 } });
    assert.equal(draft.settings.changes.autoMemoryEnabled, true); p.assertFresh(draft);
    assert.equal(settings.autoMemoryEnabled, false);
    assert.throws(() => p.prepare(target, { settings: { memoryMaxEntries: 10 } }), /BUNDLE_SETTING_REQUIRES_SEPARATE_DRAFT/);
    assert.throws(() => p.prepare(target, { settings: { imaginaryField: true } }), /Unknown JSON field/);
    p.clear();
});

test('Model field contract includes the same bundle eligibility without accessing current settings', () => {
    const m = createSettingsModule({ getSettings() { throw Error('Unexpected read'); }, getTarget() { throw Error('Unexpected target'); } });
    const rows = JSON.parse(m.handlers['muyu.settings.contract']({ fields: ['autoMemoryEnabled', 'memoryMaxEntries'] }, { signal: new AbortController().signal }).text);
    assert.deepEqual(rows.map(row => row.bundle.supported), [true, false]); m.dispose();
});

test('GUI Skill is independent and orchestration publishes its changed revision', async () => {
    const packs = await loadBuiltinSkills({ readText: path => readFile(new URL(`../../assets/muyu-skills/${path}`, import.meta.url), 'utf8') });
    const guide = packs.find(row => row.package.files[0].text.includes('name: muyu-interface-guide\n'));
    assert.ok(guide); assert.match(guide.package.files[1].text, /导入只填入未保存编辑器/);
    assert.match(guide.package.files[0].text, /muyu.interface/);
    const instructions = composeInstructions('assistant');
    assert.ok(instructions.base.length <= 4000); assert.match(instructions.base, /muyu.interface/);
    assert.match(instructions.base, /bundle合同/); assert.doesNotMatch(instructions.base, /配置→数据→暮羽长期记忆/);
});
