import { registerProvider } from '../../provider-registry.js';

export function register() {
    registerProvider({
        id: 'recentMessages',
        placeholder: '{{recentMessages}}',
        render: (ctx) => {
            const msgs = ctx.recentMessages || [];
            return { content: msgs.map(m => `${m.name || (m.is_user ? 'User' : 'Char')}: ${m.mes || ''}`).join('\n') };
        },
    });
}
