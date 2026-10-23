import { randomUUID } from '../../runtime/crypto.js';
import { copyJson, jsonKey, validateJson } from '../../core/json-contract.js';
import { createToolRegistry } from '../../tools/registry.js';
import { prepareGeneratedProfile } from '../../config/generated-profile.js';

const inputSchema = { type: 'object', properties: {
    name: { type: 'string', maxLength: 80 },
    description: { type: 'string', maxLength: 500 },
    settingsJson: { type: 'string', maxLength: 20000 },
    save: { type: 'boolean' },
}, required: ['name', 'settingsJson'], additionalProperties: false };

export function createProfileDraftModule() {
    const registry = createToolRegistry(), runs = new Map(); let disposed = false;
    registry.register({ id: 'muyu.profile.preview', version: 1,
        description: 'Create a reusable named GroupWorld config profile from exact supported global settings fields. settingsJson is a JSON object of leaf field IDs and values; omitted fields remain unchanged when the profile is later applied. This only previews a profile; it does not change active settings. In full-access mode ONLY, set save=true if the user explicitly requests saving it to My Profiles now. For preview-only requests omit save. Never include secrets, executable code, current-chat data, customPromptsEnabled, profileLibraryAutoLoad.*, memoryMaxEntries, storyBlueprintEnabled, storyBlueprintCompletionVariable scoreWeights fields, or personal lang/debugLogging preferences (use settings.preview for those).',
        inputSchema,
        outputSchema: { type: 'object', properties: { candidateId: { type: 'string', maxLength: 100 }, text: { type: 'string', maxLength: 24000 }, applyRequested: { type: 'boolean' } }, required: ['candidateId', 'text'], additionalProperties: false },
        scope: 'global', effect: 'read', dataClasses: ['settings-whitelist'], confirmation: 'policy', resourceKeys: [], timeoutMs: 1000, retryPolicy: { kind: 'none', maxAttempts: 1 } });
    registry.seal();
    const handlers = { 'muyu.profile.preview': (args, ctx) => {
        if (disposed) throw Error('MODULE_DISPOSED');
        const run = runs.get(ctx.runId);
        if (!run || jsonKey(run.target) !== jsonKey(ctx.target)) throw Error('RUN_NOT_BOUND');
        const input = validateJson(inputSchema, args);
        const content = prepareGeneratedProfile({ name: input.name, description: input.description || '', changes: JSON.parse(input.settingsJson) });
        if (run.candidates.size >= 16) throw Error('PROFILE_PREVIEW_LIMIT');
        const candidateId = 'profile:' + randomUUID();
        run.candidates.set(candidateId, content);
        return { candidateId, text: JSON.stringify({ name: content.name, description: content.description, settings: content.settings,
            warnings: content.warnings, state: 'preview_only', activeSettingsChanged: false,
            ...(input.save ? { automaticSave: 'requested; check the save result after this run' } : {}) }),
            ...(input.save ? { applyRequested: true } : {}) };
    } };
    return { registry, handlers,
        bindRun(identity) { if (disposed || runs.size >= 128 || runs.has(identity.id)) throw Error('RUN_CAPACITY'); runs.set(identity.id, { target: copyJson(identity.target), taskId: identity.taskId, candidates: new Map() }); },
        transferRun(from, identity) { const run = runs.get(from); if (!run) return; if (runs.has(identity.id) || run.taskId !== identity.taskId || jsonKey(run.target) !== jsonKey(identity.target)) throw Error('INVALID_RUN_TRANSFER'); runs.delete(from); runs.set(identity.id, run); },
        publishDraft(app, id, candidateId) {
            const run = runs.get(id), state = app.snapshot().runs.find(row => row.id === id);
            if (!run?.candidates.has(candidateId) || state?.status !== 'succeeded' || state.taskId !== run.taskId || jsonKey(state.target) !== jsonKey(run.target)) throw Error('INVALID_CANDIDATE_SOURCE');
            const artifact = app.createArtifact({ taskId: run.taskId, sourceRunId: id, kind: 'profile-draft', content: run.candidates.get(candidateId) });
            run.candidates.delete(candidateId); if (!run.candidates.size) runs.delete(id); return artifact;
        },
        validateSaved(app, id, revision) {
            const artifact = app.getArtifact(id), state = app.snapshot().runs.find(row => row.id === artifact.sourceRunId);
            if (artifact.kind !== 'profile-draft' || artifact.revision !== revision || state?.status !== 'succeeded' || state.taskId !== artifact.taskId) throw Error('INVALID_PROFILE_DRAFT');
            const checked = prepareGeneratedProfile({ name: artifact.content.name, description: artifact.content.description, changes: artifact.content.settings });
            if (jsonKey(checked) !== jsonKey(artifact.content)) throw Error('INVALID_PROFILE_DRAFT');
            return app.validateArtifact(id, revision, { structural: 'passed', semantic: 'passed', intent: 'requires_user_review', writes: 'profile-save-only' });
        },
        retainArtifacts() {}, forgetRun(id) { runs.delete(id); }, dispose() { disposed = true; runs.clear(); },
    };
}
