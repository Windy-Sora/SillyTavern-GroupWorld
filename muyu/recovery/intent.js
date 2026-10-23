import { copyJson, jsonKey, validateJson } from '../core/json-contract.js';
import { configChangesSchema, dependencyFields } from '../config/registry.js';
import { memoryFields } from '../modules/config-draft/contracts.js';
import { bundleFieldPolicy } from '../config/bundle-policy.js';
import { variablePreviewSchema } from '../modules/variables/index.js';
const definitionFields = new Set(['id', 'label', 'labelZh', 'scope', 'type', 'defaultValue', 'rule', 'ruleZh', 'autoUpdate', 'injectMode', 'updateMode', 'min', 'max', 'enumValues', 'showInDashboard', 'locked', 'dashboardOrder']);

/** Data for a NEW preview, never the old draft token or its execution authority. */
export function validateRecoveryIntent(value) {
    const data = copyJson(value);
    if (!data || Object.keys(data).sort().join() !== 'settings,variables' || !Array.isArray(data.variables) || data.variables.length > 6) throw Error('RECOVERY_INVALID');
    if (data.settings !== null) {
        const s = data.settings;
        if (Object.keys(s).sort().join() !== 'baseline,changes,contractVersion' || ![1, 2].includes(s.contractVersion)) throw Error('RECOVERY_INVALID');
        s.changes = validateJson(configChangesSchema, s.changes);
        const fields = s.contractVersion === 1 ? memoryFields : dependencyFields(Object.keys(s.changes));
        if (!Object.keys(s.changes).length || Object.keys(s.changes).some(k => !bundleFieldPolicy(k).supported || s.contractVersion === 1 && !memoryFields.includes(k)) ||
            !s.baseline || Object.keys(s.baseline).some(k => !fields.includes(k))) throw Error('RECOVERY_INVALID');
        s.baseline = validateJson(configChangesSchema, s.baseline);
    }
    const ids = new Set();
    for (const row of data.variables) {
        if (!row || Object.keys(row).sort().join() !== 'baseline,definition,request') throw Error('RECOVERY_INVALID');
        row.request = validateJson(variablePreviewSchema, row.request);
        if (Object.hasOwn(row.request, 'apply') || ids.has(row.request.id) || row.definition?.id !== row.request.id || !row.baseline ||
            Object.keys(row.baseline).sort().join() !== 'definition,occupied,value' || typeof row.baseline.occupied !== 'boolean') throw Error('RECOVERY_INVALID');
        for (const definition of [row.definition, row.baseline.definition].filter(v => v !== null)) {
            if (!definition || Array.isArray(definition) || Object.keys(definition).some(k => !definitionFields.has(k))) throw Error('RECOVERY_INVALID');
        }
        ids.add(row.request.id);
    }
    if (!data.settings && !data.variables.length) throw Error('RECOVERY_INVALID');
    return data;
}

export function recoveryIntent(content, kind) {
    try {
        if (kind === 'bundle' && content.scripts?.length || kind === 'config' && (content.memoryPrunePlan || content.blueprintTogglePlan || content.completionVariablePlan)) return null;
        const settings = kind === 'bundle' ? content.settings : { baseline: content.baseline,
            changes: content.requestedChanges ?? content.preview.manifest.settings, contractVersion: content.preview.contractVersion || 1 };
        return validateRecoveryIntent({ settings: settings ? { baseline: settings.baseline, changes: settings.changes, contractVersion: kind === 'bundle' ? 2 : settings.contractVersion } : null,
            variables: kind === 'bundle' ? content.variables.map(({ request, baseline, definition }) => ({ request, baseline, definition })) : [] });
    } catch { return null; } // Older/special drafts remain inspectable, never guessed into executables.
}

export function recoveryStepStates(record) {
    if (record.kind === 'config') return [record.status];
    const expected = [...record.intent.variables.map(r => ['variable', r.request.id]), ...(record.intent.settings ? [['settings', 'global-settings']] : [])];
    const rows = record.receipt?.steps || record.steps;
    if (!rows.length && record.status === 'not_executed') return expected.map(() => 'not_started');
    if (rows.length !== expected.length || rows.some((r, i) => jsonKey([r.kind, r.id]) !== jsonKey(expected[i]))) throw Error('RECOVERY_UNCERTAIN');
    return rows.map(r => r.status);
}
