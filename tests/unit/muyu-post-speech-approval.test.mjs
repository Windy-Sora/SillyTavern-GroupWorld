import test from 'node:test';
import assert from 'node:assert/strict';
import { renderConfigApply } from '../../muyu/ui/config-apply-view.js';

function approvalText(settings) {
    const elements = [];
    const doc = { createElement: tag => ({ tag, textContent: '', setAttribute() {} }) };
    const card = { append: element => elements.push(element) };
    const artifact = { id: 'draft', revision: 1, content: { preview: { manifest: { settings }, diff: [{ field: 'postSpeechMessageEnabled' }] } } };
    const state = { canApplyConfig: true, busy: false, resetting: false, configActions: [{ id: 'approval', artifactId: 'draft', revision: 1, status: 'pending' }] };
    renderConfigApply({ doc, card, artifact, state, controller: {}, act: () => {}, lang: 'zh' });
    return elements.map(element => element.textContent).join('\n');
}

test('PostSpeech approval names additional model calls and Capability effects', () => {
    const both = approvalText({ postSpeechMessageEnabled: true, postSpeechRoundEnabled: true });
    assert.match(both, /每条合格角色消息可能增加一次模型调用/);
    assert.match(both, /每个合格轮次可能增加一次模型调用/);
    assert.match(both, /用户扩展/);
    const disabled = approvalText({ postSpeechMessageEnabled: false });
    assert.doesNotMatch(disabled, /每条合格角色消息可能增加一次模型调用/);
});
