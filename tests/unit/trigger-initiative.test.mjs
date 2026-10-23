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

test('Latin triggers use lexical boundaries and ignore English stop words while CJK retains substring matching', () => {
    assert.deepEqual(extractTriggerKeywords({ description: 'he the she their detective' }), ['detective']);
    const latin = { description: 'hero' };
    for (const mes of ['superhero', 'heroine', 'hero_1', 'heróhero']) assert.equal(matchesTrigger(latin, [{ mes }]), false, mes);
    for (const mes of ['A HERO!', 'hero-like', '遇到了hero。']) assert.equal(matchesTrigger(latin, [{ mes }]), true, mes);
    assert.equal(matchesTrigger({ description: '魔法' }, [{ mes: '施展魔法术式' }]), true);
    assert.equal(matchesTrigger({ description: 'he the' }, [{ mes: 'the hero is here' }]), false);
});
