import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'acorn';
import { skillDisplay, permissionDisplayTitle } from '../../muyu/ui/catalog-labels.js';
import { permissionTitle, permissionDescription, requestableSources } from '../../muyu/permissions/contract.js';
import { BUILTIN_SKILL_MANIFEST } from '../../muyu/skills/builtin-manifest.js';
import { loadBuiltinSkills } from '../../muyu/skills/builtin-loader.js';
import { parseSkillMarkdown } from '../../muyu/skills/contract.js';
const han = /[\u3400-\u9fff]/;

test('All builtin Skill display translations are complete and leave packages and user text unchanged', async () => {
    const packs = await loadBuiltinSkills({ readText: path => readFile(new URL(`../../assets/muyu-skills/${path}`, import.meta.url), 'utf8') });
    assert.equal(packs.length, BUILTIN_SKILL_MANIFEST.length);
    for (const pack of packs) {
        const meta = parseSkillMarkdown(pack.package.files.find(file => file.path === 'SKILL.md').text);
        const row = { ...meta, id: 'builtin:' + meta.name, source: 'builtin' }, original = JSON.stringify(row);
        const en = skillDisplay(row, 'en');
        assert.ok(en.displayName && en.description);
        assert.doesNotMatch(en.displayName + en.description, han);
        assert.deepEqual(skillDisplay(row, 'zh'), { displayName: meta.displayName, description: meta.description });
        assert.deepEqual(skillDisplay({ ...row, source: 'user', id: 'user:' + meta.name }, 'en'), skillDisplay(row, 'zh'));
        assert.equal(JSON.stringify(row), original);
    }
    const unknown = { source: 'builtin', id: 'builtin:future', displayName: '自定义名字', description: '原始用途' };
    assert.deepEqual(skillDisplay(unknown, 'en'), { displayName: '自定义名字', description: '原始用途' });
});

test('Localized permission titles do not change canonical titles or transcript control messages', () => {
    for (const source of requestableSources) {
        const canonical = permissionTitle(source.id);
        assert.doesNotMatch(permissionDisplayTitle(source.id, 'en'), han);
        assert.equal(permissionDisplayTitle(source.id, 'zh') + ' / ' + permissionDisplayTitle(source.id, 'en'), canonical);
        assert.equal(permissionTitle(source.id), canonical);
    }
    assert.equal(permissionDisplayTitle('unknown', 'en'), '');
    const transcript = permissionDescription({ source: 'memoryConfig', reason: 'User purpose' });
    assert.ok(transcript.includes(permissionTitle('memoryConfig')));
    assert.match(transcript, /读取授权申请 \/ Read permission request/);
});

test('Classic zh/en keys stay paired and every annotated settings label resolves in English', async () => {
    const tree = parse(await readFile(new URL('../../ui/i18n.js', import.meta.url), 'utf8'), { sourceType: 'module', ecmaVersion: 'latest' });
    const dict = tree.body.find(node => node.type === 'VariableDeclaration' && node.declarations.some(row => row.id.name === 'I18N')).declarations[0].init;
    const keys = Object.fromEntries(dict.properties.map(row => [row.key.name, row.value.properties.map(row => row.key.name || row.key.value).sort()]));
    assert.deepEqual(keys.zh, keys.en);
    const html = await readFile(new URL('../../settings.html', import.meta.url), 'utf8');
    for (const match of html.matchAll(/data-i18n(?:-placeholder|-title)?="([^"]+)"/g)) assert.ok(keys.en.includes(match[1]), match[1]);
    for (const key of ['npcLibraryPlaceholder', 'npcLibraryApply', 'npcLibrarySave', 'npcLibraryImport', 'npcImportTemplateShort']) assert.ok(html.includes(`data-i18n="${key}"`));
});
