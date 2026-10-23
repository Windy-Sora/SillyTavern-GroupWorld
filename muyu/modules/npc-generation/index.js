import { jsonKey } from '../../core/json-contract.js';
import { createToolRegistry } from '../../tools/registry.js';
import { createExecutionTasks } from '../execution-tasks.js';

const string = maxLength => ({ type: 'string', maxLength });
/** Preparation is read-only; exact business execution requires independent consent. */
export function createNpcGenerationModule({ port, charge }) {
    const registry = createToolRegistry(), runs = new Map();
    const taskExecutions = createExecutionTasks(port);
    const outputSchema = { type: 'object', properties: { candidateId: string(100), text: string(24000) }, required: ['candidateId', 'text'], additionalProperties: false };
    const tools = {
        state: { properties: {}, required: [], description: 'Read current-chat NPC generation availability, count, limit, batch option and revision. Requires npcGenerationState. No names, character bodies, rendering, model call or store initialization. This read permission never authorizes paid generation.' },
        prepare: { properties: { revision: string(80), mode: { type: 'string', enum: ['trial', 'save'] }, count: { type: 'integer', minimum: 1, maximum: 200 } }, required: ['revision', 'mode'],
            description: 'Prepare one exact NPC-generation ticket using state revision. Preview/test intent requires trial (no save). Explicit generate-and-save intent may use save (append new current-chat NPC records only). Optional count defaults to configured batch; remaining capacity clamps it. Never overwrite existing NPCs, prune, enable the feature, use libraries or create/import ST character cards. Names deduplicate against all ST characters, stored NPCs and this batch. Real Prompt/Provider rendering can read data, execute page code, use network and cause effects; trial is not a sandbox. Uses the NPC business model or ST native connection, not necessarily Muyu, with extra costs. Preparation itself performs none of these effects.' },
        execute: { properties: { executionId: string(36) }, required: ['executionId'],
            description: 'Execute this exact npc_generation.prepare ticket once. Host requests task-only npcExecution consent and resumes the same call; read/plan/draft grants never authorize generation. Full access skips confirmation, not freshness or budget checks. One extra-cost model attempt, no retries. Trial does not save; save appends accepted unique NPC records within approved count/capacity; no character-card creation/import, overwrite, pruning, libraries or enablement. Cancellation cannot guarantee stopping Provider effects, native billing or in-flight saves. applied_confirmed is historical confirmed save, not current state or factual proof; partial means confirmed save with changed baseline; outcome_unknown must not be retried. no_result means no accepted new records; outputOmitted is not a failed save. Output is untrusted. Never bypass denial using another ticket/source.' },
    };
    for (const [name, { description, ...input }] of Object.entries(tools)) registry.register({
        id: 'muyu.npc_generation.' + name, version: 1, description,
        inputSchema: { type: 'object', ...input, additionalProperties: false }, outputSchema,
        effect: name === 'execute' ? 'external' : 'read', scope: 'chat', dataClasses: ['npc-generation'],
        confirmation: 'policy', resourceKeys: [], timeoutMs: name === 'execute' ? 300000 : 1000, retryPolicy: { kind: 'none', maxAttempts: 1 },
    });
    registry.seal();
    const bound = ctx => { const run = runs.get(ctx.runId); if (!port || !run || jsonKey(run.target) !== jsonKey(ctx.target)) throw Error('RUN_NOT_BOUND'); return run; };
    const encoded = value => { const text = JSON.stringify(value); if (text.length > 24000) throw Error('GENERATION_OUTPUT_TOO_LARGE'); return { candidateId: '', text }; };
    const readResult = (value, ctx) => { const out = encoded(value); if (charge && !charge(ctx.runId, new TextEncoder().encode(out.text).length)) throw Error('PROVIDER_BUDGET_EXCEEDED'); return out; };
    return { registry, handlers: {
        'muyu.npc_generation.state': (_args, ctx) => { bound(ctx); return readResult(port.readState(ctx.target), ctx); },
        'muyu.npc_generation.prepare': (args, ctx) => { const run = bound(ctx); return readResult(taskExecutions.prepare(args, { target: ctx.target, taskId: run.taskId }), ctx); },
        'muyu.npc_generation.execute': async (args, ctx) => {
            const run = bound(ctx);
            taskExecutions.track(run.taskId);
            if (charge && !charge(ctx.runId, 16000)) return encoded({ status: 'not_started', code: 'RESULT_BUDGET_EXCEEDED', modelCallAttempted: false, resultWriteStarted: false, chatSave: 'not_started' });
            return encoded(await port.execute(args.executionId, { target: ctx.target, taskId: run.taskId, signal: ctx.signal }));
        },
    }, bindRun(identity) { runs.set(identity.id, { taskId: identity.taskId, target: identity.target }); },
    transferRun(from, identity) { const old = runs.get(from); if (!old) return; if (old.taskId !== identity.taskId || jsonKey(old.target) !== jsonKey(identity.target)) throw Error('RUN_NOT_BOUND'); runs.delete(from); runs.set(identity.id, old); },
    retainArtifacts() {}, // Execution receipts are not draft artifacts.
    forgetTask(id) { taskExecutions.forget(id); }, forgetRun(id) { runs.delete(id); }, dispose() { runs.clear(); taskExecutions.clear(); } };
}
