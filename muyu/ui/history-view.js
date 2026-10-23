import { taskCatalog } from '../modules/catalog.js';
import { createHistoryActions } from './history-actions.js';
import { historyDatePresentation } from './history-presentation.js';
import { historyErrorLabel } from './history-error.js';

/** Responsive history browser. Viewing another chat never changes the execution target. */
export function createHistoryView({ doc, settings, chat, workspace, sidebarRoot, controller, act, lang, setSidebarOpen, openServices, launcherActions = null }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text, parent) => { const el = doc.createElement(tag); el.textContent = text; parent.append(el); return el; };
    const button = (text, parent) => { const el = node('button', text, parent); el.type = 'button'; el.className = 'menu_button'; return el; };
    const select = (label, values, owner) => {
        const wrapper = node('label', label, owner), el = node('select', '', wrapper); el.className = 'text_pole';
        for (const [value, text] of values) { const option = node('option', text, el); option.value = value; }
        return el;
    };
    const section = node('section', '', settings); node('h3', t('对话历史', 'Conversation history'), section);
    if (openServices) { const services = node('button', t('服务安装与自检…', 'Service installation & checks…'), section); services.type = 'button'; services.className = 'menu_button'; services.onclick = openServices; }
    const storageLocation = node('p', '', section); storageLocation.className = 'gd-muyu-storage-location';
    const storageStatus = node('p', '', section); storageStatus.className = 'gd-muyu-storage-status'; storageStatus.setAttribute('role', 'status');
    const label = node('label', t('自动保存暮羽对话（默认开启）', 'Automatically save Muyu conversations (on by default)'), section);
    const enabled = node('input', '', label); enabled.type = 'checkbox';
    node('small', t('保留旧存储初始偏好；读取来源与写入位置分别管理，不写入角色聊天存档或角色卡。浏览器记录不跨设备同步，刷新不恢复授权或执行。', 'Existing initial storage preferences are retained. Read sources and write locations are separate; roleplay chat saves and cards are unaffected. Browser records do not sync across devices; reload never restores grants or execution.'), section);
    node('small', t('开启自动保存时，配置操作与整单步骤还会在本浏览器保存独立检查点（包含提议差异，可能含私人文本）。存储失败会停止未开始的写入；关闭后不再记录，但不删除旧记录。检查点不同步、不自动续跑或撤回，可在对话底部展开核对与删除。', 'When auto-save is on, configuration operations and bundle steps also save separate checkpoints in this browser (proposed differences may include private text). Storage failure stops unstarted writes. Turning it off stops recording without deleting existing records. Checkpoints do not sync, resume or undo automatically; review or delete them below the conversation.'), section);
    const storageChoice = select(t('对话存储位置', 'Conversation storage'), [
        ['auto', t('自动（服务插件优先，否则当前浏览器）', 'Automatic (service plugin, otherwise this browser)')],
        ['world-book', t('酒馆世界书（无需服务插件，可跨设备接续）', 'ST world books (no service plugin; continue across devices)')],
        ['account-settings', t('酒馆账户设置（兼容方式）', 'ST account settings (legacy option)')],
    ], section);
    const storageLabel = storageChoice.parentElement || storageChoice.parent;
    const storageNotice = node('small', '', section);
    const routingPanel = node('div', '', section);
    const sourceLabels = { browser: t('当前浏览器', 'This browser'), 'account-settings': t('酒馆账户设置', 'ST account settings'), 'world-book': t('酒馆世界书', 'ST world books'), server: t('服务插件私有文件', 'Service plugin private files') };
    const readChoice = select(t('读取历史来源', 'Read history from'), [['', t('尚未连接，请选择来源', 'Not connected; choose a source')], ...Object.entries(sourceLabels)], routingPanel);
    node('small', t('只列出所选来源的历史，不混合读取，不自动回退。切换保留各来源的本页记录和草稿；运行或等待授权时请先结束任务。', 'Lists only the selected source: no merging or silent fallback. Switching retains each source’s page records and drafts. Finish or cancel pending tasks before switching.'), routingPanel);
    node('small', t('保存前会读取目标位置的同 ID 记录作防覆盖核验；这些核验内容不混入聊天历史，也不会因此发给模型。', 'Saving may read the same-ID record at each target to prevent overwrites. Verification data is not merged into history or sent to the model.'), routingPanel);
    const writes = node('details', '', routingPanel); node('summary', t('写入位置（可多选）', 'Write locations (multiple)'), writes);
    node('small', t('开关只管理后续保存，不删除记录，不自动复制旧历史；每个位置单独核验，冲突不覆盖。重命名、归档和删除只管理当前读取源，并要求开启该源写入。全部关闭仍可读取。服务位置需要额外插件；世界书为明文（每条8 MiB、总计64 MiB），账户设置每条8 MiB、总计32 MiB。', 'Switches control subsequent saves only: no deletion or automatic history copying. Each location is verified independently; conflicts are not overwritten. Rename, archive and delete manage only the current read source and require its write switch. All switches off still permits reading. Server files need the companion plugin. World books are plaintext (8 MiB per record, 64 MiB total); account settings allow 8 MiB per record, 32 MiB total.'), writes);
    const writeControls = new Map();
    for (const [key, labelText] of Object.entries(sourceLabels)) {
        const label = node('label', labelText, writes), input = node('input', '', label), result = node('small', '', writes); input.type = 'checkbox';
        input.onchange = () => act(() => {
            const h = controller.snapshot().history, selected = new Set(h.writeTargets || h.routing.writeTargets);
            if (input.checked) selected.add(key); else selected.delete(key);
            return controller.setHistoryWriteTargets([...selected]);
        });
        writeControls.set(key, { input, result });
    }
    readChoice.onchange = () => { if (readChoice.value) act(() => controller.setHistoryReadSource(readChoice.value)); };
    const volumePanel = node('details', '', section);
    node('summary', t('世界书分卷设置', 'World-book volume settings'), volumePanel);
    const volumeLabel = node('label', t('新会话分卷目标大小（MiB）', 'New-conversation volume target (MiB)'), volumePanel);
    const volumeInput = node('input', '', volumeLabel);
    volumeInput.type = 'number'; volumeInput.min = '1'; volumeInput.max = '16'; volumeInput.step = '1'; volumeInput.className = 'text_pole';
    node('small', t('默认8，范围1–16，修改后自动保存，从后续新会话分配生效。按整本UTF-8大小计；调小不会搬迁或截断旧内容。单会话可独占超目标卷，已有会话仍在原卷增长；单本安全上限20 MiB，达到时保存会被拒绝，请导出备份。', 'Default 8, range 1–16. Saved automatically; used for subsequent new-conversation placement. Counts the entire book in UTF-8. Lowering it does not move or truncate existing data. A single conversation may exceed the target in its own volume; existing conversations grow in place. The 20 MiB hard limit rejects oversized saves; export a backup.'), volumePanel);
    volumeInput.onchange = () => {
        if (disposed || volumeInput.disabled) return;
        return act(() => controller.setHistoryVolumeMiB(Number(volumeInput.value)));
    };
    const retry = button(t('重试保存', 'Retry saving'), section);
    const copyPanel = node('details', '', section);
    node('summary', t('复制旧历史到世界书…', 'Copy old history to world books…'), copyPanel);
    node('small', t('请先导出备份并停止其他设备编辑。仅复制已保存的记录，保留原件与会话标识；相同记录跳过，冲突不覆盖。不恢复授权、任务或检查点。世界书是明文存储。失败后可重试；不要同时在两处继续同一对话。', 'Export a backup and stop editing on other devices first. Copies saved records only, retaining originals and conversation IDs. Identical records are skipped; conflicts are not overwritten. Does not restore grants, tasks or checkpoints. World books are plaintext. Retry after failures; do not continue the same conversation in both locations.'), copyPanel);
    const copySource = select(t('旧历史位置', 'Old history location'), [
        ['browser', t('当前浏览器', 'This browser')], ['account-settings', t('酒馆账户设置', 'ST account settings')], ['server', t('服务插件私有文件', 'Service plugin private files')],
    ], copyPanel);
    copySource.value = 'browser';
    const copyButton = button(t('确认复制到世界书（保留原件）', 'Confirm copy to world books (keep originals)'), copyPanel);
    const copyStatus = node('p', '', copyPanel); copyStatus.setAttribute('role', 'status');
    const mergePanel = node('details', '', section);
    node('summary', t('合并旧版世界书存档…', 'Consolidate legacy world-book archives…'), mergePanel);
    node('small', t('请先导出备份、关闭其他设备和旧页面。仅合并当前酒馆账户的旧版暮羽存档，保留会话ID、版本及删除标记；普通世界书和其他存储位置不变。合并后读取新卷，旧书默认保留作备份；旧书若被改动会报冲突，不自动选版本。失败保留已完成部分，可重试。不恢复权限或任务。', 'Export backups and close other devices and old tabs first. Consolidates only this account’s legacy Muyu archives, preserving conversation IDs, revisions and deletion markers. Ordinary lore and other storage backends are unchanged. New volumes become authoritative; old books remain as backups by default. Changes to old backups cause a conflict, not an automatic version choice. Completed work survives failures; retry is supported. Does not restore grants or tasks.'), mergePanel);
    const mergeButton = button(t('确认合并（保留旧书）', 'Confirm consolidation (keep old books)'), mergePanel);
    node('small', t('旧书是静态备份，不随新卷中的更新或删除同步，可能仍保留旧正文；需要减少世界书列表或移除旧副本时，另行确认下方清理。', 'Old books are static backups: updates and deletions in new volumes do not update them, so old text may remain. Separately confirm removal below to reduce the world-book list or remove those copies.'), mergePanel);
    const cleanupButton = button(t('清理已合并的旧书…', 'Remove consolidated old books…'), mergePanel);
    const cleanupPrompt = node('p', t('仅清理已合并、校验通过且未被改动的旧版书。此操作不可撤销，会删除旧备份；新卷与其中的删除保护保留。请先导出备份并关闭旧页面，避免旧页面重新创建旧书。', 'Removes only verified, unchanged legacy books already consolidated. This cannot be undone and deletes those old backups; new volumes and their deletion protection remain. Export backups and close old tabs first to prevent stale pages recreating old books.'), mergePanel);
    const cleanupConfirm = button(t('确认清理旧书（不可撤销）', 'Confirm removal of old books (irreversible)'), mergePanel);
    const cleanupCancel = button(t('取消清理', 'Cancel removal'), mergePanel);
    const mergeStatus = node('p', '', mergePanel); mergeStatus.setAttribute('role', 'status');
    let cleanupIntent = null;
    const mergeKey = h => JSON.stringify([h?.sourceKey, h?.readSource, h?.backend, h?.writeTargets || h?.routing?.writeTargets]);
    const mayMerge = () => {
        const s = controller.snapshot(), h = s.history;
        return !disposed && !!h?.canMergeLegacyHistory && h.backend === 'world-book' && h.canManage !== false && !h.loading && !h.pending && !s.resetting && !s.busy && s.interaction?.status !== 'pending';
    };
    const dismissCleanup = () => { cleanupIntent = null; cleanupPrompt.hidden = cleanupConfirm.hidden = cleanupCancel.hidden = true; };
    dismissCleanup();
    mergeButton.onclick = () => { if (!mayMerge()) return; dismissCleanup(); return act(() => controller.mergeLegacyHistory(false)); };
    cleanupButton.onclick = () => {
        if (!mayMerge()) return;
        cleanupIntent = mergeKey(controller.snapshot().history);
        cleanupPrompt.hidden = cleanupConfirm.hidden = cleanupCancel.hidden = false;
    };
    cleanupCancel.onclick = dismissCleanup;
    cleanupConfirm.onclick = () => {
        if (!mayMerge() || cleanupIntent === null || cleanupIntent !== mergeKey(controller.snapshot().history)) return;
        dismissCleanup(); return act(() => controller.mergeLegacyHistory(true));
    };
    const bar = node('div', '', chat); bar.className = 'gd-muyu-session-bar';
    const toggle = button(t('历史', 'History'), bar), title = node('strong', '', bar);
    const menu = node('details', '', bar); menu.className = 'gd-muyu-session-menu';
    const menuToggle = node('summary', '⋯', menu); menuToggle.setAttribute('aria-label', t('当前对话操作', 'Conversation actions'));
    const menuList = node('div', '', menu); menuList.className = 'gd-muyu-session-menu-list';
    menuList.setAttribute('role', 'group'); menuList.setAttribute('aria-label', t('当前对话操作', 'Conversation actions'));
    const rename = button(t('重命名', 'Rename'), menuList), archive = button(t('归档', 'Archive'), menuList), remove = button(t('删除', 'Delete'), menuList);
    let rowMenus = [];
    const dismissMenu = event => {
        if (menu.open && !menu.contains(event.target)) menu.open = false;
        for (const entry of rowMenus) if (entry.root.open && !entry.root.contains?.(event.target)) entry.root.open = false;
    };
    const escapeMenu = event => {
        if (menu.open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); menu.open = false; menuToggle.focus(); }
    };
    doc.addEventListener?.('pointerdown', dismissMenu);
    doc.addEventListener?.('keydown', escapeMenu);
    menuList.addEventListener('click', event => { if (event.target.closest?.('button') && !event.target.disabled) menu.open = false; });
    const status = node('small', '', bar); status.setAttribute('role', 'status');
    const stalePanel = node('section', '', chat); stalePanel.className = 'gd-muyu-history-confirm'; stalePanel.hidden = true;
    const staleText = node('p', '', stalePanel); staleText.setAttribute('role', 'status');
    const reload = button(t('重新载入存储版本…', 'Reload stored version…'), stalePanel);
    const reloadPrompt = node('p', t('这会替换本页记录，并放弃其中未保存的消息、摘要与回执；若存储中已删除，则移除本页旧副本。未发送文字保留，已执行操作不会撤销。请先导出需要保留的内容。', 'This replaces the page record and discards its unsaved messages, summary and receipts; if deleted in storage, it removes the old page copy. Unsent text remains and executed operations are not undone. Export anything you need first.'), stalePanel);
    const reloadConfirm = button(t('确认重新载入（放弃本页记录修改）', 'Confirm reload (discard page record changes)'), stalePanel);
    const reloadCancel = button(t('取消重新载入', 'Cancel reload'), stalePanel);
    let reloadIntent = null;
    const reloadKey = h => h && JSON.stringify([h.sourceKey || null, h.sessionId]);
    reload.onclick = () => { const h = controller.snapshot().history; if (!h?.external) return; reloadIntent = reloadKey(h); reloadPrompt.hidden = reloadConfirm.hidden = reloadCancel.hidden = false; };
    reloadCancel.onclick = () => { reloadIntent = null; reloadPrompt.hidden = reloadConfirm.hidden = reloadCancel.hidden = true; };
    reloadConfirm.onclick = () => act(async () => {
        const h = controller.snapshot().history;
        if (!reloadIntent || reloadIntent !== reloadKey(h) || !h.external) throw Error('NOT_READY');
        await controller.reloadHistory({ discardLocal: true }); reloadIntent = null;
    });
    reloadCancel.onclick();
    const sidebar = node('aside', '', sidebarRoot || chat); sidebar.className = 'gd-muyu-history-sidebar'; sidebar.setAttribute('aria-label', t('暮羽历史会话', 'Muyu history'));
    const heading = node('div', '', sidebar); heading.className = 'gd-muyu-sidebar-heading';
    node('strong', t('对话', 'Conversations'), heading);
    const close = button(t('收起历史', 'Close history'), heading);
    close.className += ' gd-muyu-history-close';
    const currentTitle = launcherActions ? node('small', '', sidebar) : null;
    if (launcherActions) {
        launcherActions.append(toggle);
        toggle.setAttribute('aria-label', t('对话历史', 'Conversation history'));
        heading.append(menu);
        menu.style.position = 'relative';
    }
    const create = button(t('新对话', 'New conversation'), sidebar); create.className += ' gd-muyu-new-session';
    const actionsRoot = node('div', '', sidebar); actionsRoot.className = 'gd-muyu-sidebar-exchange';
    const actions = createHistoryActions({ doc, importRoot: actionsRoot, exportRoot: menuList, parent: launcherActions ? sidebar : bar, controller, act, t });
    rename.onclick = () => { menu.open = false; actions.show('rename'); };
    archive.onclick = () => { menu.open = false; actions.show('archive'); };
    remove.onclick = () => { menu.open = false; actions.show('remove'); };
    const searchLabel = node('label', t('搜索标题', 'Search titles'), sidebar), search = node('input', '', searchLabel); search.type = 'search'; search.maxLength = 100; search.className = 'text_pole';
    searchLabel.className = 'gd-muyu-history-search'; search.placeholder = t('搜索对话标题…', 'Search conversation titles…');
    const filtersPanel = node('details', '', sidebar); filtersPanel.className = 'gd-muyu-history-filters';
    node('summary', t('筛选对话', 'Filter conversations'), filtersPanel);
    const range = select(t('范围', 'Scope'), [['current', t('当前聊天', 'Current chat')], ['global', t('全局任务', 'Global tasks')], ['all', t('全部历史', 'All history')]], filtersPanel);
    const archived = select(t('记录', 'Records'), [['active', t('未归档', 'Active')], ['archived', t('已归档', 'Archived')], ['all', t('全部', 'All')]], filtersPanel);
    const task = select(t('任务类型', 'Task type'), [['', t('全部任务', 'All tasks')], ...Object.entries(taskCatalog).map(([id, item]) => [id, t(...item.label)])], filtersPanel);
    const refresh = button(t('刷新历史', 'Refresh history'), sidebar); refresh.className += ' gd-muyu-history-refresh';
    refresh.setAttribute('title', t('重新加载当前存储中的暮羽对话记录', 'Reload Muyu conversations from the current storage'));
    const list = node('div', '', sidebar); list.className = 'gd-muyu-session-list';
    const count = node('small', '', sidebar);
    let opened = false, wide = false, manual = !!setSidebarOpen, signature = '', disposed = false, visible = true, available = false, menuSession;
    function visibility() {
        const showing = opened && available;
        sidebar.hidden = !showing;
        if (workspace) workspace.className = 'gd-muyu-workspace' + (showing ? ' is-history-open' : '');
        toggle.setAttribute('aria-expanded', String(showing));
        close.textContent = wide ? t('收起历史', 'Close history') : t('返回聊天', 'Back to chat');
        close.setAttribute('aria-label', close.textContent); close.setAttribute('title', close.textContent);
        close.setAttribute('data-action', wide ? 'collapse' : 'back');
        setSidebarOpen?.(showing && visible);
    }
    function setOpen(value) { manual = true; opened = value; visibility(); (opened ? close : toggle).focus?.({ preventScroll: true }); }
    toggle.onclick = () => setOpen(!opened); close.onclick = () => setOpen(false);
    sidebar.onkeydown = event => {
        if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); setOpen(false); }
        if (event.key === 'Tab' && !wide) {
            const controls = [...(sidebar.querySelectorAll?.('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary') || [])].filter(el => el.getClientRects?.().length !== 0);
            const target = event.shiftKey ? controls[0] : controls.at(-1);
            if (event.target === target && controls.length) { event.preventDefault(); (event.shiftKey ? controls.at(-1) : controls[0]).focus(); }
        }
    };
    const resize = width => {
        wide = width >= 680; if (!manual) opened = wide; visibility();
        if (!wide && opened && available && visible && chat.contains?.(doc.activeElement)) close.focus?.({ preventScroll: true });
    };
    const Resize = doc.defaultView?.ResizeObserver || globalThis.ResizeObserver;
    const observer = Resize && workspace ? new Resize(entries => resize(entries[0]?.contentRect.width || 0)) : null;
    if (observer) observer.observe(workspace); resize(workspace?.clientWidth || 0);
    search.oninput = () => act(() => controller.setHistoryFilters({ query: search.value }));
    range.onchange = () => act(() => controller.setHistoryFilters({ range: range.value }));
    archived.onchange = () => act(() => controller.setHistoryFilters({ archive: archived.value }));
    task.onchange = () => act(() => controller.setHistoryFilters({ task: task.value }));
    enabled.onchange = () => act(() => controller.setHistoryEnabled(enabled.checked));
    storageChoice.onchange = () => act(() => controller.setHistoryStorage(storageChoice.value));
    retry.onclick = () => act(() => controller.retryHistory());
    refresh.onclick = () => act(() => controller.refreshHistory());
    copyButton.onclick = () => act(() => controller.copyHistoryFrom(copySource.value));
    create.onclick = () => act(async () => { await controller.newSession(); if (!disposed && !wide) setOpen(false); });
    const labels = { idle: t('空闲', 'Idle'), running: t('运行中', 'Running'), succeeded: t('完成', 'Completed'), failed: t('失败', 'Failed'), cancelled: t('已取消', 'Cancelled'), interrupted: t('已中断', 'Interrupted') };
    return {
        render(s) {
            const h = s.history; bar.hidden = section.hidden = !h; toggle.hidden = !h;
            if (menuSession !== h?.sessionId || !h) menu.open = false;
            menuSession = h?.sessionId;
            available = !!h; visibility();
            if (!h) return;
            routingPanel.hidden = !h.routing;
            volumePanel.hidden = !h.canSetWorldBookTarget;
            volumeInput.disabled = h.loading || s.resetting || s.busy || s.interaction?.status === 'pending';
            if (doc.activeElement !== volumeInput) volumeInput.value = String(h.worldBookTargetMiB ?? 8);
            readChoice.value = h.readSource || h.routing?.readSource || '';
            readChoice.disabled = h.loading || s.resetting || s.busy || s.interaction?.status === 'pending';
            for (const [key, { input, result }] of writeControls) {
                input.checked = (h.writeTargets || h.routing?.writeTargets || []).includes(key);
                input.disabled = readChoice.disabled || !readChoice.value;
                const saved = h.writeReport?.targets.find(row => row.source === key);
                result.textContent = !input.checked ? t('已关闭写入；已有记录仍可读取', 'Writing off; existing records remain readable') : saved?.state === 'failed' ? t('上次保存未确认：', 'Last save unconfirmed: ') + saved.error : saved?.state === 'saved' ? t('上次保存已确认', 'Last save confirmed') : t('已开启；从后续保存生效', 'On; applies to subsequent saves');
            }
            stalePanel.hidden = !h.external;
            if (reloadIntent !== reloadKey(h) || !h.external) reloadCancel.onclick();
            staleText.textContent = h.external === 'deleted' ? t('存储中的这份记录已删除。本页旧副本仍保留，已暂停继续发送和自动保存。', 'This record was deleted in storage. The old page copy is retained; sending and auto-saving it are paused.') : t('存储中发现不同版本。本页内容尚未替换，已暂停继续发送和自动保存；请先导出，再决定是否重新载入。', 'A different stored version was found. Page content is unchanged; sending and auto-saving it are paused. Export first, then decide whether to reload.');
            reload.disabled = reloadConfirm.disabled = h.loading || !!h.pending || s.resetting || s.busy || s.interaction?.status === 'pending';
            reloadCancel.disabled = h.loading || s.resetting;
            copyPanel.hidden = !h.canCopyHistory;
            mergePanel.hidden = !h.canMergeLegacyHistory;
            mergeButton.disabled = cleanupButton.disabled = cleanupConfirm.disabled = !mayMerge();
            if (cleanupIntent !== null && (cleanupIntent !== mergeKey(h) || !mayMerge())) dismissCleanup();
            const mergeReport = h.copyReport?.source === 'legacy-world-books' ? h.copyReport : null;
            mergeStatus.textContent = mergeReport ? (mergeReport.cleanup ? t('清理旧备份', 'Old-backup removal') : t('合并旧存档', 'Legacy consolidation')) + ' · ' + t(`已合并 ${mergeReport.copied}，已合并跳过 ${mergeReport.identical}，清理 ${mergeReport.cleaned}，冲突或未合并跳过 ${mergeReport.conflicts}，未确认 ${mergeReport.remaining ?? '未知'}。`, `Consolidated: ${mergeReport.copied}; already consolidated: ${mergeReport.identical}; removed: ${mergeReport.cleaned}; conflicts or unconsolidated skipped: ${mergeReport.conflicts}; unconfirmed: ${mergeReport.remaining ?? 'unknown'}.`) + (mergeReport.error ? ` (${mergeReport.error}) ` + t('操作已停止，已完成部分保留；请核对后重试。', 'Stopped; completed work remains. Review before retrying.') : '') : '';
            if (h.copyingHistory && mergeReport) mergeStatus.textContent = t('正在处理旧版存档，请保持页面打开。', 'Processing legacy archives; keep this page open.');
            copyButton.disabled = copySource.disabled = h.loading || !!h.pending || s.resetting || s.busy || h.canManage === false || !h.routing && h.storageChangePending;
            const report = mergeReport ? null : h.copyReport;
            copyStatus.textContent = report ? (sourceLabels[report.source] || '') + ' · ' + t(`已确认复制 ${report.copied}，相同跳过 ${report.identical}，冲突跳过 ${report.conflicts}，未确认 ${report.remaining}。原件保留。`, `Confirmed copies: ${report.copied}; identical skipped: ${report.identical}; conflicts skipped: ${report.conflicts}; unconfirmed: ${report.remaining}. Originals retained.`) + (report.error ? t('复制已停止，已完成部分保留；请检查连接、存档版本与容量后重试。', 'Copy stopped; completed copies remain. Check the connection, archive version and capacity before retrying.') + ` (${report.error})` : '') : '';
            if (h.copyingHistory && !mergeReport) copyStatus.textContent = t('正在复制旧历史，请保持页面打开；原件不会删除。', 'Copying old history; keep this page open. Originals will not be deleted.');
            else if (report?.total === null) copyStatus.textContent = (sourceLabels[report.source] || '') + ' · ' + t('旧存储未能打开或清单读取失败，尚未开始复制；请检查所选来源是否可用。原件保留。', 'Could not open the old storage or read its inventory; copying has not started. Check that the selected source is available. Originals retained.') + ` (${report.error})`;
            (task.parentElement || task.parent).hidden = s.mode === 'assistant';
            actions.render(s);
            enabled.checked = h.autoSaveRequested ?? h.enabled; enabled.disabled = !h.available || h.loading || s.resetting || s.busy;
            storageLabel.hidden = storageNotice.hidden = !h.canChooseStorage || !!h.routing;
            const selectedStorage = h.storageChoice ?? (h.accountStorage === true ? 'account-settings' : 'auto');
            storageChoice.value = selectedStorage;
            storageChoice.disabled = !h.canChooseStorage || h.loading || s.resetting || s.busy;
            storageNotice.textContent = t('刷新后切换；旧记录保留，不自动迁移。关闭自动保存不会删除已有记录。', 'Reload to switch; old records remain and are not automatically migrated. Turning off auto-save does not delete records.') + ' ' +
                (selectedStorage === 'world-book' ? t('对话以明文保存在当前酒馆账号的专用世界书。无需启用或绑定存档书；每条8 MiB、总计64 MiB。请勿同时在多台设备编辑同一会话；跨设备需刷新历史。配置操作检查点仍保存在当前浏览器，不随对话同步。', 'Conversations are plaintext in dedicated world books for this ST account. Do not enable or bind archive books. 8 MiB per conversation, 64 MiB total. Do not edit the same conversation on multiple devices at once; refresh history on the other device. Configuration checkpoints remain in this browser and do not sync.') :
                selectedStorage === 'account-settings' ? t('对话随当前账户设置保存，换浏览器可读取；会增大 settings.json，每条8 MiB、总计32 MiB。其他标签页保存设置可能覆盖记录，建议单标签页使用。', 'Conversations follow this ST account across browsers and enlarge settings.json: 8 MiB per record, 32 MiB total. Other tabs saving settings may overwrite records; prefer a single tab.') :
                t('服务插件可用时使用服务端私有文件，否则使用浏览器 IndexedDB；浏览器记录不跨设备同步。', 'Uses private server files when the service plugin is available, otherwise browser IndexedDB. Browser records do not sync across devices.'));
            retry.disabled = !h.available || !h.enabled && !h.autoSaveRequested || h.loading || !!h.pending || s.resetting || s.busy || !h.error && !h.dirty; refresh.disabled = !h.available || h.loading || s.resetting || s.busy || s.interaction?.status === 'pending';
            create.disabled = h.loading || s.resetting || !s.hasChat && !['draft', 'assistant'].includes(s.mode);
            rename.disabled = archive.disabled = remove.disabled = !h.sessionId || h.loading || s.resetting || h.canManage === false;
            archive.textContent = h.selected?.archived ? t('恢复归档', 'Restore archive') : t('归档', 'Archive');
            title.textContent = h.selected?.title || t('新对话', 'New conversation');
            if (currentTitle) currentTitle.textContent = t('当前对话：', 'Current conversation: ') + title.textContent;
            const filters = h.filters || { range: 'all', archive: 'active', task: '', query: '' };
            range.value = filters.range; archived.value = filters.archive; task.value = filters.task; if (search.value !== filters.query) search.value = filters.query;
            const now = new Date();
            const next = JSON.stringify([h.sessions, h.sessionId, s.resetting, h.loading, h.canManage, now.toDateString()]);
            if (signature !== next) {
                const focusedId = doc.activeElement?.getAttribute?.('data-session-id');
                signature = next; list.replaceChildren(); rowMenus = [];
                if (!h.sessions.length) node('p', t('没有匹配的会话', 'No matching conversations'), list);
                let previousGroup;
                for (const item of h.sessions) {
                    const date = historyDatePresentation(item.updatedAt, lang, now);
                    if (date.group !== previousGroup) {
                        node('h4', date.label, list).className = 'gd-muyu-history-date'; previousGroup = date.group;
                    }
                    const row = node('div', '', list); row.className = 'gd-muyu-session-row';
                    row.setAttribute('data-selected', String(item.id === h.sessionId));
                    const open = button(item.title || t('未命名对话', 'Untitled conversation'), row); open.setAttribute('aria-pressed', String(item.id === h.sessionId)); open.disabled = s.resetting || h.loading;
                    open.setAttribute('data-session-id', item.id);
                    const [kind, scopeKind, scopeKey] = JSON.parse(item.scope || '["chat"]');
                    if (scopeKind) node('small', scopeKind === 'global' ? t('全局任务', 'Global task') : t('聊天：', 'Chat: ') + String(scopeKey || '').slice(0, 80), row).className = 'gd-muyu-session-scope';
                    const metadata = node('div', '', row); metadata.className = 'gd-muyu-session-metadata';
                    node('small', t(...(taskCatalog[kind]?.label || ['未知任务', 'Unknown task'])), metadata);
                    if (labels[item.status]) { const badge = node('small', labels[item.status], metadata); badge.className = 'gd-muyu-session-status'; badge.setAttribute('data-state', item.status); }
                    if (date.time) { const time = node('time', date.time, metadata); time.setAttribute('title', date.full); time.setAttribute('datetime', new Date(item.updatedAt).toISOString()); }
                    if (item.imported) node('small', t('只读备份', 'Read-only backup'), metadata);
                    if (item.external) node('small', item.external === 'deleted' ? t('存储中已删除', 'Deleted in storage') : t('存储版本已变化', 'Stored version changed'), metadata);
                    const itemMenu = node('details', '', row); itemMenu.className = 'gd-muyu-row-menu';
                    const itemToggle = node('summary', '⋯', itemMenu); itemToggle.setAttribute('aria-label', t('会话操作：', 'Actions: ') + (item.title || t('未命名', 'Untitled')));
                    const itemActions = node('div', '', itemMenu); itemActions.className = 'gd-muyu-row-menu-list';
                    rowMenus.push({ root: itemMenu, toggle: itemToggle });
                    itemMenu.onkeydown = event => {
                        if (itemMenu.open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); itemMenu.open = false; itemToggle.focus?.(); }
                    };
                    itemMenu.ontoggle = () => { if (!disposed && itemMenu.open && rowMenus.some(entry => entry.root === itemMenu)) for (const entry of rowMenus) if (entry.root !== itemMenu) entry.root.open = false; };
                    for (const [action, text] of [['rename', t('重命名', 'Rename')], ['archive', item.archived ? t('恢复归档', 'Restore archive') : t('归档', 'Archive')], ['remove', t('删除', 'Delete')]]) {
                        const control = button(text, itemActions); control.disabled = open.disabled || h.canManage === false;
                        control.onclick = () => act(async () => {
                            itemMenu.open = false;
                            await controller.openSession(item.id);
                            if (disposed || controller.snapshot().history?.sessionId !== item.id) return;
                            if (!wide) setOpen(!!launcherActions); actions.show(action);
                        });
                    }
                    for (const [format, text] of [['json', t('导出 JSON', 'Export JSON')], ['markdown', t('导出 Markdown', 'Export Markdown')]]) {
                        const control = button(text, itemActions); control.disabled = open.disabled;
                        control.onclick = () => act(async () => {
                            await controller.openSession(item.id);
                            if (disposed || controller.snapshot().history?.sessionId !== item.id) return;
                            itemMenu.open = false; actions.export(format);
                        });
                    }
                    open.onclick = () => act(async () => {
                        await controller.openSession(item.id);
                        if (!disposed && controller.snapshot().history?.sessionId === item.id) {
                            if (!wide) setOpen(false);
                            else list.querySelector?.(`[data-session-id="${item.id}"]`)?.focus();
                        }
                    });
                    if (focusedId === item.id) open.focus?.();
                }
            }
            count.textContent = `${h.sessions.length} / ${h.total ?? h.sessions.length} · ${t('归档仍占容量', 'Archives retain storage')}`;
            const savedLabel = h.backend === 'world-book' ? t('已保存到酒馆世界书', 'Saved in ST world books') : t('已保存在本地', 'Saved locally');
            status.textContent = h.loading ? t('正在加载历史…', 'Loading history…') : h.error ? t('历史操作或保存失败；请先导出备份。', 'History operation/save failed; export a backup first.') : h.pending ? t('正在保存对话…', 'Saving conversation…') : !h.enabled ? h.dirty ? t('仅保留在本页；新内容未保存', 'This page only; new content is unsaved') : h.persisted ? t('已有保存记录；新内容不会自动保存', 'A saved record exists; new content will not auto-save') : t('仅保留在本页；自动保存关闭', 'This page only; automatic saving is off') : h.dirty ? t('有未保存内容', 'Unsaved changes') : h.persisted ? savedLabel : t('自动保存已开启；发送后保存新对话', 'Automatic saving is on; new conversations save after sending');
            if (h.error === 'HISTORY_CONFLICT' || h.error === 'HISTORY_DELETED') status.textContent = t('另一标签页已更新或删除此记录；未覆盖。请先导出本页内容，再刷新页面核对。', 'Another tab updated or deleted this record; not overwritten. Export this version before reloading the page.');
            if (h.error && historyErrorLabel(h.error, lang)) status.textContent = historyErrorLabel(h.error, lang);
            if (h.backend === 'world-book' && h.error === 'HISTORY_CONFLICT') status.textContent = t('世界书存档发生版本冲突，本次保存结果未确认。请先导出本页内容，再刷新核对；避免多设备同时编辑同一会话。', 'The world-book archive changed; this save is unconfirmed. Export this page before refreshing to compare. Avoid editing the same conversation on multiple devices at once.');
            if (h.external) status.textContent = h.external === 'deleted' ? t('存储中的记录已删除；本页副本保留，请核对后重新载入。', 'Record deleted in storage; page copy retained. Review before reloading.') : t('存储版本已变化；本页内容保留，请核对后重新载入。', 'Stored version changed; page content retained. Review before reloading.');
            if (h.recovery) status.textContent = t('回答仍在本页，但已超过存档容量，未保存。请立即导出恢复备份，再新建对话；恢复 JSON 仅作备份，不能直接导入。', 'The answer remains on this page but exceeds archive capacity and is unsaved. Export a recovery backup now, then start a new conversation. Recovery JSON is a backup, not an importable session.');
            if (h.backend === 'memory' && !h.loading && !h.error && !h.recovery) status.textContent = t('仅保留在本页，刷新后可能丢失；请导出需要保留的对话。', 'Held in this page only and may be lost on reload; export conversations you want to keep.');
            if (h.migration?.pending) status.textContent += t(` · ${h.migration.pending} 份浏览器记录因容量不足待迁移；原件保留。可先导出／删除服务端旧记录，再刷新历史重试。`, ` · ${h.migration.pending} browser records await migration due to capacity; originals remain. Export/delete old server records, then refresh history to retry.`);
            const locations = { 'private-files': t('酒馆服务端私有文件', 'Private files on the ST server'), browser: t('当前浏览器 IndexedDB', 'This browser’s IndexedDB'), 'account-settings': t('当前酒馆账户设置', 'Current ST account settings'), 'world-book': t('当前酒馆账户的专用世界书', 'Dedicated world books in this ST account'), memory: t('仅本页临时保留', 'This page only') };
            if (h.routed && !h.external && !h.error && !h.loading && !h.pending) {
                if (!h.writeTargets.length) status.textContent = t('未选择写入位置；本页内容不会自动保存，读取不受影响。', 'No write locations selected; page content will not auto-save. Reading is unaffected.');
                else if (h.writeReport) {
                    const saved = h.writeReport.targets.filter(row => row.state === 'saved').length, failed = h.writeReport.targets.filter(row => row.state === 'failed').length;
                    status.textContent = t(`上次保存：${saved} 处已确认，${failed} 处未确认。`, `Last save: ${saved} locations confirmed, ${failed} unconfirmed.`) + (!h.writeReport.readSaved ? t('当前读取位置未更新；请查看写入位置状态。', 'The read location was not updated; check write-location status.') : '');
                }
            }
            storageLocation.textContent = (h.routing ? t('当前读取：', 'Currently reading: ') : t('当前存储位置：', 'Current storage location: ')) + (locations[h.backend] || t('尚未确认', 'Not yet confirmed'));
            storageStatus.textContent = status.textContent;
            if (h.restoredStatus === 'interrupted') status.textContent += t(' · 上次任务已中断，未自动恢复', ' · Previous run interrupted; not resumed');
            if (s.switchedChat && !s.readOnly) status.textContent += t(' · 已切换 ST 聊天：继续发送会使用当前聊天，并告知暮羽重新核对资料', ' · ST chat changed: the next message uses this chat and tells Muyu to recheck its data');
            if (s.readOnly) status.textContent += h.selected?.imported ? t(' · 导入备份：只读，不会发送给模型', ' · Imported backup: read-only, not sent to a model') : h.selected?.archived ? t(' · 已归档：恢复后才能继续', ' · Archived: restore to continue') : t(' · 其他聊天历史：只读，请在原聊天继续', ' · Other chat: read-only; continue in its original chat');
            if (s.readOnly && h.selected?.scope) {
                const [task, kind, key] = JSON.parse(h.selected.scope);
                status.textContent += ' · ' + t(...taskCatalog[task].label) + ' · ' + (kind === 'global' ? t('全局任务', 'Global task') : key.slice(0, 160));
            }
            if (h.missingPermissions?.length && !s.readOnly) status.textContent += t(' · 继续前请在配置中重新授权相关资料', ' · Reauthorize relevant data before continuing');
            if (h.omitted) status.textContent += t(' · 继续时仅发送预算内完整问答', ' · Continuation sends complete turns within the history budget');
            if (h.routing) status.textContent += t(' · 当前读取：', ' · Reading: ') + (sourceLabels[h.readSource || h.routing.readSource] || t('尚未确认', 'Not confirmed'));
            else if (h.enabled && h.backend === 'private-files') status.textContent += t(' · ST 私有文件', ' · Private ST files');
            else if (h.enabled && h.backend === 'browser') status.textContent += t(' · 浏览器 IndexedDB', ' · Browser IndexedDB');
            else if (h.enabled && h.backend === 'account-settings') status.textContent += t(' · 酒馆账户设置', ' · ST account settings');
            else if (h.enabled && h.backend === 'world-book') status.textContent += t(' · 酒馆世界书', ' · ST world books');
            const backendChoice = h.backend === 'world-book' ? 'world-book' : h.backend === 'account-settings' ? 'account-settings' : 'auto';
            if (!h.routing && h.canChooseStorage && (h.storageChangePending || h.backend !== 'memory' && backendChoice !== selectedStorage)) {
                const notice = t(' · 存储选项已保存，刷新后生效；当前仍使用原位置', ' · Storage preference saved; reload to switch. Current storage is unchanged');
                status.textContent += notice; storageStatus.textContent += notice;
            }
        },
        setVisible(value) { visible = value; if (!value) { menu.open = false; for (const entry of rowMenus) entry.root.open = false; } visibility(); },
        dispose() { disposed = true; doc.removeEventListener?.('pointerdown', dismissMenu); doc.removeEventListener?.('keydown', escapeMenu); observer?.disconnect(); actions.dispose(); setSidebarOpen?.(false); if (launcherActions) toggle.remove(); },
    };
}
