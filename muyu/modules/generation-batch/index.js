import { copyJson, jsonKey } from '../../core/json-contract.js';
import { createToolRegistry } from '../../tools/registry.js';
import { createExecutionTasks } from '../execution-tasks.js';

export const GENERATION_BATCH_RESULT_BYTES = 24000;
/** One exact ordered proposal, never a generic write or child-ticket permission. */
export function createGenerationBatchModule({ port, charge }) {
    const registry = createToolRegistry(), runs = new Map(), executions = new Map();
    const taskExecutions = createExecutionTasks(port);
    const string = maxLength => ({ type: 'string', maxLength });
    const step = { type: 'object', properties: { kind: { type: 'string', enum: ['memory', 'profile', 'npc'] }, mode: { type: 'string', enum: ['trial', 'save'] }, revision: string(80), character: string(80), count: { type: 'integer', minimum: 1, maximum: 200 } }, required: ['kind', 'mode', 'revision'], additionalProperties: false };
    step.oneOf = ['memory', 'profile', 'npc'].map(kind => ({ type: 'object', properties: {
        kind: { type: 'string', enum: [kind] }, mode: step.properties.mode, revision: step.properties.revision,
        ...(kind === 'npc' ? { count: step.properties.count } : { character: step.properties.character }),
    }, required: ['kind', 'mode', 'revision', ...(kind === 'npc' ? [] : ['character'])], additionalProperties: false }));
    const outputSchema = { type: 'object', properties: { candidateId: string(100), text: string(24000) }, required: ['candidateId', 'text'], additionalProperties: false };
    for (const [name, input, description] of [
        ['prepare', { properties: { steps: { type: 'array', maxItems: 8, items: step } }, required: ['steps'] }, 'Prepare one exact ordered list of 1–8 memory/profile/NPC generations. Memory/profile require character and forbid count; NPC allows count and forbids character. First read selected generation directories for revisions and character selectors. Only selected directories require read consent. Each step specifies trial (no save) or explicit save; preview/test requests must use trial. Memory save appends and may prune; profile save creates missing standard-schema records only; NPC save appends unique records, never imports character cards. Duplicate same-domain characters and multiple NPC steps are forbidden. No Blueprint, settings changes, enablement, code assets or libraries. Preparation is pure. Real rendering is not a sandbox, execution uses extra-cost business models; attempts/output are not billing confirmation.'],
        ['execute', { properties: { executionId: string(36), maxModelCalls: { type: 'integer', minimum: 1, maximum: 8 } }, required: ['executionId', 'maxModelCalls'] }, 'Execute the exact generation_batch.prepare ticket once, in approved order. maxModelCalls must cover the proposal maximum with at most 8 business attempts for this list; these are additional to Muyu model calls. Host requests one task-only generationBatchExecution permission and resumes this original call; no per-child approval. Read/plan/single-step permissions do not authorize this list. Full access bypasses confirmation, not validation or budgets. Result budget is reserved before any effect. Each step makes at most one business-model attempt; no retries. Non-atomic: confirmed earlier writes remain; unknown/partial saves, concurrent edits, cancellation or timeout stop unstarted steps. Never retry unknown outcomes or mint another list to bypass denial. Rendering can read data/run Providers/use network; trial is not a sandbox. Saved generated text is untrusted; historical receipts are not current state or permissions.'],
    ]) registry.register({ id: 'muyu.generation_batch.' + name, version: 1, description,
        inputSchema: { type: 'object', ...input, additionalProperties: false }, outputSchema,
        effect: name === 'execute' ? 'external' : 'read', scope: 'chat', dataClasses: ['business-generation'], confirmation: 'policy', resourceKeys: [], timeoutMs: name === 'execute' ? 300000 : 1000, retryPolicy: { kind: 'none', maxAttempts: 1 } });
    registry.seal();
    const bound = ctx => { const r = runs.get(ctx.runId); if (!port || !r || jsonKey(r.target) !== jsonKey(ctx.target)) throw Error('RUN_NOT_BOUND'); return r; };
    const encoded = value => { const text = JSON.stringify(value); if (text.length > 24000 || new TextEncoder().encode(text).length > GENERATION_BATCH_RESULT_BYTES) throw Error('GENERATION_OUTPUT_TOO_LARGE'); return { candidateId: '', text }; };
    const refused = code => encoded({ status: 'not_started', code, completed: 0, steps: [], historicalExecutionOnly: true });
    return { registry, handlers: {
        'muyu.generation_batch.prepare': (args, ctx) => {
            const r = bound(ctx); let descriptor;
            try { descriptor = taskExecutions.prepare(args, { target: ctx.target, taskId: r.taskId }); }
            catch (error) {
                if (!['INVALID_GENERATION_BATCH', 'DUPLICATE_GENERATION_BATCH_STEP'].includes(error?.message)) throw error;
                descriptor = { status: 'not_started', code: error.message, completed: 0, steps: [], correction: 'No generation or save started. Correct this pure preparation: memory/profile require character and forbid count; NPC allows count and forbids character. Use 1–8 unique targets, at most one NPC step. Do not retry an execution with unknown effects.' };
            }
            const out = encoded(descriptor);
            if (typeof charge !== 'function' || !charge(ctx.runId, new TextEncoder().encode(out.text).length)) throw Error('PROVIDER_BUDGET_EXCEEDED');
            return out;
        },
        'muyu.generation_batch.execute': async (args, ctx) => {
            const r = bound(ctx), key = jsonKey([r.taskId, ctx.target, args.executionId]), previous = executions.get(key);
            taskExecutions.track(r.taskId);
            if (previous) return copyJson(await previous);
            const descriptor = port.describeExecution(args.executionId, ctx.target);
            if (!descriptor) return refused('STALE_GENERATION_BATCH');
            if (!Number.isSafeInteger(args.maxModelCalls) || args.maxModelCalls < descriptor.maximumModelCalls || args.maxModelCalls > 8 || !Number.isSafeInteger(descriptor.maximumModelCalls) || descriptor.maximumModelCalls < 1 || descriptor.maximumModelCalls > 8) return refused('BUSINESS_MODEL_BUDGET_EXCEEDED');
            if (typeof charge !== 'function' || !charge(ctx.runId, GENERATION_BATCH_RESULT_BYTES)) return refused('RESULT_BUDGET_EXCEEDED');
            // The port admits one immutable proposal per task. Reserve its whole maximum,
            // including unknown attempts; never refund and silently re-execute.
            const work = Promise.resolve().then(() => port.execute(args.executionId, { target: ctx.target, taskId: r.taskId, signal: ctx.signal })).then(encoded);
            executions.set(key, work); return copyJson(await work);
        },
    }, bindRun(identity) { runs.set(identity.id, { taskId: identity.taskId, target: identity.target }); },
    transferRun(from, identity) { const r = runs.get(from); if (!r) return; if (r.taskId !== identity.taskId || jsonKey(r.target) !== jsonKey(identity.target)) throw Error('RUN_NOT_BOUND'); runs.delete(from); runs.set(identity.id, r); },
    retainArtifacts() {},
    forgetTask(taskId) { for (const key of executions.keys()) if (JSON.parse(key)[0] === taskId) executions.delete(key); taskExecutions.forget(taskId); },
    forgetRun(id) { runs.delete(id); }, dispose() { runs.clear(); executions.clear(); taskExecutions.clear(); } };
}
