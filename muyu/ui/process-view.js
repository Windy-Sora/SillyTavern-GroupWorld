import { processTools } from '../application/process-store.js';
import { PROCESS_DETAILS } from '../preferences/contract.js';
import { formatBudget } from './budget-view.js';
import { MODEL_STAGE_LABELS, modelDiagnosticStage } from '../core/model-diagnostics.js';

const labels = {
    yielded: ['已交接，等待用户处理', 'Handed off for user input'],
    queued: ['等待执行', 'Queued'], running: ['任务开始', 'Run started'],
    'model.started': ['正在请求模型', 'Requesting model'], 'model.completed': ['已收到模型响应', 'Model response received'],
    'model.failed': ['模型调用失败', 'Model request failed'],
    'tool.requested': ['检查工具调用', 'Checking tool request'], 'tool.started': ['正在执行工具', 'Executing tool'],
    'tool.reused': ['复用已有结果', 'Reusing prior result'], 'tool.completed': ['工具返回成功', 'Tool returned successfully'],
    'tool.failed': ['工具返回失败或被拒绝', 'Tool failed or was rejected'],
    cancelling: ['正在取消', 'Cancelling'], succeeded: ['回答完成', 'Answer completed'], failed: ['任务失败', 'Run failed'],
    cancelled: ['任务已取消', 'Run cancelled'], interrupted: ['任务中断', 'Run interrupted'],
};
const errors = {
    HOST_CONNECTION_CHANGED: ['酒馆连接已变化，旧任务与授权失效，请重新启用', 'ST connection changed; old tasks and grants expired. Re-enable the connection'],
    HOST_CONNECTION_UNAVAILABLE: ['酒馆聊天补全连接或版本接口不可用', 'ST Chat Completion connection or host API unavailable'],
    HOST_CONNECTION_UNSUPPORTED: ['酒馆连接尚未适配，请使用独立接口', 'Unsupported ST connection; use a separate connection'],
    HOST_MODEL_REQUEST_FAILED: ['酒馆后端请求失败，请检查酒馆连接与模型', 'ST backend request failed; check the ST connection and model'],
    SKILL_STALE: ['所选技能版本已变化，请重新选择后发送', 'Selected Skill changed; select it again and send'],
    SKILL_DISABLED: ['所选技能已停用或不允许手动调用', 'Selected Skill is disabled or disallows manual invocation'],
    SKILL_UNAVAILABLE: ['技能暂不可读取，未加载该说明', 'Skill unavailable; document was not loaded'],
    PROVIDER_BUDGET_EXCEEDED: ['完整资料超过本轮读取预算，未截断加载', 'Complete document exceeds the read budget; not loaded partially'],
    CONTEXT_LIMIT: ['输入上下文超过预算（含历史、工具定义、结果及思考回传）；请调整输入上下文预算，不是单次输出上限', 'Input context exceeds budget (history, tools, results and thinking); adjust the input context budget, not output tokens'],
    CONTEXT_INCOMPLETE: ['未摘要历史无法完整携带；增加输入预算、整理历史或明确不带历史', 'Unsummarized history cannot fit; increase input budget, summarize or explicitly omit history'],
    MODEL_OUTPUT_TRUNCATED: ['模型输出被截断；提高单次输出上限或缩小任务', 'Model output truncated; increase output tokens or narrow the task'],
    MODEL_HISTORY_UNAVAILABLE: ['缺少工具思考回传信息；检查接口与模型兼容性', 'Required thinking/tool replay unavailable; check endpoint/model compatibility'],
    MODEL_HISTORY_LIMIT: ['思考回传缓存达到上限，任务未继续', 'Thinking replay cache limit reached; task stopped'],
    MODEL_RESPONSE_TOO_LARGE: ['模型响应超过本地接收容量，任务未继续', 'Model response exceeds the local receive limit; task stopped'],
    MODEL_REQUEST_TOO_LARGE: ['模型请求超过本地请求体容量，未发送', 'Model request exceeds the local body limit; not sent'],
    MODEL_PROTOCOL_ERROR: ['模型响应或思考回传不符合接口协议', 'Model response or thinking replay violates the protocol'],
    MODEL_FAILED: ['模型请求在本地准备或执行阶段失败', 'Model request failed during local preparation or execution'],
    MODEL_HTTP_ERROR: ['接口拒绝请求；检查模型与请求参数', 'Endpoint rejected the request; check model and parameters'],
    PERMISSION_LIMIT: ['本任务授权申请次数已达上限，未读取该资料', 'Task permission request limit reached; source not read'],
    CLARIFICATION_LIMIT: ['本任务澄清次数已达上限', 'Task clarification limit reached'],
    INVALID_CONTINUATION: ['任务续接无效，未继续执行', 'Invalid continuation; execution stopped'],
    PERMISSION_REQUIRED: ['需要读取授权', 'Read permission required'], PERMISSION_DENIED: ['权限拒绝', 'Permission denied'], PERMISSION_REQUEST_INVALID: ['授权申请无效或已经获准', 'Invalid or already granted permission request'], INVALID_ARGUMENT: ['参数不符合契约', 'Invalid arguments'],
    CALL_ID_CONFLICT: ['调用编号冲突', 'Call ID conflict'], UNSUPPORTED_CAPABILITY: ['不支持此能力', 'Unsupported capability'],
    TARGET_UNAVAILABLE: ['目标已不可用', 'Target unavailable'], UPSTREAM_PENDING: ['上游尚未清理', 'Upstream still pending'],
    OUTPUT_INVALID: ['返回值不符合契约', 'Invalid output'], TIMEOUT: ['超时', 'Timed out'], TOOL_FAILED: ['工具执行失败', 'Tool execution failed'],
    CANCELLED: ['已取消', 'Cancelled'], BUDGET_EXCEEDED: ['达到调用预算', 'Call budget reached'],
    MODEL_NETWORK_ERROR: ['网络失败，可能涉及 CORS', 'Network failure; CORS is possible'], MODEL_AUTH_ERROR: ['认证或访问被拒绝', 'Authentication/access rejected'],
    MODEL_RATE_LIMIT: ['服务限流', 'Service rate limit'], MODEL_SERVICE_ERROR: ['模型服务失败', 'Model service failure'],
};
const local = (pair, lang) => pair[lang === 'en' ? 1 : 0];
const readError = row => row.read && !['ok', 'empty'].includes(row.read.status);
const readLimited = row => row.read && (row.read.limited === true || row.read.truncated && !row.read.paged);
const readWarning = row => readError(row) || readLimited(row);
/** Event markers describe observed events, never a percentage or inferred write success. */
export function processEventState(row, active = false) {
    if (row.error || row.type.endsWith('.failed')) return 'error';
    if (readWarning(row)) return 'warning';
    if (row.type.endsWith('.completed') || row.type === 'tool.reused') return 'done';
    if (active && row.type.endsWith('.started')) return 'running';
    return 'neutral';
}
export function processLabel(process, lang = 'zh') {
    if (!process) return '';
    const text = local(labels[process.phase] || ['处理中', 'Processing'], lang);
    return text + (process.terminal && !process.cleaned ? local([' · 等待上游清理', ' · Waiting for cleanup'], lang) : '');
}

