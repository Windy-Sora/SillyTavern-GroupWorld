import assert from 'node:assert/strict';
import test from 'node:test';
import { decideFormulaTurn } from '../../systems/round-state.js';
import { canFinalizeRound } from '../../systems/round-finalization.js';
import { scoreFormulaCharacter } from '../../systems/speaker-selection.js';
import { matchesTrigger, rollInitiative } from '../../systems/trigger-initiative.js';

const weights = { mention: 30, recency: 20, talkativeness: 10 };

test('Formula Director pipeline selects the relevant triggered character and blocks the other candidate', () => {
    const alice = { avatar: 'alice.png', name: 'Alice', description: 'Detective clue', talkativeness: 0.5 };
    const bob = { avatar: 'bob.png', name: 'Bob', description: 'Chef kitchen', talkativeness: 0.5 };
    const recentMessages = [{ is_user: true, mes: 'Alice, did you find the clue?' }];
    const common = { recentMessages, chat: recentMessages, scoreWeights: weights, triggerScore: 40, consecutivePenalty: 15 };
    const scores = {
        [alice.avatar]: scoreFormulaCharacter({
            ...common,
            character: alice,
            triggered: matchesTrigger(alice, recentMessages),
            initiative: rollInitiative({ baseScore: 5, random: () => 0 }),
        }).score,
        [bob.avatar]: scoreFormulaCharacter({
            ...common,
            character: bob,
            triggered: matchesTrigger(bob, recentMessages),
            initiative: rollInitiative({ baseScore: 5, random: () => 0 }),
        }).score,
    };

    const aliceTurn = decideFormulaTurn({ scores, topN: 1, avatar: alice.avatar });
    const bobTurn = decideFormulaTurn({ scores, topN: 1, avatar: bob.avatar, speakerCount: aliceTurn.nextSpeakerCount });
    assert.equal(aliceTurn.allowed, true);
    assert.equal(bobTurn.allowed, false);
    assert.equal(bobTurn.nextSpeakerCount, 1);
    assert.equal(canFinalizeRound({}), true);
});

test('Formula Director pipeline honors disabled triggers and consecutive-speaking penalty', () => {
    const alice = { avatar: 'alice.png', name: 'Alice', description: 'Detective clue', talkativeness: 0.5 };
    const bob = { avatar: 'bob.png', name: 'Bob', description: 'Chef kitchen', talkativeness: 0.5 };
    const recentMessages = [{ is_user: true, mes: 'A quiet evening.' }];
    const chat = [...recentMessages, { avatar: alice.avatar, name: alice.name, mes: 'Alice spoke.' }];
    const aliceScore = scoreFormulaCharacter({ character: alice, recentMessages, chat, scoreWeights: weights, triggerScore: 40, consecutivePenalty: 15, triggered: matchesTrigger(alice, recentMessages, { enabled: false }) }).score;
    const bobScore = scoreFormulaCharacter({ character: bob, recentMessages, chat, scoreWeights: weights, triggerScore: 40, consecutivePenalty: 15, triggered: false }).score;
    assert.ok(bobScore > aliceScore);
});
