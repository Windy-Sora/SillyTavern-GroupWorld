import { copyJson } from '../../core/json-contract.js';
import { diagnosticPresentation } from '../../config/read-presentation.js';

/** Current conditions only: no inferred execution history or hidden model connectivity claims. */
export function diagnoseMemory(state) {
    const findings = [];
    const add = (kind, code, evidence, knowledge, text) => findings.push({ kind, code, evidence, knowledge, text });
    if (state.memoryEnabled === 'off') add('blocker', 'MEMORY_DISABLED', ['memoryEnabled'], 'memory.automation', '记忆总开关当前关闭；仅能说明当前条件，不证明过去未执行的原因。');
    if (state.autoMemoryEnabled === 'off') add('blocker', 'AUTO_DISABLED', ['autoMemoryEnabled'], 'memory.automation', '自动提取开关当前关闭，仅说明自动提取路径关闭；不代表记忆停止更新，也不证明手动提取是唯一写入途径。');
    if (state.hasGroup === 'off') add('blocker', 'NO_GROUP', ['hasGroup'], 'memory.targets', '当前没有群聊目标；可以查看设置，但不能推定存在待提取成员。');
    else if (state.enabledMembers === 0) add('blocker', 'NO_TARGETS', ['enabledMembers'], 'memory.targets', '当前群聊没有可用成员。');
    if (state.canFinalize === 'off' || state.manualGenerating === 'on') add('condition', 'ROUND_GUARD', ['canFinalize', 'manualGenerating'], 'memory.automation', '当前轮次结束或手动生成条件尚不允许进入自动检查，不是历史失败记录。');
    if (['swipe', 'regenerate'].includes(state.generationType)) add('condition', 'GENERATION_EXCLUDED', ['generationType'], 'memory.automation', '该生成类型不会进入自动记忆提取分支。');
    if (state.messageCount >= 0 && state.baseline >= 0 && state.interval > 0) {
        if (state.messageCount < state.baseline) add('condition', 'COVERAGE_AHEAD', ['messageCount', 'baseline'], 'memory.coverage', '消息数小于覆盖基线，符合删除后计数需调整的条件；本诊断不会修改计数。');
        else if (state.messageCount - state.baseline < state.interval) add('condition', 'INTERVAL_PENDING', ['messageCount', 'baseline', 'interval'], 'memory.coverage', '当前批次消息增量未达到间隔；间隔单位是消息条数。');
        else add('condition', 'BATCH_THRESHOLD_MET', ['messageCount', 'baseline', 'interval'], 'memory.coverage', '当前批次间隔门槛已达到，但不代表已执行、成功或模型连接可用。');
    }
    if (state.members.length) add('condition', 'PER_MEMBER_PROGRESS', ['members', 'messageCount', 'interval'], 'memory.coverage', `逐成员间隔门槛：已达到=${state.members.filter(m => m.intervalStatus === 'met').length}人，未达到=${state.members.filter(m => m.intervalStatus === 'pending').length}人，未知=${state.members.filter(m => m.intervalStatus === 'unknown').length}人。每个成员的结论见逐角色明细。新消息数为当前消息数减去已覆盖消息数，存储记忆条数不参与间隔计算。达到门槛仅表示成员间隔达到，不代表目标已执行；还受批次、开关和过滤条件约束。`);
    if (state.speakersOnly !== 'off') add('unknown', 'TARGET_FILTER_UNKNOWN', ['speakersOnly'], 'memory.targets', '没有读取导演发言历史，不能确定最终过滤目标；不能把所有启用成员视为实际执行名单。');
    if (state.members.some(m => m.intervalStatus === 'pending')) add('condition', 'SKIP_IS_NOT_FAILURE', ['members'], 'memory.coverage', '成员间隔未达到时被跳过，不计入失败，也不阻止批次完成。协调器只以失败列表是否为空判断批次完成。因此不能根据存在未达到间隔的成员推断当前批次未完成；是否实际执行或完成仍未知。');
    if (['memoryEnabled', 'autoMemoryEnabled', 'canFinalize', 'manualGenerating', 'generationType'].some(k => state[k] === 'unknown') || ['interval', 'messageCount', 'baseline', 'enabledMembers'].some(k => state[k] < 0) || state.members.some(m => m.memoryCount < 0 || m.covered < 0 || m.intervalStatus === 'unknown')) add('unknown', 'STATE_INCOMPLETE', [], 'memory.automation', '部分状态不可得或格式不受支持，不能据此判断完整执行条件。');
    add('unknown', 'HISTORY_UNKNOWN', [], 'memory.targets', '未提供历史执行记录、模型连接状态和保存结果，无法确定上一次没有提取的实际原因。');
    return copyJson({ version: 1, evidenceComplete: false, state, presentation: diagnosticPresentation(state), findings, navigation: 'memory-settings', scopeNotice: '功能设置影响所有聊天；记忆与覆盖进度属于当前聊天。本报告只读。' });
}
