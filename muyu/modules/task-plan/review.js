/** A proposal finishes only the planning segment, before any planned work runs. */
export const taskPlanReviewPort = Object.freeze({
    isControl: call => call.toolId === 'muyu.task.plan',
    read(call, result) {
        if (call.toolId !== 'muyu.task.plan' || !result.ok || typeof result.data?.candidateId !== 'string') return null;
        return '已提出任务方案。资料读取须按方案授权；方案本身不批准修改或代码执行。';
    },
});
