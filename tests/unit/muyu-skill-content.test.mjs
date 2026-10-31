import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as rawReadFile } from 'node:fs/promises';
const readFile = async (...args) => { const data = await rawReadFile(...args); return typeof data === 'string' ? data.replace(/\r\n/g, '\n') : data; };
import { loadBuiltinSkills } from '../../muyu/skills/builtin-loader.js';
import { createSkillPort } from '../../muyu/host/skills.js';
import { createSkillTaskRuntime } from '../../muyu/skills/task-runtime.js';
import { identity } from './helpers/muyu-subject.mjs';
import { BUILTIN_SKILL_MANIFEST } from '../../muyu/skills/builtin-manifest.js';
import { skillDisplay } from '../../muyu/ui/catalog-labels.js';

const newNames = ['director-diagnosis', 'memory-maintenance', 'blueprint-workflow', 'configuration-orchestration'];
const remainingNames = ['chat-context-analysis', 'variable-workbench', 'character-npc-workbench', 'resource-library-workflow', 'prompt-template-workbench', 'script-agent-workbench', 'worldbook-workflow', 'automation-workflow', 'muyu-troubleshooting', 'skill-workbench'];
const readBuiltins = () => loadBuiltinSkills({ readText: path => readFile(new URL(`../../assets/muyu-skills/${path}`, import.meta.url), 'utf8') });

test('Live-quality guide revisions preserve numeric intent, separate memory navigation and typed bundle steps', async () => {
    const packs = await readBuiltins();
    for (const [name, revision, patterns] of [
        ['memory-maintenance', 3, [/没有明确目标数值时/, /意味着增大自动提取间隔/, /不能断言当前值/]],
        ['muyu-interface-guide', 7, [/经典设置→角色记忆/, /不另加未列出的二级分区/, /不属于|不能把角色记忆/]],
        ['configuration-orchestration', 6, [/同一份整单不等于同一种步骤/, /variables步骤/, /不篡改草稿类型/]],
    ]) {
        assert.equal(BUILTIN_SKILL_MANIFEST.find(row => row.name === name).revision, revision);
        const pack = packs.find(row => row.package.files[0].text.includes(`name: ${name}\n`));
        const content = pack.package.files.map(row => row.text).join('\n');
        for (const pattern of patterns) assert.match(content, pattern);
    }
});

test('Complex-task guides associate host evidence without forcing simple previews or granting completion', async () => {
    const packs = await readBuiltins();
    for (const name of ['configuration-orchestration', 'config-review']) {
        assert.equal(BUILTIN_SKILL_MANIFEST.find(row => row.name === name).revision, name === 'configuration-orchestration' ? 6 : 5);
        const pack = packs.find(row => row.package.files[0].text.includes(`name: ${name}\n`));
        const main = pack.package.files[0].text, content = pack.package.files.map(row => row.text).join('\n');
        assert.match(main, name === 'configuration-orchestration' ? /version: "1.5"/ : /version: "1.3"/);
        assert.match(content, /muyu.task.bind_read/);
        assert.match(content, /不增加权限|不增加读取或写入授权/);
        assert.doesNotMatch(main, /必要时括注字段名/);
        if (name === 'configuration-orchestration') {
            assert.match(content, /简单单项预览不强制规划/);
            assert.match(content, /bundleSteps/);
            assert.match(content, /不按序号、kind或标题猜身份/);
            assert.match(content, /不证明用户意图、步骤完成/);
        }
    }
});

