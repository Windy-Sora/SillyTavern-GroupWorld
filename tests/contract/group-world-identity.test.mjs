import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PRODUCT_IDENTITY, HOST_PRODUCT_GUIDE } from '../../utils/product-identity.js';
import { MUYU_PERSONA } from '../../muyu/instructions/persona.js';
import { composeInstructions, composeReceiptInstructions } from '../../muyu/instructions/compose.js';
import { renderInstructions } from '../../muyu/instructions/contract.js';
import { navigationDocument } from '../../muyu/ui/navigation-metadata.js';
import { createChatCompletionsModel } from '../../muyu/model/chat-completions.js';
import { loadBuiltinSkills } from '../../muyu/skills/builtin-loader.js';
import { BUILTIN_SKILL_MANIFEST } from '../../muyu/skills/builtin-manifest.js';
import { createSkillRegistry } from '../../muyu/skills/registry.js';
import { WORLD_BOOK_HISTORY_PREFIX, WORLD_BOOK_HISTORY_KEY, historyBookName } from '../../muyu/sessions/worldbook-contract.js';
import { isInternalWorldBookName } from '../../systems/internal-world-books.js';

const read = async path => (await readFile(new URL(`../../${path}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const builtins = () => loadBuiltinSkills({ readText: path => read(`assets/muyu-skills/${path}`) });
const code = text => text.match(/```[\s\S]*?```|`[^`\n]*`/g) || [];

test('Trusted GroupWorld identity explains old names without creating new APIs or permissions', () => {
    assert.equal(PRODUCT_IDENTITY.name, 'GroupWorld');
    assert.equal(PRODUCT_IDENTITY.displayName, 'Group World');
    assert.ok(Object.isFrozen(PRODUCT_IDENTITY));
    assert.ok(Object.isFrozen(PRODUCT_IDENTITY.compatibilityNames));
    assert.match(MUYU_PERSONA, /猫头鹰娘.*GroupWorld/);
    assert.doesNotMatch(MUYU_PERSONA, /Group Director/);
    assert.match(HOST_PRODUCT_GUIDE, /不是缺失依赖/);
    assert.match(HOST_PRODUCT_GUIDE, /不需要再安装或同时启用GroupDirector/);
    assert.match(HOST_PRODUCT_GUIDE, /window\.GroupDirector、groupDirector_Interceptor、group-director/);
    assert.match(HOST_PRODUCT_GUIDE, /不杜撰window\.GroupWorld/);
    assert.match(HOST_PRODUCT_GUIDE, /GroupWorld不是世界书/);
    assert.match(HOST_PRODUCT_GUIDE, /工具和契约为准/);
    assert.match(HOST_PRODUCT_GUIDE, /不授予权限或证明操作成功/);
});

test('Every model mode and receipt includes the same identity once without inflating instruction DTO limits', () => {
    const cases = ['assistant', 'chat', 'draft', 'memory', 'director'].map(mode => composeInstructions(mode));
    cases.push(composeReceiptInstructions());
    for (const value of cases) {
        const before = JSON.stringify(value), text = renderInstructions(value);
        assert.equal(text.split(HOST_PRODUCT_GUIDE).length, 2);
        assert.equal(JSON.stringify(value), before);
        assert.ok(value.base.length <= 3700);
        assert.ok(value.task.length <= 3300);
        assert.equal(Object.keys(value).sort().join(','), 'base,preference,task,version');
    }
});

for (const [language, question] of [
    ['zh', '给我写一个 Provider，保留 window.GroupDirector 和 {{gdWorldBooksFull}}。'],
    ['en', 'I only installed GroupWorld. Explain window.GroupDirector; do not rename my code.'],
]) {
    test(`Actual ${language} request carries host identity and preserves user code and language choice`, async () => {
        let sent;
        const model = createChatCompletionsModel({
            connection: { endpoint: 'https://model.invalid/chat/completions', apiKey: 'test-placeholder', model: 'fixture', supportsTools: false },
            fetchImpl: async (_url, options) => {
                sent = JSON.parse(options.body);
                return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'fixture' } }] }), { headers: { 'content-type': 'application/json' } });
            },
        });
        const instructions = composeInstructions('assistant', { enabled: false, text: '', replyLanguage: { enabled: true, language } });
        const request = { messages: [{ role: 'user', content: question }], tools: [], instructions };
        const estimate = model.inspect(request);
        for await (const _event of model.run(request, { signal: new AbortController().signal })) { /* Only inspect the mock transport. */ }
        assert.equal(sent.messages[0].role, 'system');
        assert.ok(sent.messages[0].content.includes(HOST_PRODUCT_GUIDE));
        assert.equal(sent.messages.at(-1).content, question);
        assert.equal(sent.messages.filter(row => row.role === 'system').length, 1);
        assert.ok(estimate.requestBytes >= new TextEncoder().encode(sent.messages[0].content).length);
        assert.equal(instructions.responseLanguage, language);
    });
}

