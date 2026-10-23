import { renderMarkdown } from './markdown.js';
import { createProcessGroups } from './process-groups.js';
import { createArtifactCards } from './artifact-cards.js';
import { createCopyControl } from './copy-control.js';

/** Owns message DOM and its process/artifact anchors, not scrolling or execution. */
export function createTranscriptView({ doc, history, cards, controller, act, lang = 'zh', views, navigateDirector, navigateMemory, locateReceipt }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text, parent) => { const element = doc.createElement(tag); if (text) element.textContent = text; parent.append(element); return element; };
    const processGroups = createProcessGroups({ doc, lang }), processAnchors = new Map(), artifactAnchors = new Map();
    const artifactCards = createArtifactCards({ doc, views, controller, act, lang, navigateDirector, navigateMemory, locateReceipt });
    let historyMessages = [], viewKey, viewToken, legacyReportAnchor = null, mounted = false, disposed = false;
    const messageDisposers = [];
    function clearMessageControls() { messageDisposers.splice(0).forEach(dispose => dispose()); }
    const requestPrefixFor = message => ['读取授权申请 / Read permission request: ', '代码执行申请 / Code execution request: '].find(prefix => message.role === 'assistant' && message.content.startsWith(prefix));

    function updateMessages(state) {
        const answerTimes = new Map(state.runs.filter(run => Number.isSafeInteger(run.answeredAt) && run.answeredAt > 0 && run.answeredAt <= 8_640_000_000_000_000).map(run => [run.id, run.answeredAt]));
        const pairedTitle = index => {
            const message = state.messages[index], next = state.messages[index + 1], prefix = requestPrefixFor(message);
            const title = prefix ? message.content.split('\n')[0].slice(prefix.length) : null;
            return title && next?.role === 'user' && ['拒绝读取 / Read denied', '允许本任务 / Allow task', '允许此聊天 / Allow chat'].some(label => next.content === `${label}: ${title}`) ? title : null;
        };
        const nextMessages = state.messages.map((message, index) => JSON.stringify([message, pairedTitle(index)]));
        const sameView = mounted && viewKey === state.viewKey && viewToken === state.viewToken;
        const append = sameView && nextMessages.length >= historyMessages.length && historyMessages.every((message, index) => message === nextMessages[index]);
        const changed = !append || nextMessages.length !== historyMessages.length;
        if (!changed) return false;
        const start = append ? historyMessages.length : 0;
        historyMessages = nextMessages; viewKey = state.viewKey; viewToken = state.viewToken; mounted = true;
        const previousAnchors = new Map(artifactAnchors);
        if (!append) { clearMessageControls(); history.replaceChildren(); processAnchors.clear(); artifactAnchors.clear(); }
        if (!sameView) legacyReportAnchor = null;
        if (!legacyReportAnchor) legacyReportAnchor = doc.createElement('div');
        if (!append) history.append(legacyReportAnchor);
        let permissionRecord = null;
        for (let index = start; index < state.messages.length; index++) {
            const message = state.messages[index], requestPrefix = requestPrefixFor(message), paired = pairedTitle(index);
            if (paired) {
                permissionRecord = node('details', '', history);
                node('summary', t('资料授权记录（展开查看）', 'Data access record (expand)'), permissionRecord);
            }
            const root = node('div', '', permissionRecord || history); root.className = message.role === 'user' ? 'gd-muyu-message gd-muyu-user' : 'gd-muyu-message gd-muyu-assistant';
            node('strong', message.role === 'user' ? t('你：', 'You: ') : t('暮羽：', 'Muyu: '), root).className = 'gd-muyu-author';
            const content = node('div', '', root); content.className = 'gd-muyu-markdown'; messageDisposers.push(renderMarkdown(content, message.content, { lang }));
            if (message.role === 'assistant' && !requestPrefix) {
                const copy = createCopyControl({ doc, parent: root, text: message.content, lang, compact: true, ariaLabel: t('复制这条暮羽回答的完整原文', 'Copy the full original of this Muyu answer') });
                const at = answerTimes.get(message.runId);
                if (at !== undefined) {
                    const date = new Date(at), pad = value => String(value).padStart(2, '0');
                    const time = node('time', `${pad(date.getHours())}:${pad(date.getMinutes())}`, copy.element);
                    time.className = 'gd-muyu-message-time'; time.setAttribute('datetime', date.toISOString());
                    time.title = date.toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN');
                    time.setAttribute('aria-label', t('回答时间：', 'Answered at: ') + time.title);
                }
                messageDisposers.push(() => copy.dispose());
            }
            if (message.role === 'user' && message.runId) processAnchors.set(message.runId, { root: node('div', '', history), child: null });
            if (message.role === 'assistant' && message.runId && !requestPrefix) {
                const anchor = sameView && previousAnchors.get(message.runId) || doc.createElement('div');
                history.append(anchor); artifactAnchors.set(message.runId, anchor);
            }
            if (!paired) permissionRecord = null;
        }
        return true;
    }

    return {
        update(state) {
            if (disposed) return false;
            const changed = updateMessages(state);
            processGroups.update(state, processAnchors);
            artifactCards.retain(state);
            const ownerPositions = new Map();
            for (const artifact of state.artifacts) {
                const anchored = views.layout(artifact.kind) === 'anchored-details';
                const owner = anchored ? artifactAnchors.get(artifact.sourceRunId || artifact.content?.producedByRunId) || (artifact.kind === 'report' ? legacyReportAnchor || history : cards) : cards;
                const position = ownerPositions.get(owner) || 0;
                artifactCards.update(artifact, state, owner, position); ownerPositions.set(owner, position + 1);
            }
            return changed;
        },
        findArtifact(id, revision) { return disposed ? null : artifactCards.find(id, revision); },
        dispose() {
            if (disposed) return;
            disposed = true;
            clearMessageControls();
            artifactCards.dispose(); processGroups.dispose();
            history.replaceChildren(); cards.replaceChildren();
            processAnchors.clear(); artifactAnchors.clear(); historyMessages = [];
            legacyReportAnchor = null; viewKey = viewToken = undefined;
        },
    };
}
