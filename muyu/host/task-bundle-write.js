import { jsonKey } from '../core/json-contract.js';

/** Sequential, non-atomic execution. A failed/uncertain step stops the remainder. */
export function createTaskBundleWriter({ draftPort, getTarget, variableWriter, configWriter, scriptWriter, changed = () => {} }) {
    return Object.freeze({
        async apply(content, { checkpoint = null } = {}) {
            if (content.variables.length && !variableWriter || content.settings && !configWriter || content.scripts?.length && !scriptWriter) throw Error('WRITE_UNAVAILABLE');
            draftPort.assertFresh(content); // Preflight every step before the first mutation.
            const steps = [
                ...content.variables.map(row => ({ kind: 'variable', id: row.preview.id, status: 'not_started', result: null })),
                ...(content.settings ? [{ kind: 'settings', id: 'global-settings', status: 'not_started', result: null }] : []),
                ...(content.scripts || []).map(row => ({ kind: 'script', id: row.id || row.next.name, status: 'not_started', result: null })),
            ];
            let completed = 0, checkpointFailed = false;
            try {
                for (let i = 0; i < steps.length; i++) {
                    const step = steps[i];
                    if (jsonKey(getTarget()) !== jsonKey(content.target)) { step.status = 'not_executed'; break; }
                    step.status = 'applying';
                    try { if (checkpoint) await checkpoint(steps); }
                    catch { step.status = 'not_executed'; checkpointFailed = true; break; }
                    if (jsonKey(getTarget()) !== jsonKey(content.target)) { step.status = 'not_executed'; break; }
                    try {
                        const result = step.kind === 'variable' ? await variableWriter.apply(content.variables[i]) :
                            step.kind === 'script' ? await scriptWriter.save(content.scripts[i - content.variables.length - (content.settings ? 1 : 0)]) :
                            await configWriter.apply({ baseline: content.settings.baseline, changes: content.settings.changes, contractVersion: 2 });
                        step.result = result;
                        step.status = result?.status || 'outcome_unknown';
                    } catch (error) {
                        step.status = ['STALE_VARIABLE_DRAFT', 'TARGET_UNAVAILABLE', 'STALE_BASELINE', 'WRITE_UNAVAILABLE', 'EMPTY_CHANGES', 'INVALID_TASK_BUNDLE', 'STALE_SCRIPT_ASSET', 'SCRIPT_ASSET_EXISTS', 'SCRIPT_ASSET_UNSUPPORTED', 'INVALID_SCRIPT_DRAFT', 'SCRIPT_STORE_UNAVAILABLE'].includes(error?.message) ? 'not_executed' : 'outcome_unknown';
                    }
                    try { changed(steps); } catch { /* Observer cannot change execution. */ }
                    if (step.status === 'applied_confirmed') completed++;
                    try { if (checkpoint) await checkpoint(steps); }
                    catch { checkpointFailed = true; break; }
                    if (step.status !== 'applied_confirmed') break;
                }
            } finally { draftPort.forget(content); }
            const firstFailure = steps.find(row => row.status !== 'applied_confirmed');
            return { status: !firstFailure ? 'applied_confirmed' : completed || firstFailure.status === 'partial' ? 'partial' : firstFailure.status === 'not_executed' ? 'not_executed' : ['saved_unconfirmed', 'applied_unconfirmed'].includes(firstFailure.status) ? 'applied_unconfirmed' : 'outcome_unknown', steps, ...(checkpointFailed ? { checkpointFailed: true } : {}) };
        },
    });
}
