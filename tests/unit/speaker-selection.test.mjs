import assert from 'node:assert/strict';
import test from 'node:test';
import {
    countConsecutiveMessages,
    findLastSpokenIndex,
    scoreFormulaCharacter,
    selectTopCandidates,
} from '../../systems/speaker-selection.js';

const weights = { mention: 30, recency: 20, talkativeness: 10 };
const alice = { avatar: 'alice.png', name: 'Alice', talkativeness: 0.5 };
const mei = { avatar: 'mei.png', name: '美玲', talkativeness: '' };

test('formula score combines mention, trigger, recency, repeat penalty, talkativeness, and initiative', () => {
    const recent = [
        { is_user: true, mes: 'Alice, please answer.' },
        { avatar: 'alice.png', name: 'Alice', mes: 'Already answered.' },
        { is_user: true, mes: 'Alice, one more thing.' },
    ];
    const result = scoreFormulaCharacter({
        character: alice,
        recentMessages: recent,
        chat: [...recent, { avatar: 'alice.png', name: 'Alice', mes: 'latest' }],
        scoreWeights: weights,
        triggerScore: 40,
        consecutivePenalty: 15,
        triggered: true,
        initiative: 2.5,
    });

    assert.equal(result.score, 99.16666666666667);
    assert.deepEqual(result.breakdown, {
        mentionCount: 2,
        lastSpokenIndex: 1,
        consecutiveCount: 1,
        talkativeness: 0.5,
        triggered: true,
        initiative: 2.5,
    });
});

test('formula score handles CJK mentions and ignores user/system messages for recency', () => {
    const recent = [
        { is_user: true, mes: '美玲，美玲，请说话。' },
        { is_system: true, name: '美玲', mes: 'system text' },
    ];
    const result = scoreFormulaCharacter({
        character: mei,
        recentMessages: recent,
        chat: recent,
        scoreWeights: weights,
        triggerScore: 40,
        consecutivePenalty: 15,
    });

    assert.equal(result.breakdown.mentionCount, 2);
    assert.equal(findLastSpokenIndex(mei, recent), -1);
    assert.equal(countConsecutiveMessages(mei, recent), 0);
    assert.equal(result.score, 85);
});

test('Top-N selection is deterministic, bounded, and keeps only the highest ranked avatars', () => {
    const scores = { alice: 10, bob: 20, mei: 20, eve: -5 };
    assert.deepEqual(selectTopCandidates(scores, 2), ['bob', 'mei']);
    assert.deepEqual(selectTopCandidates(scores, 99), ['bob', 'mei', 'alice', 'eve']);
    assert.deepEqual(selectTopCandidates(scores, 0), []);
});
