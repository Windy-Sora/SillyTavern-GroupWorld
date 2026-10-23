import { copyJson, jsonKey } from '../../core/json-contract.js';
import { createToolRegistry } from '../../tools/registry.js';
import { diagnosticPresentation, readPresentationSchema } from '../../config/read-presentation.js';
import { configValue } from '../../config/presentation.js';
const str = { type: 'string', maxLength: 2000 }, num = { type: 'number', minimum: -1 };
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items, maxItems) => ({ type: 'array', items, maxItems });
const flag = x => x === true ? 'on' : x === false ? 'off' : 'unknown';
const number = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1e9 ? x : -1;
const count = x => Number.isSafeInteger(x) && x >= 0 ? number(x) : -1;
const stateSchema = obj({ mode: str, topN: num, llmMaxSpeakers: num, consecutivePenalty: num, triggerEnabled: str, triggerScore: num, initiativeEnabled: str, initiativeBaseScore: num, respectOrder: str, recentMessageCount: num, llmContextDepth: num, hasGroup: str, enabledMembers: num, manualGenerating: str, roundActive: str, generationType: str, takeoverPending: str, takeoverRemaining: num, takeoverFailed: str, historyCount: num, lastSpeakerCount: num, reasonFieldPresent: str, lastChatLength: num });
export function createDirectorModule({ ports }) {
    const registry = createToolRegistry(), reports = new Map();
    let disposed = false;
    function read(target) {
        if (disposed) throw Error('MODULE_DISPOSED');
        const check = () => { if (target?.kind !== 'chat' || jsonKey(target) !== jsonKey(ports.getTarget())) throw Error('TARGET_UNAVAILABLE'); };
        function project() {
            const s = ports.getSettings(), g = ports.getGroup(), guards = ports.getGuards();
            const raw = ports.getMetadata()?.[ports.extensionKey]?.directorHistory;
            const history = raw === undefined ? [] : Array.isArray(raw) ? raw : null, last = history?.at(-1);
            if (Array.isArray(g?.members) && g.members.length > 64 || Array.isArray(g?.disabled_members) && g.disabled_members.length > 64) throw Error('EVIDENCE_LIMIT');
            const members = Array.isArray(g?.members) && (g.disabled_members == null || Array.isArray(g.disabled_members)) ? g.members.filter(id => !g.disabled_members?.includes(id)) : null;
            return { mode: ['off', 'formula', 'llm'].includes(s.mode) ? s.mode : 'unknown', topN: count(s.topN), llmMaxSpeakers: count(s.llmMaxSpeakers), consecutivePenalty: number(s.consecutivePenalty), triggerEnabled: flag(s.triggerEnabled), triggerScore: number(s.triggerScore), initiativeEnabled: flag(s.initiativeEnabled), initiativeBaseScore: number(s.initiativeBaseScore), respectOrder: flag(s.llmRespectOrder), recentMessageCount: count(s.recentMessageCount), llmContextDepth: count(s.llmContextDepth), hasGroup: g ? 'on' : 'off', enabledMembers: g ? members ? members.length : -1 : 0, manualGenerating: flag(guards.manualGenerating), roundActive: flag(guards.roundActive), generationType: ['normal', 'swipe', 'regenerate'].includes(guards.generationType) ? guards.generationType : 'unknown', takeoverPending: flag(guards.takeoverPending), takeoverRemaining: count(guards.takeoverRemaining), takeoverFailed: flag(guards.takeoverFailed), historyCount: history ? history.length : -1, lastSpeakerCount: Array.isArray(last?.speakers) ? last.speakers.length : -1, reasonFieldPresent: last && typeof last === 'object' ? flag(Object.hasOwn(last, 'reason')) : 'unknown', lastChatLength: count(last?._chatLength) };
        }
        check(); const state = project(); check(); if (jsonKey(state) !== jsonKey(project())) throw Error('STALE_EVIDENCE'); check(); return copyJson(state);
    }
    function report(state) {
        const findings = [];
        const add = (kind, code, text) => findings.push({ kind, code, text });
        add('fact', 'CURRENT_MODE', `当前模式：${state.mode === 'unknown' ? '未知' : configValue('mode', state.mode)}。当前配置不证明历史选人原因。${state.mode === 'llm' ? '人数上限等于成员数也不代表每轮全选；模型仍可少选，不能据此说导演没有筛选作用。' : ''}`);
        if (state.hasGroup === 'off') add('fact', 'NO_GROUP', '当前不是群聊，无法按群聊成员排查。');
        if (state.mode === 'off') add('fact', 'DIRECTOR_OFF', '当前导演模式关闭，不执行导演筛选。');
        if (state.enabledMembers === 0 && state.hasGroup === 'on') add('fact', 'NO_MEMBERS', '当前没有未禁用成员。');
        if (state.takeoverFailed === 'on') add('fact', 'TAKEOVER_FAILED', '当前接管状态带失败标志，未提供历史异常原因。');
        if (state.historyCount === 0) add('unknown', 'NO_HISTORY', '没有保存的导演历史，不能还原过去某次选择。');
        add('unknown', 'HISTORY_LIMIT', '只读取历史结构；条目可编辑，选择原因字段存在不代表内容有效，更不证明实际执行成功。');
        add('unknown', 'NO_CHARACTER_EVIDENCE', '没有读取身份、逐角色评分或消息正文，不能判定某角色过去为何未发言。');
        return { module: 'director', version: 1, state, findings, presentation: diagnosticPresentation(state), navigation: 'director' };
    }
    registry.register({ id: 'muyu.director.inspect', version: 1, description: '只读检查当前导演白名单配置、匿名成员数、运行状态及历史结构。formula使用topN，llm使用llmMaxSpeakers，后者是本轮发言人数上限，不是候选人数或必须发言人数。lastChatLength是最后一条历史记录的消息长度锚点，不是当前聊天长度；llmContextDepth是窗口配置，不是实际输入。本工具不能确认导演完整看过或没看过全部聊天。lastSpeakerCount是历史人数，与当前上限相同不证明当时使用此上限。findings是证据边界，仅解释与用户问题有关的项。无角色身份、历史原因原文、Prompt和正文，不重新评分或选人。', inputSchema: obj({}), outputSchema: obj({ module: str, version: num, state: stateSchema, presentation: readPresentationSchema, findings: arr(obj({ kind: str, code: str, text: str }), 8), navigation: str }), scope: 'chat', effect: 'read', dataClasses: ['director-settings-whitelist', 'anonymous-counts', 'runtime-flags', 'history-structure'], confirmation: 'policy', resourceKeys: [], timeoutMs: 1000, retryPolicy: { kind: 'none', maxAttempts: 1 } }); registry.seal();
    return { registry, handlers: { 'muyu.director.inspect': (_, ctx) => { if (reports.size >= 128 && !reports.has(ctx.runId)) throw Error('REPORT_CAPACITY'); const result = report(read(ctx.target)); reports.set(ctx.runId, { target: copyJson(ctx.target), report: result }); return copyJson(result); } },
        publishReport(app, runId) { const saved = reports.get(runId); if (!saved || jsonKey(read(saved.target)) !== jsonKey(saved.report.state)) throw Error('STALE_EVIDENCE'); const r = app.snapshot().runs.find(r => r.id === runId); if (r?.status !== 'succeeded' || jsonKey(r.target) !== jsonKey(saved.target)) throw Error('INVALID_SOURCE'); return app.createArtifact({ taskId: r.taskId, sourceRunId: runId, kind: 'report', content: saved.report }); },
        retainArtifacts() {}, // Published reports do not hold private host plans.
        forgetRun: id => reports.delete(id), dispose: () => { disposed = true; reports.clear(); },
        transferRun(from, identity) { const report = reports.get(from); if (!report) return; if (reports.has(identity.id) || jsonKey(report.target) !== jsonKey(identity.target)) throw Error('INVALID_RUN_TRANSFER'); reports.delete(from); reports.set(identity.id, report); },
    };
}
