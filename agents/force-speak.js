/**
 * ForceSpeak Agent — single-character LLM takeover when user manually
 * triggers a character to speak.
 *
 * Extracted from index.js initForceSpeakLLM().
 * Pipeline: context → prompt → call
 */
export function createForceSpeakAgent({
    renderPrompt,
    getDefaultLlmPrompt,
    buildJsonSchema,
    parseLlmResponse,
    matchCharacterByName,
    buildCharacterProfilesText,
    log,
}) {
    return {
        id: 'force-speak',
        displayName: 'Force Speak LLM',
        contextAccess: ['chat', 'recentMessages', 'characters', 'charactersRaw', 'profilesText', 'worldInfoText',
            'group', 'settings', 'forceSpeakCharacter', 'forceSpeakPrompt', 'profileEnabled'],
        pipelineOrder: ['context', 'prompt', 'call', 'parse'],
        pipeline: {
            async parse(raw, ctx) {
                const parsed = parseLlmResponse(raw, log);
                if (!parsed || !Array.isArray(parsed.speakers) || parsed.speakers.length === 0) return null;
                // Convert LLM-returned name to avatar (same pattern as director agent)
                const speaker = parsed.speakers[0];
                const match = matchCharacterByName(speaker, ctx.enabledMembers);
                return {
                    ...parsed,
                    speakers: match ? [match.avatar] : [speaker],
                    names: [match?.name || speaker],
                };
            },
            async context(_input, _ctx, pool, settings) {
                const group = pool.group();
                const enabledMembers = group?.members?.filter(a => !group.disabled_members?.includes(a)) ?? [];
                const char = pool.forceSpeakCharacter?.();
                const llmDepth = Math.min(settings.llmContextDepth ?? 10, pool.chat()?.length ?? 0);
                const recentMessages = pool.recentMessages(llmDepth);

                return {
                    recentMessages,
                    enabledMembers,
                    maxSpeakers: 1,
                    character: char,
                };
            },

            async prompt(ctx, _state, pool, settings) {
                const promptTemplate = settings.llmPrompt || getDefaultLlmPrompt();
                const runtimeContext = {
                    recentMessages: ctx.recentMessages,
                    enabledMembers: ctx.enabledMembers,
                    maxSpeakers: 1,
                };
                let filled = await renderPrompt(promptTemplate, runtimeContext, {
                    maxPasses: settings.templateMaxPasses ?? 5,
                    recursive: settings.templateRecursive ?? true,
                    debugPlaceholders: settings.templateDebugPlaceholders ?? false,
                    passthrough: ['User','user','char','original','anchorBefore','anchorAfter','system','persona','wiBefore','loreBefore','wiAfter','loreAfter','mesExamples','mesExamplesRaw','trim','description','personality','scenario'],
                });

                // WI auto-inject
                const wiText = pool.worldInfoText?.();
                if (settings.llmWorldInfoEnabled && !promptTemplate.includes('{{worldInfo}}') && wiText) {
                    const wrapper = settings.llmWorldInfoWrapper || '{{worldInfo}}';
                    filled = wrapper.replace('{{worldInfo}}', wiText) + '\n\n' + filled;
                }

                // Profile auto-inject
                const profEnabled = pool.profileEnabled?.() ?? settings.profileEnabled;
                if (profEnabled && !promptTemplate.includes('{{character_profiles}}')) {
                    const profilesText = pool.profilesText?.() ?? buildCharacterProfilesText();
                    if (profilesText) filled = profilesText + '\n\n' + filled;
                }

                // JSON schema auto-inject (same fallback as director agent)
                if (!promptTemplate.includes('{{llmJsonSchema}}')) {
                    filled += '\n\n' + buildJsonSchema();
                }

                // Force-speak instruction
                const char = pool.forceSpeakCharacter?.();
                const fsPrompt = pool.forceSpeakPrompt?.() ?? settings.forceSpeakPrompt;
                const systemInstruction = settings.lang === 'zh'
                    ? `【系统指令】用户已强制触发 {charName} 发言。请只选择 {charName} 一人作为本轮发言者。忽略其他角色。为 {charName} 生成一段简短的舞台指导。`
                    : `[SYSTEM] Force-speak: {charName} has been manually triggered. You MUST select ONLY {charName}. Do NOT select any other characters. Write a short stage direction for {charName}.`;
                const finalInstruction = (fsPrompt || systemInstruction).replace(/\{charName\}/g, char?.name ?? '');
                filled += '\n\n' + finalInstruction;

                return filled;
            },
        },
    };
}
