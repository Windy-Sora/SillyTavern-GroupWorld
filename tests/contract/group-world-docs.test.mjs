import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir, access } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const legacy = ['DESIGN.md', 'DESIGN_EN.md', 'USER-GUIDE.md', 'USER-GUIDE_EN.md',
    'TEMPLATE-SYNTAX.md', 'TEMPLATE-SYNTAX_EN.md', 'STORY-BLUEPRINT.md', 'TESTING.md'];

test('GW documentation links resolve without requiring another checkout', async () => {
    const files = ['README.md', 'README_EN.md', 'MIGRATION.md', ...legacy,
        ...(await readdir(new URL('docs/', root))).filter(p => p.endsWith('.md')).map(p => 'docs/' + p)];
    for (const file of files) {
        const prose = (await read(file)).replace(/```[\s\S]*?```/g, '');
        for (const match of prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
            const target = match[1].replace(/^<|>$/g, '').split('#')[0];
            if (!target || /^[a-z]+:/i.test(target)) continue;
            await assert.doesNotReject(access(new URL(decodeURIComponent(target), new URL(file, root))), `${file}: ${target}`);
        }
    }
});

test('GW old documentation paths are redirects, not independent manuals', async () => {
    for (const file of legacy) {
        const content = await read(file);
        assert.ok(content.length < 600, file);
        assert.ok(content.includes(`](docs/${file})`), file);
        assert.ok((await read('docs/' + file)).length > content.length, file);
    }
});

test('GW bilingual install and default-profile instructions retain adaptations', async () => {
    for (const file of ['README.md', 'README_EN.md', 'docs/USER-GUIDE.md', 'docs/USER-GUIDE_EN.md']) {
        const content = await read(file);
        assert.match(content, /SillyTavern-GroupWorld/, file);
        assert.match(content, /group-world-default/, file);
        assert.doesNotMatch(content, /SillyTavern-GroupDirector|group-director-default/, file);
    }
});

test('GW release guidance retains API, optional-service and manual-acceptance boundaries', async () => {
    const migration = await read('MIGRATION.md');
    for (const marker of ['window.GroupDirector', 'groupDirector_Interceptor', '/api/plugins/gd-muyu-history',
        'gd-muyu-history-worldbook', 'HISTORY_UNAVAILABLE', 'Enable only one', 'Remaining manual release gate']) {
        assert.ok(migration.includes(marker), marker);
    }
    assert.doesNotMatch(await read('docs/DESIGN.md'), /window\.GroupWorld/);
    assert.doesNotMatch(await read('docs/DESIGN_EN.md'), /window\.GroupWorld/);
    assert.match(await read('docs/UI-REWORK.md'), /历史设计参考/);
});
