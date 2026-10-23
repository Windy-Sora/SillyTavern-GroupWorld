import { quickResultText } from './quick-actions.js';

export function mountCommandBoard(root, { deps, navigate }) {
    if (!deps?.quickActions) return null;
    const actions = deps.quickActions, doc = root.ownerDocument;
    const t = (zh, en) => deps.settings.lang === 'en' ? en : zh;
    const board = doc.createElement('section'); board.className = 'gd-command-board'; root.append(board);
    const textNodes = [], entries = [];
    function node(tag, cls, parent, zh, en) {
        const el = doc.createElement(tag); el.className = cls; parent.append(el);
        if (zh) textNodes.push([el, zh, en]); return el;
    }
    function link(parent, route, zh, en) {
        const button = node('button', 'menu_button', parent, zh, en);
        button.type = 'button'; button.dataset.boardRoute = route; return button;
    }
    const toolbar = node('div', 'gd-board-toolbar', board);
    const chat = node('strong', '', toolbar);
    const language = root.querySelector('#gd-lang'); let languageAnchor;
    const controls = node('div', 'gd-board-controls', board);
    const modeLabel = node('label', '', controls, '导演模式', 'Director mode');
    modeLabel.htmlFor = 'gd-board-mode';
    const mode = node('select', 'text_pole', controls); mode.id = 'gd-board-mode';
    for (const [value, zh, en] of [['off', '关闭', 'Off'], ['formula', '公式', 'Formula'], ['llm', 'LLM', 'LLM']]) {
        const option = node('option', '', mode, zh, en); option.value = value;
    }
    const countLabel = node('label', '', controls, '发言人数', 'Speaker limit'); countLabel.htmlFor = 'gd-board-count';
    const count = node('input', 'text_pole', controls); count.id = 'gd-board-count'; count.type = 'number'; count.min = '1'; count.max = '20';
    node('small', 'gd-board-scope', board, '模式与人数影响所有聊天 · 修改后自动保存', 'Mode and limit apply to all chats · Saved automatically');
    const decision = node('p', 'gd-board-decision', board);
    const related = node('div', 'gd-board-toolbar', board);
    link(related, 'rules', '发言规则', 'Speaker rules');
    link(related, 'agents', '模型连接', 'Connections');
    link(related, 'ledger', '导演账本', 'Director ledger');
    const grid = node('div', 'gd-board-grid', board);
    for (const [action, route, zh, en, verbZh, verbEn] of [
        ['profiles', 'profile', '角色档案', 'Profiles', '检测变动', 'Detect changes'],
        ['memory', 'memory', '角色记忆', 'Memories', '提取全部', 'Extract all'],
        ['summary', 'summary', '上下文总结', 'Summary', '执行总结', 'Summarize'],
        ['blueprint', 'storyBlueprint', '故事蓝图', 'Blueprint', '续写蓝图', 'Continue'],
    ]) {
        const card = node('section', 'gd-board-card', grid);
        node('h4', '', card, zh, en);
        const summary = node('p', 'gd-board-meta', card);
        const buttons = node('div', 'gd-board-toolbar', card);
        link(buttons, route, '查看', 'View');
        const run = node('button', 'menu_button', buttons, verbZh, verbEn); run.type = 'button'; run.dataset.boardAction = action;
        const status = node('p', 'gd-board-task', card); status.setAttribute('role', 'status');
        entries.push({ action, summary, run, status });
    }
    const shortcuts = node('div', 'gd-board-toolbar gd-board-links', board);
    for (const [route, zh, en] of [['npc', 'NPC', 'NPCs'], ['variables', '变量', 'Variables'], ['worldbooks', '世界书', 'World books'], ['config-profile', '配置档', 'Profiles & presets']]) link(shortcuts, route, zh, en);
    const feedback = node('p', 'gd-board-task', board); feedback.setAttribute('role', 'status');
    function render() {
        textNodes.forEach(([el, zh, en]) => { el.textContent = t(zh, en); });
        const group = deps.getCurrentGroup?.();
        chat.textContent = group?.name || (group ? t('当前群聊', 'Current group') : t('未打开群聊', 'No group chat'));
        mode.value = deps.settings.mode;
        const busy = actions.unavailable('summary') === 'busy' || !!deps.isRoundActive?.();
        mode.disabled = busy;
        count.disabled = busy || deps.settings.mode === 'off';
        if (doc.activeElement !== count) count.value = deps.settings.mode === 'llm' ? deps.settings.llmMaxSpeakers : deps.settings.topN;
        const history = group ? deps.getDirectorHistory?.() || [] : [];
        const last = history.at(-1);
        decision.textContent = !group ? t('聊天数据与生成操作需在群聊中使用。', 'Chat data and generation require a group chat.')
            : !last ? t('暂无决策记录', 'No decision recorded')
                : `${t('最近选人：', 'Last selection: ')}${(Array.isArray(last.speakers) ? last.speakers.join(' → ') : '') || t('无', 'None')} · ${last.reason || t('未记录原因', 'Reason not recorded')}`;
        for (const entry of entries) {
            let info = t('暂无数据', 'No data');
            if (group) {
                if (entry.action === 'profiles') info = `${Object.values(deps.getProfiles?.() || {}).filter(p => p?.state === 'ready').length} ${t('个就绪', 'ready')}`;
                if (entry.action === 'memory') {
                    const total = Object.values(deps.memorySystem?.getStats?.() || {}).reduce((n, s) => n + (s.count || 0), 0);
                    const members = group.members?.filter(a => !group.disabled_members?.includes(a)).length || 0;
                    info = `${total} ${t('条记忆；提取全部针对', 'memories; extract all targets')} ${members} ${t('个未禁用角色', 'enabled members')}`;
                }
                if (entry.action === 'summary') {
                    const active = deps.summarySystem?.getLatestActive?.();
                    info = active ? t(`上次总结位置：第 ${active.rangeEnd} 条`, `Last summary position: #${active.rangeEnd}`) : t('尚无有效总结', 'No active summary');
                }
                if (entry.action === 'blueprint') {
                    const progress = deps.storyBlueprintSystem?.getProgress?.();
                    info = progress?.total ? `${progress.doneCount}/${progress.total}` : t('暂无可推进节点', 'No progression steps');
                }
            }
            entry.summary.textContent = info;
            const reason = actions.unavailable(entry.action), record = actions.state(entry.action);
            entry.run.disabled = !!reason;
            const message = quickResultText(record || (reason ? { status: 'blocked', reason } : null), deps.settings.lang === 'en');
            const block = reason && record?.status !== 'running' ? quickResultText({ status: 'blocked', reason }, deps.settings.lang === 'en') : '';
            entry.status.textContent = [message, block && block !== message ? block : ''].filter(Boolean).join(' · ');
        }
    }
    const onClick = async event => {
        const button = event.target.closest('button'); if (!button || !board.contains(button)) return;
        if (button.dataset.boardRoute) { navigate(button.dataset.boardRoute); return; }
        if (button.dataset.boardAction && !button.disabled) {
            try {
                const result = await deps.runQuickAction(button.dataset.boardAction);
                if (button.dataset.boardAction === 'profiles' && result.status === 'success' && actions.isCurrent(result) && root.contains(board)) navigate('profile');
            } catch (e) { if (root.contains(board)) feedback.textContent = e.message || String(e); }
        }
    };
    const onMode = () => { if (actions.setMode(mode.value)) deps.syncDirectorControls?.(); render(); };
    const onCount = () => {
        if (actions.setSpeakers(count.value)) { feedback.textContent = ''; deps.syncDirectorControls?.(); }
        else feedback.textContent = t('请输入 1–20 的整数；运行期间不可修改。', 'Enter an integer from 1 to 20; changes are locked during execution.');
        render();
    };
    board.addEventListener('click', onClick); mode.addEventListener('change', onMode); count.addEventListener('change', onCount);
    const unsubscribe = actions.subscribe(render);
    return {
        element: board,
        update(preview) {
            if (preview && language && !languageAnchor) {
                languageAnchor = doc.createComment('board-language'); language.before(languageAnchor); toolbar.append(language);
            } else if (!preview && languageAnchor) { languageAnchor.replaceWith(language); languageAnchor = null; }
            render();
        },
        dispose() {
            unsubscribe(); board.removeEventListener('click', onClick); mode.removeEventListener('change', onMode); count.removeEventListener('change', onCount);
            if (languageAnchor) languageAnchor.replaceWith(language);
            board.remove();
        },
    };
}
