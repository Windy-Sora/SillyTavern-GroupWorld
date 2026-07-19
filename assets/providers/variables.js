import { registerProvider } from '../../provider-registry.js';

export function register({ variableSystem }) {
    if (!variableSystem) return;

    registerProvider({
        id: 'globalVars',
        placeholder: '{{globalVars}}',
        render: () => ({
            content: variableSystem.renderGlobalVars(),
            data: variableSystem.getSnapshot().global,
        }),
    });

    registerProvider({
        id: 'charVars',
        placeholder: '{{charVars}}',
        render: (ctx) => ({
            content: variableSystem.renderCharVars(ctx),
            data: variableSystem.getSnapshot(ctx).character,
        }),
    });

    registerProvider({
        id: 'vars',
        placeholder: '{{vars}}',
        render: (ctx) => {
            const data = variableSystem.getSnapshot(ctx);
            return {
                content: JSON.stringify(data, null, 2),
                data,
            };
        },
    });

    registerProvider({
        id: 'varsJson',
        placeholder: '{{varsJson}}',
        render: (ctx) => {
            const data = variableSystem.getSnapshot(ctx);
            return {
                content: JSON.stringify(data, null, 2),
                data,
            };
        },
    });

    registerProvider({
        id: 'variableMaintenance',
        placeholder: '{{variableMaintenance}}',
        render: () => ({
            content: variableSystem.renderMaintenance(),
            data: variableSystem.getSnapshot(),
        }),
    });
}
