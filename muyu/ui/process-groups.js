import { createProcessView, processHasIssue, processSummary } from './process-view.js';

const identified = value => typeof value === 'string' && value.trim().length > 0;
const groupKey = run => identified(run.sessionId) && identified(run.taskId)
    ? JSON.stringify(['task', run.sessionId, run.taskId]) : JSON.stringify(['run', run.id]);

/** Presentation-only grouping of explicit runtime identities. No inference or storage. */
export function createProcessGroups({ doc, lang = 'zh' }) {
    const processView = createProcessView({ doc, lang }), groups = new Map();
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, parent) => { const el = doc.createElement(tag); if (parent) parent.append(el); return el; };
    let identity, disposed = false;
    function clear() { for (const group of groups.values()) group.root.remove(); groups.clear(); processView.clear(); }
    return {
        update(state, anchors) {
            if (disposed) return;
            const nextIdentity = JSON.stringify([state.viewKey, state.viewToken]);
            if (identity !== nextIdentity) { clear(); identity = nextIdentity; }
            const members = new Map(), ids = new Set();
            for (const run of state.runs) {
                if (!identified(run.id) || ids.has(run.id) || !run.process) continue;
                ids.add(run.id);
                const key = groupKey(run); if (!members.has(key)) members.set(key, []);
                members.get(key).push(run);
            }
            processView.retain(ids);
            const retained = new Set();
            for (const [key, runs] of members) {
                const anchor = runs.map(run => anchors.get(run.id)).find(Boolean); if (!anchor) continue;
                let group = groups.get(key);
                if (runs.length > 1 || group) {
                    if (!group) {
                        const root = node('details'); root.className = 'gd-muyu-process-group';
                        group = { root, summary: node('summary', root), total: node('p', root), segments: node('div', root) };
                        groups.set(key, group);
                        // Carry an already opened first segment into its new wrapper.
                        group.root.open = !!anchor.child?.open;
                    }
                    retained.add(key);
                    const latest = runs.at(-1).process;
                    const earlierIssue = runs.slice(0, -1).some(run => processHasIssue(run.process));
                    group.summary.textContent = t('执行过程', 'Execution process') + ' · ' + processSummary(latest, lang)
                        + ` · ${runs.length} ` + t('执行段', 'segments')
                        + (earlierIssue ? t(' · 较早执行段含异常记录', ' · Earlier segments contain issue records') : '');
                    group.root.setAttribute('data-state', latest.error || latest.phase === 'failed' ? 'error' : latest.phase === 'yielded' ? 'waiting' : earlierIssue ? 'warning' : latest.terminal ? 'ended' : 'running');
                    const budgets = runs.map(run => run.process.budget).filter(Boolean);
                    const sum = field => budgets.reduce((total, budget) => total + (Number.isFinite(budget[field]) ? budget[field] : 0), 0);
                    group.total.textContent = !budgets.length ? t('暂无执行段用量报告。', 'No segment usage reports yet.')
                        : t('任务累计：模型 ', 'Task total: model ') + sum('modelCalls') + t(' 次 · 工具 ', ' calls · tools ') + sum('toolCalls')
                        + t(' 次 · 执行耗时 ', ' calls · execution time ') + (sum('elapsedMs') / 1000).toFixed(1) + 's'
                        + (budgets.length < runs.length ? t('（仅已报告执行段）', ' (reported segments only)') : '')
                        + t('；不含等待用户的时间，不代表保存结果。', '; excludes user-wait time and is not a save result.');
                    const children = [];
                    for (const [index, run] of runs.entries()) {
                        const child = processView.update(run, state.artifacts.some(a => a.sourceRunId === run.id || a.content?.producedByRunId === run.id), state.mode !== 'chat', state.displayConfig?.processDetail || 'compact', index + 1);
                        child.setAttribute('data-run-id', run.id); children.push(child);
                        if (group.segments.children[index] !== child) group.segments.insertBefore(child, group.segments.children[index] || null);
                    }
                    for (const child of Array.from(group.segments.children)) if (!children.includes(child)) child.remove();
                    if (anchor.child !== group.root) { anchor.root.append(group.root); anchor.child = group.root; }
                } else {
                    const run = runs[0], child = processView.update(run, state.artifacts.some(a => a.sourceRunId === run.id || a.content?.producedByRunId === run.id), state.mode !== 'chat', state.displayConfig?.processDetail || 'compact');
                    if (anchor.child !== child) { anchor.root.append(child); anchor.child = child; }
                }
            }
            for (const [key, group] of groups) if (!retained.has(key)) { group.root.remove(); groups.delete(key); }
        },
        dispose() { if (disposed) return; disposed = true; clear(); },
    };
}