test('Public navigation uses the actual GW display name and remains a bounded static document', async () => {
    const document = navigationDocument(), nav = JSON.parse(document.text);
    const manifest = JSON.parse(await read('manifest.json'));
    assert.equal(nav.product.displayName, manifest.display_name);
    assert.equal(nav.product.homepage, manifest.homePage);
    assert.match(nav.ballVisibility.location, /^Group World 经典设置/);
    assert.match(nav.characterMemory.location.zh, /^Group World 经典设置 → 角色记忆$/);
    assert.match(nav.characterMemory.location.en, /^Group World classic settings → Character Memory$/);
    assert.ok(document.text.length <= 4000);
    assert.equal(nav.notes.distinctFromCharacterMemory, true);
});

test('All 23 builtins load and every adapted package publishes its new content revision', async () => {
    const expected = {
        'config-review': 5, 'provider-workbench': 4, 'variable-workbench': 4,
        'memory-maintenance': 3, 'muyu-interface-guide': 7, 'muyu-troubleshooting': 10, 'muyu-settings-guide': 5,
        'character-npc-workbench': 7, 'resource-library-workflow': 6,
        'prompt-template-workbench': 11, 'script-agent-workbench': 4,
        'worldbook-workflow': 13, 'dsl-template-workbench': 2,
        'st-card-stack-analysis': 9, 'st-ejs-template-guide': 5, 'tavern-helper-guide': 6,
    };
    const packs = await builtins();
    assert.equal(packs.length, 23);
    for (const [name, revision] of Object.entries(expected)) {
        assert.equal(BUILTIN_SKILL_MANIFEST.find(row => row.name === name).revision, revision);
    }
    const prose = packs.flatMap(row => row.package.files).filter(file => file.path.endsWith('.md')).map(file => file.text.replace(/```[\s\S]*?```|`[^`\n]*`/g, '')).join('\n');
    assert.doesNotMatch(prose, /Group Director|\bGD\b/);
});

test('Brand adaptation preserves original Skill code and JSON; added storage names use only canonical literals', async () => {
    const files = [];
    async function walk(path) {
        // This new guide was not in the original 22-package brand-adaptation snapshot.
        // Its GroupWorld prose and manifest revision are checked above; keep the
        // original code/JSON checksum intact rather than replacing it with a new hash.
        if (path === 'assets/muyu-skills/muyu-settings-guide') return;
        for (const entry of await readdir(new URL(`../../${path}`, import.meta.url), { withFileTypes: true })) {
            const child = `${path}/${entry.name}`;
            if (entry.isDirectory()) await walk(child);
            else if (/\.(md|json)$/.test(child)) files.push(child);
        }
    }
    await walk('assets/muyu-skills');
    const snapshot = [];
    const addedStorageNames = new Set(['`GD-Muyu-History-v1-`', '`GD-Muyu-History-v2-`', '`gdMuyuHistory`', '`gd-muyu-history-worldbook`']);
    for (const file of files.sort()) {
        const text = await read(file);
        const spans = file.endsWith('.json') ? text : code(text);
        snapshot.push([file, file === 'assets/muyu-skills/worldbook-workflow/references/workflow.md'
            ? spans.filter(span => !addedStorageNames.has(span)) : spans]);
    }
    // All original GD a507a14 code spans remain byte-identical. Only four new
    // canonical archive-name literals were added, verified separately below.
    assert.equal(createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'), 'a9dcd87c05b03a8fcc4466b7482a2cdcc75b46a69467b66b1b4c88c4f5b82820');
});

test('Archive knowledge keeps canonical markers and disabled storage distinct from story injection', async () => {
    const text = await read('assets/muyu-skills/worldbook-workflow/references/workflow.md');
    for (const name of ['GD-Muyu-History-v1-', 'GD-Muyu-History-v2-', WORLD_BOOK_HISTORY_KEY, 'gd-muyu-history-worldbook']) {
        assert.ok(text.includes('`' + name + '`'), name);
    }
    assert.match(text, /仅看到书名并不能证明.*完整有效/);
    assert.match(text, /必须保持所有条目禁用并防递归/);
    assert.match(text, /不靠酒馆关键词激活或剧情绑定/);
    assert.match(text, /删除整卷会影响卷内多个会话/);
    assert.match(text, /先在暮羽导出备份/);
    assert.match(text, /当前读取来源仍单选/);
});

test('Session knowledge distinguishes Muyu conversations, Tavern targets and shared product storage', async () => {
    const text = await read('assets/muyu-skills/muyu-interface-guide/references/workflow.md');
    assert.match(text, /对话历史.*新对话.*New conversation/);
    assert.match(text, /同一个酒馆聊天可以对应多段暮羽对话/);
    assert.match(text, /切换酒馆聊天后，可以在同一暮羽会话继续交流/);
    assert.match(text, /不是磁盘、账号或权限的强隔离/);
    assert.match(text, /两个实际仓库.*相同兼容/);
    assert.match(text, /只能启用其中一个/);
    assert.match(text, /用户资源及历史名称不做品牌替换/);
    assert.match(text, /不能把旧聊天资料当作新聊天的当前状态/);
});

test('New builtin revisions preserve user Skill documents, disabled policies and stale-version rejection', async () => {
    const pack = { format: 'muyu-skill-package', version: 1, files: [{ path: 'SKILL.md', text: '---\nname: personal-guide\ndescription: My Group Director guide.\n---\nKeep window.GroupDirector and my GD variable names unchanged.' }] };
    const data = { version: 2, revision: 7, enabled: true, skills: [{ id: 'user:personal-guide', revision: 5, enabled: true, package: pack }], builtinPolicies: [
        { id: 'builtin:memory-maintenance', revision: 7, enabled: false },
        { id: 'builtin:muyu-interface-guide', revision: 7, enabled: false },
        { id: 'builtin:worldbook-workflow', revision: 7, enabled: false },
    ] };
    const before = JSON.stringify(data);
    const registry = createSkillRegistry({ builtins: await builtins(), store: { read: async () => data } });
    const rows = await registry.list();
    const builtin = rows.find(row => row.id === 'builtin:memory-maintenance');
    assert.equal(builtin.revision, '3:7');
    assert.equal(builtin.enabled, false);
    await assert.rejects(registry.snapshot({ id: builtin.id, revision: '2:7', invocation: 'model' }), /SKILL_STALE/);
    await assert.rejects(registry.snapshot({ id: builtin.id, revision: builtin.revision, invocation: 'model' }), /SKILL_DISABLED/);
    for (const [name, oldRevision, revision] of [['muyu-interface-guide', '6:7', '7:7'], ['worldbook-workflow', '12:7', '13:7']]) {
        const row = rows.find(r => r.id === 'builtin:' + name);
        assert.equal(row.revision, revision);
        assert.equal(row.enabled, false, 'knowledge updates must not re-enable user-disabled guides');
        await assert.rejects(registry.snapshot({ id: row.id, revision: oldRevision, invocation: 'model' }), /SKILL_STALE/);
        await assert.rejects(registry.snapshot({ id: row.id, revision, invocation: 'model' }), /SKILL_DISABLED/);
    }
    const user = await registry.inspect({ id: 'user:personal-guide', revision: 5 });
    assert.deepEqual(user.package, pack);
    assert.equal(JSON.stringify(data), before);
});

test('Character-card product prose changes without renaming its companion book or technical identifiers', async () => {
    const card = JSON.parse(await read('assets/gd-assistant/character.json'));
    const book = JSON.parse(await read('assets/gd-assistant/world-book.json'));
    assert.match(card.description, /GroupWorld/);
    assert.ok(card.system_prompt.includes(HOST_PRODUCT_GUIDE));
    assert.match(card.system_prompt, /GD_Dev_Assistant/);
    assert.match(await read('ui/sections/gdAssistant.js'), /GD_Dev_Assistant/);
    assert.ok(book.entries['0'].content.includes(HOST_PRODUCT_GUIDE));
    assert.ok(book.entries['0'].key.includes('GD架构'));
    assert.ok(book.entries['0'].key.includes('GroupWorld架构'));
    assert.match(book.entries['14'].content, /\[GroupDirector\]/);
    assert.match(book.entries['16'].comment, /不证明启用成功/);
});

test('World-book history namespaces and metadata stay legacy-compatible despite display branding', () => {
    const namespace = '11111111-1111-4111-8111-111111111111', record = '22222222-2222-4222-8222-222222222222';
    assert.equal(WORLD_BOOK_HISTORY_PREFIX, 'GD-Muyu-History-v1-');
    assert.equal(WORLD_BOOK_HISTORY_KEY, 'gdMuyuHistory');
    assert.equal(historyBookName(namespace, record), `GD-Muyu-History-v1-${namespace}-${record}`);
    assert.equal(isInternalWorldBookName(`GD-Muyu-History-v2-${namespace}-${record}`), true);
    assert.equal(isInternalWorldBookName(`GroupWorld-Muyu-History-v2-${namespace}-${record}`), false);
});
