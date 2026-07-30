import assert from 'node:assert/strict';
import test from 'node:test';
import { formatValue, parsePath, resolvePath } from '../../utils/path-resolver.js';

test('BUG-2: path resolver supports ordinary, quoted, negative and filtered segments', () => {
    const data = {
        party: {
            'lead.name': 'Muyu',
            members: [
                { name: 'A', active: false },
                { name: 'B', active: true },
            ],
        },
        'key]with]brackets': 42,
    };

    assert.equal(resolvePath(data, parsePath('party["lead.name"]')), 'Muyu');
    assert.equal(resolvePath(data, parsePath('party.members[-1].name')), 'B');
    assert.equal(resolvePath(data, parsePath('party.members[active=true].name')), 'B');
    assert.equal(resolvePath(data, parsePath('["key]with]brackets"]')), 42);
});

test('path resolver returns undefined for invalid traversal and formats values', () => {
    assert.equal(resolvePath({ a: 1 }, parsePath('a.b')), undefined);
    assert.equal(resolvePath({ a: [] }, parsePath('a[]')), undefined);
    assert.equal(formatValue(null), '');
    assert.equal(formatValue(true), 'true');
    assert.equal(formatValue({ a: 1 }), '{\n  "a": 1\n}');
});
