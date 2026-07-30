import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import baseConfig from '../../gd-test.config.mjs';
import { runStaticChecks } from '../../tools/gd-test/lib/checks.mjs';

async function createFixture(t, files) {
    const root = await mkdtemp(path.join(tmpdir(), 'gd-test-lab-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    for (const [name, content] of Object.entries(files)) {
        await writeFile(path.join(root, name), content, 'utf8');
    }
    return root;
}

function fixtureConfig() {
    return {
        ...baseConfig,
        staticChecks: {
            ...baseConfig.staticChecks,
            syntaxConcurrency: 1,
            moduleSmokeRoots: [],
        },
    };
}

test('static checks fail missing imports reachable from the manifest entry', async t => {
    const root = await createFixture(t, {
        'manifest.json': JSON.stringify({
            display_name: 'fixture',
            loading_order: 1,
            js: 'index.js',
            css: 'style.css',
            version: '1.0.0',
        }),
        'index.js': "import './missing.js';\n",
        'style.css': '',
    });
    const result = await runStaticChecks(root, fixtureConfig());
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(item => item.code === 'IMPORT_MISSING' && item.severity === 'error'));
});

test('static checks expose broken orphan modules without failing active code', async t => {
    const root = await createFixture(t, {
        'manifest.json': JSON.stringify({
            display_name: 'fixture',
            loading_order: 1,
            js: 'index.js',
            css: 'style.css',
            version: '1.0.0',
        }),
        'index.js': 'export const ready = true;\n',
        'orphan.js': "import './missing.js';\n",
        'style.css': '',
    });
    const result = await runStaticChecks(root, fixtureConfig());
    assert.equal(result.ok, true);
    assert.ok(result.issues.some(item => item.code === 'IMPORT_MISSING_ORPHAN' && item.severity === 'warning'));
});