test('Third-round guides distinguish explicit independent goals and operation stages from approval count', async () => {
    const packs = await readBuiltins();
    for (const [name, revision, version, patterns] of [
        ['configuration-orchestration', 6, '1.5', [/已有金币不自动等于/, /独立系统/, /后续纠正优先/, /不是固定四次审批/]],
        ['script-agent-workbench', 4, '1.2', [/阶段不等于固定审批次数/, /同一候选/, /trial／save/]],
        ['resource-library-workflow', 6, '1.4', [/不是保留当前聊天旧蓝图/, /不保证这个目标/, /定向编辑方案/]],
    ]) {
        assert.equal(BUILTIN_SKILL_MANIFEST.find(row => row.name === name).revision, revision);
        const pack = packs.find(row => row.package.files[0].text.includes(`name: ${name}\n`));
        assert.ok(pack.package.files[0].text.includes(`version: "${version}"`));
        for (const pattern of patterns) assert.match(pack.package.files[1].text, pattern);
    }
});
const required = {
    'director-diagnosis': [/lastChatLength/, /不是当前聊天长度/, /不是候选池大小/, /不证明那次生成成功/],
    'memory-maintenance': [/NO_NEW_MEMORIES/, /两个保存域/, /trial 会调用/, /不是容量上限/],
    'blueprint-workflow': [/连续完成前缀/, /已有空树不是未建立/, /不是深度合并/, /不自动启用蓝图/],
    'configuration-orchestration': [/最多 6 个/, /最多 3 个/, /不是事务/, /partial 或 outcome_unknown/, /只读动作都标为 read/],
    'chat-context-analysis': [/目录不是正文/, /不是 ST 聊天/, /不自动生成编辑草稿/, /拒/],
    'variable-workbench': [/不是插件全局设置/, /resetValues/, /delta／append/, /保护/],
    'character-npc-workbench': [/不会更新已导出 ST 卡/, /最多八步/, /trial 不是沙箱/, /不覆写任何已有状态/],
    'resource-library-workflow': [/整树替换/, /save=true/, /scoreWeights/, /全跳过/],
    'prompt-template-workbench': [/不是访问隔离/, /不是标准 JSON Schema/, /全部置为 disabled/, /不自动截断/],
    'script-agent-workbench': [/trial 不是沙箱/, /不是确认发送／扣费/, /不证明业务正确/, /未知结果不另造票据/],
    'worldbook-workflow': [/整个资源库的独立正文来源授权/, /不提供最终注入证明/, /runtimeActive 未知/, /整列表替换/],
    'automation-workflow': [/不跳过或异步化/, /不是轮数/, /Capability 写入未开放/, /不是可执行动作数量/],
    'muyu-troubleshooting': [/CONTEXT_LIMIT/, /不请求密钥原文/, /长期 note 和角色记忆是不同层/, /没有读取 CMD/],
    'skill-workbench': [/content:policy/, /本任务固定|同任务固定快照/, /内置原件不能 update／delete/, /当前无专用 Skill export/],
};

async function catalogAll(port) {
    const rows = []; let offset = 0;
    do { const page = await port.catalog(offset); rows.push(...page.entries); offset = page.nextOffset; } while (offset !== -1);
    return rows;
}

test('Revised guides retain live-test boundaries and publish new content revisions', async () => {
    const packs = await readBuiltins();
    const patterns = {
        'director-diagnosis': [/不得据此说/, /筛选失效的证明/],
        'variable-workbench': [/revision/, /合并规则/, /不是.*事务/],
        'character-npc-workbench': [/船夫/, /事实核对/],
        'resource-library-workflow': [/exportData.template/, /template.*null/],
        'muyu-troubleshooting': [/全权限.*资料读取/, /历史.*独立现象/, /stDiagnostics/, /生成结束不证明成功/, /清空只删本地缓存/, /不能追溯旧请求/, /停止正文读取/, /retainedChars/],
        'prompt-template-workbench': [/stPromptText/, /构建快照不是最终发送/, /当时注册项/, /不主动生成/, /不能追溯旧请求/, /停止正文读取/, /缺席原因未知/, /offset:0/, /retainedChars/],
        'skill-workbench': [/muyu.tools.list/, /select/, /显式传新版 load.*SKILL_STALE/, /下一新任务/],
    };
    for (const [name, checks] of Object.entries(patterns)) {
        assert.equal(BUILTIN_SKILL_MANIFEST.find(row => row.name === name).revision, name === 'director-diagnosis' ? 3 : name === 'prompt-template-workbench' ? 11 : name === 'variable-workbench' ? 4 : name==='muyu-troubleshooting' ? 10 : name === 'character-npc-workbench' ? 7 : name === 'resource-library-workflow' ? 6 : 2);
        const pack = packs.find(row => row.package.files[0].text.includes(`name: ${name}\n`));
        assert.match(pack.package.files[0].text, name === 'director-diagnosis' ? /version: "1.2"/ : name === 'prompt-template-workbench' ? /version: "1.9"/ : name === 'variable-workbench' ? /version: "1.2"/ : name==='muyu-troubleshooting' ? /version: "1.8"/ : name === 'character-npc-workbench' ? /version: "1.5"/ : name === 'resource-library-workflow' ? /version: "1.4"/ : /version: "1.1"/);
        for (const pattern of checks) assert.match(pack.package.files[1].text, pattern);
    }
});

