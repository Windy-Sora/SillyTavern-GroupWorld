import assert from 'node:assert/strict';
import test from 'node:test';
import {
    normalizeCustomAgent,
    normalizeCustomAgentList,
    validateCustomAgentExport,
} from '../../systems/custom-agent-validation.js';

test('custom agent normalization applies safe defaults and ignores external ids', () => {
    assert.deepEqual(normalizeCustomAgent({
        id: 'external',
        name: '  Audit  ',
        providerName: ' audit_result ',
    }), {
        name: 'Audit',
        providerName: 'audit_result',
        prompt: '',
        schema: '',
        enabled: false,
        autoEnabled: false,
        autoInterval: 10,
        order: 0,
    });
});

test('custom agent lists reject duplicate trusted ids', () => {
    assert.throws(() => normalizeCustomAgentList([
        { id: 'same', name: 'A', providerName: 'a' },
        { id: 'same', name: 'B', providerName: 'b' },
    ]), /duplicate id/);
});

test('custom agent validation rejects malformed fields and schemas', () => {
    const cases = [
        [null, /must be an object/],
        [{ name: '', providerName: 'x' }, /name must be a non-empty string/],
        [{ name: 'x', providerName: '' }, /providerName must be a non-empty string/],
        [{ name: 'x', providerName: 'bad-name' }, /letters, numbers, and underscore/],
        [{ name: 'x', providerName: 'x', prompt: 1 }, /prompt must be a string/],
        [{ name: 'x', providerName: 'x', schema: '{' }, /valid JSON/],
        [{ name: 'x', providerName: 'x', schema: '[]' }, /JSON object/],
        [{ name: 'x', providerName: 'x', autoInterval: 0 }, /autoInterval/],
        [{ name: 'x', providerName: 'x', order: 1000 }, /order/],
    ];
    for (const [value, error] of cases) {
        assert.throws(() => normalizeCustomAgent(value), error);
    }
});

test('custom agent export rejects duplicate providers and imports disabled', () => {
    const wrap = agents => ({ version: 1, type: 'custom-agent-export', agents });
    assert.throws(() => validateCustomAgentExport(null), /root must be an object/);
    assert.throws(() => validateCustomAgentExport({ version: 2, type: 'custom-agent-export', agents: [] }), /Unsupported version/);
    assert.throws(() => validateCustomAgentExport(wrap([
        { name: 'A', providerName: 'same' },
        { name: 'B', providerName: 'same' },
    ])), /duplicate providerName/);

    const [agent] = validateCustomAgentExport(wrap([{
        id: 'external', name: 'A', providerName: 'a', enabled: true, autoEnabled: true,
    }]));
    assert.equal(agent.id, undefined);
    assert.equal(agent.enabled, false);
    assert.equal(agent.autoEnabled, false);
});
