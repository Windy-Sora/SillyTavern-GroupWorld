import { skillDisplay } from './catalog-labels.js';

let skillViewSequence = 0;
export function createSkillView({ doc, settings, controller, act, lang }) {
    const viewId = `gd-muyu-skills-${++skillViewSequence}`;
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text, parent = settings, className = '') => { const el = doc.createElement(tag); el.textContent = text; el.className = className; parent.append(el); return el; };
    const section = node('section', '', settings, 'gd-muyu-skills');
    const button = (text, fn, parent = section) => { const el = node('button', text, parent, 'menu_button'); el.type = 'button'; el.onclick = () => act(fn); return el; };
    const label = (text, type, parent = section) => { const wrap = node('label', text, parent), input = node(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input', '', wrap); if (!['textarea', 'select'].includes(type)) input.type = type; wrap.className = type === 'checkbox' ? 'gd-muyu-skill-check' : 'gd-muyu-skill-field'; input.className = type === 'checkbox' ? '' : 'text_pole'; return input; };
    const fold = (text, parent = section) => { const el = node('details', '', parent); el.open = false; node('summary', text, el); return el; };
    const select = (title, options, parent) => { const el = label(title, 'select', parent); for (const [value, text] of options) node('option', text, el).value = value; el.value = ''; return el; };
    const bytes = text => new TextEncoder().encode(text || '').length;
    let state, pending = null, requested = false, listKey = '', resourceKey = '', resourceFields = [];
    const groupOpen = new Map([['user', true], ['builtin', false]]);
    const toggle = label(t('允许按需使用技能', 'Allow on-demand Skill use'), 'checkbox');
    toggle.onchange = () => act(() => controller.setSkillsEnabled(toggle.checked));
    const status = node('small', '', section, 'gd-muyu-skill-status'); status.setAttribute('role', 'status');
    const catalog = node('div', '', section, 'gd-muyu-skill-catalog');
    const toolbar = node('div', '', catalog, 'gd-muyu-skill-actions');
    const newButton = button(t('新建技能', 'New Skill'), () => request({ type: 'new' }), toolbar);
    const resume = button(t('继续未保存编辑', 'Resume unsaved draft'), () => { showPage('editor'); back.focus(); }, toolbar); resume.hidden = true;
    const libraryMenu = fold('⋯', toolbar); libraryMenu.className = 'gd-muyu-skill-menu';
    libraryMenu.children[0].setAttribute('aria-label', t('技能目录操作', 'Skill library actions'));
    const menuBody = node('div', '', libraryMenu, 'gd-muyu-skill-menu-body');
    const refresh = button(t('刷新', 'Refresh'), () => { libraryMenu.open = false; return controller.loadSkills(); }, menuBody);
    button(t('导入技能', 'Import Skill'), () => { libraryMenu.open = false; showPage('import'); importText.focus(); }, menuBody);
    const help = fold(t('使用说明与权限', 'Usage and permissions'), menuBody);
    node('p', t('技能是可复用的方法，不授予工具权限。保存在账户设置中；启用后用途和正文可按需外发给当前模型。不要存密钥或私密聊天副本。当前任务保留已加载版本，停用影响新任务。', 'Skills are reusable procedures, not permissions. Stored in account settings; enabled descriptions/documents may be sent to your model on demand. Never store credentials or private chat copies. Current tasks retain loaded versions; disabling affects new tasks.'), help);
    const filters = node('div', '', catalog, 'gd-muyu-skill-filters');
    const search = label(t('搜索技能', 'Search Skills'), 'search', filters); search.placeholder = t('名称或用途', 'Name or purpose');
    const source = select(t('来源', 'Source'), [['', t('全部来源', 'All sources')], ['builtin', t('内置', 'Builtin')], ['user', t('用户', 'User')]], filters);
    const enabled = select(t('状态', 'Status'), [['', t('全部状态', 'All states')], ['on', t('已启用', 'Enabled')], ['off', t('已禁用', 'Disabled')]], filters);
    const count = node('small', '', catalog), list = node('div', '', catalog, 'gd-muyu-skill-list');
    const confirm = node('div', '', section, 'gd-muyu-skill-confirm'); confirm.hidden = true;
    const confirmText = node('p', '', confirm), confirmActions = node('div', '', confirm, 'gd-muyu-skill-actions');
    const confirmButton = button(t('确认', 'Confirm'), async () => { const item = pending; if (!item) return; pending = null; confirm.hidden = true; await perform(item); }, confirmActions);
    const cancelButton = button(t('取消', 'Cancel'), () => { pending = null; confirm.hidden = true; }, confirmActions);
    async function perform(item) {
        if (item.type === 'new') controller.newSkill();
        else if (item.type === 'edit') await controller.editSkill(item.id, item.revision);
        else if (item.type === 'delete') { await controller.removeSkill(item.id, item.revision); showPage('catalog'); }
        else if (item.type === 'import') controller.importSkillText(item.text, item.mode);
        if (item.type !== 'delete') { showPage('editor'); chooseTab('body'); back.focus(); }
    }
    function request(item) {
        if (state.busy) return;
        libraryMenu.open = more.open = false;
        if (item.type !== 'delete' && state.dirty === false) return perform(item);
        pending = item; confirm.hidden = false;
        confirmText.textContent = item.type === 'delete' ? t('删除该用户技能？不能撤回已外发内容。', 'Delete this user Skill? Already shared text cannot be recalled.') : t('替换／放弃当前未保存编辑？', 'Replace / discard the current unsaved editor?');
        confirm.scrollIntoView?.({ block: 'nearest' }); confirmButton.focus();
    }
    const editor = node('div', '', section, 'gd-muyu-skill-editor'); editor.hidden = true;
    const editorHeader = node('div', '', editor, 'gd-muyu-skill-actions');
    const back = button(t('← 返回技能列表', '← Back to Skills'), () => { showPage('catalog'); search.focus(); }, editorHeader);
    const editorTitle = node('strong', '', editorHeader);
    const more = fold('⋯', editorHeader); more.className = 'gd-muyu-skill-menu';
    more.children[0].setAttribute('aria-label', t('当前技能操作', 'Current Skill actions'));
    const moreBody = node('div', '', more, 'gd-muyu-skill-menu-body');
    const editorStatus = node('small', '', editor, 'gd-muyu-skill-status gd-muyu-form-status');
    const basic = node('div', '', editor, 'gd-muyu-skill-basic');
    const readonlyDescription = node('p', '', editor);
    const tabs = node('div', '', editor, 'gd-muyu-skill-tabs'); tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', t('技能详情', 'Skill details'));
    const instructions = node('div', '', editor), resources = node('div', '', editor), advanced = node('div', '', editor);
    const readonlyBody = node('pre', '', instructions, 'gd-muyu-skill-readonly');
    const originalNote = node('small', t('正文与参考文件保留原语言；译名仅用于界面，不修改技能内容。', 'Instructions and references remain in their original language. Translated labels are for display only and do not change the Skill.'), instructions);
    originalNote.hidden = true;
    let activeTab = 'body';
    const tabEntries = [['body', t('正文', 'Instructions'), instructions], ['resources', t('参考文件', 'References'), resources], ['advanced', t('高级设置', 'Advanced'), advanced]];
    const tabButtons = tabEntries.map(([key, title, panel]) => {
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-label', title);
        const btn = button(title, () => chooseTab(key), tabs); btn.setAttribute('role', 'tab');
        panel.id = `${viewId}-${key}-panel`; btn.id = `${viewId}-${key}-tab`;
        btn.setAttribute('aria-controls', panel.id); panel.setAttribute('aria-labelledby', btn.id);
        return btn;
    });
    tabButtons.forEach((btn, index) => { btn.onkeydown = event => {
        const target = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : -1;
        if (target < 0) return; event.preventDefault(); chooseTab(tabEntries[target][0]); tabButtons[target].focus();
    }; });
    function chooseTab(key) {
        activeTab = key;
        tabEntries.forEach(([id, , panel], index) => { panel.hidden = id !== key; tabButtons[index].setAttribute('aria-selected', String(id === key)); tabButtons[index].tabIndex = id === key ? 0 : -1; });
        readonlyBody.hidden = key !== 'body' || state?.draft.source !== 'builtin';
    }
    function showPage(page) {
        catalog.hidden = page !== 'catalog'; editor.hidden = page !== 'editor'; exchange.hidden = page !== 'import';
        libraryMenu.open = more.open = false;
    }
    chooseTab('body');
    const inputs = {};
    for (const [key, zh, en, type, parent] of [
        ['name', '稳定名称（小写字母／数字／连字符）', 'Stable name (kebab-case)', 'text', advanced],
        ['displayName', '显示名称', 'Display name', 'text', basic],
        ['description', '何时使用', 'When to use', 'textarea', basic],
        ['body', '技能说明', 'Instructions', 'textarea', instructions],
        ['contentVersion', '作者版本', 'Author version', 'text', advanced],
        ['modelInvocable', '允许模型按需选用', 'Allow model selection', 'checkbox', advanced],
        ['userInvocable', '允许手动指定', 'Allow user invocation', 'checkbox', advanced],
        ['enabled', '新建保存后启用', 'Enable after creation', 'checkbox', advanced],
    ]) {
        const input = label(t(zh, en), type, parent); inputs[key] = input;
        if (type === 'textarea') input.rows = key === 'body' ? 6 : 2;
        input[type === 'checkbox' ? 'onchange' : 'oninput'] = () => controller.setSkillDraft({ [key]: type === 'checkbox' ? input.checked : input.value });
    }
    const resourceStatus = node('small', '', resources), resourceList = node('div', '', resources);
    function readResources() {
        const value = JSON.parse(state.draft.resourcesJson);
        if (!Array.isArray(value) || value.length > 31 || value.some(file => !file || typeof file !== 'object' || typeof file.path !== 'string' || typeof file.text !== 'string' || Object.keys(file).some(key => !['path', 'text'].includes(key)))) throw Error('SKILL_INVALID');
        return value;
    }
    function editResources(fn) { const files = readResources(); fn(files); controller.setSkillDraft({ resourcesJson: JSON.stringify(files, null, 2) }); }
    const addResource = button(t('添加参考文件', 'Add reference file'), () => editResources(files => { if (files.length >= 31) throw Error('SKILL_CAPACITY'); files.push({ path: 'references/new.md', text: '' }); }), resources);
    const raw = fold(t('原始资源 JSON（高级）', 'Raw resources JSON (advanced)'), resources);
    inputs.resourcesJson = label(t('资源列表 JSON：[{path,text}]', 'Resources JSON: [{path,text}]'), 'textarea', raw); inputs.resourcesJson.rows = 4;
    inputs.resourcesJson.oninput = () => controller.setSkillDraft({ resourcesJson: inputs.resourcesJson.value });
    const saveActions = node('div', '', editor, 'gd-muyu-skill-actions');
    const save = button(t('保存当前技能', 'Save Skill'), () => controller.saveSkill(), saveActions);
    const reset = button(t('重载已保存版本', 'Reload saved version'), () => request({ type: 'edit', id: state.draft.id, revision: state.rows.find(row => row.id === state.draft.id)?.revision }), saveActions);
    node('small', t('复制和导出只使用已保存版本，不包含未保存编辑。内置技能可复制后修改。', 'Copy/export use the saved version, not unsaved edits. Copy builtin Skills to edit them.'), moreBody);
    const copyName = label(t('复制为新的稳定名称', 'New stable name for copy'), 'text', moreBody);
    const copy = button(t('复制为用户技能（默认禁用）', 'Copy as user Skill (disabled)'), () => controller.copySkill(state.draft.id, state.draft.revision, copyName.value), moreBody);
    const exported = label(t('导出结果（完整 JSON，可复制保存）', 'Export output (complete JSON, copy to save)'), 'textarea', moreBody); exported.readOnly = true; exported.rows = 4;
    let exportSequence = 0;
    async function exportSaved(download) {
        const identity = { ...state.draft }, ticket = ++exportSequence;
        const text = await controller.exportSkill(identity.id, identity.revision);
        if (ticket !== exportSequence || state.draft.id !== identity.id || state.draft.revision !== identity.revision) return;
        exported.value = text;
        if (download) {
            const urlAPI = doc.defaultView?.URL, BlobType = doc.defaultView?.Blob;
            if (!urlAPI?.createObjectURL || !BlobType) { exported.focus(); return; }
            const url = urlAPI.createObjectURL(new BlobType([text], { type: 'application/json;charset=utf-8' }));
            const anchor = node('a', '', more); anchor.href = url; anchor.download = `${identity.name.replace(/[^a-z0-9-]/g, '_')}.skill.json`; anchor.hidden = true;
            try { anchor.click(); } finally { anchor.remove(); setTimeout(() => urlAPI.revokeObjectURL(url), 0); }
        }
    }
    const exportActions = node('div', '', moreBody, 'gd-muyu-skill-actions');
    const exportButton = button(t('导出已保存版本', 'Export saved version'), () => exportSaved(false), exportActions);
    const download = button(t('下载完整技能包', 'Download complete package'), () => exportSaved(true), exportActions);
    const removeSkill = button(t('删除当前技能', 'Delete current Skill'), () => request({ type: 'delete', id: state.draft.id, revision: state.draft.revision }), moreBody);
    const exchange = node('div', '', section); exchange.hidden = true;
    button(t('← 返回技能列表', '← Back to Skills'), () => { showPage('catalog'); search.focus(); }, exchange);
    node('strong', t('导入技能 · 文件或文本', 'Import Skill · file or text'), exchange);
    node('small', t('导入只填入编辑器；检查后再保存。同名替换仅限用户技能。', 'Import only fills the editor; review before saving. Replacement targets user Skills only.'), exchange);
    const importText = label(t('粘贴 SKILL.md 或完整文本包 JSON', 'Paste SKILL.md or complete package JSON'), 'textarea', exchange); importText.rows = 4;
    let importSequence = 0;
    importText.oninput = () => { importSequence++; };
    const file = label(t('或选择本地文件', 'Or choose a local file'), 'file', exchange); file.accept = '.md,.json';
    file.onchange = () => act(async () => { const selected = file.files?.[0]; if (!selected) return; const ticket = ++importSequence; if (selected.size > 524288) throw Error('SKILL_CAPACITY'); const text = await selected.text(); if (ticket === importSequence) { importText.value = text; file.value = ''; } });
    const importActions = node('div', '', exchange, 'gd-muyu-skill-actions');
    const imported = button(t('校验并导入编辑器（不保存）', 'Validate into editor (not saved)'), () => request({ type: 'import', text: importText.value }), importActions);
    const replaceImport = button(t('替换同名用户技能的编辑器（不保存）', 'Replace same-name user editor (not saved)'), () => request({ type: 'import', text: importText.value, mode: 'replace' }), importActions);
    search.oninput = source.onchange = enabled.onchange = renderRows;
    function renderRows() {
        if (!state) return;
        const query = search.value.toLowerCase().trim();
        const rows = state.rows.filter(row => { const display = skillDisplay(row, lang); return `${display.displayName} ${display.description} ${row.displayName} ${row.name} ${row.description}`.toLowerCase().includes(query) && (!source.value || row.source === source.value) && (!enabled.value || row.enabled === (enabled.value === 'on')); });
        count.textContent = t(`显示 ${rows.length} / ${state.rows.length} 项`, `${rows.length} / ${state.rows.length} shown`);
        const key = JSON.stringify([rows, state.draft.id, state.busy, query, source.value, enabled.value]); if (key === listKey) return; listKey = key;
        list.replaceChildren();
        if (!rows.length) node('p', state.rows.length ? t('没有符合筛选条件的技能。', 'No Skills match these filters.') : t('暂无技能。可以新建或导入。', 'No Skills yet. Create or import one.'), list);
        for (const kind of ['user', 'builtin']) {
            const matches = rows.filter(row => row.source === kind); if (!matches.length) continue;
            const group = fold((kind === 'user' ? t('我的技能', 'My Skills') : t('内置技能', 'Builtin Skills')) + ` · ${matches.length}`, list);
            group.setAttribute('data-source', kind); group.open = !!query || !!source.value || !!enabled.value || groupOpen.get(kind);
            group.ontoggle = () => { if (!search.value.trim() && !source.value && !enabled.value) groupOpen.set(kind, group.open); };
            for (const row of matches) {
                const display = skillDisplay(row, lang);
                const item = node('div', '', group, 'gd-muyu-skill-row'); item.setAttribute('data-skill-id', row.id); item.setAttribute('data-selected', String(row.id === state.draft.id));
                const selectRow = button('', () => request({ type: 'edit', id: row.id, revision: row.revision }), item);
                selectRow.className = 'gd-muyu-skill-select'; selectRow.disabled = state.busy;
                selectRow.setAttribute('aria-label', t('查看／编辑', 'View / edit') + ': ' + display.displayName);
                node('strong', display.displayName, selectRow);
                const description = node('small', display.description, selectRow); description.title = display.description;
                const enableButton = button(row.enabled ? t('已启用', 'Enabled') : t('已禁用', 'Disabled'), () => controller.setSkillEnabled(row.id, row.revision, !row.enabled), item);
                enableButton.disabled = state.busy; enableButton.setAttribute('aria-pressed', String(row.enabled));
                enableButton.setAttribute('aria-label', (row.enabled ? t('禁用', 'Disable') : t('启用', 'Enable')) + ': ' + display.displayName);
            }
        }
    }
    function renderResources(readonly) {
        let files; try { files = readResources(); } catch { files = null; }
        resourceStatus.textContent = files ? t(`${files.length} 个参考文件；保存时统一校验路径与内容。`, `${files.length} reference files; paths/content are validated on save.`) : t('资源 JSON 无效，请在高级编辑中修正；不会丢弃原文。', 'Invalid resources JSON; repair it in advanced editing. Original text is retained.');
        addResource.disabled = state.busy || readonly || !files || files.length >= 31;
        const key = JSON.stringify([state.draft.id, files?.length ?? -1]);
        if (resourceKey !== key) {
            resourceKey = key; resourceList.replaceChildren(); resourceFields = [];
            for (let index = 0; index < (files?.length ?? 0); index++) {
                const item = fold('', resourceList), title = item.children[0];
                const path = label(t('文件路径', 'File path'), 'text', item), text = label(t('参考正文', 'Reference text'), 'textarea', item); text.rows = 4;
                path.oninput = () => editResources(files => { files[index].path = path.value; });
                text.oninput = () => editResources(files => { files[index].text = text.value; });
                const remove = button(t('移除此参考文件', 'Remove this reference'), () => editResources(files => { files.splice(index, 1); }), item);
                resourceFields.push({ path, text, remove, title });
            }
        }
        resourceFields.forEach((fields, index) => { const value = files[index]; fields.title.textContent = `${value.path || t('未命名文件', 'Unnamed file')} · ${bytes(value.text)} B`; for (const key of ['path', 'text']) { if (fields[key].value !== value[key]) fields[key].value = value[key]; fields[key].disabled = state.busy || readonly; } fields.remove.disabled = state.busy || readonly; });
        return !!files;
    }
    return { render(s) {
        state = s.skills; section.hidden = !state?.available; if (!state?.available) return;
        if (!state.loaded && !requested) { requested = true; queueMicrotask(() => act(() => controller.loadSkills())); }
        toggle.checked = state.enabled; toggle.disabled = refresh.disabled = newButton.disabled = imported.disabled = replaceImport.disabled = file.disabled = confirmButton.disabled = cancelButton.disabled = state.busy;
        const readonly = state.draft.source === 'builtin';
        basic.hidden = readonly; (inputs.body.parentElement || inputs.body.parent).hidden = readonly;
        resume.hidden = !state.dirty; resume.disabled = state.busy;
        const display = skillDisplay(state.draft, lang);
        readonlyDescription.hidden = !readonly; readonlyDescription.textContent = display.description;
        originalNote.hidden = !readonly || activeTab !== 'body';
        readonlyBody.textContent = state.draft.body; readonlyBody.hidden = !readonly || activeTab !== 'body';
        saveActions.hidden = readonly;
        removeSkill.hidden = readonly || !state.draft.id; removeSkill.disabled = state.busy;
        for (const [key, input] of Object.entries(inputs)) {
            if (input.type === 'checkbox') input.checked = state.draft[key]; else if (input.value !== state.draft[key]) input.value = state.draft[key];
            input.disabled = state.busy || readonly || key === 'name' && !!state.draft.id || key === 'enabled' && !!state.draft.id;
        }
        const validResources = renderResources(readonly);
        save.disabled = state.busy || readonly || !validResources || !state.draft.name || !state.draft.description.trim() || !state.draft.body.trim();
        copy.disabled = exportButton.disabled = download.disabled = state.busy || !state.draft.id;
        reset.disabled = state.busy || !state.draft.id || !state.rows.some(row => row.id === state.draft.id);
        editorStatus.textContent = (readonly ? t('内置只读 · 可复制后修改', 'Builtin read-only · copy to edit') : state.dirty ? t('未保存编辑', 'Unsaved edits') : state.draft.id ? t('已载入保存版本', 'Saved version loaded') : t('新建草稿 · 尚未保存', 'New draft · not saved')) + ` · ${bytes(state.draft.body)} B`;
        editorStatus.setAttribute('data-state', state.error ? 'error' : state.busy ? 'saving' : state.dirty ? 'dirty' : 'ready');
        editorTitle.textContent = display.displayName || t('新建技能', 'New Skill');
        tabButtons[1].textContent = t('参考文件', 'References') + ` · ${resourceFields.length}`;
        status.textContent = state.error ? t('操作失败，编辑内容已保留：', 'Operation failed; draft retained: ') + state.error : state.busy ? t('正在处理…', 'Working…') : state.result ? t('已更新内存，持久化未确认；请核对，不自动重试。', 'Memory updated; persistence unconfirmed. Check, do not auto retry.') : state.enabled ? t('技能按需使用，点击名称查看或编辑。', 'Skills are used on demand. Select a name to view or edit.') : t('技能已停用；保留各项启用状态。', 'Skills are off; individual enabled states are retained.');
        renderRows();
    } };
}
