import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSchema, validateJson } from '../../muyu/core/json-contract.js';

const branch = kind => ({ type: 'object', properties: { kind: { type: 'string', enum: [kind] } }, required: ['kind'], additionalProperties: false });
const schema = { type: 'object', properties: { kind: { type: 'string' } }, required: ['kind'], additionalProperties: false, oneOf: [branch('memory'), branch('npc')] };
test('oneOf requires exactly one closed, validated alternative', () => {
    assert.deepEqual(validateJson(schema, { kind: 'memory' }), { kind: 'memory' });
    assert.throws(() => validateJson(schema, { kind: 'profile' }), /alternative mismatch/);
    assert.throws(() => validateJson({ ...schema, oneOf: [branch('memory'), branch('memory')] }, { kind: 'memory' }), /alternative mismatch/);
    assert.throws(() => validateJson(schema, { kind: 'memory', arbitrary: true }), /Unknown JSON field/);
});
test('unsupported, invalid and overlarge alternatives fail at schema registration', () => {
    for (const oneOf of [[], [branch('memory')], Array(9).fill(branch('memory')), 'memory', [{ ...branch('memory'), unsafeKeyword: true }, branch('npc')]]) {
        assert.throws(() => checkSchema({ ...schema, oneOf }));
    }
});
