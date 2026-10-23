import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectDirectorContinuityTemplate } from '../../muyu/config/director-continuity-template.js';
import { register } from '../../assets/providers/history.js';
import { providers, unregisterProvider } from '../../provider-registry.js';

test('Continuity template inspection distinguishes the required placeholder from other tokens', () => {
    assert.deepEqual(inspectDirectorContinuityTemplate('', 'previousPlan'), { placeholderCount: 1, otherPlaceholders: false });
    assert.deepEqual(inspectDirectorContinuityTemplate('Last: {{previousPlan}}', 'previousPlan'), { placeholderCount: 1, otherPlaceholders: false });
    assert.deepEqual(inspectDirectorContinuityTemplate('{{previousPlan}} / {{previousPlan}} / {{custom}}', 'previousPlan'),
        { placeholderCount: 2, otherPlaceholders: true });
    assert.deepEqual(inspectDirectorContinuityTemplate('{{previousPlans}}', 'previousPlan'), { placeholderCount: 0, otherPlaceholders: true });
});

test('History Providers use their own wrapper, mode, count and literal empty fallback', t => {
    t.after(() => { unregisterProvider('previousPlan'); unregisterProvider('previousPlans'); });
    const history = [{ turn: 1 }, { turn: 2 }, { turn: 3 }];
    const settings = { llmHistoryEnabled: true, llmScriptContinuity: true,
        llmScriptContinuityMode: 'last', llmScriptContinuityCount: 0,
        llmScriptContinuityWrapper: 'Last: {{previousPlan}}',
        llmScriptContinuityHistoryWrapper: 'All: {{previousPlans}}' };
    register(settings, () => history);
    const last = providers.get('previousPlan');
    const all = providers.get('previousPlans');
    assert.match(last.render().content, /Last: \{\s*"turn": 3\s*\}/);
    assert.equal(all.render().content, '');
    settings.llmScriptContinuityWrapper = '';
    assert.equal(last.render().content, JSON.stringify(history[2], null, 2));
    settings.llmScriptContinuityMode = 'history';
    assert.equal(last.render().content, '');
    assert.match(all.render().content, /"turn": 1/);
    assert.match(all.render().content, /"turn": 3/);
    settings.llmScriptContinuityCount = 2;
    assert.doesNotMatch(all.render().content, /"turn": 1/);
    settings.llmScriptContinuityHistoryWrapper = '';
    assert.equal(all.render().content, JSON.stringify(history.slice(-2), null, 2));
    settings.llmHistoryEnabled = false;
    assert.equal(all.render().content, '');
});
