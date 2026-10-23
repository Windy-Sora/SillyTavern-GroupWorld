import { copyJson } from '../../core/json-contract.js';
const documents = [
    { id: 'director.modes', version: 1, title: '导演模式与发言人数', scope: 'global-settings/current-chat', source: 'settings.js; index.js; systems/speaker-selection.js', text: 'mode为off/formula/llm。off表示不启用导演筛选；公式模式使用topN，LLM模式使用llmMaxSpeakers。两个人数设置不能互相混用。成员是否禁用也影响可用范围。当前配置只描述读取时刻，不证明某次历史选人原因；没有对应记录就应说明无法确定。只读检查不重新评分，不触发选人或生成。' },
    { id: 'director.scoring', version: 1, title: '公式规则与证据边界', scope: 'global-settings', source: 'systems/speaker-selection.js; systems/trigger-initiative.js', text: '公式评分包含提及、近期发言间隔、话多程度、连续发言惩罚、触发与主动性。连续发言惩罚按连续消息计数。triggerScore影响已触发角色的加分；主动性由运行系统维护，不应仅用开关推断每个角色的当前值。评分依赖实际消息和角色数据；本工具不读取这些正文、不提供逐角色得分，也不将当前重算当成过去的评分。' },
    { id: 'director.history', version: 1, title: '历史记录与执行状态', scope: 'current-chat', source: 'systems/history-system.js; systems/round-orchestrator.js; systems/llm-speaker-state.js', text: '导演历史可能包含speakers、reason、剧本和自由账本。历史可编辑、可清空并按聊天消息修剪；记录存在不证明生成或保存成功。历史结构概况仅提供条目数量、最后条目的发言者数量、reason字段是否存在和消息长度锚点，不提供名称、原因文本、剧本、账本或消息正文。lastChatLength来自最后一条记录的_chatLength，是历史锚点，不是当前聊天总长度，也不代表当时模型实际看到了哪些消息；即使小于当前窗口配置，也不能断言完整覆盖或排除截断。lastSpeakerCount与当前llmMaxSpeakers相同，只能描述数值一致，不能证明当时配置相同、拉满上限或解释选择原因。运行中的接管剩余数量、等待/失败标志只描述当前内存快照，不是完整历史日志。swipe/regenerate有复用或放行规则，不能一概认定为新的导演决策。未知或缺失数据必须标为未知。' },
];
export const listDirectorKnowledge = () => documents.map(({ text, ...d }) => copyJson(d));
export const directorDocument = id => { const d = documents.find(d => d.id === id); return d ? copyJson(d) : null; };
