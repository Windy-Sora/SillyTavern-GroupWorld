import { copyJson } from '../../core/json-contract.js';

// Maintained task-sized evidence, not instructions or an executable routing language.
const documents = [
    { id: 'memory.automation', version: 1, source: 'index.js: automatic memory branch; settings.js', scope: 'global-settings/chat-progress', title: '自动提取条件与间隔', text: '自动记忆需要memoryEnabled和autoMemoryEnabled同时启用。autoMemoryInterval按chat.length的消息条数计，不是对话轮数；现有调度以配置值或10作为间隔。自动分支还受轮次结束条件、手动生成状态和生成类型约束，swipe/regenerate不会进入该提取分支。设置影响所有聊天，覆盖进度属于当前聊天。当前开关只能证明现在的配置，不能证明过去某次未执行的原因。达到间隔不等于请求已成功，也不证明模型连接可用。关闭自动提取仅停止这条自动路径，不代表记忆被冻结；手动编辑、导入与提取应分别核对，不能断言只能手动提取。' },
    { id: 'memory.coverage', version: 1, source: 'index.js: runAutoMemoryBatch; systems/auto-memory-coordinator.js', scope: 'current-chat', title: '批次与角色覆盖进度', text: '批次基线优先_autoMemLen，缺失时参考旧_autoCheckLength，普通缺失基线从0判断。先经过批次间隔门槛，再按_autoMemCharLen逐角色跳过尚未达到间隔的目标。首次启用且消息不足时可记录当前长度，删除消息时会重置或夹紧计数；诊断只描述这些规则，不执行修复。成功角色单独保存进度，失败角色可重试。NO_NEW_MEMORIES也会推进覆盖进度，因此记忆数量没增长不必然是失败。跳过未到间隔的成员不算失败，也不阻止批次完成；协调器以failures为空判断complete，批次据此推进进度。不能把pending成员推断为批次未完成。' },
    { id: 'memory.targets', version: 1, source: 'index.js: resolveMemoryTargets; systems/memory-system.js: generateForCharacter', scope: 'current-chat', title: '目标范围与证据不足', text: '自动目标来自当前群聊的未禁用成员；没有群聊或没有可用成员时无法按群聊目标提取。autoMemorySpeakers启用后参考导演历史中的发言者，历史缺失或匹配不到时可能回退全部成员。没有提供该历史投影时只能标记目标过滤未知，不能断言谁应被提取。角色存在性、记忆Agent注册、模型调用、解析及保存都可能影响执行；没有本次执行记录时应明确无法确定历史失败原因，不猜测连接错误。只读诊断不读取聊天、记忆正文或角色身份，不触发生成，也不修改设置。' },
];

export function listMemoryKnowledge() {
    return documents.map(({ text, ...metadata }) => copyJson(metadata));
}

/** Return complete documents or explicit omissions; never cut away a prerequisite. */
export function readMemoryKnowledge(ids, maxBytes = 12000) {
    if (!Array.isArray(ids) || ids.length > 3 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !/^[a-z0-9_.-]{1,64}$/.test(id)) || !Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 16000) throw new TypeError('Invalid knowledge request');
    const result = { complete: true, documents: [], missing: [] };
    for (const id of ids) {
        const document = documents.find(d => d.id === id);
        if (!document) { result.missing.push(id); continue; }
        const candidate = { ...result, documents: [...result.documents, document] };
        // Reserve room for the bounded omission list and completion flag.
        if (new TextEncoder().encode(JSON.stringify(candidate)).length + 512 > maxBytes) result.missing.push(id);
        else result.documents.push(copyJson(document));
    }
    result.complete = result.missing.length === 0;
    return result;
}
