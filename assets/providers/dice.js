import { registerProvider } from '../../provider-registry.js';

export function register() {
    registerProvider({
        id: 'dice',
        placeholder: '{{dice}}',
        render: () => {
            const die = Math.floor(Math.random() * 6) + 1;
            const luck = Math.floor(Math.random() * 100) + 1;
            return {
                content: `${die}`,
                data: { die, luck },
            };
        },
    });
}
