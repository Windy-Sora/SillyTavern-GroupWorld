import { copyJson, jsonKey } from '../core/json-contract.js';
import { validateReceipt, receiptStatuses, receiptSources } from '../actions/receipts.js';
import { taskBundleLayout } from '../modules/task-bundle/steps.js';

const terminal = new Set(receiptStatuses);
const states = new Set(['pending', 'applying', ...receiptStatuses]);
const meanings = { pending: 'not-dispatched', applying: 'in-progress', cancelled: 'cancelled-before-dispatch', expired: 'approval-expired',
    not_executed: 'not-executed', applied_confirmed: 'confirmed', saved_confirmed: 'confirmed',
    applied_unconfirmed: 'persistence-unconfirmed', saved_unconfirmed: 'persistence-unconfirmed', partial: 'partial', outcome_unknown: 'unknown' };

/** Trusted action observations only. Never maps proposed steps by text or operation kind. */
export function createTaskOperations({ canCarry = () => false } = {}) {
    const rows = new Map(); let omitted = 0;
    return {
        owns: action => rows.has(action?.id),
        hasActive: () => [...rows.values()].some(row => ['pending', 'applying'].includes(row.status)),
        observe(action, artifact, plan, receipt = null, binding = null) {
            let row = rows.get(action?.id);
            if (!action || !states.has(action.status)) return;
            if (artifact) {
                if (action.artifactId !== artifact.id || action.revision !== artifact.revision || action.sessionId !== artifact.sessionId || jsonKey(action.content) !== jsonKey(artifact.content)) return;
            } else if (!row || row.artifactId !== action.artifactId || row.artifactRevision !== action.revision ||
                row.sessionId !== action.sessionId || row.targetKey !== jsonKey(action.target)) return;
            let validated = null;
            if (terminal.has(action.status)) {
                try { validated = validateReceipt(receipt); } catch { return; }
                if (validated.operationId !== action.id || validated.artifactId !== action.artifactId || validated.revision !== action.revision || validated.status !== action.status) return;
            }
            if (row && (row.artifactId !== action.artifactId || row.artifactRevision !== action.revision || row.terminal || row.status === 'applying' && action.status === 'pending')) return;
            if (!row) {
                if (rows.size >= 32) { omitted++; return; }
                row = { operationId: action.id, artifactId: artifact.id, artifactRevision: artifact.revision, artifactKind: artifact.kind,
                    sessionId: action.sessionId, targetKey: jsonKey(action.target),
                    referenceState: 'current', stepMapping: 'unmapped', ...(plan?.referenceState === 'published' ? {
                        planReference: { artifactId: plan.artifactId, artifactRevision: plan.artifactRevision, referenceState: 'current' },
                    } : {}) };
                rows.set(action.id, row);
                row.expectedLayout = taskBundleLayout(action.content);
                if (binding?.referenceState === 'published') { row.stepMapping = 'explicit-model-proposal'; row.stepReference = copyJson(binding); }
            }
            row.status = action.status; row.executionResult = meanings[action.status]; row.terminal = terminal.has(action.status);
            // The receipt remains authoritative; this is only a bounded identity/status projection.
            if (validated) {
                row.authorization = { sources: receiptSources(validated), ...(validated.memoryPrune ? { memoryPruneChatKey: validated.memoryPrune.chatKey } : {}) };
                row.receiptAt = validated.at;
                if ([4, 9].includes(validated.version) && row.expectedLayout && (row.expectedLayout.length !== validated.steps.length ||
                    row.expectedLayout.some((step, index) => step.kind !== validated.steps[index].kind || step.sourceId !== validated.steps[index].id))) {
                    row.substepEvidence = 'layout-mismatch';
                } else if ([4, 9].includes(validated.version)) row.executedSteps = validated.steps.map((step, index) => ({
                    id: action.id + ':step:' + (index + 1), displayIndex: index + 1, kind: step.kind,
                    status: step.status, chatSave: step.chatSave, settingsSave: step.settingsSave,
                    ...(row.stepReference?.bundleSteps?.find(mapped => mapped.displayIndex === index + 1) ? {
                        proposalStepId: row.stepReference.bundleSteps.find(mapped => mapped.displayIndex === index + 1).stepId,
                        bundleStepId: row.stepReference.bundleSteps.find(mapped => mapped.displayIndex === index + 1).bundleStepId,
                        association: 'model-proposed', intentVerification: 'not-assessed',
                    } : {}),
                }));
            }
        },
        retainArtifacts(artifacts) {
            for (const row of rows.values()) {
                if (!artifacts.some(a => a.id === row.artifactId && a.revision === row.artifactRevision)) row.referenceState = 'stale';
                if (row.planReference && !artifacts.some(a => a.id === row.planReference.artifactId && a.revision === row.planReference.artifactRevision)) row.planReference.referenceState = 'stale';
                if (row.stepReference && (!artifacts.some(a => a.id === row.stepReference.planArtifactId && a.revision === row.stepReference.planRevision) || row.referenceState === 'stale')) row.stepReference.referenceState = 'stale';
            }
        },
        retainPlan(plan) {
            for (const row of rows.values()) if (row.planReference && (row.planReference.artifactId !== plan?.artifactId || row.planReference.artifactRevision !== plan?.artifactRevision)) row.planReference.referenceState = 'stale';
            for (const row of rows.values()) if (row.stepReference && (row.stepReference.planArtifactId !== plan?.artifactId || row.stepReference.planRevision !== plan?.artifactRevision)) row.stepReference.referenceState = 'stale';
        },
        project(target, taskId) {
            const operations = [];
            for (const row of rows.values()) {
                // Pending identity/status is not source content. Terminal evidence must pass receipt source policy.
                try {
                    if (row.authorization && canCarry(row.authorization, target, taskId) !== true) continue;
                    const { authorization, terminal: ended, sessionId, targetKey, expectedLayout, ...publicRow } = row;
                    operations.push(copyJson({ ...publicRow, ...(row.executedSteps ? { executedSteps: row.executedSteps.map(step => ({ ...step,
                        ...(step.proposalStepId ? { referenceState: row.stepReference.referenceState } : {}) })) } : {}) }));
                } catch { /* Fail closed, observer has no dispatch authority. */ }
            }
            return { operations, omittedOperations: omitted, notice: 'Historical action observations, not permission or current state. Explicit step associations are model proposals, not verified user intent or step completion; absent associations remain unmapped. Actual bundle steps are receipt steps, not plan steps. Unconfirmed/partial/unknown never means success or safe retry. Stale references do not erase historical outcomes. Cancelling a task does not undo dispatched actions.' };
        },
    };
}
