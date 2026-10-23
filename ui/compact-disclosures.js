// Explicitly curated auxiliary editors. Core data/code editors are not selected
// merely because they are textareas. All ranges stay inside their original gate.
export const COMPACT_DISCLOSURES = [
    ['npc-prompt', 'gd-npc-prompt', 'gd-npc-prompt-reset', '生成提示词', 'Generation prompt'],
    ['blueprint-prompts', 'gd-story-blueprint-prompt', 'gd-story-blueprint-template-reset', '提示词与输出格式', 'Prompts & output format'],
    ['blueprint-preview', 'gd-story-blueprint-provider-preview', 'gd-story-blueprint-signals', '注入预览与完成信号', 'Injection preview & completion signals'],
    ['critique-prompts', 'gd-critique-prompt', 'gd-critique-schema-reset', '提示词与输出格式', 'Prompts & output format'],
    ['message-prompt', 'gd-ps-msg-prompt', 'gd-ps-msg-prompt-reset', '消息反馈提示词', 'Message feedback prompt'],
    ['round-prompt', 'gd-ps-round-prompt', 'gd-ps-round-prompt-reset', '轮次反馈提示词', 'Round feedback prompt'],
    ['continuity-templates', 'gd-llm-script-continuity-wrapper', 'gd-llm-script-continuity-history-wrapper', '历史包装模板', 'History wrapper templates'],
    ['worldinfo-template', 'gd-llm-world-info-wrapper', 'gd-llm-world-info-wrapper', '注入包装模板', 'Injection wrapper template'],
    ['force-prompt', 'gd-force-speak-prompt', 'gd-force-speak-prompt', '接管提示词', 'Takeover prompt'],
    // A whole existing library/preview box; controls inside retain their parents.
    ['npc-library', 'gd-npc-library-select', null, 'NPC 库', 'NPC library', 2],
    ['blueprint-library', 'gd-story-blueprint-library-select', null, '蓝图库', 'Blueprint library', 2],
    ['worldbook-preview', 'gd-world-book-provider-preview', null, '世界书注入预览', 'World book injection preview', 1],
];

export function mountCompactDisclosures(root, { settings, definitions = COMPACT_DISCLOSURES } = {}) {
    const doc = root.ownerDocument;
    // Validate the complete mapping before touching any nodes.
    const entries = definitions.map(([id, startId, endId, zh, en, climb = 0]) => {
        let start = root.querySelector(climb ? `#${startId}` : `label[for="${startId}"]`);
        for (let i = 0; start && i < climb; i++) start = start.parentElement;
        const end = climb ? start : root.querySelector(`#${endId}`);
        if (!start || !end || start.parentElement !== end.parentElement || !root.contains(start)) throw new Error(`Invalid compact range: ${id}`);
        const siblings = [...start.parentElement.children];
        const first = siblings.indexOf(start), last = siblings.indexOf(end);
        if (last < first) throw new Error(`Reversed compact range: ${id}`);
        return { id, zh, en, nodes: siblings.slice(first, last + 1), details: null, anchors: [], open: false };
    });
    let previousTarget;
    function restore() {
        for (const entry of [...entries].reverse()) {
            if (!entry.details) continue;
            entry.open = entry.details.open;
            entry.anchors.forEach((anchor, i) => anchor.replaceWith(entry.nodes[i]));
            entry.details.remove(); entry.details = null; entry.anchors = [];
        }
    }
    return {
        update(preview, targetSelector) {
            if (!preview) { restore(); previousTarget = undefined; return; }
            try {
                for (const entry of entries) {
                    if (!entry.details) {
                        const details = doc.createElement('details');
                        details.className = 'gd-compact-disclosure'; details.dataset.compactId = entry.id;
                        details.open = entry.open;
                        const summary = doc.createElement('summary'); details.append(summary);
                        entry.nodes[0].before(details); entry.details = details;
                        for (const el of entry.nodes) {
                            const anchor = doc.createComment('compact-classic-position');
                            el.before(anchor); entry.anchors.push(anchor); details.append(el);
                        }
                    }
                    entry.details.firstElementChild.textContent = settings?.lang === 'en' ? entry.en : entry.zh;
                    // Library shortcuts must not land inside a closed disclosure.
                    if (targetSelector && targetSelector !== previousTarget) {
                        const target = root.querySelector(targetSelector);
                        if (target && entry.details.contains(target)) entry.details.open = true;
                    }
                }
                previousTarget = targetSelector;
            } catch (error) { restore(); throw error; }
        },
        dispose: restore,
    };
}
