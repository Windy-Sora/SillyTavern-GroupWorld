import { copyJson } from '../core/json-contract.js';
import { taskBundleLayout } from '../modules/task-bundle/steps.js';

const tools = Object.freeze({
    'muyu.config.preview': { kind: 'config-draft', steps: ['settings'] },
    'muyu.settings.preview': { kind: 'config-draft', steps: ['settings'] },
    'muyu.variables.preview': { kind: 'variable-draft', steps: ['variables'] },
    'muyu.task.preview': { kind: 'task-bundle', steps: ['settings', 'variables', 'code'] },
});

export function assertPlanSteps(args, plan, allowedKinds) {
    if (!plan || plan.referenceState !== 'published' || plan.readScopeReview !== 'approved-read-only' ||
        plan.artifactId !== args.planArtifactId || plan.artifactRevision !== args.planRevision ||
        !Array.isArray(args.stepIds) || !args.stepIds.length || args.stepIds.length > 8 || new Set(args.stepIds).size !== args.stepIds.length ||
        args.stepIds.some(id => !plan.steps.some(step => step.id === id && allowedKinds.includes(step.kind)))) throw Error('INVALID_STEP_BINDING');
}

const proposalKind = kind => ({ variable: 'variables', settings: 'settings', script: 'code' })[kind];

/** Model-proposed association, never user-intent verification or execution authority. */
export function createStepBindings() {
    const candidates = new Map(), bindings = new Map(), seen = new Set(); let epoch = 0, stopped = false;
    const key = (toolId, id) => toolId + ':' + id;
    return {
        observe(call, result, runId) {
            if (!tools[call.toolId] || result?.ok !== true || typeof result.data?.candidateId !== 'string' || !result.data.candidateId) return;
            const observation = runId + ':' + call.callId;
            if (stopped || seen.has(observation)) return;
            if (seen.size >= 128) { candidates.clear(); bindings.clear(); stopped = true; return; }
            seen.add(observation);
            const id = key(call.toolId, result.data.candidateId);
            if (!candidates.has(id) && candidates.size >= 128) return;
            const rawSteps = result.data.steps;
            const steps = call.toolId === 'muyu.task.preview' && Array.isArray(rawSteps) && rawSteps.length <= 10 &&
                rawSteps.every((row, index) => row?.id === result.data.candidateId + ':step:' + (index + 1) && row.displayIndex === index + 1 && ['variable', 'settings', 'script'].includes(row.kind)) ? rawSteps : [];
            candidates.set(id, { epoch: ++epoch, steps: copyJson(steps) });
            // Reused candidate IDs must be explicitly rebound after replacement.
            bindings.delete(id);
        },
        bind(args, plan, activeCandidates) {
            assertPlanSteps(args, plan, Object.values(tools).flatMap(tool => tool.steps));
            const active = [...activeCandidates.values()].filter(row => row.candidateId === args.candidateId && tools[row.toolId]);
            if (active.length !== 1) throw Error('INVALID_STEP_CANDIDATE');
            const candidate = active[0], id = key(candidate.toolId, candidate.candidateId), observed = candidates.get(id), generation = observed?.epoch;
            if (!generation || args.stepIds.some(stepId => !plan.steps.some(step => step.id === stepId && tools[candidate.toolId].steps.includes(step.kind)))) throw Error('INVALID_STEP_BINDING');
            const substeps = args.bundleSteps || [];
            if (!Array.isArray(substeps) || substeps.length > 10 || new Set(substeps.map(row => row.bundleStepId)).size !== substeps.length ||
                substeps.length && candidate.toolId !== 'muyu.task.preview' || substeps.some(row => !args.stepIds.includes(row.stepId) ||
                    !observed.steps.some(step => step.id === row.bundleStepId && plan.steps.some(proposed => proposed.id === row.stepId && proposed.kind === proposalKind(step.kind))))) throw Error('INVALID_BUNDLE_STEP_BINDING');
            const binding = { planArtifactId: plan.artifactId, planRevision: plan.artifactRevision, stepIds: [...args.stepIds],
                association: 'model-proposed', intentVerification: 'not-assessed', referenceState: 'candidate', generation,
                ...(substeps.length ? { bundleSteps: copyJson(substeps).sort((a, b) => a.bundleStepId.localeCompare(b.bundleStepId)) } : {}) };
            const previous = bindings.get(id);
            if (previous) {
                if (previous.planArtifactId !== binding.planArtifactId || previous.planRevision !== binding.planRevision ||
                    JSON.stringify(previous.stepIds) !== JSON.stringify(binding.stepIds) || JSON.stringify(previous.bundleSteps) !== JSON.stringify(binding.bundleSteps)) throw Error('STEP_BINDING_CONFLICT');
                return { bound: true, notice: 'Association only; no permission, application or step completion.' };
            }
            if (bindings.size >= 32) throw Error('STEP_BINDING_CAPACITY');
            bindings.set(id, binding);
            return { bound: true, notice: 'Association only; no permission, application or step completion.' };
        },
        publish(published, plan, activeCandidates = null) {
            for (const [id, binding] of bindings) {
                if (binding.referenceState !== 'candidate' || candidates.get(id)?.epoch !== binding.generation || plan?.referenceState !== 'published' ||
                    plan.artifactId !== binding.planArtifactId || plan.artifactRevision !== binding.planRevision) continue;
                const split = id.indexOf(':'); const toolId = id.slice(0, split), candidateId = id.slice(split + 1);
                if (activeCandidates) {
                    const active = [...activeCandidates.values()].filter(row => row.candidateId === candidateId);
                    if (active.length !== 1 || active[0].toolId !== toolId) continue;
                }
                const artifact = published.get(candidateId);
                if (!artifact || artifact.kind !== tools[toolId].kind) continue;
                if (binding.bundleSteps) {
                    const layout = taskBundleLayout(artifact.content), observed = candidates.get(id).steps;
                    if (!layout || layout.length !== observed.length || layout.some((step, i) => step.kind !== observed[i].kind || observed[i].displayIndex !== i + 1)) continue;
                    binding.bundleSteps = binding.bundleSteps.map(row => ({ ...row, displayIndex: observed.find(step => step.id === row.bundleStepId).displayIndex }));
                }
                binding.artifactId = artifact.id; binding.artifactRevision = artifact.revision; binding.referenceState = 'published';
            }
        },
        forArtifact(artifact) {
            const values = [...bindings.values()].filter(row => row.referenceState === 'published' && row.artifactId === artifact?.id && row.artifactRevision === artifact?.revision);
            if (values.length !== 1) return null;
            const { generation, ...result } = values[0]; return copyJson(result);
        },
        retain(plan, artifacts = null) {
            for (const binding of bindings.values()) if (plan?.referenceState !== 'published' || plan.artifactId !== binding.planArtifactId || plan.artifactRevision !== binding.planRevision ||
                artifacts && binding.artifactId && !artifacts.some(a => a.id === binding.artifactId && a.revision === binding.artifactRevision)) binding.referenceState = 'stale';
        },
    };
}
