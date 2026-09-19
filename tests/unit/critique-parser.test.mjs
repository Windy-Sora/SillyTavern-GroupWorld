import assert from 'node:assert/strict';
import test from 'node:test';
import { extractCritiqueJson, parseCritiqueResponse } from '../../systems/critique-parser.js';

test('critique parser extracts fenced JSON with escaped braces and trailing commas', () => {
    const parsed = parseCritiqueResponse('```json\n{"directorCritique":{"pacing":"keep {this}",},"characterCritiques":{"Alice":{"suggestions":["go"],},},}\n```');
    assert.equal(parsed.directorCritique.pacing, 'keep {this}');
    assert.deepEqual(parsed.characterCritiques.Alice.suggestions, ['go']);
});

test('critique parser preserves comma-brace and comma-bracket text in valid JSON strings', () => {
    const pacing = 'literal ,} marker and ,] marker';
    const parsed = parseCritiqueResponse(JSON.stringify({
        directorCritique: { pacing },
        characterCritiques: {},
    }));
    assert.equal(parsed.directorCritique.pacing, pacing);
});

test('critique parser skips an invalid prose brace before the real object', () => {
    const parsed = extractCritiqueJson('Example {not json} then {"directorCritique":{},"characterCritiques":{}}');
    assert.deepEqual(parsed, { directorCritique: {}, characterCritiques: {} });
});

test('critique parser returns null without a complete JSON object', () => {
    assert.equal(parseCritiqueResponse('plain response'), null);
    assert.equal(extractCritiqueJson('{"unfinished":true'), null);
});
