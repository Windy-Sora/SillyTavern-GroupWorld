const instances = new WeakMap();
export function getQuickActions(deps) {
    const key = deps.summarySystem || deps.settings;
    let actions = instances.get(key);
    if (!actions) { actions = createQuickActions(deps); instances.set(key, actions); }
    else actions.updateDeps(deps);
    return actions;
}

// UI-independent, session-only state. Survives panel rebuilds, never exported.
export function createQuickActions(initialDeps) {
    let deps = initialDeps, latest = new Map(), pending = new Set();
    const listeners = new Set();
    const scope = () => ({ chat: deps.getChat?.(), metadata: deps.getChatMetadata?.(), group: deps.getCurrentGroup?.()?.id });
    const current = s => { const now = scope(); return now.chat === s.chat && now.metadata === s.metadata && now.group === s.group; };
    const emit = () => { for (const fn of listeners) { try { fn(); } catch (e) { console.error('[GD] Quick action subscriber:', e); } } };
    const enabledKey = { profiles: 'profileEnabled', memory: 'memoryEnabled', summary: 'summaryEnabled', blueprint: 'storyBlueprintEnabled' };
    function unavailable(id) {
        if (!(id in enabledKey)) return 'unavailable';
        if (pending.size) return 'busy'; // Shared caller resources: do not start overlapping quick tasks.
        if (!deps.getCurrentGroup?.()) return 'no-group';
        if (deps.isRoundActive?.()) return 'round-active';
        if (deps.quickActionGuard?.(id)) return 'busy';
        if (!deps.settings[enabledKey[id]]) return 'disabled';
        if (id === 'blueprint' && !deps.storyBlueprintSystem?.getBlueprint()) return 'no-blueprint';
        if (!deps.getChatMetadata || !Array.isArray(deps.getChat?.())) return 'unavailable';
        return null;
    }
    const api = {
        updateDeps(value) { deps = value; },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        refresh: emit,
        unavailable,
        isCurrent: record => !!record?.scope && current(record.scope),
        state(id) { const value = latest.get(id); return value && current(value.scope) ? value : null; },
        async run(id) {
            const reason = unavailable(id);
            if (reason) return { status: 'blocked', reason, scope: scope() };
            const d = deps, origin = scope();
            const record = { status: 'running', scope: origin, done: 0, failed: 0, total: 0 };
            latest.set(id, record); pending.add(id); emit();
            try {
                if (id === 'memory') {
                    const group = d.getCurrentGroup();
                    const members = [...group.members].filter(a => !group.disabled_members?.includes(a));
                    record.total = members.length;
                    if (!members.length) throw new Error(d.settings.lang === 'en' ? 'No enabled members' : '当前群聊没有可用角色');
                    for (const avatar of members) {
                        if (!current(origin)) { record.status = 'stale'; break; }
                        try { await d.memorySystem.generateForCharacter(avatar); record.done++; }
                        catch (error) { record.failed++; record.error = error?.message || String(error); }
                        if (!current(origin)) { record.status = 'stale'; break; }
                        emit();
                    }
                } else if (id === 'summary') record.result = await d.summarySystem.generateSummary();
                else if (id === 'blueprint') record.result = await d.storyBlueprintSystem.generateBlueprint('continue');
                else record.result = d.detectCharacterChanges();
                if (!current(origin)) record.status = 'stale';
                else if (record.status === 'running') record.status = record.failed ? (record.done ? 'partial' : 'failed') : 'success';
            } catch (error) {
                record.status = current(origin) ? 'failed' : 'stale';
                record.error = error?.message || String(error);
            } finally { pending.delete(id); emit(); }
            return record;
        },
        setMode(mode) {
            if (!['off', 'formula', 'llm'].includes(mode) || pending.size || deps.isRoundActive?.()) return false;
            deps.settings.mode = mode; deps.saveSettings(); emit(); return true;
        },
        setSpeakers(value, mode = deps.settings.mode) {
            if (pending.size || deps.isRoundActive?.() || !['formula', 'llm'].includes(mode)) return false;
            const n = Number(value);
            if (!Number.isInteger(n) || n < 1 || n > 20) return false;
            deps.settings[mode === 'llm' ? 'llmMaxSpeakers' : 'topN'] = n;
            deps.saveSettings(); emit(); return true;
        },
    };
    return api;
}

export function quickResultText(record, en = false) {
    if (!record) return '';
    const reasons = {
        busy: ['另一个快捷任务正在运行', 'Another quick task is running'],
        'no-group': ['请先打开群聊', 'Open a group chat'],
        'round-active': ['对话生成中，暂不可执行', 'Conversation generation in progress'],
        disabled: ['功能未启用，请进入功能页启用', 'Enable this feature on its page'],
        'no-blueprint': ['暂无蓝图，请先进入蓝图页生成', 'Create a blueprint on its page first'],
        unavailable: ['此操作暂不可用', 'Action unavailable'],
    };
    if (record.status === 'blocked') return reasons[record.reason]?.[en ? 1 : 0] || record.reason;
    if (record.status === 'running') return record.total ? (en ? `Processed ${record.done + record.failed}/${record.total}` : `已处理 ${record.done + record.failed}/${record.total}`) : (en ? 'Running…' : '正在执行…');
    if (record.status === 'stale') return en ? 'Chat changed; remaining work stopped' : '聊天已变化，已停止后续任务';
    if (record.total) return en ? `${record.done} succeeded, ${record.failed} failed` : `${record.done} 个成功，${record.failed} 个失败`;
    if (record.status === 'failed') return record.error || (en ? 'Failed' : '执行失败');
    return en ? 'Completed' : '执行完成';
}
