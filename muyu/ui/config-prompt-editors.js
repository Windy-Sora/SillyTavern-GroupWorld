/** Keep the classic prompt editors in sync without replacing an active draft. */
export function syncConfigPromptEditors({ fields, settings, getControl, activeElement }) {
    const editors = [
        ['llmJsonSchema', 'llm-json-schema', null, true],
        ['llmScriptPrompt', 'llm-script-prompt', null], ['llmScriptWrapper', 'llm-script-wrapper', null],
        ['llmScriptContinuityWrapper', 'llm-script-continuity-wrapper', null],
        ['llmScriptContinuityHistoryWrapper', 'llm-script-continuity-history-wrapper', null],
        ['llmWorldInfoWrapper', 'llm-world-info-wrapper', null],
        ['forceSpeakPrompt', 'force-speak-prompt', 'gdDefaultPrompt'],
        ['knowledgeText', 'knowledge-text', null], ['identityPrompt', 'identity-prompt', 'gdDefaultPrompt'],
        ['npcPrompt', 'npc-prompt', 'gdDefaultPrompt'],
        ['memoryPrompt', 'memory-prompt', 'gdDefaultPrompt'], ['memoryCompressPrompt', 'memory-compress-prompt', 'gdDefaultPrompt'],
        ['memoryJsonSchema', 'memory-json-schema', 'gdDefaultSchema'], ['memoryRenderTemplate', 'memory-render-template', 'gdDefaultTemplate'],
        ['storyBlueprintPrompt', 'story-blueprint-prompt', 'gdDefaultPrompt'], ['storyBlueprintContinuePrompt', 'story-blueprint-continue-prompt', 'gdDefaultPrompt'],
        ['storyBlueprintJsonSchema', 'story-blueprint-schema', 'gdDefaultSchema'], ['storyBlueprintProviderTemplate', 'story-blueprint-template', 'gdDefaultTemplate'],
        ['summaryPrompt', 'summary-prompt', 'gdDefaultPrompt'], ['critiquePrompt', 'critique-prompt', 'gdDefaultPrompt'],
        ['critiqueSchema', 'critique-schema', 'gdDefaultSchema'], ['profileGeneratorPrompt', 'profile-generator-prompt', 'gdDefaultPrompt'],
        ['profileJsonSchema', 'profile-json-schema', 'gdDefaultSchema'], ['profileRenderTemplate', 'profile-render-template', 'gdDefaultTemplate'],
        ['postSpeechMessagePrompt', 'ps-msg-prompt', 'gdDefaultPrompt'], ['postSpeechRoundPrompt', 'ps-round-prompt', 'gdDefaultPrompt'],
    ];
    for (const [field, control, defaultKey, preserveEmpty] of editors) {
        if (!fields.includes(field)) continue;
        const editor = getControl(control);
        if (!editor?.[0] || editor[0] === activeElement) continue;
        const saved = settings[field];
        editor.val(preserveEmpty ? (saved ?? '') : (saved || (defaultKey ? editor.data?.(defaultKey) : '') || ''));
    }
}
