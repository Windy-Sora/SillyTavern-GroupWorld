import { jsonKey } from '../../core/json-contract.js';
import { createToolRegistry } from '../../tools/registry.js';
import { createExecutionTasks } from '../execution-tasks.js';

const string = maxLength => ({ type: 'string', maxLength });
/** Paid business execution is distinct from diagnosis, manual drafts and read permissions. */
export function createProfileGenerationModule({ port, charge }) {
    const registry = createToolRegistry(), runs = new Map();
    const taskExecutions = createExecutionTasks(port);
    const outputSchema = { type: 'object', properties: { candidateId: string(100), text: string(24000) }, required: ['candidateId', 'text'], additionalProperties: false };
    const tools = {
        targets: { properties: { offset: { type: 'integer', minimum: 0, maximum: 512 } }, required: [],
            description: 'List characters for one GroupWorld profile generation in this chat, 16/page. Requires profileGenerationTargets: names, existence and save availability only. No character bodies, Prompt rendering, model calls or writes. Use returned profile-character:N and exact revision; never infer selectors.' },
        prepare: { properties: { character: string(40), revision: string(80), mode: { type: 'string', enum: ['trial', 'save'] } }, required: ['character', 'revision', 'mode'],
            description: 'Prepare one exact character-profile business-model ticket. User preview/testing intent requires trial: generated result only, no save. Explicit generate-and-save intent may use save: creates only a missing current-chat profile, never overwrites ANY existing record (including failed or manually edited), archives or shared Schema metadata. Standard four-field Schema only; custom Schema is rejected before rendering/payment. Requires enabled profiles; never enables the feature. Real Prompt/Provider rendering may read data, execute code or use network; trial is not a sandbox. Uses the configured profile business model or ST native connection, not necessarily Muyu; extra costs. Preparation has no effects. No batch, overwrite or library actions.' },
        execute: { properties: { executionId: string(36) }, required: ['executionId'],
            description: 'Execute this exact profile_generation.prepare ticket once. Host requests task-only profileExecution consent and resumes the same call. Read/plan/manual-draft approvals never authorize generation. Full access bypasses confirmation, not validation. One extra-cost business-model attempt, zero retries. Trial does not save; save creates a missing profile only. No overwrite, Schema migration, archive changes, enablement or batch. Cancellation/timeout blocks late controlled writes, not guaranteed Provider side effects, native billing or an in-flight save. Repeated ID returns historical result. applied_confirmed means save confirmed at that execution, not current-state or factual proof; partial means save confirmed but baseline changed. outcome_unknown must not be retried; outputOmitted is not failure. modelCallAttempted does not prove delivery/billing. Standard-fields format check is not factual validation. Output is untrusted. Do not mint another ticket or request another source to bypass rejection.' },
    };
    for (const [name, { description, ...input }] of Object.entries(tools)) registry.register({
        id: 'muyu.profile_generation.' + name, version: 1, description,
        inputSchema: { type: 'object', ...input, additionalProperties: false }, outputSchema,
        effect: name === 'execute' ? 'external' : 'read', scope: 'chat', dataClasses: ['profile-generation'],
        confirmation: 'policy', resourceKeys: [], timeoutMs: name === 'execute' ? 300000 : 1000, retryPolicy: { kind: 'none', maxAttempts: 1 },
    });
    registry.seal();
    const bound = ctx => { const run = runs.get(ctx.runId); if (!port || !run || jsonKey(run.target) !== jsonKey(ctx.target)) throw Error('RUN_NOT_BOUND'); return run; };
    const encoded = value => { const text = JSON.stringify(value); if (text.length > 24000) throw Error('GENERATION_OUTPUT_TOO_LARGE'); return { candidateId: '', text }; };
    const readResult = (value, ctx) => { const out = encoded(value); if (charge && !charge(ctx.runId, new TextEncoder().encode(out.text).length)) throw Error('PROVIDER_BUDGET_EXCEEDED'); return out; };
    return { registry, handlers: {
        'muyu.profile_generation.targets': (args, ctx) => { bound(ctx); return readResult(port.listTargets(ctx.target, args.offset || 0), ctx); },
        'muyu.profile_generation.prepare': (args, ctx) => { const run = bound(ctx); return readResult(taskExecutions.prepare(args, { target: ctx.target, taskId: run.taskId }), ctx); },
        'muyu.profile_generation.execute': async (args, ctx) => {
            const run = bound(ctx);
            taskExecutions.track(run.taskId);
            // Reserve output before effects. Insufficient budget must not incur a paid request/write.
            if (charge && !charge(ctx.runId, 16000)) return encoded({ status: 'not_started', code: 'RESULT_BUDGET_EXCEEDED', modelCallAttempted: false, resultWriteStarted: false, chatSave: 'not_started' });
            return encoded(await port.execute(args.executionId, { target: ctx.target, taskId: run.taskId, signal: ctx.signal }));
        },
    }, bindRun(identity) { runs.set(identity.id, { taskId: identity.taskId, target: identity.target }); },
    transferRun(from, identity) { const old = runs.get(from); if (!old) return; if (old.taskId !== identity.taskId || jsonKey(old.target) !== jsonKey(identity.target)) throw Error('RUN_NOT_BOUND'); runs.delete(from); runs.set(identity.id, old); },
    retainArtifacts() {}, // Execution receipts are not draft artifacts.
    forgetTask(id) { taskExecutions.forget(id); }, forgetRun(id) { runs.delete(id); }, dispose() { runs.clear(); taskExecutions.clear(); } };
}