for (const name of [...newNames, ...remainingNames]) {
    test(`Shipped ${name} loads complete independent instructions without granting permission or saving`, async () => {
        let saves = 0;
        const settings = {}, port = createSkillPort({ getSettings: () => settings, saveSettings: async () => { saves++; }, loadBuiltins: readBuiltins });
        await port.ready(); const initialSaves = saves;
        const task = createSkillTaskRuntime({ port, charge: () => true }); task.bindRun(identity); await task.prepare(identity.id);
        const row = (await catalogAll(port)).find(row => row.id === `builtin:${name}`);
        const query = { id: row.id, revision: String(row.revision), path: 'SKILL.md' };
        const main = await task.load(identity.id, query);
        assert.equal(main.complete, true); assert.equal(main.permissionGranted, false);
        const reference = await task.load(identity.id, { ...query, path: 'references/workflow.md' });
        assert.equal(reference.complete, true); assert.equal(reference.permissionGranted, false);
        const packageRows = await readBuiltins(), pack = packageRows.find(row => row.package.files[0].text.includes(`name: ${name}\n`));
        for (const file of pack.package.files) {
            if (!['SKILL.md', 'references/workflow.md'].includes(file.path)) await task.load(identity.id, { ...query, path: file.path });
            assert.ok(task.project(identity.id).some(message => JSON.parse(message.content.split('\n')[1]).text === file.text));
        }
        assert.deepEqual(task.usage(identity.id)[0].paths, pack.package.files.map(file => file.path));
        assert.equal(saves, initialSaves);
        const body = pack.package.files[1].text;
        for (const pattern of required[name]) assert.match(body, pattern);
        assert.match(body, name === 'worldbook-workflow' ? /2026-10-23/ : /2026-10-05/);
    });
}

