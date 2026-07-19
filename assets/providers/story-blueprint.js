import { registerProvider } from '../../provider-registry.js';

export function register({ settings, storyBlueprintSystem }) {
    if (!storyBlueprintSystem) return;

    const isEnabled = () => !!settings.storyBlueprintEnabled;

    registerProvider({
        id: 'storyBlueprintCurrent',
        placeholder: '{{storyBlueprintCurrent}}',
        enabled: isEnabled,
        render: (ctx) => ({
            content: storyBlueprintSystem.renderCurrent({ consumeCompleteNotice: ctx?.agentId === 'director' }),
            data: storyBlueprintSystem.getProviderData(),
        }),
    });

    registerProvider({
        id: 'storyBlueprintCurrentJson',
        placeholder: '{{storyBlueprintCurrentJson}}',
        enabled: isEnabled,
        render: () => {
            const data = storyBlueprintSystem.getProviderData();
            const current = data.current?.node || null;
            return {
                content: current ? JSON.stringify(current, null, 2) : '',
                data: current,
            };
        },
    });

    registerProvider({
        id: 'storyBlueprintProgress',
        placeholder: '{{storyBlueprintProgress}}',
        enabled: isEnabled,
        render: () => {
            const data = storyBlueprintSystem.getProviderData();
            return {
                content: storyBlueprintSystem.renderProgress(),
                data: data.progress,
            };
        },
    });

    registerProvider({
        id: 'storyBlueprintSchemaHint',
        placeholder: '{{storyBlueprintSchemaHint}}',
        enabled: isEnabled,
        render: () => ({
            content: `When the current Story Blueprint step is complete, set variable_update.global.${storyBlueprintSystem.getCompletionVariable()} = true. Otherwise keep it false.`,
            data: { completionVariable: storyBlueprintSystem.getCompletionVariable() },
        }),
    });

    registerProvider({
        id: 'storyBlueprintFullJson',
        placeholder: '{{storyBlueprintFullJson}}',
        enabled: isEnabled,
        render: () => {
            const data = storyBlueprintSystem.getProviderData();
            return {
                content: data.blueprint ? JSON.stringify(data.blueprint, null, 2) : '',
                data: data.blueprint,
            };
        },
    });
}
