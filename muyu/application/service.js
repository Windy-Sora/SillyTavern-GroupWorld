import { randomUUID } from '../runtime/crypto.js';
import { copyJson, jsonKey } from '../core/json-contract.js';
import { copyModelText } from '../core/model-message.js';
import { HISTORY_LIMITS } from '../sessions/contract.js';
import { createRunState } from '../core/run-state.js';
import { createWorkspace } from '../workspace/store.js';
import { createProcessStore } from './process-store.js';
import { selectHistory } from '../sessions/contract.js';
import { createInteractionStore } from '../interactions/store.js';
import { describeAnswer, validateAnswer } from '../interactions/contract.js';
import { permissionAnswer, permissionTitle, permissionSource } from '../permissions/contract.js';
import { interactionLimit } from '../interactions/limits.js';

/** Trusted application facade. startRun must expose completion AND physical drained promises. */
export function createApplication({ startRun, currentTarget, maxQueue = 8, maxSessions = 16, maxTasks = 128, maxRuns = 128, workspaceOptions } = {}) {
    if (typeof startRun !== 'function') throw new TypeError('Missing run factory');
    for (const n of [maxQueue, maxSessions, maxTasks, maxRuns]) if (!Number.isSafeInteger(n) || n < 1) throw new TypeError('Invalid application limit');
    const sessions = new Map(), tasks = new Map(), runs = new Map(), listeners = new Set(), queue = [], resumes = new Map();
    const workspace = createWorkspace(workspaceOptions);
    const interactions = createInteractionStore();
    const processes = createProcessStore({ maxRuns: Math.min(maxRuns, 1024) });
    let target = currentTarget == null ? null : copyJson(currentTarget), active = null, disposed = false, cursor = 0, scheduled = false, targetEpoch = 0;
    const nextId = prefix => prefix + ':' + randomUUID();
    const live = () => { if (disposed) throw new Error('APPLICATION_DISPOSED'); };
    const session = id => { const s = sessions.get(id); if (!s || s.closed) throw new Error('SESSION_CLOSED'); return s; };
    const task = id => { const t = tasks.get(id); if (!t) throw new Error('TASK_NOT_FOUND'); session(t.sessionId); return t; };
    const isCurrent = value => value.kind === 'global' || (target !== null && jsonKey(value) === jsonKey(target));
    const unfinished = r => ['queued', 'running', 'cancelling'].includes(r.status);
    const dropResume = taskId => { const resume = resumes.get(taskId); resumes.delete(taskId); try { resume?.dispose(); } catch { /* Cleanup only. */ } };
    function snapshot() {
        return structuredClone({ cursor, disposed, activeRunId: active?.id ?? null, draining: !!active?.completed,
            sessions: [...sessions.values()], tasks: [...tasks.values()], interactions: interactions.list(), runs: [...runs.values()].map(r => ({ ...r, process: processes.snapshot(r.id) })), artifacts: workspace.list() });
    }
    function emit(type, ids = {}) {
        const event = { cursor: ++cursor, type, ...ids };
        // Capture recipients at publish time: subscribe's snapshot already contains older events.
        const recipients = [...listeners];
        queueMicrotask(() => { for (const l of recipients) if (listeners.has(l)) { try { l(structuredClone(event)); } catch { /* View failure is isolated. */ } } });
    }
    function schedule() {
        if (disposed || scheduled) return;
        scheduled = true; queueMicrotask(() => { scheduled = false; pump(); });
    }
    function settle(record, status, error, answer = null) {
        record.status = status; record.error = error;
        processes.lifecycle(record.id, status, error);
        if (active?.id !== record.id) processes.lifecycle(record.id, 'cleaned');
        const s = sessions.get(record.sessionId);
        if (!s.closed) {
            if (answer !== null) { record.answeredAt = Date.now(); s.messages.push({ role: 'assistant', runId: record.id, content: answer }); }
            const t = tasks.get(record.taskId); t.status = status === 'yielded' ? 'awaiting_input' : status === 'succeeded' ? 'awaiting_acceptance' : 'open';
        }
        emit('run.settled', { runId: record.id });
    }
    function pump() {
        if (disposed || active) return;
        while (queue.length) {
            const record = runs.get(queue.shift());
            if (record.status !== 'queued') continue;
            if (sessions.get(record.sessionId).closed || !isCurrent(record.target)) { settle(record, 'cancelled', 'TARGET_UNAVAILABLE'); continue; }
            record.status = 'running'; tasks.get(record.taskId).status = 'running';
            processes.lifecycle(record.id, 'running');
            const lease = { id: record.id, handle: null, completed: false, drained: false }; active = lease;
            const startedTargetEpoch = targetEpoch;
            emit('run.started', { runId: record.id });
            try {
                const resume = resumes.get(record.taskId) || null;
                lease.handle = startRun({ identity: { id: record.id, sessionId: record.sessionId, taskId: record.taskId, target: copyJson(record.target) },
                    input: record.input, previousMessages: selectHistory(sessions.get(record.sessionId).messages.slice(0, -1)).messages,
                    resume,
                    taskContext: { goal: copyModelText(tasks.get(record.taskId).goal), constraints: copyJson(tasks.get(record.taskId).constraints) },
                    onEvent: event => {
                        if (disposed || lease.completed || record.status !== 'running' || sessions.get(record.sessionId).closed) return;
                        // Notifications only; model text cannot mutate task/artifact or application status.
                        if (event.runId === record.id) {
                            processes.event(record.id, event);
                            if (event.type !== 'model.delta') emit('run.progress', { runId: record.id });
                        }
                    } });
                if (resume) resumes.delete(record.taskId);
            } catch { dropResume(record.taskId); active = null; settle(record, 'failed', 'START_FAILED'); continue; }
            const release = () => {
                if (active === lease && lease.completed && lease.drained) { processes.lifecycle(record.id, 'cleaned'); active = null; if (!disposed) { emit('queue.released', { runId: record.id }); schedule(); } }
            };
            Promise.resolve(lease.handle.completion).then(result => {
                if (lease.completed) return;
                lease.completed = true;
                if (!disposed) {
                    if (record.status === 'cancelling' || sessions.get(record.sessionId).closed) {
                        try { result?.resume?.dispose(); } catch { /* Cleanup only. */ }
                        settle(record, 'cancelled', 'CANCELLED');
                    }
                    else {
                        let status = ['succeeded', 'failed', 'cancelled', 'interrupted', 'yielded'].includes(result?.state?.status) ? result.state.status : 'failed';
                        let settlementError = null;
                        if (status === 'yielded') {
                            const t = tasks.get(record.taskId);
                            try {
                                const permission = result.interaction?.kind === 'permission';
                                if (!isCurrent(record.target) || startedTargetEpoch !== targetEpoch) throw Error('TARGET_UNAVAILABLE');
                                const limit = interactionLimit(t, result.interaction);
                                if (limit) throw Error(limit);
                                if (result.resume && result.interaction?.kind !== 'permission') throw Error('INVALID_CONTINUATION');
                                interactions.create({ sessionId: record.sessionId, taskId: record.taskId, runId: record.id, target: record.target },
                                    permission ? { ...result.interaction, hostManaged: !!result.resume } : result.interaction);
                                if (result.resume) resumes.set(record.taskId, result.resume);
                                t.interactionCount = (t.interactionCount || 0) + 1;
                                if (!permission) t.clarifications = (t.clarifications || 0) + 1;
                                else { const counter = permissionSource(result.interaction.source)?.permission === 'code' ? 'codePermissions' : 'readPermissions'; t[counter] = (t[counter] || 0) + 1; }
                            } catch (error) { status = 'failed'; settlementError = ['PERMISSION_LIMIT', 'CLARIFICATION_LIMIT', 'TARGET_UNAVAILABLE', 'INVALID_CONTINUATION'].includes(error?.message) ? error.message : null; }
                        }
                        let answer = null;
                        if (['succeeded', 'yielded'].includes(status) && typeof result.answer === 'string') { try { answer = copyModelText(result.answer); } catch { /* Reject oversized result. */ } }
                        const successful = ['succeeded', 'yielded'].includes(status) && answer !== null;
                        if (!successful) {
                            interactions.invalidate(r => r.runId === record.id);
                            if (result?.resume) {
                                if (resumes.get(record.taskId) === result.resume) dropResume(record.taskId);
                                else { try { result.resume.dispose(); } catch { /* Cleanup only. */ } }
                            }
                        }
                        settle(record, ['succeeded', 'yielded'].includes(status) && !successful ? 'failed' : status, successful ? null : settlementError || 'RUN_ENDED', answer);
                    }
                } else {
                    try { result?.resume?.dispose(); } catch { /* Cleanup only. */ }
                }
                release();
            }, () => { lease.completed = true; if (!disposed) settle(record, record.status === 'cancelling' ? 'cancelled' : 'failed', record.status === 'cancelling' ? 'CANCELLED' : 'RUN_FAILED'); release(); });
            // Unknown or rejected drain never unlocks the global execution slot.
            if (lease.handle.drained && typeof lease.handle.drained.then === 'function') Promise.resolve(lease.handle.drained).then(() => { lease.drained = true; release(); }, () => { if (!disposed) emit('queue.blocked'); });
            return;
        }
    }
    function cancel(runId) {
        const r = runs.get(runId); if (!r || !unfinished(r)) return;
        if (r.status === 'queued') { queue.splice(queue.indexOf(runId), 1); dropResume(r.taskId); settle(r, 'cancelled', 'CANCELLED'); schedule(); }
        else { r.status = 'cancelling'; processes.lifecycle(runId, 'cancelling'); try { active?.handle?.cancel(); } catch { /* Hold lease until actual drain. */ } emit('run.cancelling', { runId }); }
    }
    function enqueue(t, input, answerId = null, displayInput = input) {
        const s = session(t.sessionId);
        if (interactions.list().some(r => r.sessionId === s.id && r.status === 'pending' && r.id !== answerId)) throw Error('INTERACTION_PENDING');
        if ([...runs.values()].some(r => r.sessionId === s.id && unfinished(r)) || (active && runs.get(active.id).sessionId === s.id)) throw new Error('SESSION_BUSY');
        if (queue.length >= maxQueue) throw new Error('QUEUE_FULL');
        if (runs.size >= maxRuns) throw new Error('RUN_CAPACITY');
        if (typeof input !== 'string' || !input.trim()) throw new TypeError('Missing input'); copyModelText(input);
        if (typeof displayInput !== 'string' || !displayInput.trim()) throw new TypeError('Invalid display input');
        copyModelText(displayInput);
        const id = nextId('run');
        const r = { id, sessionId: s.id, taskId: t.id, target: copyJson(s.target), input, status: 'queued', error: null };
        runs.set(id, r); processes.create(id); queue.push(id); t.status = 'queued'; s.messages.push({ role: 'user', runId: id, content: displayInput });
        emit('run.queued', { runId: id }); schedule(); return id;
    }
    function ownedArtifact(id) { const a = workspace.get(id); task(a.taskId); return a; }
    return Object.freeze({
        createSession(scope, history = []) {
            live(); if (sessions.size >= maxSessions) throw new Error('SESSION_CAPACITY');
            if (!Array.isArray(history) || history.length > HISTORY_LIMITS.messages) throw Error('HISTORY_CAPACITY');
            const messages = history.map(m => {
                if (!['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || typeof m.runId !== 'string') throw Error('HISTORY_INVALID');
                return { role: m.role, content: copyModelText(m.content), runId: copyJson(m.runId) };
            });
            const id = nextId('session'); const valid = createRunState({ id: 'check', sessionId: id, taskId: 'check', target: scope }).target;
            sessions.set(id, { id, target: valid, closed: false, messages }); emit('session.created', { sessionId: id }); return id;
        },
        submit(sessionId, goal, constraints = []) {
            live(); session(sessionId); if (tasks.size >= maxTasks) throw new Error('TASK_CAPACITY');
            if (interactions.list().some(r => r.sessionId === sessionId && r.status === 'pending')) throw Error('INTERACTION_PENDING');
            const c = copyJson(constraints); if (!Array.isArray(c) || c.some(v => typeof v !== 'string')) throw new TypeError('Invalid constraints');
            const t = { id: nextId('task'), sessionId, goal, constraints: c, status: 'open' };
            const runId = enqueue(t, goal); tasks.set(t.id, t); return { taskId: t.id, runId };
        },
        continueTask(taskId, input) { live(); const t = task(taskId); if (t.status === 'completed') throw new Error('TASK_COMPLETED'); if (t.status === 'awaiting_input') throw Error('INTERACTION_PENDING'); return enqueue(t, input); },
        setInteractionDraft(id, value) { live(); interactions.draft(id, value); emit('interaction.changed'); },
        answerInteraction(id, answer) {
            live(); const r = interactions.get(id), t = task(r.taskId);
            if (r.kind !== 'clarification' || !isCurrent(r.target) || t.status !== 'awaiting_input') throw Error('INTERACTION_STALE');
            const text = describeAnswer(r, validateAnswer(answer));
            const runId = enqueue(t, text, id, answer);
            interactions.resolve(id, 'answered');
            t.constraints.push(text); // Bounded (three answers); survives history trimming, never authorization.
            emit('interaction.changed'); return { taskId: t.id, runId };
        },
        answerPermission(id, decision) {
            live(); const r = interactions.get(id), t = task(r.taskId);
            if (r.kind !== 'permission' || !isCurrent(r.target) || t.status !== 'awaiting_input') throw Error('INTERACTION_STALE');
            const text = permissionAnswer(r, decision);
            const label = decision === 'deny' ? '拒绝读取 / Read denied' : decision === 'task' ? '允许本任务 / Allow task' : '允许此聊天 / Allow chat';
            const runId = enqueue(t, text, id, `${label}: ${r.source === 'providerExecution' ? `${r.providerId} (${r.providerRevision})` : permissionTitle(r.source)}`);
            interactions.resolve(id, decision === 'deny' ? 'denied' : 'granted');
            t.constraints.push(text);
            emit('interaction.changed'); return { taskId: t.id, runId };
        },
        cancelInteraction(id) { live(); const r = interactions.get(id); dropResume(r.taskId); interactions.resolve(id, 'cancelled'); task(r.taskId).status = 'open'; emit('interaction.changed'); },
        invalidateInteractions(sessionId = null) { live(); for (const r of interactions.list()) if (r.status === 'pending' && (sessionId === null || r.sessionId === sessionId)) dropResume(r.taskId); interactions.invalidate(r => sessionId === null || r.sessionId === sessionId); emit('interaction.changed'); },
        completeTask(taskId) { live(); const t = task(taskId); if (['queued', 'running', 'awaiting_input'].includes(t.status) || active && runs.get(active.id).taskId === t.id) throw new Error('TASK_BUSY'); t.status = 'completed'; emit('task.completed', { taskId }); },
        cancel(runId) { live(); cancel(runId); },
        closeSession(id) { live(); const s = session(id); s.closed = true; for (const r of interactions.list()) if (r.sessionId === id) dropResume(r.taskId); interactions.invalidate(r => r.sessionId === id); for (const r of runs.values()) if (r.sessionId === id) cancel(r.id); emit('session.closed', { sessionId: id }); },
        unloadSession(id) {
            live(); session(id);
            if ([...runs.values()].some(r => r.sessionId === id && (unfinished(r) || active?.id === r.id))) throw Error('SESSION_BUSY');
            for (const artifact of workspace.list()) if (artifact.sessionId === id) workspace.delete(artifact.id);
            for (const [key, r] of runs) if (r.sessionId === id) { runs.delete(key); processes.forget(key); }
            for (const [key, t] of tasks) if (t.sessionId === id) { dropResume(key); tasks.delete(key); }
            sessions.delete(id); emit('session.unloaded', { sessionId: id });
            interactions.forget(id);
        },
        changeTarget(value) { live(); const next = value === null ? null : createRunState({ id: 'check', sessionId: 'check', taskId: 'check', target: value }).target; if (jsonKey(next) !== jsonKey(target)) { targetEpoch++; for (const r of interactions.list()) if (r.status === 'pending') dropResume(r.taskId); interactions.invalidate(() => true); } target = next; for (const r of runs.values()) if (!isCurrent(r.target)) cancel(r.id); emit('target.changed'); },
        snapshot,
        subscribe(listener) {
            live(); if (typeof listener !== 'function') throw new TypeError('Invalid listener');
            const subscription = event => listener(event); listeners.add(subscription);
            return { snapshot: snapshot(), cursor, unsubscribe: () => listeners.delete(subscription) };
        },
        createArtifact({ taskId, sourceRunId = null, kind, content }) {
            live(); const t = task(taskId);
            if (sourceRunId !== null) { const r = runs.get(sourceRunId); if (!r || r.taskId !== taskId || r.status !== 'succeeded') throw new Error('INVALID_SOURCE_RUN'); }
            const a = workspace.create({ id: nextId('artifact'), taskId, sessionId: t.sessionId, sourceRunId, kind, content }); emit('artifact.created', { artifactId: a.id }); return a;
        },
        updateArtifact(id, revision, content) { live(); ownedArtifact(id); const a = workspace.update(id, revision, content); emit('artifact.updated', { artifactId: id }); return a; },
        validateArtifact(id, revision, validation) { live(); ownedArtifact(id); const a = workspace.validate(id, revision, validation); emit('artifact.validated', { artifactId: id }); return a; },
        getArtifact(id, revision) { live(); return workspace.get(id, revision); },
        deleteArtifact(id) { live(); ownedArtifact(id); workspace.delete(id); emit('artifact.deleted', { artifactId: id }); },
        dispose() { if (disposed) return; for (const r of runs.values()) cancel(r.id); for (const id of resumes.keys()) dropResume(id); disposed = true; listeners.clear(); workspace.clear(); processes.clear(); interactions.clear(); queue.length = 0; },
    });
}
