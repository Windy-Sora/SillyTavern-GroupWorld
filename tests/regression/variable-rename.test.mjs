import assert from 'node:assert/strict';
import test from 'node:test';
import { hasVariableIdCollision } from '../../ui/sections/variable-helpers.js';

test('BUG-14: variable rename collision is detected before destructive replacement', () => {
    const definitions = new Map([['old', {}], ['occupied', {}]]);
    const variableSystem = { getDefinition: id => definitions.get(id) };
    assert.equal(hasVariableIdCollision(variableSystem, 'old', 'occupied'), true);
    assert.equal(hasVariableIdCollision(variableSystem, 'old', 'old'), false);
    assert.equal(hasVariableIdCollision(variableSystem, 'old', 'free'), false);
});
