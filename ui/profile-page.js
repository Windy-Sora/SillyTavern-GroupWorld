// Reuse live controls. Anchors restore classic order without copying values or
// rebinding business events. Dynamic loader/results stay in the data wrapper.
export function mountProfilePage(root, { settings, onConnection } = {}) {
    const section = root.querySelector('#gd-profile-section');
    if (!section) return null;
    const doc = root.ownerDocument;
    const t = (zh, en) => settings?.lang === 'en' ? en : zh;
    const owned = [];
    const translations = [];
    const placements = [];
    let active = false;
    let lastRoute;
    function node(tag, className, parent, zh, en) {
        const el = doc.createElement(tag);
        el.className = className;
        parent?.append(el);
        if (zh) translations.push([el, zh, en]);
        return el;
    }
    const scope = node('p', 'gd-profile-page-only gd-profile-hint', null,
        '启用设置影响所有聊天；下方资料属于当前聊天。关闭后沿用原行为收起内容，不会删除档案。',
        'Enabling applies to all chats; the data below belongs to this chat. Disabling hides the content without deleting profiles.');
    section.before(scope);
    owned.push(scope);
    const page = node('div', 'gd-profile-page-only gd-profile-page', section);
    owned.push(page);
    const panels = {};
    // Keep existing validation output visible even when Advanced is not selected.
    const warning = node('div', 'gd-profile-warning', page);
    for (const id of ['use', 'settings', 'advanced']) {
        panels[id] = node(id === 'advanced' ? 'details' : 'div', 'gd-profile-view', page);
        panels[id].id = `gd-profile-view-${id}`;
        if (id === 'advanced') node('summary', '', panels[id], '提示词与输出格式', 'Prompts & output format');
    }
    node('p', 'gd-profile-hint', panels.use, '当前聊天的角色档案。首次生成可展开“更多操作”，选择“全部重新生成”；编辑后使用原有保存/取消按钮。',
        'Profiles in this chat. For first-time generation, expand More actions and choose Regenerate All. Edits use the existing Save/Cancel buttons.');
    const data = node('div', '', panels.use);
    const actions = node('div', 'gd-profile-actions', panels.use);
    const more = node('details', 'gd-profile-disclosure', panels.use);
    node('summary', '', more, '更多操作', 'More actions');
    node('p', 'gd-profile-hint', more,
        '扫描存档读取已有记录；全部重新生成会重新处理当前群聊中未禁用的角色，可能更新已有档案。',
        'Scan reads saved records. Regenerate all processes enabled group members again and may update existing profiles.');
    const moreActions = node('div', 'gd-profile-actions', more);
    const library = node('details', 'gd-profile-disclosure', panels.use);
    node('summary', '', library, '档案库', 'Profile library');
    node('p', 'gd-profile-hint', library,
        '保存当前：将当前档案保存到库。应用：按下方匹配、覆盖及模板选项导入到当前聊天或更新模板设置。',
        'Save Current stores profiles in the library. Apply imports into this chat or updates templates according to the matching, overwrite and template options below.');
    node('p', 'gd-profile-hint', panels.settings,
        '生成设置 · 影响所有聊天，修改后自动保存。',
        'Generation settings · All chats, saved automatically.');
    const connection = node('button', 'menu_button', panels.settings, '模型连接…', 'Model connections…');
    connection.type = 'button';
    node('p', 'gd-profile-hint', panels.advanced,
        '影响所有聊天。Prompt、Schema 和渲染模板输入后自动保存；“默认”会恢复对应字段。此处无需填写也可使用默认模板。',
        'Applies to all chats. Prompt, schema and render template save automatically on input. Reset restores the corresponding field; default templates work without custom text.');

    function place(selector, parent) {
        const el = section.querySelector(selector);
        if (!el) throw new Error(`Profile layout missing ${selector}`);
        placements.push({ el, parent, anchor: null });
    }
    // Resolve everything before moving anything, so incomplete templates stay intact.
    try {
        place('[data-profile-group="data"]', data);
        place('#gd-profile-detect-changes', actions);
        place('#gd-profile-scan-save', moreActions);
        place('[data-profile-group="batch"]', moreActions);
        place('#gd-profile-library-section', library);
        place('[data-profile-group="settings"]', panels.settings);
        place('[data-profile-group="advanced"]', panels.advanced);
        place('#gd-profile-template-warning', warning);
    } catch (error) { owned.forEach(el => el.remove()); throw error; }

    function restore() {
        // Reverse order also restores the warning inside its original advanced group.
        for (const item of [...placements].reverse()) {
            if (item.anchor) { item.anchor.replaceWith(item.el); item.anchor = null; }
        }
        active = false;
        section.classList.remove('gd-profile-arranged');
    }
    function update(preview, route) {
        translations.forEach(([el, zh, en]) => { el.textContent = t(zh, en); });
        if (preview && !active) {
            try {
                for (const item of placements) {
                    item.anchor = doc.createComment('profile-classic-position');
                    item.el.before(item.anchor);
                    item.parent.append(item.el);
                }
                active = true;
                section.classList.add('gd-profile-arranged');
            } catch (error) { restore(); throw error; }
        } else if (!preview && active) restore();
        if (preview && route === 'profile-library' && lastRoute !== route) {
            library.open = true;
        }
        lastRoute = route;
    }
    const onConnect = () => onConnection?.();
    connection.addEventListener('click', onConnect);
    return {
        update,
        dispose() {
            connection.removeEventListener('click', onConnect);
            restore(); owned.forEach(el => el.remove());
        },
    };
}
