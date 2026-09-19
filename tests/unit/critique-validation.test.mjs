import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCritiqueData, validateCritiqueExport } from '../../systems/critique-validation.js';

test('critique validation adds missing core containers without mutating input', () => {
    const source = { extra: 'kept' };
    const normalized = normalizeCritiqueData(source);
    assert.deepEqual(normalized, { extra: 'kept', directorCritique: {}, characterCritiques: {} });
    assert.deepEqual(source, { extra: 'kept' });
});

test('critique validation rejects null character entries and non-JSON data', () => {
    assert.throws(() => normalizeCritiqueData({ directorCritique: {}, characterCritiques: { Alice: null } }), /Alice must be an object/);
    assert.throws(() => normalizeCritiqueData({ directorCritique: { score: Infinity }, characterCritiques: {} }), /JSON-compatible/);
});

test('critique export validation enforces the nested content and data contract', () => {
    const base = { version: 1, type: 'critique-export', critique: { content: '', data: { directorCritique: {}, characterCritiques: {} } } };
    assert.deepEqual(validateCritiqueExport(base), { ok: true });
    assert.match(validateCritiqueExport({ ...base, critique: { ...base.critique, content: 4 } }).error, /content/);
    assert.match(validateCritiqueExport({ ...base, critique: { ...base.critique, data: [] } }).error, /must be an object/);
});
