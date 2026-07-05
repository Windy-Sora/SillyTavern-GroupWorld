/**
 * Critique Agent — reviews recent chat and criticises Director decisions + character performance.
 *
 * Same pipeline as Summary: context → prompt → call
 * Outputs JSON with directorCritique and characterCritiques.
 */
export function createCritiqueAgent({ log }) {
    const DEFAULT_PROMPT = {
        zh: `你是一个客观中立的群聊导演批判系统。回顾最近的对话内容，从以下角度进行分析。
重要：只批判AI角色的表现，绝对不要批判或评价User/用户的行为和发言。

1. 导演决策批判：
   - 是否合理安排了发言顺序？有没有角色被忽略或过度聚焦？
   - 节奏是否恰当？是否过快或过慢？
   - 有没有错过的关键话题或冲突点？

2. 角色表现批判（仅限AI角色，不含User）：
   - 角色言行是否一致？有没有出现OOC（角色偏差）？
   - 角色之间的互动是否自然、有推进剧情？
   - 有没有角色表现得过于被动或过于强势？

请以JSON格式输出，不要包含其他文字：
{
  "directorCritique": {
    "pacing": "节奏评价",
    "spotlight": "焦点分配评价",
    "suggestions": ["建议1", "建议2"]
  },
  "characterCritiques": {
    "角色名": {
      "consistency": "一致性评价",
      "interaction": "互动表现评价",
      "suggestions": ["建议1"]
    }
  }
}`,
        en: `You are an objective, neutral group chat critique system. Review the recent conversation and analyze.
IMPORTANT: Only critique AI character performance. Do NOT critique or judge the User's actions or messages.

1. Director Decision Critique:
   - Was the speaking order reasonable? Any characters ignored or over-focused?
   - Was the pacing appropriate? Too fast or too slow?
   - Any missed key topics or conflicts?

2. Character Performance Critique (AI characters only, NOT the User):
   - Are characters consistent in their words and actions? Any OOC (out-of-character) issues?
   - Are character interactions natural and plot-advancing?
   - Any characters too passive or too dominant?

Output ONLY a JSON object, no other text:
{
  "directorCritique": {
    "pacing": "pacing assessment",
    "spotlight": "spotlight distribution assessment",
    "suggestions": ["suggestion 1", "suggestion 2"]
  },
  "characterCritiques": {
    "CharacterName": {
      "consistency": "consistency assessment",
      "interaction": "interaction assessment",
      "suggestions": ["suggestion 1"]
    }
  }
}`,
    };

    return {
        id: 'critique',
        displayName: 'Chat Critique',
        contextAccess: ['chat', 'settings'],
        pipelineOrder: ['context', 'prompt', 'call'],
        pipeline: {
            async context(_input, _ctx, pool, settings) {
                const chat = pool.chat?.() ?? [];
                return { chat, critiqueSettings: settings };
            },

            async prompt(ctx, _state, pool, settings) {
                const chat = ctx.chat;
                if (!chat.length) throw new Error('No messages to critique');

                const reusePrev = settings.critiqueReusePrevious !== false;
                const prevCritique = pool.critiqueLatest?.();

                let inputText;
                if (reusePrev && prevCritique) {
                    const startFrom = prevCritique.rangeEnd ?? 0;
                    const newMessages = chat.slice(startFrom);
                    if (!newMessages.length) throw new Error('No new messages since last critique');
                    inputText = `[Previous critique]\n${JSON.stringify(prevCritique.data, null, 2)}\n\n[New content]\n` +
                        newMessages.map(m => `${m.name || (m.is_user ? 'User' : 'System')}: ${m.mes}`).join('\n');
                } else {
                    inputText = chat.map(m => `${m.name || (m.is_user ? 'User' : 'System')}: ${m.mes}`).join('\n');
                }

                const promptTemplate = settings.critiquePrompt || (settings.lang === 'zh' ? DEFAULT_PROMPT.zh : DEFAULT_PROMPT.en);
                return promptTemplate + '\n\n' + inputText;
            },
        },
    };
}
