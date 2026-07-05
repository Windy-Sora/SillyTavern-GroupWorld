import { registerProvider } from '../../provider-registry.js';

export function register(settings, getDirectorHistory) {
    registerProvider({
        id: 'previousPlan',
        placeholder: '{{previousPlan}}',
        render: () => {
            const history = getDirectorHistory();
            if (!settings.llmHistoryEnabled || !settings.llmScriptContinuity || !history.length)
                return { content: '', data: null };
            if (settings.llmScriptContinuityMode === 'history')
                return { content: '', data: null };
            const lastPlan = history[history.length - 1];
            const wrapper = settings.llmScriptContinuityWrapper || '{{previousPlan}}';
            return {
                content: wrapper.replace('{{previousPlan}}', JSON.stringify(lastPlan, null, 2)),
                data: lastPlan,
            };
        },
    });

    registerProvider({
        id: 'previousPlans',
        placeholder: '{{previousPlans}}',
        render: () => {
            const history = getDirectorHistory();
            if (!settings.llmHistoryEnabled || !settings.llmScriptContinuity || !history.length)
                return { content: '', data: null };
            if (settings.llmScriptContinuityMode !== 'history')
                return { content: '', data: null };
            const count = settings.llmScriptContinuityCount > 0
                ? Math.min(settings.llmScriptContinuityCount, history.length)
                : history.length;
            const recentPlans = history.slice(-count);
            const wrapper = settings.llmScriptContinuityHistoryWrapper || '{{previousPlans}}';
            return {
                content: wrapper.replace('{{previousPlans}}', JSON.stringify(recentPlans, null, 2)),
                data: recentPlans,
            };
        },
    });
}
