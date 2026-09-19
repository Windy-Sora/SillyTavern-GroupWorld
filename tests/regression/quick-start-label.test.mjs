import assert from 'node:assert/strict';
import test from 'node:test';
import { getWorldBookSourceLabel } from '../../ui/sections/quick-start-helpers.js';

test('BUG-16: Chinese quick-start identifies the active SillyTavern world-book source', () => {
    assert.equal(getWorldBookSourceLabel('zh'), '跟随 ST 当前激活世界书');
    assert.equal(getWorldBookSourceLabel('en'), 'Following ST active world books');
});
