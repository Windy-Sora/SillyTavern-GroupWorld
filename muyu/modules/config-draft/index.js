import { copyJson, jsonKey } from '../../core/json-contract.js';
import { assertActive } from '../../core/execution.js';
import { createToolRegistry } from '../../tools/registry.js';
import { getMemoryConfigContract, memoryFields } from './contracts.js';
import { changesSchema, previewMemoryConfig, readConfigBaseline } from './preview.js';

const str = { type: 'string', maxLength: 2000 }, number = { type: 'integer', minimum: 1 };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = (items, maxItems) => ({ type: 'array', items, maxItems });
const manifestSchema = object({ type: str, version: number, drawers: object({ profilesAndData: { type: 'boolean' } }), settings: changesSchema });
const previewSchema = object({ contractVersion: number, scope: str, structural: str, range: str, semantic: str, intent: str, warnings: array(str, 4), diff: array(object({ field: str, before: str, after: str }), 4), manifest: manifestSchema, notice: str });

/** One instance per application. No apply/import/save callbacks are accepted. */
export function createConfigDraftModule({ getSettings, getTarget, maxRuns = 128 }) {
    if (typeof getSettings !== 'function' || typeof getTarget !== 'function' || !Number.isSafeInteger(maxRuns) || maxRuns < 1 || maxRuns > 128) throw new TypeError('Invalid draft ports');
    const registry = createToolRegistry(), records = new Map(), handlers = {}; let counter = 0, disposed = false;
    const live = () => { if (disposed) throw new Error('MODULE_DISPOSED'); };
    function assertTarget(target) {
        const current = getTarget();
        if (!current || (target.kind === 'global' ? current.userKey !== target.userKey : jsonKey(target) !== jsonKey(current))) throw new Error('TARGET_UNAVAILABLE');
    }
    function read(target) { assertTarget(target); const a = readConfigBaseline(getSettings()); assertTarget(target); if (jsonKey(a) !== jsonKey(readConfigBaseline(getSettings()))) throw new Error('STALE_BASELINE'); assertTarget(target); return a; }
    function state(runId) { live(); const record = records.get(runId); if (!record) throw new Error('RUN_NOT_BOUND'); return record; }
    function current(record) { if (jsonKey(read(record.target)) !== jsonKey(record.baseline)) throw new Error('STALE_BASELINE'); }
    function register(id, description, inputSchema, outputSchema, handler) {
        registry.register({ id, version: 1, description, inputSchema, outputSchema, scope: 'global', effect: 'read', dataClasses: ['config-contract', 'settings-whitelist'], confirmation: 'policy', resourceKeys: [], timeoutMs: 1000, retryPolicy: { kind: 'none', maxAttempts: 1 } });
        handlers[id] = (args, context) => { live(); assertActive(context.signal); return handler(args, context); };
    }
    register('muyu.config.contract', '查询记忆配置四个字段的合同。只读，不授予修改权限。', object({}), object({ id: str, version: number, scope: str, fields: array(object({ field: str, type: str, defaultValue: str, constraint: str, unit: str, description: str }), 4), sources: array(str, 4), rules: array(str, 4) }), () => getMemoryConfigContract());
    register('muyu.config.preview', '提交记忆配置changes进行校验与预览。只修改用户明确要求的字段；不要补开前置开关。返回候选ID，不保存也不应用。errors非空表示失败，previews为空；成功时previews包含一份预览。', object({ changes: changesSchema }), object({ candidateId: str, errors: array(str, 4), previews: array(previewSchema, 1) }), ({ changes }, context) => {
        const r = state(context.runId); if (jsonKey(context.target) !== jsonKey(r.target)) throw new Error('TARGET_UNAVAILABLE'); current(r);
        let preview;
        try { preview = previewMemoryConfig({ baseline: r.baseline, changes, allowedFields: r.allowedFields, previousChanges: r.previousChanges }); }
        catch (error) {
            r.candidate = null;
            return { candidateId: '', errors: [['OUT_OF_SCOPE', 'EMPTY_CHANGES'].includes(error.message) ? error.message : 'INVALID_CHANGES'], previews: [] };
        }
        assertActive(context.signal); const candidateId = 'candidate:' + (++counter); r.candidate = { candidateId, preview }; return copyJson({ candidateId, errors: [], previews: [preview] });
    });
    registry.seal();
    return Object.freeze({ id: 'muyu.config-draft', version: 1, registry, handlers: Object.freeze(handlers),
        bindRun({ runId, taskId, target, allowedFields, previousArtifact = null }) {
            live(); if (records.has(runId) || records.size >= maxRuns) throw new Error('RUN_CAPACITY');
            if (typeof runId !== 'string' || !runId || typeof taskId !== 'string' || !taskId || !Array.isArray(allowedFields) || !allowedFields.length || new Set(allowedFields).size !== allowedFields.length || allowedFields.some(k => !memoryFields.includes(k))) throw new Error('INVALID_EDIT_SCOPE');
            const baseline = read(target); let previousChanges = {};
            if (previousArtifact) {
                if (previousArtifact.kind !== 'config-draft' || previousArtifact.taskId !== taskId || previousArtifact.content?.module !== 'memory-config' || jsonKey(previousArtifact.content.baseline) !== jsonKey(baseline)) throw new Error('INVALID_PREVIOUS_DRAFT');
                previousChanges = copyJson(previousArtifact.content.preview.manifest.settings);
            }
            records.set(runId, { taskId, target: copyJson(target), allowedFields: [...allowedFields], baseline, previousChanges, previousArtifact: previousArtifact ? copyJson(previousArtifact) : null, candidate: null });
        },
        publishDraft(app, runId, candidateId) {
            const r = state(runId), run = app.snapshot().runs.find(item => item.id === runId);
            if (!run || run.status !== 'succeeded' || run.taskId !== r.taskId || jsonKey(run.target) !== jsonKey(r.target) || !r.candidate || r.candidate.candidateId !== candidateId) throw new Error('INVALID_CANDIDATE_SOURCE');
            current(r);
            const content = { module: 'memory-config', producedByRunId: runId, baseline: r.baseline, preview: r.candidate.preview };
            let artifact;
            if (r.previousArtifact) {
                const previous = app.getArtifact(r.previousArtifact.id);
                if (previous.taskId !== r.taskId || previous.revision !== r.previousArtifact.revision || jsonKey(previous.content) !== jsonKey(r.previousArtifact.content)) throw new Error('STALE_ARTIFACT');
                artifact = app.updateArtifact(previous.id, previous.revision, content);
            } else artifact = app.createArtifact({ taskId: r.taskId, sourceRunId: runId, kind: 'config-draft', content });
            records.delete(runId); return artifact;
        },
        validateSaved(app, artifactId, expectedRevision) {
            live(); const artifact = app.getArtifact(artifactId);
            if (artifact.kind !== 'config-draft' || artifact.revision !== expectedRevision || artifact.content?.module !== 'memory-config') throw new Error('STALE_ARTIFACT');
            const run = app.snapshot().runs.find(r => r.id === artifact.content.producedByRunId);
            if (!run || run.taskId !== artifact.taskId || run.status !== 'succeeded') throw new Error('INVALID_CANDIDATE_SOURCE');
            const baseline = read(run.target);
            if (jsonKey(baseline) !== jsonKey(artifact.content.baseline)) throw new Error('STALE_BASELINE');
            const preview = artifact.content.preview;
            // Recompute from saved fields, never trust its embedded validation labels.
            const result = previewMemoryConfig({ baseline, changes: preview.manifest.settings, allowedFields: memoryFields, allowEmpty: true });
            if (jsonKey(result) !== jsonKey(preview)) throw new Error('INVALID_DRAFT');
            return app.validateArtifact(artifactId, expectedRevision, { contractVersion: 1, structural: result.structural, semantic: result.semantic, intent: result.intent, baseline: jsonKey(baseline) });
        },
        forgetRun(runId) { records.delete(runId); },
        retainArtifacts() { /* This legacy preview owns no host tickets. */ },
        transferRun(from, identity) { const record = records.get(from); if (!record) return; if (records.has(identity.id) || record.taskId !== identity.taskId || jsonKey(record.target) !== jsonKey(identity.target)) throw Error('INVALID_RUN_TRANSFER'); records.delete(from); records.set(identity.id, record); },
        dispose() { disposed = true; records.clear(); },
    });
}
