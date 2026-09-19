import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('memory UI delegates storage and generation mutations to Memory System', async () => {
    const source = await readFile(new URL('../../ui/sections/memory.js', import.meta.url), 'utf8');
    for (const method of [
        'pruneAfter', 'detectOrphans', 'resetAll', 'getStats', 'listMemories',
        'generateForCharacter', 'compressOldMemories', 'revertLast', 'deleteEntry', 'updateEntry',
    ]) {
        assert.match(source, new RegExp(`memorySystem\\.${method}\\(`));
    }
    assert.doesNotMatch(source, /chat_metadata|charMemories|saveChatConditional/);
    assert.doesNotMatch(source, /\.splice\(|Object\.assign\(/);
});

test('variable UI delegates definitions, values, rollback, and exchange to Variable System', async () => {
    const source = await readFile(new URL('../../ui/sections/variables.js', import.meta.url), 'utf8');
    for (const method of [
        'getDefs', 'getValue', 'deleteDefinition', 'upsertDefinition', 'setValue',
        'getLog', 'getValueStatus', 'resolveAvatar', 'revertValue', 'addTemplate',
        'exportToFile', 'importFromFile',
    ]) {
        assert.match(source, new RegExp(`variableSystem\\.${method}(?:\\?\\.)?\\(`));
    }
    assert.doesNotMatch(source, /chat_metadata|variables\.values|saveChatConditional/);
    assert.doesNotMatch(source, /\.splice\(|Object\.assign\(/);
});
