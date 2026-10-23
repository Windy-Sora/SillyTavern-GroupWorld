// Shared observation DTO, independent of any concrete model adapter.
// Locally chosen tags only. Never carry provider content, errors or reasoning.
export const MODEL_STAGE_LABELS = Object.freeze({
    prepare: Object.freeze(['请求准备', 'Request preparation']),
    transport: Object.freeze(['网络传输与响应解析', 'Transport and response parsing']),
    decode: Object.freeze(['响应协议校验', 'Response protocol validation']),
    history: Object.freeze(['思考回传状态校验', 'Thinking replay state validation']),
    emit: Object.freeze(['响应事件交付', 'Response event delivery']),
    runtime: Object.freeze(['运行事件校验', 'Runtime event validation']),
});
export const modelDiagnosticStage = value => typeof value === 'string' && Object.hasOwn(MODEL_STAGE_LABELS, value) ? value : null;
