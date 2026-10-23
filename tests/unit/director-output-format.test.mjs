import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../../settings.js';
import { migrateLegacyDirectorOutputFormat, renderDirectorOutputFormat } from '../../systems/director-output-format.js';
import { inspectDirectorOutputFormat } from '../../muyu/config/director-output-format.js';

test('Director output-format text expands only its built-in fragments for both feature states', () => {
    const text = 'speakers {{scriptField}} / {{storyBlueprintDoneField}} / {{llmJsonSchema}}';
    const enabled = renderDirectorOutputFormat({ text, scriptEnabled: true, storyBlueprintEnabled: true, completionVariable: 'chapter_done' });
    assert.match(enabled, /"scripts"/);
    assert.match(enabled, /"chapter_done": false/);
    assert.doesNotMatch(enabled, /\{\{(?:scriptField|storyBlueprintDoneField|llmJsonSchema)\}\}/);
    const disabled = renderDirectorOutputFormat({ text, scriptEnabled: false, storyBlueprintEnabled: false });
    assert.equal(disabled, 'speakers  /  / ');
    assert.equal(renderDirectorOutputFormat({ text: '', scriptEnabled: true, storyBlueprintEnabled: true, completionVariable: 'chapter_done' }), '');
    assert.match(renderDirectorOutputFormat({ text: DEFAULT_SETTINGS.llmJsonSchema, scriptEnabled: false, storyBlueprintEnabled: false }), /"speakers"/);
});

test('Legacy empty global object migrates once without replacing custom output formats or empty values', () => {
    const legacy = '{"variable_update":{"global":{},"character":{}}}';
    const migrated = migrateLegacyDirectorOutputFormat(legacy);
    assert.match(migrated, /"global": \{ \{\{storyBlueprintDoneField\}\} \}/);
    assert.equal(migrateLegacyDirectorOutputFormat(migrated), migrated);
    assert.equal(migrateLegacyDirectorOutputFormat(''), '');
    assert.equal(migrateLegacyDirectorOutputFormat('Return speakers only.'), 'Return speakers only.');
    assert.equal(migrateLegacyDirectorOutputFormat(undefined), undefined);
});

test('Director output-format inspection stays advisory for prose and dynamic placeholders', () => {
    assert.deepEqual(inspectDirectorOutputFormat(''), { empty: true });
    const builtIn = inspectDirectorOutputFormat(DEFAULT_SETTINGS.llmJsonSchema);
    assert.equal(builtIn.hasSpeakers, true);
    assert.equal(builtIn.hasScriptField, true);
    assert.equal(builtIn.hasStoryDoneField, true);
    assert.equal(builtIn.hasOtherPlaceholders, false);
    const custom = inspectDirectorOutputFormat('Return JSON with {{llmJsonSchema}} and {{customProvider}}.');
    assert.equal(custom.hasSpeakers, false);
    assert.equal(custom.hasSelfReference, true);
    assert.equal(custom.hasOtherPlaceholders, true);
});
