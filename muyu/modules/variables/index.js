import { randomUUID } from '../../runtime/crypto.js';
import { copyJson, jsonKey, validateJson } from '../../core/json-contract.js';
import { createToolRegistry } from '../../tools/registry.js';
import { createArtifactLeases } from '../artifact-leases.js';

const string = maxLength => ({ type: 'string', maxLength });
export const variablePreviewSchema = { type: 'object', properties: {
    action: { type: 'string', enum: ['create', 'update'] }, id: { ...string(64), description: 'Normalized current-chat variable ID: lowercase ASCII letters, digits and underscore only, 1..64 chars, e.g. party_gold. No camelCase, hyphens, Chinese or reserved __proto__/constructor/prototype. Display label can be Chinese. Host rejects invalid IDs; it does not silently normalize.' }, label: string(100), rule: string(500),
    initialValue: { type: 'number', minimum: -1e9, maximum: 1e9 }, autoUpdate: { type: 'boolean' },
    injectMode: { type: 'string', enum: ['manual', 'always'] }, updateMode: { type: 'string', enum: ['replace', 'delta'] },
    min: { type: 'number', minimum: -1e9, maximum: 1e9 }, max: { type: 'number', minimum: -1e9, maximum: 1e9 },
    showInDashboard: { type: 'boolean' }, apply: { type: 'boolean' },
}, required: ['action', 'id'], additionalProperties: false };

/** Model data only; the host owns baselines, diff and future write authority. */
export function createVariableDraftModule({ port }) {
    const registry = createToolRegistry(), runs = new Map(); let disposed = false;
    const published = createArtifactLeases(content => port.forget(content));
    registry.register({ id: 'muyu.variables.preview', version: 1,
        description: 'Preview creating or editing one current-chat numeric variable. Use muyu.variable_editor tools for other types, scope changes, stored values and deletion when available. For create, provide label, initialValue, rule, autoUpdate, injectMode and updateMode explicitly. Update only listed definition fields, never the stored value. In full-access mode ONLY, set apply=true when the user explicitly asks to change it now; the host validates and saves after the run. For preview-only or read-only requests, omit apply. Without full access, separate UI approval is required.',
        inputSchema: variablePreviewSchema, outputSchema: { type: 'object', properties: { candidateId: string(100), text: string(12000), applyRequested: { type: 'boolean' } }, required: ['candidateId', 'text'], additionalProperties: false },
        scope: 'chat', effect: 'read', dataClasses: ['chat-variables'], confirmation: 'policy', resourceKeys: [], timeoutMs: 1000, retryPolicy: { kind: 'none', maxAttempts: 1 } });
    registry.seal();
    const handlers = { 'muyu.variables.preview': (args, ctx) => {
        if (disposed) throw Error('MODULE_DISPOSED');
        const run = runs.get(ctx.runId);
        if (!run || jsonKey(run.target) !== jsonKey(ctx.target)) throw Error('RUN_NOT_BOUND');
        const { apply, ...request } = validateJson(variablePreviewSchema, args);
        if (run.candidate) port.forget(run.candidate.content);
        run.candidate = null;
        const content = port.prepare(ctx.target, request), candidateId = 'variable:' + randomUUID();
        run.candidate = { candidateId, content };
        return { candidateId, text: JSON.stringify(apply ? { ...content.preview, automaticApplication: 'requested; check receipt after run' } : content.preview), ...(apply ? { applyRequested: true } : {}) };
    } };
    return { registry, handlers,
        bindRun(identity) { if (disposed || runs.size >= 128 || runs.has(identity.id)) throw Error('RUN_CAPACITY'); runs.set(identity.id, { target: copyJson(identity.target), taskId: identity.taskId, candidate: null }); },
        transferRun(from, identity) { const run = runs.get(from); if (!run) return; if (runs.has(identity.id) || run.taskId !== identity.taskId || jsonKey(run.target) !== jsonKey(identity.target)) throw Error('INVALID_RUN_TRANSFER'); runs.delete(from); runs.set(identity.id, run); },
        publishDraft(app, id, candidateId) {
            const r = runs.get(id), run = app.snapshot().runs.find(item => item.id === id);
            if (!r?.candidate || r.candidate.candidateId !== candidateId || run?.status !== 'succeeded' || run.taskId !== r.taskId || jsonKey(run.target) !== jsonKey(r.target)) throw Error('INVALID_CANDIDATE_SOURCE');
            port.assertFresh(r.candidate.content);
            const artifact = app.createArtifact({ taskId: r.taskId, sourceRunId: id, kind: 'variable-draft', content: r.candidate.content });
            published.track(artifact); runs.delete(id); return artifact;
        },
        validateSaved(app, id, revision) {
            const artifact = app.getArtifact(id), run = app.snapshot().runs.find(item => item.id === artifact.sourceRunId);
            if (artifact.kind !== 'variable-draft' || artifact.revision !== revision || run?.status !== 'succeeded' || run.taskId !== artifact.taskId) throw Error('INVALID_VARIABLE_DRAFT');
            port.assertFresh(artifact.content);
            return app.validateArtifact(id, revision, { structural: 'passed', baseline: 'matched-at-validation', intent: 'review-only', writes: 'separate-approval-required' });
        },
        forgetRun(id) { if (runs.get(id)?.candidate) port.forget(runs.get(id).candidate.content); runs.delete(id); },
        retainArtifacts: values => published.retain(values),
        dispose() { if (disposed) return; disposed = true; for (const run of runs.values()) if (run.candidate) port.forget(run.candidate.content); runs.clear(); published.clear(); },
    };
}
