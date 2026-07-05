import { registerProvider } from '../../provider-registry.js';

export function register() {
    registerProvider({
        id: 'randomDice',
        placeholder: '{{randomDice}}',
        render: () => {
            const value = Math.round(Math.random() * 100) / 100;
            return {
                content: String(value),
                data: { value },
            };
        },
    });
}
