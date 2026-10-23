import { patchReadonly as patch } from './readonly-dom.js';
const tag = element => (element.tagName || element.tag || '').toLowerCase();
const children = element => Array.from(element.children);
const parent = element => element.parentElement || element.parent;

/** Stable artifact occurrences; render dependencies are observed from trusted built-in views.
 * Revisions/content changes replace the occurrence and invalidate captured callbacks.
 * Controller/action methods remain the authorization boundary.
 */
export function createArtifactCards({ doc, views, controller, act, lang, navigateDirector, navigateMemory, locateReceipt }) {
    const entries = new Map(), defaults = new WeakMap();
    let disposed = false;
    const t = (zh, en) => lang === 'en' ? en : zh;
    const remove = entry => {
        entry.active = false;
        for (const button of descendants(entry.root).filter(el => tag(el) === 'button')) button.disabled = true;
        entry.root.remove();
    };
    const keyFor = (state, artifact) => JSON.stringify([state.viewToken, artifact.id]);
    const dependencySignature = (state, keys) => JSON.stringify([...keys].map(key => [key, state[key]]));
    function descendants(root) { return [root, ...children(root).flatMap(descendants)]; }
    return {
        update(artifact, state, owner, index) {
            const key = keyFor(state, artifact), content = JSON.stringify(artifact);
            const occurrence = JSON.stringify([artifact.kind, artifact.revision, artifact.content]);
            let entry = entries.get(key);
            const replaced = !!entry && entry.occurrence !== occurrence;
            if (replaced) { remove(entry); entries.delete(key); entry = null; }
            if (!entry) {
                entry = { root: doc.createElement(views.layout(artifact.kind) === 'anchored-details' ? 'details' : 'section'), artifactId: artifact.id, revision: artifact.revision, occurrence, updated: replaced, content: null, active: true, generation: 0, keys: new Set(), signature: null, stage: null };
                entries.set(key, entry);
            }
            const connection = JSON.stringify(state.connection);
            const signature = dependencySignature(state, entry.keys);
            if (entry.signature === null || entry.signature !== signature || entry.content !== content) {
                const generation = ++entry.generation, keys = new Set(['connection', 'viewToken', 'readOnly', 'switchedChat', 'permissions', 'sourceGrants', 'busy', 'resetting', 'enabled']);
                const observed = new Proxy(state, { get(object, name) { if (typeof name === 'string') keys.add(name); return object[name]; } });
                const root = doc.createElement(tag(entry.root));
                const isPlan = artifact.kind === 'task-plan', isReport = artifact.kind === 'report';
                root.className = 'gd-muyu-card' + (isPlan ? ' gd-muyu-plan' : isReport ? ' gd-muyu-report' : '');
                const node = (name, text, target = root) => { const element = doc.createElement(name); if (text) element.textContent = text; target.append(element); return element; };
                const button = (text, target) => { const element = node('button', text, target); element.type = 'button'; element.className = 'menu_button'; return element; };
                let card = root;
                if (tag(root) === 'details') {
                    const settled = observed.approvedPlans?.includes(artifact.id) || observed.declinedPlans?.includes(artifact.id) || observed.invalidPlans?.includes(artifact.id);
                    const stage = `${artifact.revision}:${!!settled}`;
                    root.open = stage === entry.stage ? !!entry.root.open : isPlan && !settled;
                    entry.stage = stage;
                    const summary = node('summary', '', root);
                    node('strong', views.title(artifact.kind, lang) + ' · v' + artifact.revision, summary);
                    node('span', isPlan ? artifact.content.plan.goal : t('生成时的证据快照 · 展开查看', 'Evidence snapshot · expand to view'), summary);
                    if (isPlan) node('small', observed.invalidPlans?.includes(artifact.id) ? t('已失效 · 不可批准', 'Expired · cannot approve') : observed.declinedPlans?.includes(artifact.id) ? t('已拒绝读取', 'Reads declined') : observed.approvedPlans?.includes(artifact.id) ? t('已允许本任务读取 · 非修改批准', 'Task reads allowed · not write approval') : t('待批准读取 · 不批准修改', 'Read approval pending · no write approval'), summary);
                    card = node('div', '', root); card.className = 'gd-muyu-plan-body';
                } else node('strong', views.title(artifact.kind, lang) + ' · v' + artifact.revision, card);
                if (entry.updated && !isReport) node('small', t('内容已更新，需要重新核对。', 'Content updated; review this version again.'), card);
                if (!views.render(artifact.kind, { doc, card, artifact, state: observed, controller, act, lang, node, button, t, navigateDirector, navigateMemory })) {
                    node('small', t('暂不支持显示此类型的产物；不会提供应用入口。', 'This artifact type is not supported here; no apply action is offered.'), card);
                }
                const related = (observed.receipts || []).filter(receipt => receipt.artifactId === artifact.id && receipt.revision === artifact.revision);
                if (locateReceipt && related.length) {
                    const links = node('div', '', card); links.className = 'gd-muyu-result-links';
                    related.forEach((receipt, index) => { const link = button(t('查看操作回执', 'View operation receipt') + (related.length > 1 ? ` · ${index + 1}` : ''), links); link.onclick = () => locateReceipt(receipt.operationId); });
                }
                for (const element of descendants(root).filter(el => tag(el) === 'button')) {
                    if (!isReport && (state.readOnly || state.switchedChat)) element.disabled = true;
                    const handler = element.onclick;
                    if (!handler) continue;
                    const disabled = !!element.disabled;
                    element.onclick = (...args) => {
                        const current = controller.snapshot();
                        if (disposed || !entry.active || entry.generation !== generation || disabled ||
                            keyFor(current, artifact) !== key || JSON.stringify(current.connection) !== connection ||
                            dependencySignature(current, keys) !== entry.signature ||
                            !current.artifacts?.some(row => JSON.stringify(row) === content)) return;
                        return handler(...args);
                    };
                }
                entry.content = content; entry.keys = keys; entry.signature = dependencySignature(state, keys);
                const open = root.open;
                patch(entry.root, root, defaults);
                // Outer disclosure follows review-stage changes; inner disclosures retain manual choices.
                if (tag(root) === 'details') { entry.root.open = open; defaults.set(entry.root, !!open); }
            }
            if (parent(entry.root) !== owner || children(owner)[index] !== entry.root) owner.insertBefore(entry.root, children(owner)[index] || null);
            return entry.root;
        },
        find(id, revision) { if (disposed) return null; return [...entries.values()].find(entry => entry.active && entry.artifactId === id && entry.revision === revision)?.root || null; },
        retain(state) {
            const keys = new Set(state.artifacts.map(artifact => keyFor(state, artifact)));
            for (const [key, entry] of entries) if (!keys.has(key)) { remove(entry); entries.delete(key); }
        },
        dispose() { disposed = true; for (const entry of entries.values()) remove(entry); entries.clear(); },
    };
}
