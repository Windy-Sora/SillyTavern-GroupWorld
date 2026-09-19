import assert from 'node:assert/strict';
import test from 'node:test';
import { extractTriggerKeywords, matchesTrigger, rollInitiative } from '../../systems/trigger-initiative.js';

const character = { description: 'Detective, London', personality: 'Calm detective', scenario: 'Night mystery' };

test('trigger engine extracts stable unique keywords and matches recent messages case-insensitively', () => {
    assert.deepEqual(extractTriggerKeywords(character), ['detective', 'london', 'calm', 'night', 'mystery']);
    assert.equal(matchesTrigger(character, [{ mes: 'The DETECTIVE found a clue.' }]), true);
    assert.equal(matchesTrigger(character, [{ mes: 'No relevant topic.' }]), false);
});

test('trigger and initiative honor disabled settings and deterministic random input', () => {
    assert.equal(matchesTrigger(character, [{ mes: 'detective' }], { enabled: false }), false);
    assert.equal(rollInitiative({ enabled: false, baseScore: 10, random: () => 0.5 }), 0);
    assert.equal(rollInitiative({ baseScore: 10, random: () => 0.25 }), 2.5);
    assert.equal(rollInitiative({ baseScore: -1, random: () => 0.5 }), 0);
});
