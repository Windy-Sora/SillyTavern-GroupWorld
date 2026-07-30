import assert from 'node:assert/strict';
import { extractJsonObject } from '../../utils/json-utils.js';
import { parsePath, resolvePath } from '../../utils/path-resolver.js';
import { property } from '../harness/property.mjs';

property('quoted path keys round-trip across generated punctuation', {
    cases: 300,
}, random => random.string({
    minLength: 1,
    maxLength: 30,
    alphabet: 'abcXYZ09 .[]\\/"_-你好',
}), key => {
    const data = { [key]: { value: 42 } };
    const path = `[${JSON.stringify(key)}].value`;
    assert.equal(resolvePath(data, parsePath(path)), 42);
});

property('balanced JSON extraction ignores generated braces inside strings', {
    cases: 200,
}, random => ({
    id: random.integer(0, 1_000_000),
    text: random.string({
        minLength: 0,
        maxLength: 40,
        alphabet: 'abc {}[]\\"你好',
    }),
}), value => {
    const json = JSON.stringify(value);
    const wrapped = `model preamble\n\`\`\`json\n${json}\n\`\`\`\nmodel suffix`;
    assert.deepEqual(JSON.parse(extractJsonObject(wrapped)), value);
});
