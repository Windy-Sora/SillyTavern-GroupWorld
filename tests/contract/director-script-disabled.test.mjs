import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { matchEnabledCharacter } from '../../utils/character-identity.js';

const source = await readFile(new URL('../../index.js', import.meta.url), 'utf8');
const functionSource = source.slice(source.indexOf('async function getScriptForChar('), source.indexOf('\nfunction saveSettings()'));

test('disabled Director scripts neither render the wrapper nor update counters', async () => {
    const getScript = vm.runInNewContext(`${functionSource}\ngetScriptForChar`, {
        settings: { llmScriptEnabled: false },
    });
    assert.equal(await getScript('Alice'), '');
});

test('production script injection and reroll snapshots stay with each same-name avatar', async () => {
    const characters = [{ name: 'Alice', avatar: 'a.png' }, { name: 'Alice', avatar: 'b.png' }];
    const restores = [];
    const sandbox = { settings: { llmScriptEnabled: true }, characters,
        directorScripts: { 'a.png': 'A', 'b.png': 'B', Alice: 'WRONG' },
        roundGenerateType: 'normal', scriptCounterSnapshots: new Map(), chat_metadata: { gd: {} }, EXT_KEY: 'gd',
        roundCounterGet: () => sandbox.scriptCounterSnapshots.size,
        roundCounterSet: value => restores.push(value),
        matchCharacterByName: (name, enabled) => matchEnabledCharacter(name, enabled, characters),
        renderPrompt: async (prompt, ctx) => `${prompt}:${ctx.avatar}:${ctx.characterNameAmbiguous}`,
    };
    const getScript = vm.runInNewContext(`${functionSource}\ngetScriptForChar`, sandbox);
    assert.equal(await getScript('a.png'), 'A:a.png:true');
    assert.equal(await getScript('b.png'), 'B:b.png:true');
    assert.equal(await getScript('Alice'), '');
    sandbox.roundGenerateType = 'swipe';
    await getScript('b.png');
    await getScript('a.png');
    assert.deepEqual(restores, [1, 0]);
    sandbox.directorScripts = { Alice: 'WRONG' };
    assert.equal(await getScript('a.png'), ':a.png:true');
});