test('Builtin skills remain discoverable through bounded catalog pages without projecting bodies', async () => {
    const settings = {};
    const port = createSkillPort({ getSettings: () => settings, saveSettings: async () => {}, loadBuiltins: readBuiltins });
    await port.ready();
    let offset = 0; const rows = [];
    do {
        const page = await port.catalog(offset);
        assert.ok(page.entries.length <= 16);
        assert.ok(new TextEncoder().encode(JSON.stringify(page)).length <= 8192);
        assert.ok(page.nextOffset === -1 || page.nextOffset > offset);
        assert.doesNotMatch(JSON.stringify(page), /# 技能开发和管理合同/);
        rows.push(...page.entries); offset = page.nextOffset;
    } while (offset !== -1);
    assert.equal(rows.length, BUILTIN_SKILL_MANIFEST.length); assert.equal(new Set(rows.map(row => row.id)).size, BUILTIN_SKILL_MANIFEST.length);
    assert.equal(rows.at(-1).id, `builtin:${BUILTIN_SKILL_MANIFEST.at(-1).name}`);
});

test('Preset reading guides distinguish paging, body coverage and source authorization', async () => {
    const packs = await readBuiltins();
    for (const name of ['worldbook-workflow', 'prompt-template-workbench']) {
        assert.equal(BUILTIN_SKILL_MANIFEST.find(row => row.name === name).revision, name === 'worldbook-workflow' ? 13 : 11);
        const pack = packs.find(row => row.package.files[0].text.includes(`name: ${name}\n`));
        assert.match(pack.package.files[0].text, name === 'worldbook-workflow' ? /version: "1.11"/ : /version: "1.9"/);
        const text = pack.package.files[1].text;
        for (const pattern of [/continuation/, /SOURCE_TOO_LARGE/, /stPresetContent/, /正文/, /主动/, /页尾/, /宿主核验/]) assert.match(text, pattern);
    }
});

test('Card stack guide loads references independently and projects only loaded documents without saving or granting permission', async () => {
    let saves = 0;
    const settings = {};
    const port = createSkillPort({ getSettings: () => settings, saveSettings: async () => { saves++; }, loadBuiltins: readBuiltins });
    await port.ready();
    const initialSaves = saves;
    const task = createSkillTaskRuntime({ port, charge: () => true });
    task.bindRun(identity); await task.prepare(identity.id);
    const row = (await catalogAll(port)).find(row => row.id === 'builtin:st-card-stack-analysis');
    assert.ok(row); assert.equal(row.revision, '9:0');
    assert.equal(skillDisplay({ ...row, source: 'builtin' }, 'en').displayName, 'Character card and preset integration');
    const query = { id: row.id, revision: String(row.revision) };
    const pack = (await readBuiltins()).find(row => row.package.files[0].text.includes('name: st-card-stack-analysis\n')).package;
    for (const [index, file] of pack.files.entries()) {
        const result = await task.load(identity.id, { ...query, path: file.path });
        assert.equal(result.complete, true); assert.equal(result.permissionGranted, false);
        const projected = task.project(identity.id).map(message => JSON.parse(message.content.split('\n')[1])).filter(item => item.path);
        assert.deepEqual(projected.map(item => item.path), pack.files.slice(0, index + 1).map(item => item.path));
        assert.equal(projected.at(-1).text, file.text);
    }
    assert.equal(saves, initialSaves);
});

test('Card stack evaluation cases identify independent mechanisms and explicit unknowns without shipping source assets', async () => {
    const cases = JSON.parse(await readFile(new URL('../fixtures/muyu-skills/card-stack-evaluation.json', import.meta.url), 'utf8'));
    assert.equal(cases.length, 6);
    assert.equal(new Set(cases.map(row => row.id)).size, cases.length);
    for (const row of cases) {
        assert.equal(row.skill, 'st-card-stack-analysis');
        assert.ok(row.question.length > 8); assert.ok(row.expected.length); assert.ok(row.forbidden.length);
    }
});

for (const [name, title] of [
    ['st-ejs-template-guide', 'EJS prompt templates'],
    ['tavern-helper-guide', 'TavernHelper and interactive frontends'],
]) test(`${name} discovers bilingual metadata and loads complete resources progressively without grants or saves`, async () => {
    let saves = 0;
    const settings = {};
    const port = createSkillPort({ getSettings: () => settings, saveSettings: async () => { saves++; }, loadBuiltins: readBuiltins });
    await port.ready(); const initialSaves = saves;
    const task = createSkillTaskRuntime({ port, charge: () => true });
    task.bindRun(identity); await task.prepare(identity.id);
    const row = (await catalogAll(port)).find(row => row.id === `builtin:${name}`);
    assert.ok(row); assert.equal(row.revision, name === 'tavern-helper-guide' ? '6:0' : '5:0');
    assert.equal(skillDisplay({ ...row, source: 'builtin' }, 'en').displayName, title);
    const pack = (await readBuiltins()).find(row => row.package.files[0].text.includes(`name: ${name}\n`)).package;
    assert.equal(pack.files.length, 4);
    for (const [index, file] of pack.files.entries()) {
        const result = await task.load(identity.id, { id: row.id, revision: String(row.revision), path: file.path });
        assert.equal(result.complete, true); assert.equal(result.permissionGranted, false);
        const projected = task.project(identity.id).map(message => JSON.parse(message.content.split('\n')[1])).filter(item => item.path);
        assert.deepEqual(projected.map(item => item.path), pack.files.slice(0, index + 1).map(item => item.path));
        assert.equal(projected.at(-1).text, file.text);
    }
    assert.equal(saves, initialSaves);
});

test('Third-party component evaluation cases cover EJS and TavernHelper boundaries', async () => {
    const cases = JSON.parse(await readFile(new URL('../fixtures/muyu-skills/third-party-evaluation.json', import.meta.url), 'utf8'));
    assert.equal(cases.length, 8); assert.equal(new Set(cases.map(row => row.id)).size, cases.length);
    for (const name of ['st-ejs-template-guide', 'tavern-helper-guide']) assert.equal(cases.filter(row => row.skill === name).length, 4);
    for (const row of cases) {
        assert.ok(row.question.length > 8); assert.ok(row.expected.length); assert.ok(row.forbidden.length);
    }
});

test('Remaining plugin skill evaluation questions cover all ten workflows with explicit boundary cases', async () => {
    const cases = JSON.parse(await readFile(new URL('../fixtures/muyu-skills/remaining-evaluation.json', import.meta.url), 'utf8'));
    assert.equal(cases.length, 40); assert.equal(new Set(cases.map(row => row.id)).size, 40);
    for (const name of remainingNames) {
        const rows = cases.filter(row => row.skill === name);
        assert.equal(rows.length, 4); assert.ok(rows.some(row => row.kind === 'boundary'));
    }
    for (const row of cases) {
        assert.ok(row.question.length > 8); assert.ok(row.expected.length); assert.ok(row.forbidden.length);
    }
});

test('Plugin skill evaluation questions cover each skill and retain explicit expected and forbidden behavior', async () => {
    const cases = JSON.parse(await readFile(new URL('../fixtures/muyu-skills/evaluation.json', import.meta.url), 'utf8'));
    assert.equal(cases.length, 24); assert.equal(new Set(cases.map(row => row.id)).size, 24);
    for (const name of newNames) {
        const rows = cases.filter(row => row.skill === name);
        assert.equal(rows.length, 6);
        assert.ok(rows.some(row => row.kind === 'ambiguous'));
        assert.ok(rows.some(row => row.kind === 'boundary'));
    }
    for (const row of cases) {
        assert.ok(row.question.length > 8); assert.ok(row.expected.length); assert.ok(row.forbidden.length);
    }
});
