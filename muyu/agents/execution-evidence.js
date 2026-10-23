// Module-owned evidence, never derived from the generated text or schema examples.
export const AGENT_EXECUTION_GUIDANCE = '结果解释：text仅为模型输出，不是独立读取的当前账目；未保存不证明当前值不是输出值，未知不能说成否定。Schema未执行校验，不是校验失败；定义中的示例不是默认值。未审计是没有进行副作用审计，不是审计后未发现。调用阶段或返回内容不证明已计费，无账单只说可能产生费用。saved_unconfirmed确认当时已赋值内存，不只是开始写入；未确认落盘不表示仍在保存，不推测等待或界面稳定可补齐确认。保存未确认时不得建议刷新、切聊天、重载、重跑（含新任务／票据）或重新应用来验证，可能丢失未保存内容；先复制保留输出，仅使用目录中确实支持的独立只读证据，当前内存或界面可见不证明落盘。不依据占位符名字推断渲染错误。拒绝后本次交互结束，不承诺旧按钮可恢复，不重复申请或换票据绕过；只有用户另行明确要求新执行，才按当时版本与权限重新处理。';

export function agentExecutionEvidence(result) {
    return { ...result, schemaValidation: 'not_performed', evidence: {
        execution: result.status === 'saved_unconfirmed' ? 'memory_result_assigned_at_execution_time; durable_save_not_verified_not_necessarily_pending' : result.status === 'trial_completed' ? 'trial_output_returned_without_controlled_result_write' : result.status === 'not_started' ? 'this_invocation_not_started' : 'no_confirmed_success; consult_status_and_phase_flags',
        generatedText: 'untrusted_model_output_not_independent_state_read',
        currentValues: 'not_independently_read; neither equality nor inequality with output is established',
        schema: 'not_performed; schemaValidated=false does not mean validation failed; schema examples are not runtime defaults',
        billing: 'not_verified; modelCallAttempted and returned output are not billing receipts',
        sideEffects: 'not_audited; trial omits controlled result write, not Provider side effects',
        persistence: 'not_verified; memory assignment, visible UI and retained values do not prove durable storage',
        interpretation: AGENT_EXECUTION_GUIDANCE,
    } };
}
