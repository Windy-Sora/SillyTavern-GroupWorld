/**
 * Summary Agent — compresses chat context into concise summaries.
 *
 * Extracted from chat-summary-system.js.
 * Pipeline: context → prompt → call
 */
export function createSummaryAgent({ log }) {
    const DEFAULT_PROMPT = {
        zh: `你是一个上下文摘要系统。请将以下聊天记录总结为简洁摘要。
保留关键事件、角色行动、重要对话要点。不要包含次要细节。
用第三人称中文总结，控制在 500 字以内。`,
        en: `You are a context summarizer. Summarize the following chat log concisely.
Preserve key events, character actions, and important dialogue points.
Omit minor details. Keep under 500 words.`,
    };

    return {
        id: 'summary',
        displayName: 'Chat Summary',
        contextAccess: ['chat', 'settings'],
        pipelineOrder: ['context', 'prompt', 'call'],
        pipeline: {
            async context(_input, _ctx, pool, settings) {
                const chat = pool.chat?.() ?? [];
                return { chat, summarySettings: settings };
            },

            async prompt(ctx, _state, pool, settings) {
                const chat = ctx.chat;
                if (!chat.length) throw new Error('No messages to summarize');

                const reusePrev = settings.summaryReusePrevious !== false;
                const prevSummary = pool.summaryLatest?.();

                let inputText;
                if (reusePrev && prevSummary) {
                    const startFrom = prevSummary.rangeEnd ?? 0;
                    const newMessages = chat.slice(startFrom);
                    if (!newMessages.length) throw new Error('No new messages since last summary');
                    inputText = `[Previous summary]\n${prevSummary.content}\n\n[New content]\n` +
                        newMessages.map(m => `${m.name || (m.is_user ? 'User' : 'System')}: ${m.mes}`).join('\n');
                } else {
                    inputText = chat.map(m => `${m.name || (m.is_user ? 'User' : 'System')}: ${m.mes}`).join('\n');
                }

                const promptTemplate = settings.summaryPrompt || (settings.lang === 'zh' ? DEFAULT_PROMPT.zh : DEFAULT_PROMPT.en);
                return promptTemplate + '\n\n' + inputText;
            },
        },
    };
}
