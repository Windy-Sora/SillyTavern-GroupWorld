import { randomUUID } from '../../runtime/crypto.js';
import { copyJson, jsonKey, validateJson } from '../../core/json-contract.js';
import { createToolRegistry } from '../../tools/registry.js';
import { permissionSource, requestableSources } from '../../permissions/contract.js';

const sourceIds = requestableSources.filter(item => item.permission !== 'code').map(item => item.id);
const stepKinds = ['read', 'settings', 'variables', 'blueprint', 'resource', 'code', 'other'];
const string = maxLength => ({ type: 'string', maxLength });
const stepSchema = { type: 'object', properties: {
    kind: { type: 'string', enum: stepKinds, description: 'Operation kind, not subject/domain. All reading, contract lookup and analysis use read. Split different proposed operation kinds even inside one bundle: variable definitions use variables, settings use settings, script definitions use code. Never label a combined variable/settings proposal as one settings step.' }, title: string(100), detail: string(600),
}, required: ['kind', 'title', 'detail'], additionalProperties: false };
export const taskPlanSchema = { type: 'object', properties: {
    goal: string(300), scope: { type: 'string', enum: ['global', 'current-chat', 'mixed'] },
    sources: { type: 'array', items: { type: 'string', enum: sourceIds }, maxItems: 12 },
    steps: { type: 'array', items: stepSchema, maxItems: 8 },
    risks: { type: 'array', items: { ...string(200), description: 'At most 200 characters per item, not 200 words. Use one short sentence.' }, maxItems: 6 },
    unknowns: { type: 'array', items: { ...string(200), description: 'At most 200 characters per item, not 200 words. Shorten long explanations before submitting; never retry the same oversized text.' }, maxItems: 6 },
}, required: ['goal', 'scope', 'sources', 'steps', 'unknowns'], additionalProperties: false };

const availability = Object.freeze({ read: 'read-only', settings: 'bundle-or-separate-draft-approval-required', variables: 'bundle-or-separate-draft-approval-required',
    blueprint: 'not-available', resource: 'not-available', code: 'separate-code-approval-required', other: 'not-available' });

export function projectTaskPlan(input, target) {
    const value = validateJson(taskPlanSchema, input);
    if (!value.goal.trim() || !value.steps.length || value.steps.some(step => !step.title.trim() || !step.detail.trim()) ||
        new Set(value.sources).size !== value.sources.length ||
        (value.scope !== 'global' && target?.kind !== 'chat') ||
        (value.scope === 'global' && value.sources.some(id => permissionSource(id)?.scope === 'chat')) ||
        value.sources.some(id => !permissionSource(id) || permissionSource(id).scope === 'chat' && target?.kind !== 'chat')) throw Error('INVALID_TASK_PLAN');
    return copyJson({ ...value, risks: value.risks || [], steps: value.steps.map(step => ({ ...step, availability: availability[step.kind] })) });
}

