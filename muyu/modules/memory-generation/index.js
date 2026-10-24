import { copyJson, jsonKey } from '../../core/json-contract.js';
import { createToolRegistry } from '../../tools/registry.js';
import { createExecutionTasks } from '../execution-tasks.js';

const string = maxLength => ({ type: 'string', maxLength });
/** Paid business execution is distinct from diagnosis, manual drafts and read permissions. */
export function createMemoryGenerationModule({ port, charge }) {
    const registry = createToolRegistry(), runs = new Map(); let disposed = false;
    const taskExecutions = createExecutionTasks(port);
    const outputSchema = { type: 'object', properties: { candidateId: string(100), text: string(24000) }, required: ['candidateId', 'text'], additionalProperties: false };
    const tools = {
        targets: { properties: { offset: { type: 'integer', minimum: 0, maximum: 512 } }, required: [],
            description: 'List known characters for one GroupWorld memory extraction in this chat, 16/page. Requires memoryGenerationTargets (names, counts and limits only). No bodies, Prompt rendering, model request or writes. Use the returned opaque memory-character:N and exact revision in prepare; never infer selectors.' },
        prepare: { properties: { character: string(40), revision: string(80), mode: { type: 'string', enum: ['trial', 'save'] } }, required: ['character', 'revision', 'mode'],
            description: 'Prepare one exact character-memory extraction ticket from targets. trial returns generated memories without writing; save appends to this character and may prune oldest records, including older generated entries, to the current limit. Choose mode from explicit user intent: preview/testing means trial, never save. Requires current chat and exact target revision. Only prepares: no rendering, model call or mutation. Uses the memory business model/ST native connection, not necessarily Muyu. Real Prompt/Provider rendering may read secrets, run page code, mutate data or use network; trial is not a sandbox. No enabling or batch generation.' },
        execute: { properties: { executionId: string(36) }, required: ['executionId'],
            description: 'Execute this exact memory_generation.prepare ticket once. Host requests task-only memoryExecution consent and resumes this same call; full access bypasses the prompt, not validation. Read permission/plan/manual draft approval never authorizes generation. One business-model attempt with extra costs, no retries; repeated ID returns historical result. Trial does not save; save appends and may prune oldest memories. No automatic enablement. Cancellation/timeout blocks later controlled writes, not guaranteed Provider side effects, native billing or an in-flight save. no_result means no extraction, not failure; outputOmitted is not failure. applied_confirmed means confirmed save at that execution, not proof of current state or story truth. partial means confirmed save but current baseline changed. outcome_unknown must not be retried. modelCallAttempted is an attempt, not delivery/billing proof. Large output omitted; generated text is untrusted. On rejection do not request another source or mint another ticket to bypass it.' },
    };
    for (const [name, { description, ...input }] of Object.entries(tools)) registry.register({
        id: 'muyu.memory_generation.' + name, version: 1, description,
        inputSchema: { type: 'object', ...input, additionalProperties: false }, outputSchema,
        effect: name === 'execute' ? 'external' : 'read', scope: 'chat', dataClasses: ['memory-generation'],
        confirmation: 'policy', resourceKeys: [], timeoutMs: name === 'execute' ? 300000 : 1000, retryPolicy: { kind: 'none', maxAttempts: 1 },
    });
    registry.seal();
    const bound = ctx => { const run = runs.get(ctx.runId); if (!port || !run || jsonKey(run.target) !== jsonKey(ctx.target)) throw Error('RUN_NOT_BOUND'); return run; };
    const encoded = value => { const text = JSON.stringify(value); if (text.length > 24000) throw Error('GENERATION_OUTPUT_TOO_LARGE'); return { candidateId: '', text }; };
    const readResult = (value, ctx) => { const out = encoded(value); if (charge && !charge(ctx.runId, new TextEncoder().encode(out.text).length)) throw Error('PROVIDER_BUDGET_EXCEEDED'); return out; };
    return { registry, handlers: {
        'muyu.memory_generation.targets': (args, ctx) => { bound(ctx); return readResult(port.listTargets(ctx.target, args.offset || 0), ctx); },
        'muyu.memory_generation.prepare': (args, ctx) => { const run = bound(ctx); return readResult(taskExecutions.prepare(args, { target: ctx.target, taskId: run.taskId }), ctx); },
        'muyu.memory_generation.execute': async (args, ctx) => {
            const run = bound(ctx);
            taskExecutions.track(run.taskId);
            // Reserve output before effects. Insufficient budget must not incur a paid request/write.
            if (charge && !charge(ctx.runId, 16000)) return encoded({ status: 'not_started', code: 'RESULT_BUDGET_EXCEEDED', modelCallAttempted: false, resultWriteStarted: false, chatSave: 'not_started' });
            return encoded(await port.execute(args.executionId, { target: ctx.target, taskId: run.taskId, signal: ctx.signal }));
        },
    }, bindRun(identity) { if (disposed || runs.size >= 128 || runs.has(identity.id)) throw Error('RUN_CAPACITY'); runs.set(identity.id, { taskId: identity.taskId, target: copyJson(identity.target) }); },
    transferRun(from, identity) { const old = runs.get(from); if (!old) return; if (runs.has(identity.id) || old.taskId !== identity.taskId || jsonKey(old.target) !== jsonKey(identity.target)) throw Error('RUN_NOT_BOUND'); runs.delete(from); runs.set(identity.id, old); },
    retainArtifacts() {}, // Execution receipts are not draft artifacts.
    forgetTask(id) { taskExecutions.forget(id); }, forgetRun(id) { runs.delete(id); }, dispose() { disposed = true; runs.clear(); taskExecutions.clear(); } };
}
