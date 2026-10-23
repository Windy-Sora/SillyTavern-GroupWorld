import { randomUUID } from '../runtime/crypto.js';
import { copyJson, jsonKey } from '../core/json-contract.js';
import { readSettingsFields, dependencyFields, previewSettings } from '../config/registry.js';
import { memoryFields } from '../modules/config-draft/contracts.js';
import { previewMemoryConfig } from '../modules/config-draft/preview.js';
import { createConfigActions } from '../actions/config-apply.js';
import { createTaskBundleActions } from '../actions/task-bundle-apply.js';
import { recoveryStepStates } from './intent.js';
import { inspectConfigUndo } from './config-undo.js';
import { normalizeDefinition } from '../../systems/variable-system.js';

const unstarted = state => ['not_started', 'not_executed'].includes(state);

/** Local review -> fresh private draft -> fresh exact approval. No model invocation or old grants. */
export function createRecoveryWorkbench({ host, journal, changed = () => {} }) {
    let preview = null, checking = false, epoch = 0, preparing = null;
    const getTarget = kind => kind === 'config' ? host.globalTarget : host.currentTarget();
    async function verifyParent(row, visited = new Set()) {
        if (!row.parentId) return [];
        if (visited.has(row.id) || visited.size >= 64) throw Error('RECOVERY_STALE');
        visited.add(row.id);
        const parent = await journal.get(row.parentId);
        if (parent.continuedBy !== row.id) throw Error('RECOVERY_CONSUMED');
        inspect({ ...parent, continuedBy: '' }, true);
        return [parent, ...await verifyParent(parent, visited)];
    }
    function inspect(row, completedOnly = false) {
        if (row.version !== 2 || !row.intent) throw Error('RECOVERY_NO_INTENT');
        if (row.continuedBy) throw Error('RECOVERY_CONSUMED');
        const target = getTarget(row.kind);
        if (!target || row.scope !== JSON.stringify([target.kind, target.chatKey || null])) throw Error('RECOVERY_WRONG_TARGET');
        const states = recoveryStepStates(row);
        if (states.some(s => !unstarted(s) && s !== 'applied_confirmed')) throw Error('RECOVERY_UNCERTAIN');
        if (!completedOnly && !states.some(unstarted)) throw Error('RECOVERY_COMPLETE');
        const variables = row.intent.variables;
        for (let i = 0; i < variables.length; i++) {
            if (completedOnly && unstarted(states[i])) continue;
            const v = variables[i], actual = host.variableDraftPort?.inspect(target, v.request.id);
            if (!actual) throw Error('WRITE_UNAVAILABLE');
            const definition = v.request.action === 'create' ? v.definition : { ...v.baseline.definition };
            if (v.request.action === 'update') {
                // The writer applies only approved differences, not normalization defaults.
                const before = normalizeDefinition(v.baseline.definition);
                for (const field of Object.keys(v.request)) {
                    if (Object.hasOwn(v.definition, field) && jsonKey(before[field] ?? null) !== jsonKey(v.definition[field])) definition[field] = v.definition[field];
                }
            }
            const expected = unstarted(states[i]) ? v.baseline : {
                definition, value: v.request.action === 'create' ? v.definition.defaultValue : v.baseline.value, occupied: true };
            if (jsonKey(actual) !== jsonKey(expected)) throw Error('RECOVERY_CONFLICT');
        }
        const settings = row.intent.settings;
        if (settings && !(completedOnly && unstarted(states[variables.length]))) {
            const fields = settings.contractVersion === 1 ? memoryFields : dependencyFields(Object.keys(settings.changes));
            const actual = readSettingsFields(host.getSettings(), fields);
            const expected = unstarted(states[variables.length]) ? settings.baseline : { ...settings.baseline, ...settings.changes };
            if (jsonKey(actual) !== jsonKey(expected)) throw Error('RECOVERY_CONFLICT');
        }
        return { target, states, request: { variables: variables.filter((_, i) => unstarted(states[i])).map(v => v.request),
            ...(settings && unstarted(states[variables.length]) ? { settings: settings.changes } : {}) } };
    }
    function verifyDraft(id, revision) {
        const p = preview;
        if (!p || p.cancelled || p.artifact.id !== id || p.artifact.revision !== revision || p.state !== 'ready') throw Error('ACTION_STALE');
        // During dispatch, completed original steps are still verified separately below.
        if (jsonKey(getTarget(p.source.kind)) !== jsonKey(p.target)) throw Error('ACTION_STALE');
        if (p.source.kind === 'bundle') host.bundleDraftPort.assertFresh(p.artifact.content);
        else {
            const s = p.artifact.content;
            if (jsonKey(readSettingsFields(host.getSettings(), s.preview.contractVersion === 1 ? memoryFields : dependencyFields(Object.keys(s.requestedChanges)))) !== jsonKey(s.baseline)) throw Error('STALE_BASELINE');
        }
        if (p.mode === 'undo') inspectConfigUndo(host, { ...p.source, continuedBy: '' });
        else inspect({ ...p.source, continuedBy: '' });
        for (const ancestor of p.ancestors) inspect({ ...ancestor, continuedBy: '' }, true);
    }
    async function checkpoint(record, steps) {
        const p = preview;
        if (!p || !journal.snapshot().enabled) throw Error('RECOVERY_SAVE_FAILED');
        if (p.cancelled && record.status === 'applying') throw Error('RECOVERY_CANCELLED');
        // Write the child marker BEFORE consuming the original record. A crash never leaves
        // a consumed source without a durable child that can explain/recover the attempt.
        if (record.status === 'applying') {
            if (p.mode === 'undo') inspectConfigUndo(host, { ...p.source, continuedBy: '' });
            else inspect({ ...p.source, continuedBy: '' }, !!steps);
        }
        if (record.status === 'applying' && !p.claimed) await verifyParent(p.source);
        await journal.checkpoint(record, steps, p.source.conversationId, p.source.id);
        if (record.status === 'applying' && !p.claimed) {
            await journal.claim(p.source.id, p.source.revision, record.id); p.claimed = true;
        }
        if (record.status === 'applying') {
            if (p.mode === 'undo') inspectConfigUndo(host, { ...p.source, continuedBy: '' });
            else inspect({ ...p.source, continuedBy: '' }, !!steps);
            for (const ancestor of p.ancestors) inspect({ ...ancestor, continuedBy: '' }, true);
        }
    }
    const common = { changed, checkpoint, getArtifact: id => { if (preview?.artifact.id !== id) throw Error('ACTION_STALE'); return preview.artifact; }, validate: verifyDraft };
    const config = createConfigActions({ ...common, writer: host.configWriter, getTarget: () => host.globalTarget });
    const bundle = createTaskBundleActions({ ...common, writer: host.bundleWriter, getTarget: () => host.currentTarget() });
    const busy = () => checking || config.busy || bundle.busy;
    function discard() { if (preview?.source.kind === 'bundle') host.bundleDraftPort?.forget(preview.artifact.content); preview = null; }
    return Object.freeze({
        get busy() { return busy(); },
        list: () => [...config.list(), ...bundle.list()],
        snapshot() { return preview ? copyJson({ id: preview.source.id, mode: preview.mode || 'resume', state: preview.state, diff: preview.artifact.content.preview?.diff || [],
            steps: preview.artifact.content.variables?.map(v => ({ id: v.preview.id, diff: v.preview.diff })) || [],
            settingsDiff: preview.artifact.content.settings?.preview.diff || [], result: preview.result ? { operationId: preview.result.id, status: preview.result.status } : null }) : null; },
        async prepare(id, mode = 'resume') {
            if (!['resume', 'undo'].includes(mode)) throw Error('RECOVERY_STALE');
            if (busy()) throw Error('ACTION_BUSY');
            discard(); const token = ++epoch; let checked; preparing = new Promise(resolve => { checked = resolve; }); checking = true; changed();
            try {
                const source = await journal.get(id);
                const ancestors = await verifyParent(source);
                if (token !== epoch) throw Error('RECOVERY_STALE');
                const inspected = mode === 'undo' ? inspectConfigUndo(host, source) : inspect(source);
                const { target, request } = inspected; let content;
                if (mode === 'undo') content = inspected.content;
                else if (source.kind === 'bundle') content = host.bundleDraftPort.prepare(target, request);
                else {
                    const s = source.intent.settings;
                    const result = s.contractVersion === 1 ? previewMemoryConfig({ baseline: s.baseline, changes: s.changes, allowedFields: Object.keys(s.changes) }) : previewSettings({ baseline: s.baseline, changes: s.changes });
                    content = { module: s.contractVersion === 1 ? 'memory-config' : 'settings-config', baseline: s.baseline, requestedChanges: s.changes, preview: result };
                }
                preview = { source, ancestors, mode, target: copyJson(target), state: 'ready', claimed: false,
                    artifact: { id: 'recovery-draft:' + randomUUID(), revision: 1, kind: source.kind === 'bundle' ? 'task-bundle' : 'config-draft', sessionId: source.conversationId, content } };
                return this.snapshot();
            } finally { checking = false; preparing = null; checked(); changed(); }
        },
        async approve(id) {
            if (busy() || !preview || preview.source.id !== id || preview.state !== 'ready') throw Error('RECOVERY_STALE');
            const p = preview, coordinator = p.source.kind === 'bundle' ? bundle : config;
            const action = coordinator.prepare(p.artifact.id, 1);
            try { p.result = await coordinator.approve(action.id); p.state = 'finished'; return copyJson(p.result); }
            finally { if (p.state === 'ready') p.state = 'finished'; changed(); }
        },
        invalidate() { epoch++; config.invalidate(); bundle.invalidate(); if (preview) preview.cancelled = true; if (!config.busy && !bundle.busy) discard(); },
        async drain() { await Promise.all([preparing, config.drain(), bundle.drain()]); },
        clear() { if (busy()) throw Error('ACTION_BUSY'); discard(); config.clear(); bundle.clear(); },
    });
}
