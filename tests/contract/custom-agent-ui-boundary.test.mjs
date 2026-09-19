import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('custom agent UI delegates every business mutation to the system boundary', async () => {
    const source = await readFile(new URL('../../ui/sections/customAgents.js', import.meta.url), 'utf8');
    for (const method of [
        'add', 'update', 'toggle', 'remove', 'importAgents',
        'createExportData', 'updateResult',
    ]) {
        assert.match(source, new RegExp(`customAgentSystem\\.${method}\\(`));
    }
    for (const method of ['add', 'update', 'toggle', 'remove', 'importAgents', 'updateResult']) {
        assert.match(source, new RegExp(`await customAgentSystem\\.${method}\\(`));
    }
    assert.match(source, /await saveFromEditPanel\(id, true\)/);
    assert.doesNotMatch(source, /settings\.customAgents/);
    assert.doesNotMatch(source, /saveSettings|saveChatConditional/);
    assert.doesNotMatch(source, /_caData|_autoCAG_/);
    assert.doesNotMatch(source, /\.splice\(|Object\.assign\(/);
});

test('entry auto orchestration consumes pure policy actions without direct counter writes', async () => {
    const source = await readFile(new URL('../../index.js', import.meta.url), 'utf8');
    const start = source.indexOf('// ─── Auto Custom Agents');
    const end = source.indexOf('\n        }\n    }\n});', start);
    const block = source.slice(start, end);
    assert.match(block, /planCustomAgentAutoRuns\(/);
    assert.match(block, /customAgentSystem\.executeAuto\(/);
    assert.match(block, /customAgentSystem\.setAutoCounter\(/);
    assert.doesNotMatch(block, /chat_metadata\[EXT_KEY\]\[[^\]]+\]\s*=/);
});
