/** Controller-owned editor, rendered with textContent: stored notes are never HTML. */
export function createAgentMemoryView({ doc, settings, controller, act, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text, parent) => { const el = doc.createElement(tag); el.textContent = text; parent.append(el); return el; };
    const section = node('details', '', settings); section.className = 'gd-muyu-agent-memory';
    node('summary', t('暮羽长期记忆', 'Muyu long-term memory'), section);
    node('p', t('保存你的偏好、约定和背景，不是角色剧情记忆。存入酒馆账户设置，无需附属插件；明文保存，不要填写密钥。开启后相关记忆可按需发送给当前模型，关闭不删除。多酒馆标签页同时保存可能覆盖设置，建议单页使用。', 'Your preferences, agreements and background, not character story memory. Stored unencrypted in ST account settings without a companion plugin; never enter credentials. Enabled notes may be sent to the active model on demand; disabling does not delete them. Concurrent ST tabs can overwrite settings; use one tab.'), section);
    const toggleLabel = node('label', t('允许按需读取，并按明确请求保存／删除记忆（默认关闭）', 'Allow on-demand reads and explicit-request saves / deletes (off by default)'), section), enabled = node('input', '', toggleLabel); enabled.type = 'checkbox';
    const status = node('p', '', section); status.setAttribute('role', 'status');
    const button = (text, parent = section) => { const el = node('button', text, parent); el.type = 'button'; el.className = 'menu_button'; return el; };
    const load = button(t('刷新记忆列表', 'Refresh notes')), add = button(t('新增／放弃编辑', 'New / discard editor'));
    const query = node('input', '', section); query.type = 'search'; query.className = 'text_pole'; query.placeholder = t('搜索标题或正文', 'Search title or content');
    query.setAttribute('aria-label', query.placeholder);
    const list = node('div', '', section);
    const titleLabel = node('label', t('标题', 'Title'), section), title = node('input', '', titleLabel); title.type = 'text'; title.className = 'text_pole'; title.maxLength = 80;
    const scopeLabel = node('label', t('使用范围', 'Scope'), section), scope = node('select', '', scopeLabel); scope.className = 'text_pole';
    for (const [value, zh, en] of [['chat', '仅当前聊天', 'Current ST chat only'], ['account', '账户内所有聊天', 'All chats in this account']]) { const option = node('option', t(zh, en), scope); option.value = value; }
    const contentLabel = node('label', t('记忆正文', 'Content'), section), content = node('textarea', '', contentLabel); content.rows = 5; content.className = 'text_pole';
    node('small', t('最多 256 条；每条 16000 字符／64000 JSON UTF-8 字节；整库 2 MiB。超限拒绝保存，不静默截断。', 'Up to 256 notes; each 16000 characters / 64000 JSON UTF-8 bytes; repository 2 MiB. Over-limit saves are rejected, never silently truncated.'), section);
    node('small', t('普通切页保留草稿；切换聊天或账户后旧草稿禁止保存，请复制或新建。删除不会抹去已保存的旧对话及旧摘要。此阶段不自动提炼聊天或工具资料，模型只能记住本次明确要求保存的原话。', 'Drafts survive view changes. Switching ST chats or accounts blocks saving the old draft: copy it or start a new one. Deleting a note does not erase old conversations or summaries. No background extraction; model writes are limited to explicitly requested quotes from the current user message.'), section);
    const save = button(t('保存这条记忆', 'Save this note'));
    let state = null, deleteId = null;
    function renderRows() {
        list.replaceChildren(); if (!state) return;
        const search = (query.value || '').toLowerCase();
        for (const row of state.rows.filter(note => (note.title + '\n' + note.content).toLowerCase().includes(search))) {
            const deleteKey = `${row.id}:${row.revision}`;
            const item = node('div', '', list); item.className = 'gd-muyu-memory-row';
            node('span', row.title + ' · ' + (row.scope === 'chat' ? t('当前聊天', 'This chat') : t('账户', 'Account')), item);
            const edit = button(t('编辑', 'Edit'), item), remove = button(deleteId === deleteKey ? t('确认删除', 'Confirm delete') : t('删除', 'Delete'), item);
            edit.disabled = remove.disabled = state.busy;
            edit.onclick = () => act(() => controller.editAgentMemory(row.id));
            remove.onclick = () => { if (deleteId !== deleteKey) { deleteId = deleteKey; renderRows(); } else act(async () => { await controller.removeAgentMemory(row.id, row.revision); deleteId = null; }); };
        }
    }
    query.oninput = renderRows;
    enabled.onchange = () => act(() => controller.setAgentMemoryEnabled(enabled.checked));
    load.onclick = () => act(() => controller.loadAgentMemory()); add.onclick = () => act(() => { deleteId = null; controller.newAgentMemory(); });
    title.oninput = () => controller.setAgentMemoryDraft({ title: title.value });
    content.oninput = () => controller.setAgentMemoryDraft({ content: content.value });
    scope.onchange = () => controller.setAgentMemoryDraft({ scope: scope.value });
    save.onclick = () => act(() => controller.saveAgentMemory());
    section.addEventListener('toggle', () => { if (section.open && state && !state.loaded) act(() => controller.loadAgentMemory()); });
    return { render(s) {
        state = s.agentMemory; section.hidden = !state?.available; if (!state?.available) return;
        enabled.checked = state.enabled; enabled.disabled = load.disabled = add.disabled = state.busy;
        for (const [el, value] of [[title, state.draft.title], [content, state.draft.content], [scope, state.draft.scope]]) { if (el.value !== value) el.value = value; el.disabled = state.busy; }
        save.disabled = state.busy || state.stale || !state.draft.title.trim() || !state.draft.content.trim();
        const labels = { NOTE_CONFLICT: t('记录已变化，请重新打开；草稿已保留', 'Note changed; reopen it. Draft retained.'), NOTE_SAVE_UNKNOWN: t('保存未确认，草稿保留；请核对后再重试', 'Save unconfirmed; draft retained. Check before retrying.'), NOTE_SECRET: t('检测到疑似密钥，请移除', 'Possible credential detected; remove it.'), NOTE_CAPACITY: t('记忆容量已满，请清理', 'Note capacity exceeded; clean up notes.'), NOTE_IDENTITY: t('账户身份不可用或已切换', 'Account identity unavailable or changed'), NOTE_INVALID: t('内容无效或超出容量限制', 'Invalid content or over capacity'), NOTE_STALE_TARGET: t('聊天已切换，不能保存旧草稿', 'Chat changed; old draft cannot be saved') };
        status.textContent = state.stale ? t('聊天或账户已切换，旧草稿保留但禁止保存。点“新增／放弃编辑”开始新条目。', 'ST chat or account changed. Old draft retained but cannot be saved; choose New.') : state.error ? labels[state.error] || t('记忆暂不可用；草稿已保留', 'Notes unavailable; draft retained') : state.busy ? t('正在保存或读取…', 'Saving or loading…') : `${state.rows.length} ` + t('条可见记忆 · ', 'visible notes · ') + (state.enabled ? t('按需读取已开启', 'On-demand use enabled') : t('模型使用已关闭', 'Model use disabled'));
        renderRows();
    } };
}
