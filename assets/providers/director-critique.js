import { registerProvider } from '../../provider-registry.js';

export function register(getActiveDirectorCritiqueText) {
    registerProvider({
        id: 'directorCritique',
        placeholder: '{{directorCritique}}',
        render: () => ({
            content: getActiveDirectorCritiqueText(),
        }),
    });
}