export function processHasIssue(process) {
    return !!process && (!!process.error || process.phase === 'failed' || !!process.toolFailures || process.rows.some(readWarning));
}

export function processSummary(process, lang = 'zh') {
    let text = processLabel(process, lang);
    if (process.error) text += ' · ' + local(errors[process.error] || ['任务发生错误', 'Run error'], lang);
    else if (process.toolFailures) text += local([' · 含失败或拒绝记录', ' · Includes failures or rejections'], lang);
    else if (process.rows.some(readError)) text += local([' · 存在资料读取异常记录', ' · Includes read error records'], lang);
    else if (process.rows.some(readLimited)) text += local([' · 资料范围有限或未完整返回', ' · Limited scope or partial content'], lang);
    return text;
}

/** Stable details nodes preserve expansion/focus and scroll across progress notifications. */
export function createProcessView({ doc, lang = 'zh' }) {
    const nodes = new Map();
    const node = (tag, text, parent) => { const el = doc.createElement(tag); el.textContent = text; if (parent) parent.append(el); return el; };
    return {
        update(run, artifactPresent, expectsArtifact = true, detail = 'verbose', segment = null) {
            const p = run.process; if (!p) return null;
            if (!PROCESS_DETAILS.includes(detail)) detail = 'compact';
            let view = nodes.get(run.id);
            if (!view) {
                const root = node('details', ''); root.className = 'gd-muyu-process';
                view = { root, summary: node('summary', '', root), list: node('ol', '', root), note: node('p', '', root), signature: '' };
                nodes.set(run.id, view);
            }
            view.summary.textContent = (segment === null ? local(['执行过程', 'Execution process'], lang) : local(['执行段 ', 'Segment '], lang) + segment) + ' · ' + processSummary(p, lang);
            view.root.setAttribute('data-state', p.error || p.phase === 'failed' ? 'error' : p.phase === 'yielded' ? 'waiting' : p.terminal ? 'ended' : 'running');
            const signature = JSON.stringify([p.rows, detail, p.phase, p.terminal]);
            if (signature !== view.signature) {
                const scrollTop = view.list.scrollTop;
                view.signature = signature; view.list.replaceChildren();
                const rows = detail === 'compact' ? p.rows.filter((row, index) => row.error || readWarning(row) || row.type.endsWith('.failed') || index === p.rows.length - 1)
                    : detail === 'standard' ? p.rows.filter(row => !['tool.requested', 'tool.started', 'model.started'].includes(row.type)) : p.rows;
                for (const row of rows) {
                    const tool = row.tool ? local(processTools[row.tool] || ['未知工具', 'Unknown tool'], lang) + ' · ' : '';
                    const error = row.error ? ' · ' + row.error + ' · ' + local(errors[row.error] || ['安全错误（无原始详情）', 'Safe error (no raw details)'], lang) : '';
                    const stage = modelDiagnosticStage(row.diagnosticStage);
                    const diagnostic = stage ? ' · ' + local(['失败阶段：', 'Failure stage: '], lang) + local(MODEL_STAGE_LABELS[stage], lang) : '';
                    if (row.read && (detail === 'verbose' || readWarning(row))) { const read = node('li', `${row.read.source} · ${row.read.status} · ${row.read.characters}` + local([' 字符', ' characters'], lang) + (row.read.paged ? local([' · 分段读取（还有后续页）', ' · Paged read (more pages available)'], lang) : '') + (readLimited(row) ? local([' · 资料范围有限或未完整返回', ' · Limited scope or partial content'], lang) : ''), view.list); read.setAttribute('data-state', readWarning(row) ? 'warning' : 'neutral'); }
                    const technical = ['detailed', 'verbose'].includes(detail) ? ` #${row.attemptId}` + (row.durationMs === null ? '' : ` · ${row.durationMs} ms`) + diagnostic : '';
                    const event = node('li', tool + local(labels[row.type] || ['处理中', 'Processing'], lang) + technical + error, view.list);
                    event.setAttribute('data-state', processEventState(row, row === p.rows.at(-1) && !p.terminal && p.phase !== 'yielded'));
                }
                view.list.scrollTop = scrollTop;
            }
            const notes = [];
            if (run.skills?.length) notes.push(local(['本任务技能（完整读取）：', 'Task Skills (read completely): '], lang) + run.skills.map(row => detail === 'verbose' ? `${row.displayName} · ${row.revision} · ${row.paths.join(', ')} · ${row.bytes} B` : row.displayName).join('；'));
            if (p.toolFailures) notes.push(local(['包含失败或被拒绝的工具调用', 'Includes failed/rejected tool calls'], lang));
            if (p.dropped) notes.push(local(['较早过程记录已截断', 'Earlier process records were truncated'], lang));
            if (p.terminal === 'succeeded' && expectsArtifact && !artifactPresent) notes.push(local(['回答已结束；尚无可信报告或草稿', 'Answer ended; no verified report or draft available'], lang));
            if (p.error) notes.push(p.error + ' · ' + local(errors[p.error] || ['任务结束时发生错误', 'Run ended with an error'], lang));
            view.note.textContent = notes.join(' · ') + (p.budget && detail !== 'compact' ? '\n' + (detail === 'standard' ? formatBudget(p.budget, lang).split('\n').slice(0, 2).join('\n') : formatBudget(p.budget, lang)) : '');
            return view.root;
        },
        retain(ids) { for (const [id, view] of nodes) if (!ids.has(id)) { view.root.remove(); nodes.delete(id); } },
        clear() { for (const view of nodes.values()) view.root.remove?.(); nodes.clear(); },
    };
}
