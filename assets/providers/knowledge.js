import { registerProvider } from '../../provider-registry.js';

/**
 * {{knowledge}} — raw unrendered text from the Knowledge textarea.
 * Any {{...}} inside the content is escaped before the rendering
 * pipeline and restored after — so it survives as literal text.
 */
const ESC_OPEN = '\x00KDLO\x00';
const ESC_CLOSE = '\x00KDLC\x00';

export function register(settings) {
    registerProvider({
        id: 'knowledge',
        placeholder: '{{knowledge}}',
        render: () => {
            const text = settings.knowledgeText || '';
            if (!text) return { content: '' };
            return {
                content: text.replace(/\{\{/g, ESC_OPEN).replace(/\}\}/g, ESC_CLOSE),
            };
        },
    });
}

export function unescapeKnowledge(text) {
    return text.split(ESC_OPEN).join('{{').split(ESC_CLOSE).join('}}');
}
