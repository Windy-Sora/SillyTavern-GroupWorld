import { randomUUID } from '../../runtime/crypto.js';
import { copyJson, jsonKey, validateJson } from '../../core/json-contract.js';
import { createToolRegistry } from '../../tools/registry.js';
import { taskBundleSchema } from '../../host/task-bundle-draft.js';
import { configChangesSchema } from '../../config/registry.js';
import { taskBundleLayout } from './steps.js';
import { createArtifactLeases } from '../artifact-leases.js';

// Avoid duplicating the full settings schema in every model request.
const toolSchema = { type: 'object', properties: {
    settingsJson: { type: 'string', maxLength: 16000 },
    variables: taskBundleSchema.properties.variables, scripts: taskBundleSchema.properties.scripts, apply: { type: 'boolean' },
}, additionalProperties: false };

/** One model call proposes data; only the trusted UI can approve writes. */
export function createTaskBundleModule({ port }) {
    const registry = createToolRegistry(), runs = new Map(); let disposed = false;
    const published = createArtifactLeases(content => port.forget(content));
    registry.register({ id: 'muyu.task.preview', version: 1,
        description: 'Preview one bounded operation bundle: up to six distinct numeric shared current-chat variable definitions (scope=global, no per-character selector; use variable_editor for character scopes), ordinary global settings changes, and up to three explicit Script Executor definition requests in scripts [{operation,id?,revision?,changesJson}]. Order: variables then settings then scripts. Script saving does not actively run code; enabled definitions allow later automatic events and require full-source review. Unconfirmed saves stop the rest. Put settings changes in settingsJson as a JSON object string of exact field names and values; omit unused sections. In full-access mode ONLY, set apply=true when the user explicitly asks to execute the bundle now; the host validates and saves after the run. For preview-only or read-only requests omit apply. Without full access, separate UI approval is required. customPromptsEnabled, profileLibraryAutoLoad.*, memoryMaxEntries, storyBlueprintEnabled, storyBlueprintCompletionVariable, blueprint/resource writes, other executable assets and secrets require separate workflows. Do not add changes the user did not request. For a multi-kind request (for example variable definitions plus settings), first publish task.plan and await read-scope approval; then preview. If the current approved plan is present, associate successful actual-read evidence using task.bind_read, then associate this candidate and returned steps IDs using task.bind_step with bundleSteps before concluding. Simple single-kind previews need no artificial plan. These associations are not approvals or completion.',
        inputSchema: toolSchema,
        outputSchema: { type: 'object', properties: { candidateId: { type: 'string', maxLength: 100 }, text: { type: 'string', maxLength: 12000 }, applyRequested: { type: 'boolean' },
            steps: { type: 'array', maxItems: 10, items: { type: 'object', properties: { id: { type: 'string', maxLength: 100 }, kind: { type: 'string', enum: ['variable', 'settings', 'script'] }, displayIndex: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['id', 'kind', 'displayIndex'], additionalProperties: false } } }, required: ['candidateId', 'text'], additionalProperties: false },
        scope: 'chat', effect: 'read', dataClasses: ['chat-variables', 'settings-whitelist'], confirmation: 'policy', resourceKeys: [], timeoutMs: 1000, retryPolicy: { kind: 'none', maxAttempts: 1 } });
    registry.seal();
    const handlers = { 'muyu.task.preview': (args, ctx) => {
        if (disposed) throw Error('MODULE_DISPOSED');
        const run = runs.get(ctx.runId);
        if (!run || jsonKey(run.target) !== jsonKey(ctx.target)) throw Error('RUN_NOT_BOUND');
        if (run.candidate) port.forget(run.candidate.content);
        run.candidate = null;
        const input = validateJson(toolSchema, args);
        const settings = input.settingsJson === undefined ? {} : validateJson(configChangesSchema, JSON.parse(input.settingsJson));
        const content = port.prepare(ctx.target, { settings, variables: input.variables || [], scripts: input.scripts || [] });
        const preview = { scope: 'current-chat-and-global', order: 'variables-then-settings-then-scripts',
            variables: content.variables.map(row => row.preview), settings: content.settings?.preview || null,
            scripts: (content.scripts || []).map(row => ({ operation: row.operation, id: row.id, name: row.next?.name || row.previous?.name, enabled: row.next?.enabled ?? false, warnings: row.warnings })),
            notice: 'Preview only. One separate UI approval executes exact steps in order; an uncertain save stops remaining steps.' };
        const text = JSON.stringify(input.apply ? { ...preview, automaticApplication: 'requested; check step receipts after run' } : preview);
        if (text.length > 12000) { port.forget(content); throw Error('BUNDLE_PREVIEW_TOO_LARGE'); }
        const candidateId = 'bundle:' + randomUUID();
        run.candidate = { candidateId, content };
        const steps = taskBundleLayout(content).map((step, index) => ({ id: candidateId + ':step:' + (index + 1), kind: step.kind, displayIndex: index + 1 }));
        return { candidateId, text, steps, ...(input.apply ? { applyRequested: true } : {}) };
    } };
    return { registry, handlers,
        bindRun(identity) { if (disposed || runs.size >= 128 || runs.has(identity.id)) throw Error('RUN_CAPACITY'); runs.set(identity.id, { target: copyJson(identity.target), taskId: identity.taskId, candidate: null }); },
        transferRun(from, identity) { const run = runs.get(from); if (!run) return; if (runs.has(identity.id) || run.taskId !== identity.taskId || jsonKey(run.target) !== jsonKey(identity.target)) throw Error('INVALID_RUN_TRANSFER'); runs.delete(from); runs.set(identity.id, run); },
        publishDraft(app, id, candidateId) {
            const run = runs.get(id), state = app.snapshot().runs.find(row => row.id === id);
            if (!run?.candidate || run.candidate.candidateId !== candidateId || state?.status !== 'succeeded' || state.taskId !== run.taskId || jsonKey(state.target) !== jsonKey(run.target)) throw Error('INVALID_CANDIDATE_SOURCE');
            port.assertFresh(run.candidate.content);
            const artifact = app.createArtifact({ taskId: run.taskId, sourceRunId: id, kind: 'task-bundle', content: run.candidate.content });
            published.track(artifact); runs.delete(id); return artifact;
        },
        validateSaved(app, id, revision) {
            const artifact = app.getArtifact(id), state = app.snapshot().runs.find(row => row.id === artifact.sourceRunId);
            if (artifact.kind !== 'task-bundle' || artifact.revision !== revision || state?.status !== 'succeeded' || state.taskId !== artifact.taskId) throw Error('INVALID_TASK_BUNDLE');
            port.assertFresh(artifact.content);
            return app.validateArtifact(id, revision, { structural: 'passed', baseline: 'matched-at-validation', intent: 'review-only', writes: 'bundle-approval-required' });
        },
        forgetRun(id) { const run = runs.get(id); if (run?.candidate) port.forget(run.candidate.content); runs.delete(id); },
        retainArtifacts: values => published.retain(values),
        dispose() { if (disposed) return; disposed = true; for (const run of runs.values()) if (run.candidate) port.forget(run.candidate.content); runs.clear(); published.clear(); },
    };
}
