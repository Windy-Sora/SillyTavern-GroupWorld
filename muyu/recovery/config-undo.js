import { jsonKey } from '../core/json-contract.js';
import { dependencyFields, readSettingsFields, previewSettings } from '../config/registry.js';
import { memoryFields } from '../modules/config-draft/contracts.js';
import { previewMemoryConfig } from '../modules/config-draft/preview.js';

/** Reverse registered leaves only. Never reconstruct old values from display receipts. */
export function inspectConfigUndo(host, row) {
    if (row.continuedBy) throw Error('RECOVERY_CONSUMED');
    const s = row.intent?.settings;
    if (row.version !== 2 || row.kind !== 'config' || !s) throw Error('RECOVERY_UNDO_UNSUPPORTED');
    if (row.status !== 'applied_confirmed' || !row.receipt || row.receipt.saveError || row.receipt.changed) throw Error('RECOVERY_UNCERTAIN');
    const target = host.globalTarget;
    if (!target || row.scope !== JSON.stringify([target.kind, target.chatKey || null])) throw Error('RECOVERY_WRONG_TARGET');
    const fields = s.contractVersion === 1 ? memoryFields : dependencyFields(Object.keys(s.changes));
    const after = { ...s.baseline, ...s.changes };
    if (jsonKey(readSettingsFields(host.getSettings(), fields)) !== jsonKey(after)) throw Error('RECOVERY_CONFLICT');
    const changes = {};
    for (const key of Object.keys(s.changes)) {
        // An absent leaf requires deletion semantics, not assigning an invented default.
        if (!Object.hasOwn(s.baseline, key)) throw Error('RECOVERY_UNDO_UNSUPPORTED');
        changes[key] = s.baseline[key];
    }
    const result = s.contractVersion === 1
        ? previewMemoryConfig({ baseline: after, changes, allowedFields: Object.keys(changes) })
        : previewSettings({ baseline: after, changes });
    if (!result.diff.length) throw Error('RECOVERY_COMPLETE');
    return { target, content: { module: s.contractVersion === 1 ? 'memory-config' : 'settings-config',
        baseline: after, requestedChanges: changes, preview: result } };
}
