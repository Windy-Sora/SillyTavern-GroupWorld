// Small presentation adapter. Groups never leave their original mode/enable
// parent. Classic restoration uses anchors; business controls are never cloned.
export function mountFeatureViews(host, { id, settings, onConnection } = {}) {
    if (!host) return null;
    const groups = [...host.querySelectorAll('[data-feature-view]')];
    if (!groups.length) return null;
    const doc = host.ownerDocument;
    const compact = ['rules', 'memory', 'summary'].includes(id);
    const t = (zh, en) => settings?.lang === 'en' ? en : zh;
    const owned = [], texts = [], placements = [], panels = [], buttons = [];
    let active = false, view = 'use';
    function node(tag, className, parent, zh, en) {
        const el = doc.createElement(tag); el.className = className;
        parent?.append(el);
        if (zh) texts.push([el, zh, en]);
        return el;
    }
    const header = node('div', 'gd-feature-preview');
    header.dataset.featureOwner = id;
    host.prepend(header); owned.push(header);
    const switches = node('div', 'gd-profile-views', header);
    switches.setAttribute('role', 'group');
    for (const [key, zh, en] of (compact ? [] : [['use', '使用', 'Use'], ['settings', '设置', 'Settings'], ['advanced', '高级', 'Advanced']])) {
        const button = node('button', '', switches, zh, en);
        button.type = 'button'; button.dataset.featureViewButton = key;
        buttons.push(button);
    }
    switches.hidden = compact;
    const hint = node('p', 'gd-profile-hint', header);
    const connection = node('button', 'menu_button gd-feature-connect', header, '模型连接…', 'Model connections…');
    connection.type = 'button';
    const parents = new Map();
    for (const el of groups) {
        const parent = el.parentElement;
        if (!parents.has(parent)) parents.set(parent, []);
        parents.get(parent).push(el);
    }
    for (const [parent, items] of parents) {
        const container = node('div', 'gd-feature-preview gd-feature-content', parent);
        container.dataset.featureOwner = id;
        owned.push(container);
        const destinations = {};
        for (const key of ['use', 'settings', 'advanced']) {
            const fold = compact && (key === 'advanced' || (key === 'settings' && parent.id === 'gd-formula-section'));
            const panel = node(fold ? 'details' : 'div', 'gd-feature-panel', container);
            if (fold) {
                panel.open = false;
                node('summary', '', panel,
                    key === 'advanced' ? '提示词与输出格式' : '评分细则',
                    key === 'advanced' ? 'Prompts & output format' : 'Scoring details');
            }
            panel.dataset.featurePopulated = String(items.some(el => el.dataset.featureView === key || (key === 'use' && el.dataset.featureView === 'more')));
            panels.push([panel, key]); destinations[key] = panel;
            if (id === 'memory' && key === 'settings' && parent.id === 'gd-memory-section') {
                node('p', 'gd-profile-hint', panel, '降低单角色上限会触发现有记忆裁剪，请谨慎调整。', 'Lowering the per-character limit triggers existing memory pruning. Adjust carefully.');
            }
        }
        const more = node('details', 'gd-profile-disclosure', destinations.use);
        node('summary', '', more, '更多操作', 'More actions');
        node('p', 'gd-profile-hint', more,
            '以下为维护操作。重置、回退或清理会修改当前聊天数据，请确认操作对象。',
            'Maintenance actions: reset, revert or cleanup modifies this chat. Check the operation before proceeding.');
        destinations.more = more;
        more.hidden = !items.some(el => el.dataset.featureView === 'more');
        // Data before actions; More remains last. No CSS visual-order mismatch.
        for (const el of [...items].sort((a, b) => Number(a.dataset.featureOrder || 0) - Number(b.dataset.featureOrder || 0))) {
            const key = el.dataset.featureView;
            const dest = destinations[key];
            if (!dest) { owned.forEach(n => n.remove()); throw new Error(`Unknown feature view: ${key}`); }
            placements.push({ el, dest, anchor: null, before: key === 'use' ? more : null });
        }
    }
    function render() {
        texts.forEach(([el, zh, en]) => { el.textContent = t(zh, en); });
        switches.setAttribute('aria-label', t('功能页面视图', 'Feature page view'));
        buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.featureViewButton === view)));
        panels.forEach(([el, key]) => { el.hidden = compact ? el.dataset.featurePopulated !== 'true' : key !== view; });
        connection.hidden = compact ? id === 'rules' && settings?.mode !== 'llm' : view !== 'settings';
        if (compact) {
            hint.textContent = id === 'rules'
                ? t('影响所有聊天 · 修改后自动保存', 'All chats · Changes save automatically')
                : t('数据属于当前聊天；设置与模板影响所有聊天并自动保存。编辑结果仍需保存。', 'Data belongs to this chat; settings and templates apply globally and save automatically. Save edited results explicitly.');
            return;
        }
        const hints = {
            use: id === 'rules'
                ? ['模式与发言人数影响所有聊天；仅显示当前模式适用的选项。', 'Mode and speaker limits apply globally; only options for the current mode are shown.']
                : [id === 'summary' ? '当前聊天的总结。编辑结果后点击“保存”；开关与自动规则影响所有聊天。' : '当前聊天的记忆。编辑后使用保存/取消；关闭功能仍按原行为收起内容。',
                    id === 'summary' ? 'Summary for this chat. Save edited results explicitly; feature switches and automatic rules apply globally.' : 'Memories for this chat. Use Save/Cancel after editing; disabling retains the existing content visibility behavior.'],
            settings: id === 'memory'
                ? ['运行设置影响所有聊天，修改后自动保存。调整单角色上限还会触发现有记忆裁剪，请谨慎降低。', 'Runtime settings apply globally and save automatically. Changing the per-character limit also triggers existing memory pruning; lower it carefully.']
                : ['运行设置影响所有聊天，修改后自动保存。', 'Runtime settings apply to all chats and save automatically.'],
            advanced: id === 'rules' && settings?.mode !== 'llm'
                ? ['导演 Prompt 与输出格式仅用于 LLM 模式；公式模式无需填写。', 'Director prompts and output schema are for LLM mode; Formula needs no prompt.']
                : ['高级模板影响所有聊天，输入后自动保存；无需自定义也可使用默认值。', 'Advanced templates apply globally and save on input; defaults work without customization.'],
        };
        hint.textContent = t(...hints[view]);
    }
    function restore() {
        for (const item of [...placements].reverse()) {
            if (item.anchor) { item.anchor.replaceWith(item.el); item.anchor = null; }
        }
        active = false;
    }
    const controller = {
        update(preview) {
            if (preview && !active) {
                try {
                    for (const item of placements) {
                        item.anchor = doc.createComment('feature-classic-position'); item.el.before(item.anchor);
                        if (item.before) item.before.before(item.el); else item.dest.append(item.el);
                    }
                    active = true;
                } catch (error) { restore(); throw error; }
            } else if (!preview && active) restore();
            render();
        },
        showView(key) {
            if (!['use', 'settings', 'advanced'].includes(key)) return;
            view = key;
            if (compact) panels.forEach(([el, name]) => { if (name === key) el.open = true; });
            render();
        },
        dispose() {
            switches.removeEventListener('click', onSwitch);
            connection.removeEventListener('click', onConnect);
            host.removeEventListener('change', onChange);
            restore(); owned.forEach(el => el.remove());
        },
    };
    const onSwitch = event => {
        const button = event.target.closest('button[data-feature-view-button]');
        if (button && switches.contains(button)) controller.showView(button.dataset.featureViewButton);
    };
    const onConnect = () => onConnection?.(id);
    const onChange = () => render(); // Existing mode/enable handlers retain control of their containers.
    switches.addEventListener('click', onSwitch);
    connection.addEventListener('click', onConnect);
    host.addEventListener('change', onChange);
    return controller;
}
