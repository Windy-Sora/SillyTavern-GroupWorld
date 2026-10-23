// Result interpretation belongs to the module, not the arbitrary script output.
// These facts do not inspect or certify user-code side effects.
export const SCRIPT_EXECUTION_GUIDANCE = '解释执行结果：completed只证明函数返回，text是脚本返回值，不是独立状态读取或保存确认。任何计数、自定义设置写入都是副作用；未合并自动回合状态不等于无副作用。不得建议或调用再次执行（含新任务、新票据、全权限）来验证保存，数值累加或稍后仍可读取都不证明落盘。核验只能使用已存在的独立只读接口，先查目录确认目标字段支持；脚本可访问settings不代表settings.read能读任意键，未接入就说明无法核实，不承诺能读。保存未知时不要建议刷新、重载或重新应用来验证，这可能丢失未保存内容。not_started仅说明此次未启动，不证明当前值未被其他操作改变。报告实际结果，别从返回值倒推未读取的起始值，默认值、假值和类型转换会使这种倒推不唯一。';

export function scriptExecutionEvidence(result) {
    return {
        ...result,
        evidence: {
            execution: result.status === 'completed' ? 'function_returned' : result.status === 'not_started' ? 'this_invocation_not_started' : 'outcome_unknown',
            returnedText: 'untrusted_script_return_not_independent_state_read',
            currentValues: 'not_independently_read',
            priorValues: 'not_observed; defaults, falsy values and type coercion prevent unique reconstruction. Do not infer starting values from returned data.',
            persistence: 'not_verified',
            sideEffects: 'not_audited; counter/settings mutations count as side effects',
            verification: 'Do not rerun this script to verify saving, including via a new ticket/task. Do not suggest refresh/reload/reapply with unknown persistence: unsaved data could be lost. Check supported-field/source catalogs before proposing independent read tools; unsupported custom keys cannot be promised readable. Retained memory values do not prove durable storage.',
        },
    };
}
