import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDirectorPlan, normalizeDirectorScripts, recoverDirectorPlan } from '../../systems/director-plan.js';

const characters = [{ avatar: 'alice.png', name: 'Alice' }, { avatar: 'bob.png', name: 'Bob' }, { avatar: 'eve.png', name: 'Eve' }];
const enabled = ['alice.png', 'bob.png'];
const match = (name, members) => characters.find(character => members.includes(character.avatar) && character.name.toLowerCase() === String(name).trim().toLowerCase()) || null;

test('Director plan removes duplicate, disabled, and unknown speakers before applying its cap', () => {
    const warnings = [];
    const plan = normalizeDirectorPlan({ speakers: ['alice', 'Alice', 'Eve', 'Unknown', 'Bob'], reason: 'scene relevance', scripts: { Alice: 'speak' }, variable_update: { global: {} } }, {
        enabledMembers: enabled, maxSpeakers: 1, matchCharacterByName: match, log: message => warnings.push(message),
    });
    assert.deepEqual(plan, { speakers: ['alice.png'], names: ['Alice'], reason: 'scene relevance', scripts: { Alice: 'speak' }, loreAssignments: null, variable_update: { global: {} } });
    assert.equal(warnings.length, 2);
});

test('Director plan rejects empty source plans and keeps enabled string scripts only', () => {
    assert.equal(normalizeDirectorPlan({ speakers: [] }, { enabledMembers: enabled, matchCharacterByName: match }), null);
    assert.deepEqual(normalizeDirectorScripts({ Alice: 'line', Eve: 'disabled', Bob: '', Unknown: 'bad' }, { enabledMembers: enabled, matchCharacterByName: match }), { Alice: 'line' });
});

test('persisted Director plans recover only currently enabled speakers and their valid scripts', () => {
    const recovered = recoverDirectorPlan({
        speakers: ['Bob', 'Eve', 'Bob', 'Alice'],
        reason: 'resume',
        scripts: { Bob: 'B', Eve: 'E', Alice: 42 },
    }, { enabledMembers: enabled, maxSpeakers: 3, matchCharacterByName: match });
    assert.deepEqual(recovered, {
        avatars: ['bob.png', 'alice.png'],
        names: ['Bob', 'Alice'],
        reason: 'resume',
        scripts: { Bob: 'B' },
    });
});
