/** Run cleanup never retires task execution; only this owner's task IDs are released. */
export function createExecutionTasks(port) {
    const owned = new Set();
    return Object.freeze({
        track(taskId) { owned.add(taskId); },
        prepare(args, context) {
            // Track before preparation: a port may allocate before throwing.
            owned.add(context.taskId);
            return port.prepareExecution(args, context);
        },
        forget(taskId) {
            if (!owned.has(taskId)) return;
            port?.forgetExecutions?.(taskId);
            owned.delete(taskId);
        },
        clear() {
            const errors = [];
            for (const taskId of owned) try { this.forget(taskId); } catch (error) { errors.push(error); }
            if (errors.length) throw new AggregateError(errors, 'EXECUTION_TASK_CLEANUP_FAILED');
        },
    });
}
