import { registerProvider } from '../../provider-registry.js';

/**
 * {{newRecentMessages}} — smart context window.
 *
 * - No summary: same as {{recentMessages}} (last N messages)
 * - Summary active: [Summary text] + [messages strictly after rangeEnd]
 *
 * No overlap between summary and raw messages. The summary IS the
 * context for everything up to rangeEnd; raw messages pick up from there.
 * {{recentMessages}} and {{chatSummary}} remain available for users
 * who want to assemble context manually.
 */
export function register(settings, getChat, getLatestActive) {
    registerProvider({
        id: 'newRecentMessages',
        placeholder: '{{newRecentMessages}}',
        render: () => {
            const chat = getChat();
            if (!chat.length) return { content: '' };

            const depth = settings.llmContextDepth || 10;
            const summary = settings.summaryEnabled ? getLatestActive() : null;

            if (summary && summary.active && summary.rangeEnd > 0 && summary.content) {
                // Summary covers up to rangeEnd — return only strictly new messages
                const newMessages = chat.slice(summary.rangeEnd);
                const prefix = settings.lang === 'zh'
                    ? `[上下文总结]\n${summary.content}`
                    : `[Chat Summary]\n${summary.content}`;
                if (!newMessages.length) return { content: prefix };
                const label = settings.lang === 'zh' ? '\n\n[最新消息]\n' : '\n\n[Recent Messages]\n';
                return {
                    content: prefix + label + newMessages.map(m =>
                        `${m.name || (m.is_user ? 'User' : 'System')}: ${m.mes}`).join('\n'),
                };
            }

            // No summary — normal depth window
            const messages = chat.slice(Math.max(0, chat.length - depth));
            return {
                content: messages.map(m => `${m.name || (m.is_user ? 'User' : 'System')}: ${m.mes}`).join('\n'),
            };
        },
    });
}
