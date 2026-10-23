import { randomUUID } from '../runtime/crypto.js';
import { copyJson, jsonKey } from '../core/json-contract.js';
import { createTaskEvidence } from './task-evidence.js';
import { createReadReferences } from './read-references.js';
import { createTaskOperations } from './task-operations.js';
import { createStepBindings } from './task-step-bindings.js';
import { createTaskReadEvidence } from './task-read-evidence.js';

const statuses = new Set(['succeeded', 'yielded', 'failed', 'cancelled', 'interrupted']);
const kinds = new Set(['read', 'settings', 'variables', 'blueprint', 'resource', 'code', 'other']);
const note = 'Host task observation, not permission or an executable checkpoint. Segments ending and answers finishing do not establish goal or step completion. A published plan remains a model proposal; stable step IDs identify its displayed order, not verified user intent. Read-scope approval grants no writes. Evidence describes past observations, not current values; use original results and independent operation receipts. No inference of step completion, persistence or cancellation of already dispatched operations is made here.';

/** Connection-local bounded ownership and historical result transport; no approval/dispatch authority. */
export function createTaskStateStore({ capacity = 8, canCarry = () => false, canCarryReceipt = () => false } = {}) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 32) throw TypeError('Invalid task state capacity');
    const tasks = new Map();
    const owner = identity => jsonKey({ sessionId: identity.sessionId, taskId: identity.taskId, target: identity.target });
    function entry(identity) { const value = tasks.get(identity.taskId); return value?.owner === owner(identity) ? value : null; }
    function snapshot(value) {
        return { ...value.evidence.snapshot(), scope: 'connection-local-task', taskState: {
            taskId: value.taskId, segmentCount: value.segments, executionPhase: value.phase,
            goalCompletion: 'not-assessed', ...(value.plan ? { plan: copyJson(value.plan) } : {}),
        } };
    }
    return {
        begin(identity) {
            let value = entry(identity);
            if (!value && tasks.has(identity.taskId)) return null; // Never inherit a foreign target/session.
            if (!value) {
                if (tasks.size >= capacity) {
                    const disposable = [...tasks].find(([, row]) => !row.operations.hasActive() && !['running', 'waiting-user', 'awaiting-read-review'].includes(row.phase));
                    if (!disposable) return null; // Caller keeps isolated trajectory evidence instead.
                    tasks.delete(disposable[0]);
                }
                value = { owner: owner(identity), taskId: identity.taskId, sessionId: identity.sessionId, target: copyJson(identity.target),
                    evidence: createTaskEvidence(), references: createReadReferences({ canCarry }), operations: createTaskOperations({ canCarry: canCarryReceipt }),
                    bindings: createStepBindings(), reads: createTaskReadEvidence({ canCarry }), runIds: new Set(), runId: null, segments: 0, phase: 'running', plan: null };
                value.port = {
                    observe: (...args) => {
                        if (tasks.get(value.taskId) !== value || args[2] !== value.runId) return;
                        value.evidence.observe(...args); value.references.observe(...args, value.segments);
                        value.bindings.observe(...args);
                        value.reads.observe(...args);
                    },
                    project: () => tasks.get(value.taskId) === value ? [{ role: 'user', content: note + ' ' + (value.evidence.project()[0]?.content.split('\n')[0] || '') + '\n' +
                        JSON.stringify({ ...snapshot(value), priorReadReferences: value.references.project(value.segments, value.target, value.taskId),
                            actionEvidence: value.operations.project(value.target, value.taskId), readEvidence: value.reads.project(value.target, value.taskId) }) }] : [],
                };
                tasks.set(identity.taskId, value);
            }
            if (value.runId !== identity.id) { value.runId = identity.id; if (value.runIds.size < 128) value.runIds.add(identity.id); value.segments++; value.phase = 'running'; }
            return value.port;
        },
        settle(identity, status) {
            const value = entry(identity);
            if (!value || value.runId !== identity.id || !statuses.has(status)) return;
            value.phase = status === 'succeeded' ? 'segment-ended' : status === 'yielded' ? 'waiting-user' : status;
        },
        publishPlan(identity, artifact) {
            const value = entry(identity), steps = artifact?.content?.plan?.steps;
            if (!value || value.runId !== identity.id || artifact?.kind !== 'task-plan' || artifact.taskId !== identity.taskId ||
                artifact.sourceRunId !== identity.id || artifact.sessionId !== identity.sessionId || jsonKey(artifact.content.target) !== jsonKey(identity.target) ||
                !Number.isInteger(artifact.revision) || !Array.isArray(steps) || !steps.length || steps.length > 8 || steps.some(step => !kinds.has(step.kind))) return;
            if (value.plan?.artifactId === artifact.id && value.plan.artifactRevision === artifact.revision) return;
            value.plan = { artifactId: artifact.id, artifactRevision: artifact.revision, referenceState: 'published', intent: 'model-proposal', readScopeReview: 'pending',
                steps: steps.map((step, index) => ({ id: 'step:' + randomUUID(), displayIndex: index + 1, kind: step.kind, status: 'not-assessed' })) };
            value.operations.retainPlan(value.plan);
            value.bindings.retain(value.plan);
            value.reads.retainPlan(value.plan);
            value.phase = 'awaiting-read-review';
        },
        reviewPlan(artifact, decision) {
            const value = tasks.get(artifact?.taskId);
            if (!value || !['approved-read-only', 'declined'].includes(decision) || value.plan?.referenceState !== 'published' || value.plan.readScopeReview !== 'pending' || value.plan.artifactId !== artifact.id ||
                value.plan.artifactRevision !== artifact.revision || jsonKey(value.target) !== jsonKey(artifact.content?.target)) return;
            value.plan.readScopeReview = decision;
            if (decision === 'declined') value.phase = 'read-plan-declined';
        },
        observeAction(action, artifact, receipt = null) {
            // An already bound action may settle after its artifact is revised/deleted. Never rebind it to the new version.
            if (!artifact || artifact.revision !== action?.revision) {
                for (const value of tasks.values()) if (value.operations.owns(action)) value.operations.observe(action, null, null, receipt);
                return;
            }
            const value = tasks.get(artifact?.taskId);
            if (!value || artifact.sessionId !== value.sessionId || !value.runIds.has(artifact.sourceRunId) ||
                !(jsonKey(action?.target) === jsonKey(value.target) || action?.target?.kind === 'global' && action.target.userKey === value.target.userKey)) return;
            value.operations.observe(action, artifact, value.plan, receipt, value.bindings.forArtifact(artifact));
        },
        bindCandidate(identity, args, activeCandidates) {
            const value = entry(identity);
            if (!value || value.runId !== identity.id || value.phase !== 'running') throw Error('STEP_BINDING_STALE');
            return value.bindings.bind(args, value.plan, activeCandidates);
        },
        bindRead(identity, args) {
            const value = entry(identity);
            if (!value || value.runId !== identity.id || value.phase !== 'running') throw Error('STEP_BINDING_STALE');
            return value.reads.bind(args, value.plan, value.target, value.taskId);
        },
        publishBindings(identity, published, activeCandidates = null) {
            const value = entry(identity);
            if (!value || value.runId !== identity.id) return;
            const owned = new Map([...published].filter(([, artifact]) => artifact.taskId === value.taskId && artifact.sessionId === value.sessionId &&
                value.runIds.has(artifact.sourceRunId)));
            value.bindings.publish(owned, value.plan, activeCandidates);
        },
        forgetTask(id) { tasks.delete(id); },
        invalidateWait(id) { const value = tasks.get(id); if (value && ['waiting-user', 'awaiting-read-review'].includes(value.phase)) value.phase = 'continuation-invalidated'; },
        retainTarget(target) { for (const [id, value] of tasks) if (value.target.kind === 'chat' && jsonKey(value.target) !== jsonKey(target)) tasks.delete(id); },
        retainArtifacts(artifacts) {
            for (const value of tasks.values()) value.operations.retainArtifacts(artifacts);
            for (const value of tasks.values()) if (value.plan && !artifacts.some(a => a.id === value.plan.artifactId && a.revision === value.plan.artifactRevision)) {
                value.plan.referenceState = 'stale';
                if (value.phase === 'awaiting-read-review') value.phase = 'plan-reference-stale';
            }
            for (const value of tasks.values()) value.bindings.retain(value.plan, artifacts);
            for (const value of tasks.values()) value.reads.retainPlan(value.plan);
        },
        forgetSession(id) { for (const [key, value] of tasks) if (value.sessionId === id) tasks.delete(key); },
        clear() { tasks.clear(); },
        snapshot(identity) { const value = entry(identity); return value ? snapshot(value) : null; },
    };
}
