import assert from 'node:assert/strict';
import test from 'node:test';
import {
    normalizeCustomPrompt,
    normalizeCustomPromptList,
    parseCustomPromptData,
    validateCustomPromptExport,
} from '../../systems/custom-prompt-validation.js';

test('custom prompt normalization applies defaults and preserves only an explicitly supplied id', () => {
    assert.deepEqual(normalizeCustomPrompt({ name: ' note ' }, { id: 'trusted' }), {
        id: 'trusted', name: 'note', content: '', dataJson: '', scope: 'global', enabled: true,
    });
    assert.deepEqual(parseCustomPromptData('[1,2]'), [1, 2]);
    assert.equal(parseCustomPromptData(''), null);
});

test('custom prompt validation rejects malformed fields and duplicate identities', () => {
    const cases = [
        [null, /must be an object/],
        [{ name: '' }, /non-empty string/],
        [{ name: 'bad-name' }, /letters, numbers, and underscore/],
        [{ name: 'x', content: 1 }, /content must be a string/],
        [{ name: 'x', dataJson: 1 }, /dataJson must be a string/],
        [{ name: 'x', dataJson: '{' }, /valid JSON/],
        [{ name: 'x', dataJson: '1' }, /object or array/],
        [{ name: 'x', scope: 'invalid' }, /scope is invalid/],
        [{ name: 'x', enabled: 1 }, /enabled must be boolean/],
    ];
    for (const [value, error] of cases) assert.throws(() => normalizeCustomPrompt(value), error);
    assert.throws(() => normalizeCustomPromptList([{ name: 'x' }, { name: 'x' }]), /duplicate name/);
    assert.throws(() => normalizeCustomPromptList([
        { id: 'same', name: 'x' }, { id: 'same', name: 'y' },
    ]), /duplicate id/);
});

test('custom prompt export validates the full envelope and drops external ids', () => {
    assert.throws(() => validateCustomPromptExport(null), /root must be an object/);
    assert.throws(() => validateCustomPromptExport({ type: 'wrong', version: 1 }), /Not a custom prompt/);
    assert.throws(() => validateCustomPromptExport({ type: 'custom-prompt-export', version: 2, prompts: [] }), /Unsupported version/);
    const [prompt] = validateCustomPromptExport({
        type: 'custom-prompt-export', version: 1,
        prompts: [{ id: 'external', name: 'note', dataJson: '{}' }],
    });
    assert.equal(prompt.id, undefined);
    assert.equal(prompt.scope, 'global');
});
