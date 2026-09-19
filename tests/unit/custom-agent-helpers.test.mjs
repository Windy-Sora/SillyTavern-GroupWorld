import assert from 'node:assert/strict';
import test from 'node:test';
import {
    matchesDataId,
    toBoundedInt,
} from '../../ui/sections/custom-agent-helpers.js';

test('Custom Agent numeric fields are bounded and invalid values use defaults', () => {
    assert.equal(toBoundedInt(-5, 10, 1, 200), 1);
    assert.equal(toBoundedInt(500, 10, 1, 200), 200);
    assert.equal(toBoundedInt('bad', 10, 1, 200), 10);

});

test('Custom Agent data-id matching treats selector syntax as plain text', () => {
    const malicious = 'x"] .gd-ca-del-btn, [data-id="y';
    assert.equal(matchesDataId(malicious, malicious), true);
    assert.equal(matchesDataId('x', malicious), false);
    assert.equal(matchesDataId(undefined, malicious), false);
});