/** A model proposal is data, never a permission or a write command. */
export function createTaskPlanModule({ bindStep = null, bindRead = null } = {}) {
    const registry = createToolRegistry(), runs = new Map(); let disposed = false;
    registry.register({ id: 'muyu.task.plan', version: 1,
        description: 'Propose a bounded multi-step task plan. This must be the only tool call in its response. On success the host ends the planning segment immediately for read-scope review; do not batch reads or analysis with it. Name only sources needed to investigate; do not read them here. Every reading/contract-lookup/analysis step uses kind=read, even when its subject is blueprint, variables or settings. Other kinds refer to proposed writes/actions; availability is not a probe of data sources. A blueprint write being unavailable does not mean storyBlueprint cannot be read. Only provider.read results establish source read status. After authorized reads, ordinary settings and numeric current-chat variables can be proposed together with muyu.task.preview, then require one separate exact-bundle UI approval. The task-plan read approval grants no writes. Blueprint/resource writes and code changes are not available through this plan. Do not claim the task is complete. After read-scope approval, link successful actual-read evidence IDs to read steps with available task.bind_read; link supported preview candidates to write steps with task.bind_step. Use exact IDs from Host task observation, never text guesses or inferred completion.',
        inputSchema: taskPlanSchema, outputSchema: { type: 'object', properties: { candidateId: string(100), text: string(10000) }, required: ['candidateId', 'text'], additionalProperties: false },
        scope: 'global', effect: 'read', dataClasses: ['public-knowledge'], confirmation: 'policy', resourceKeys: [], timeoutMs: 1000, retryPolicy: { kind: 'none', maxAttempts: 1 } });
    if (bindStep) registry.register({ id: 'muyu.task.bind_step', version: 1,
        description: 'Associate a successful preview candidate with explicit host step IDs from the current approved task-plan observation. Supply the exact plan artifact/revision and candidateId returned by config/settings/variables/task preview. For task.preview, optionally map its returned opaque steps IDs via bundleSteps [{bundleStepId,stepId}]; include each proposal step in stepIds. No guessed position/name mapping. Association is model-proposed, not verified user intent, approval, execution or completion. Use only same-task matching write step kinds. Do not bind read/analysis steps here; use bind_read. This never applies a draft.',
        inputSchema: { type: 'object', properties: { planArtifactId: string(100), planRevision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
            candidateId: string(100), stepIds: { type: 'array', maxItems: 8, items: string(100) },
            bundleSteps: { type: 'array', maxItems: 10, items: { type: 'object', properties: { bundleStepId: string(100), stepId: string(100) }, required: ['bundleStepId', 'stepId'], additionalProperties: false } } },
        required: ['planArtifactId', 'planRevision', 'candidateId', 'stepIds'], additionalProperties: false },
        outputSchema: { type: 'object', properties: { bound: { type: 'boolean' }, notice: string(300) }, required: ['bound', 'notice'], additionalProperties: false },
        scope: 'global', effect: 'read', dataClasses: ['public-knowledge'], confirmation: 'policy', resourceKeys: [], timeoutMs: 1000, retryPolicy: { kind: 'none', maxAttempts: 1 } });
    if (bindRead) registry.register({ id: 'muyu.task.bind_read', version: 1,
        description: 'Associate host-generated read evidence IDs from readEvidence in the current task observation with explicit read stepIds from the approved plan. Supply exact planArtifactId/planRevision/evidenceId. Metadata distinguishes contract/catalog, actual field read, empty, directory, page and failure; none proves complete analysis or whole-source coverage. Current original-source authorization is rechecked; this tool grants no permission, performs no new read and completes no step. Never invent IDs.',
        inputSchema: { type: 'object', properties: { planArtifactId: string(100), planRevision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, evidenceId: string(100), stepIds: { type: 'array', maxItems: 8, items: string(100) } }, required: ['planArtifactId', 'planRevision', 'evidenceId', 'stepIds'], additionalProperties: false },
        outputSchema: { type: 'object', properties: { bound: { type: 'boolean' }, notice: string(300) }, required: ['bound', 'notice'], additionalProperties: false },
        scope: 'global', effect: 'read', dataClasses: ['public-knowledge'], confirmation: 'policy', resourceKeys: [], timeoutMs: 1000, retryPolicy: { kind: 'none', maxAttempts: 1 } });
    registry.seal();
    const handlers = { 'muyu.task.plan': (args, ctx) => {
        if (disposed) throw Error('MODULE_DISPOSED');
        const run = runs.get(ctx.runId);
        if (!run || jsonKey(run.target) !== jsonKey(ctx.target)) throw Error('RUN_NOT_BOUND');
        const plan = projectTaskPlan(args, ctx.target), candidateId = 'plan:' + randomUUID();
        run.candidate = { candidateId, plan };
        return { candidateId, text: JSON.stringify({ ...plan, notice: 'Only a proposal. No data access granted and no changes applied. Step availability describes operation support, not whether any data source exists or can be read. Blueprint/resource write restrictions do not prohibit reading those sources; use provider.read to verify.' }) };
    } };
    if (bindStep) handlers['muyu.task.bind_step'] = (args, ctx) => {
        if (disposed || !runs.has(ctx.runId)) throw Error('RUN_NOT_BOUND');
        try { return bindStep(args, ctx); }
        catch (error) {
            // Closed synchronous validation failures; never expose arbitrary host messages.
            if (error instanceof Error && error.message === 'INVALID_BUNDLE_STEP_BINDING') return { bound: false, notice: 'Association rejected: each bundle substep must map to a proposal step of the same operation kind (variable→variables, settings→settings, script→code), using exact host IDs. The draft remains unapplied; no step completed. Do not repeat the same mapping.' };
            if (error instanceof Error && error.message === 'INVALID_STEP_BINDING') return { bound: false, notice: 'Association rejected: use existing matching write-step IDs from the current approved plan and its exact artifact/revision. No draft applied, no permission granted and no step completed. Do not repeat the same mapping.' };
            throw error;
        }
    };
    if (bindRead) handlers['muyu.task.bind_read'] = (args, ctx) => {
        if (disposed || !runs.has(ctx.runId)) throw Error('RUN_NOT_BOUND');
        return bindRead(args, ctx);
    };
    return { registry, handlers,
        bindRun(identity) { if (disposed || runs.size >= 128 || runs.has(identity.id)) throw Error('RUN_CAPACITY'); runs.set(identity.id, { target: copyJson(identity.target), taskId: identity.taskId, candidate: null }); },
        transferRun(from, identity) { const run = runs.get(from); if (!run) return; if (runs.has(identity.id) || run.taskId !== identity.taskId || jsonKey(run.target) !== jsonKey(identity.target)) throw Error('INVALID_RUN_TRANSFER'); runs.delete(from); runs.set(identity.id, run); },
        publishDraft(app, id, candidateId) {
            const r = runs.get(id), run = app.snapshot().runs.find(item => item.id === id);
            if (!r?.candidate || r.candidate.candidateId !== candidateId || run?.status !== 'succeeded' || run.taskId !== r.taskId || jsonKey(run.target) !== jsonKey(r.target)) throw Error('INVALID_CANDIDATE_SOURCE');
            const content = { module: 'task-plan', version: 1, target: r.target, plan: r.candidate.plan };
            const artifact = app.createArtifact({ taskId: r.taskId, sourceRunId: id, kind: 'task-plan', content });
            runs.delete(id); return artifact;
        },
        validateSaved(app, id, revision) {
            const artifact = app.getArtifact(id), content = artifact.content;
            if (artifact.kind !== 'task-plan' || artifact.revision !== revision || content.module !== 'task-plan' || content.version !== 1 ||
                jsonKey(projectTaskPlan({ ...content.plan, steps: content.plan.steps.map(({ availability, ...step }) => step) }, content.target)) !== jsonKey(content.plan)) throw Error('INVALID_TASK_PLAN');
            return app.validateArtifact(id, revision, { structural: 'passed', intent: 'read-scope-review', writes: 'unavailable' });
        },
        retainArtifacts() {}, forgetRun(id) { runs.delete(id); }, dispose() { disposed = true; runs.clear(); },
    };
}
