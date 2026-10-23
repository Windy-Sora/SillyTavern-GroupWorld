import { randomUUID } from '../runtime/crypto.js';
import { createToolBroker } from '../tools/broker.js';

/** Deterministic read-only task through the same provider, policy and budget as model reads. */
export async function checkReceiptConfig({ builtins, target, receipt, allowed, limit, signal }) {
    const runId = 'config-check:' + randomUUID();
    builtins.bindBudget(runId, limit);
    try {
        if (receipt.version === 2) {
            const broker = createToolBroker({ registry: builtins.registry, handlers: builtins.handlers, runId, target,
                allowedTools: ['muyu.settings.read'], signal, maxCalls: 1, policy: () => allowed() });
            const result = await broker.call({ toolId: 'muyu.settings.read', version: 1, callId: 'check', args: { fields: receipt.diff.map(d => d.field) } });
            if (!allowed() || signal.aborted) throw Error('CHECK_CANCELLED');
            const bytes = new TextEncoder().encode(JSON.stringify(result)).length;
            if (bytes > limit) throw Error('PROVIDER_BUDGET_EXCEEDED');
            const values = result.ok ? JSON.parse(result.data.text).values : {};
            const fields = receipt.diff.map(d => {
                const actual = Object.hasOwn(values, d.field) ? JSON.stringify(values[d.field]) : '';
                return { field: d.field, expected: d.after, actual, state: actual ? actual === d.after ? 'matched' : 'different' : 'unknown' };
            });
            return { state: fields.some(f => f.state === 'unknown') ? 'unknown' : fields.some(f => f.state === 'different') ? 'different' : 'matched', fields, readAt: new Date().toISOString(), persistence: 'unknown', bytes };
        }
        const broker = createToolBroker({ registry: builtins.registry, handlers: builtins.handlers, runId, target,
            allowedTools: ['muyu.provider.read'], signal, maxCalls: 1,
            policy: ({ definition, args }) => definition.id === 'muyu.provider.read' && args.id === 'memoryConfig' && allowed(),
        });
        const result = await broker.call({ toolId: 'muyu.provider.read', version: 2, callId: 'check', args: { id: 'memoryConfig', selector: '', revision: '', offset: 0 } });
        if (!allowed() || signal.aborted) throw Error('CHECK_CANCELLED');
        const data = result.ok && result.data.status === 'ok' ? result.data : null;
        const fields = receipt.diff.map(d => {
            const field = data?.data?.fields.find(f => f.field === d.field);
            return { field: d.field, expected: d.after, actual: field?.state === 'value' ? field.value : '', state: field?.state === 'value' ? field.value === d.after ? 'matched' : 'different' : 'unknown' };
        });
        return { state: !fields.length || fields.some(f => f.state === 'unknown') ? 'unknown' : fields.some(f => f.state === 'different') ? 'different' : 'matched',
            fields, readAt: data?.readAt || '', persistence: 'unknown', bytes: builtins.resourceUsage(runId).used };
    } finally { builtins.forgetRun(runId); }
}
