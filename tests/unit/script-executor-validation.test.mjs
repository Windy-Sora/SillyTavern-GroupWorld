import assert from 'node:assert/strict';
import test from 'node:test';
import {
    normalizeScriptExecutor,
    validateScriptExecutorExport,
} from '../../systems/script-executor-validation.js';

test('script executor normalization applies version-1 defaults without retaining an external id', () => {
    assert.deepEqual(normalizeScriptExecutor({ id: 'external', name: '  Scene hook  ' }), {
        name: 'Scene hook',
        triggerOn: 'both',
        priority: 0,
        code: '',
        enabled: true,
        params: [],
        renderParams: false,
        returnMode: 'ignore',
    });
});

test('script executor export rejects malformed entries and unsupported fields', () => {
    const wrap = executor => ({
        version: 1,
        type: 'script-executor-export',
        executors: [executor],
        migrations: [],
    });
    const cases = [
        [null, /executors\[0\] must be an object/],
        [{ name: '' }, /name must be a non-empty string/],
        [{ name: 'x', triggerOn: 'later' }, /triggerOn is invalid/],
        [{ name: 'x', priority: 101 }, /priority/],
        [{ name: 'x', code: 42 }, /code must be a string/],
        [{ name: 'x', enabled: 1 }, /enabled must be boolean/],
        [{ name: 'x', params: [null] }, /params\[0\] must be an object/],
        [{ name: 'x', params: [{ key: '__proto__' }] }, /key is not allowed/],
        [{ name: 'x', params: [{ key: 'count', type: 'number', default: '1' }] }, /finite number/],
        [{ name: 'x', params: [{ key: 'a' }, { key: 'a' }] }, /duplicate key/],
    ];
    for (const [entry, pattern] of cases) {
        assert.throws(() => validateScriptExecutorExport(wrap(entry)), pattern);
    }
});

test('script executor export validates its root contract and duplicate names', () => {
    assert.throws(() => validateScriptExecutorExport(null), /root must be an object/);
    assert.throws(() => validateScriptExecutorExport({ type: 'wrong', version: 1, executors: [] }), /file type/);
    assert.throws(() => validateScriptExecutorExport({ type: 'script-executor-export', version: 2, executors: [] }), /Unsupported version/);
    assert.throws(() => validateScriptExecutorExport({
        type: 'script-executor-export',
        version: 1,
        executors: [{ name: 'same' }, { name: 'same' }],
    }), /duplicate name/);
});

test('legacy blank typed defaults normalize to safe typed values', () => {
    const entry = normalizeScriptExecutor({
        name: 'legacy',
        params: [
            { key: 'count', type: 'number', default: '' },
            { key: 'enabled', type: 'boolean', default: '' },
        ],
    });
    assert.equal(entry.params[0].default, 0);
    assert.equal(entry.params[1].default, false);
});
