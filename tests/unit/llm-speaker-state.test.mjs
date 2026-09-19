import assert from 'node:assert/strict';
import test from 'node:test';
import { decideLlmSpeakerTurn } from '../../systems/llm-speaker-state.js';

test('LLM speaker state blocks unplanned normal speakers and advances planned order', () => {
    assert.deepEqual(decideLlmSpeakerTurn({ plannedAvatars: ['alice', 'bob'], avatar: 'eve', respectOrder: true }), {
        action: 'block', reason: 'not_planned', spokenAvatars: [], cursor: 0,
    });
    assert.deepEqual(decideLlmSpeakerTurn({ plannedAvatars: ['alice', 'bob'], avatar: 'alice', respectOrder: true }), {
        action: 'allow', reason: 'planned', spokenAvatars: ['alice'], cursor: 1,
    });
});

test('LLM speaker state records out-of-order allowed speakers and keeps rerolls transparent', () => {
    assert.deepEqual(decideLlmSpeakerTurn({ plannedAvatars: ['alice', 'bob'], avatar: 'bob', respectOrder: true }), {
        action: 'allow', reason: 'planned', spokenAvatars: ['bob'], cursor: 0,
    });
    assert.deepEqual(decideLlmSpeakerTurn({ plannedAvatars: ['alice'], spokenAvatars: ['alice'], cursor: 1, avatar: 'eve', generationType: 'swipe', respectOrder: true }), {
        action: 'allow', reason: 'reroll', spokenAvatars: ['alice'], cursor: 1,
    });
});
