import { validateJson } from '../core/json-contract.js';
import { providerCatalog } from '../modules/providers/catalog.js';

export const PERMISSION_TOOL = 'muyu.permission.request';
export const sourceKey = id => 'source:' + id;
export const generationBatchExecutionSource = id => `source:generationBatchExecution:${id}`;
export function parseGenerationBatchExecutionSource(value) { return /^source:generationBatchExecution:([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(value)?.[1] || null; }
export const npcExecutionSource = id => `source:npcExecution:${id}`;
export function parseNpcExecutionSource(value) { return /^source:npcExecution:([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(value)?.[1] || null; }
export const profileExecutionSource = id => `source:profileExecution:${id}`;
export function parseProfileExecutionSource(value) { return /^source:profileExecution:([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(value)?.[1] || null; }
export const memoryExecutionSource = id => `source:memoryExecution:${id}`;
export function parseMemoryExecutionSource(value) { return /^source:memoryExecution:([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(value)?.[1] || null; }
export const agentExecutionSource = id => `source:agentExecution:${id}`;
export function parseAgentExecutionSource(value) { return /^source:agentExecution:([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(value)?.[1] || null; }
export const scriptExecutionSource = id => `source:scriptExecution:${id}`;
export function parseScriptExecutionSource(value) { return /^source:scriptExecution:([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(value)?.[1] || null; }
export const requestSource = r => r.source === 'generationBatchExecution' ? generationBatchExecutionSource(r.executionId) : r.source === 'npcExecution' ? npcExecutionSource(r.executionId) : r.source === 'profileExecution' ? profileExecutionSource(r.executionId) : r.source === 'memoryExecution' ? memoryExecutionSource(r.executionId) : r.source === 'agentExecution' ? agentExecutionSource(r.executionId) : r.source === 'scriptExecution' ? scriptExecutionSource(r.executionId) : r.source === 'providerExecution' ? executionSource(r.providerId, r.providerRevision) : sourceKey(r.source);
export const permissionFields = r => ({ source: r.source, reason: r.reason, ...(r.source === 'providerExecution' ? { providerId: r.providerId, providerRevision: r.providerRevision } : ['scriptExecution', 'agentExecution', 'memoryExecution', 'profileExecution', 'npcExecution', 'generationBatchExecution'].includes(r.source) ? { executionId: r.executionId } : {}) });
export const executionSource = (providerId, providerRevision) => `source:providerExecution:${providerId}:${providerRevision}`;
export function parseExecutionSource(value) {
    const match = /^source:providerExecution:([A-Za-z][A-Za-z0-9_-]{0,79}):([0-9a-f]{64}-[0-3]|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(value);
    return match ? { providerId: match[1], providerRevision: match[2] } : null;
}
export const requestableSources = Object.freeze([...providerCatalog,
    { id: 'serviceDocuments', title: '本地资料白名单目录与文本（将发送给模型） / Approved local document roots and text (sent to model)', scope: 'global', permission: 'source-only' },
    { id: 'stCharacterCardState', title: '酒馆角色卡正文与保存资料 / ST saved character-card details', scope: 'global', permission: 'extended' },
    { id: 'stCharacterCardReferences', title: '角色卡删除保护：已加载群组、标签、绑定与当前使用引用计数 / Loaded character-card reference counts for deletion safeguards', scope: 'global', permission: 'extended' },
    { id: 'npcLibraryChat', title: '当前聊天 NPC 正文、角色卡关联及有效提示词 / Current chat NPCs, character-card links and effective Prompt', scope: 'chat', permission: 'extended' },
    { id: 'profileLibraryChat', title: '当前群聊角色档案、成员及有效档案模板 / Current group profiles, members and effective profile templates', scope: 'chat', permission: 'extended' },
    { id: 'blueprintStructureState', title: '当前聊天完整蓝图树、各进度轨道与完成变量状态 / Chat Blueprint tree, progress scopes and completion-variable state', scope: 'chat', permission: 'extended' },
    { id: 'selectionState', title: 'GroupWorld世界书选择与档案库加载策略、可选名称 / GroupWorld world book selection and profile auto-load policy, available names', scope: 'global', permission: 'configuration' },
    { id: 'ledgerEditState', title: '当前聊天导演账本正文 / Chat Director ledger entries', scope: 'chat', permission: 'extended' },
    { id: 'blueprintNodeEditState', title: '当前聊天蓝图节点正文与已存进度 / Chat Blueprint nodes and stored progress', scope: 'chat', permission: 'extended' },
    { id: 'npcEditState', title: '当前聊天NPC正文与导入状态 / Chat NPC records and import status', scope: 'chat', permission: 'extended' },
    { id: 'profileEditState', title: '当前聊天角色档案与归档正文、角色映射 / Chat character profiles, archives and character mapping', scope: 'chat', permission: 'extended' },
    { id: 'profileCreateState', title: '新建档案角色映射、指纹及Schema状态 / Profile creation targets, fingerprints and schema state', scope: 'chat', permission: 'extended' },
    { id: 'npcCreateState', title: '新建NPC的角色名称、已有名单与容量 / NPC creation character names, existing names and capacity', scope: 'chat', permission: 'extended' },
    { id: 'memoryEditState', title: '当前聊天角色记忆正文与角色映射 / Chat character memories and character mapping', scope: 'chat', permission: 'extended' },
    { id: 'memoryCreateState', title: '新增记忆目标、所选角色记忆基线与容量 / Memory creation targets, selected memories and capacity', scope: 'chat', permission: 'extended' },
    { id: 'variableEditState', title: '当前聊天变量定义、已存值与角色映射 / Chat variable definitions, stored values and character mapping', scope: 'chat', permission: 'extended' },
    { id: 'blueprintLibraryChat', title: '当前聊天蓝图、进度和完成标记 / Chat Blueprint, progress and completion signal', scope: 'chat', permission: 'configuration' },
    { id: 'blueprintLibraryAssets', title: '蓝图库节点正文与保存的进度 / Blueprint library nodes and stored progress', scope: 'global', permission: 'configuration' },
    { id: 'npcLibraryAssets', title: 'NPC 库正文与包内提示词 / NPC library content and packaged Prompt', scope: 'global', permission: 'configuration' },
    { id: 'profileLibraryAssets', title: '角色档案库正文、模板与加载关联 / Character profile library content, templates and auto-load references', scope: 'global', permission: 'configuration' },
    { id: 'customPromptAssets', title: '自定义 Prompt 条目与结构化数据 / Custom Prompt entries and structured data', scope: 'global', permission: 'configuration' },
    { id: 'skillAssets', title: '暮羽技能目录、说明与参考资源 / Muyu Skill catalog, instructions and resources', scope: 'global', permission: 'configuration' },
    { id: 'customAgentAssets', title: '自定义 Agent 定义与提示词 / Custom Agent definitions and prompts', scope: 'global', permission: 'configuration' },
    { id: 'npcGenerationState', title: 'NPC生成状态、数量、容量与选项 / NPC generation availability, counts, capacity and options', scope: 'chat', permission: 'extended' },
    { id: 'generationBatchExecution', title: '精确整单业务生成（模型费用、顺序保存与部分完成） / Exact generation batch (model costs, ordered saves and partial completion)', scope: 'chat', permission: 'code' },
    { id: 'npcExecution', title: 'NPC生成（模型费用、试生成或追加保存；不导入角色卡） / NPC generation (model costs, trial or append save; no character-card import)', scope: 'chat', permission: 'code' },
    { id: 'profileGenerationTargets', title: '档案生成的角色名称、已有状态及新建可用性 / Profile generation character names, existence and create availability', scope: 'chat', permission: 'extended' },
    { id: 'profileExecution', title: '单角色档案生成（模型费用、试跑或缺失保存） / Single-character profile generation (model cost, trial or missing-record save)', scope: 'chat', permission: 'code' },
    { id: 'memoryGenerationTargets', title: '记忆提取的角色名称、数量与容量 / Memory extraction character names, counts and limits', scope: 'chat', permission: 'extended' },
    { id: 'memoryExecution', title: '单角色记忆提取（模型费用、保存与裁剪） / Single-character memory extraction (model cost, save and pruning)', scope: 'chat', permission: 'code' },
    { id: 'agentExecution', title: '运行指定自定义 Agent（模型费用与结果写入） / Run a specified Custom Agent (model costs and result write)', scope: 'chat', permission: 'code' },
    { id: 'scriptExecution', title: '在当前聊天执行指定脚本 / Execute a specified script in this chat', scope: 'chat', permission: 'code' },
    { id: 'scriptTests', title: '脚本草稿合成代码测试（无真实酒馆数据） / Synthetic script code tests (no real host data)', scope: 'global', permission: 'code' },
    { id: 'scriptAssets', title: '脚本执行器定义与源码 / Script Executor definitions and source', scope: 'global', permission: 'configuration' },
    { id: 'providerAssets', title: '用户 Provider 源码与资产目录 / User Provider source assets', scope: 'global', permission: 'configuration' },
    { id: 'providerTests', title: 'Provider 草稿合成代码测试（无真实酒馆数据） / Synthetic Provider code tests (no real host data)', scope: 'global', permission: 'code' },
    { id: 'configSettings', title: '导演、评分、Prompt与Provider超时配置（不含密钥） / Director, scoring, prompt and Provider settings (no secrets)', scope: 'global', permission: 'configuration' },
    { id: 'memoryDiagnostics', title: '记忆运行诊断（匿名统计与条件） / Memory diagnostics', scope: 'chat', permission: 'diagnostics' },
    { id: 'directorDiagnostics', title: '导演白名单配置与运行诊断 / Director diagnostics', scope: 'chat', permission: 'diagnostics' },
    { id: 'providerExecution', title: '执行指定 Provider 的代码 / Execute a named Provider', scope: 'chat', permission: 'code' },
]);
export const permissionSource = id => requestableSources.find(p => p.id === id) || null;
export const permissionSources = requestableSources.map(p => sourceKey(p.id));
export const permissionSchema = { type: 'object', properties: {
    source: { type: 'string', enum: requestableSources.map(p => p.id) },
    reason: { type: 'string', maxLength: 400 },
    executionId: { type: 'string', maxLength: 36 },
    providerId: { type: 'string', maxLength: 80 },
    providerRevision: { type: 'string', maxLength: 80 },
}, required: ['source', 'reason'], additionalProperties: false };
export function validatePermission(value) {
    const request = validateJson(permissionSchema, value);
    if (!request.reason.trim()) throw Error('INVALID_PERMISSION_REQUEST');
    if (request.source === 'providerExecution' ? !request.providerId || !request.providerRevision : request.providerId !== undefined || request.providerRevision !== undefined) throw Error('INVALID_PERMISSION_REQUEST');
    if (['scriptExecution', 'agentExecution', 'memoryExecution', 'profileExecution', 'npcExecution', 'generationBatchExecution'].includes(request.source) ? !parseScriptExecutionSource(scriptExecutionSource(request.executionId)) : request.executionId !== undefined) throw Error('INVALID_PERMISSION_REQUEST');
    return request;
}
export function permissionTitle(id) { return permissionSource(id)?.title || ''; }
export function permissionDescription(r) { return r.source === 'generationBatchExecution' ? `整单业务生成申请 / Generation batch request: ${r.executionId}\n${r.reason}` : r.source === 'npcExecution' ? `NPC生成执行申请 / NPC generation request: ${r.executionId}\n${r.reason}` : r.source === 'profileExecution' ? `档案生成执行申请 / Profile generation request: ${r.executionId}\n${r.reason}` : r.source === 'memoryExecution' ? `记忆提取执行申请 / Memory extraction run request: ${r.executionId}\n${r.reason}` : r.source === 'agentExecution' ? `自定义 Agent 运行申请 / Custom Agent run request: ${r.executionId}\n${r.reason}` : r.source === 'scriptExecution' ? `脚本真实执行申请 / Real script execution: ${r.executionId}\n${r.reason}` : r.source === 'providerExecution' ? `代码执行申请 / Code execution request: ${r.providerId} (${r.providerRevision})\n${r.reason}` : ['providerTests', 'scriptTests'].includes(r.source) ? `合成代码测试申请 / Synthetic code test request: ${permissionTitle(r.source)}\n${r.reason}` : `读取授权申请 / Read permission request: ${permissionTitle(r.source)}\n${r.reason}`; }
export function permissionAnswer(r, decision) {
    if (!['task', 'chat', 'deny'].includes(decision)) throw Error('INVALID_PERMISSION_DECISION');
    return `Permission request resolved by the application: ${JSON.stringify({ source: r.source, decision, ...(['scriptExecution', 'agentExecution', 'memoryExecution', 'profileExecution', 'npcExecution', 'generationBatchExecution'].includes(r.source) ? { executionId: r.executionId } : {}), ...(r.source === 'providerExecution' ? { providerId: r.providerId, providerRevision: r.providerRevision } : {}) })}. Check tool policy before reading; do not repeat denied requests.`;
}
