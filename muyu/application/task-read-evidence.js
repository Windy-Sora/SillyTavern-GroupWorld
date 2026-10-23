import { randomUUID } from '../runtime/crypto.js';
import { copyJson } from '../core/json-contract.js';
import { createTaskEvidence } from './task-evidence.js';
import { assertPlanSteps } from './task-step-bindings.js';

const tools = new Set(['muyu.settings.read', 'muyu.provider.read', 'muyu.settings.contract', 'muyu.config.contract', 'muyu.settings.catalog', 'muyu.provider.list']);

/** Historical metadata only; neither content cache nor proof of an analysis being complete. */
export function createTaskReadEvidence({ canCarry = () => false } = {}) {
    const seen = new Set(), rows = new Map(); let exhausted = false;
    function allowed(row, target, taskId) { try { return canCarry(row.query, target, taskId) === true; } catch { return false; } }
    return {
        observe(call, result, runId) {
            if (!tools.has(call?.toolId) || call.args?.resultId || typeof call.callId !== 'string' || call.callId.length > 100) return;
            const key = runId + ':' + call.callId;
            if (exhausted || seen.has(key)) return;
            if (seen.size >= 128 || rows.size >= 32) { exhausted = true; return; }
            seen.add(key);
            if (call.toolId === 'muyu.provider.read' && result?.ok === true && result.data?.source !== call.args?.id) return;
            const probe = createTaskEvidence(); probe.observe(call, result, runId);
            const observation = probe.snapshot().observations[0];
            if (!observation || observation.outcome === 'not-established') return;
            const id = 'read-evidence:' + randomUUID();
            rows.set(id, { id, capturedAt: new Date().toISOString(), observation,
                query: copyJson({ toolId: call.toolId, args: call.args || {} }), binding: null });
        },
        bind(args, plan, target, taskId) {
            assertPlanSteps(args, plan, ['read']);
            const row = rows.get(args.evidenceId);
            if (!row || !allowed(row, target, taskId)) throw Error('READ_EVIDENCE_UNAVAILABLE');
            const binding = { planArtifactId: plan.artifactId, planRevision: plan.artifactRevision, stepIds: [...args.stepIds],
                association: 'model-proposed', intentVerification: 'not-assessed', referenceState: 'current' };
            if (row.binding && JSON.stringify(row.binding) !== JSON.stringify(binding)) throw Error('STEP_BINDING_CONFLICT');
            row.binding = binding;
            return { bound: true, notice: 'Historical read evidence association only; no permission or step/analysis completion.' };
        },
        retainPlan(plan) {
            for (const row of rows.values()) if (row.binding && (plan?.referenceState !== 'published' || row.binding.planArtifactId !== plan.artifactId || row.binding.planRevision !== plan.artifactRevision)) row.binding.referenceState = 'stale';
        },
        project(target, taskId) {
            const evidence = [];
            for (const row of rows.values()) if (allowed(row, target, taskId)) {
                const { query, ...metadata } = row; evidence.push(copyJson(metadata));
            }
            return { evidence, captureCapacityReached: exhausted,
                notice: 'Historical read metadata, not content, current facts, permission, analysis adequacy or step completion. Catalog/contract/empty/directory/page/failure outcomes are distinct; pages do not prove complete coverage. Step associations are model proposals; stale references never rebind.' };
        },
    };
}
