import { registerSection } from './registry.js';

function getDefaultPrompt(lang) {
    return lang === 'zh'
        ? '请用简洁的语言总结以下内容，保留关键情节、角色互动和重要细节。输出纯文本，不超过500字。'
        : 'Summarize the following content concisely. Keep key plot points, character interactions, and important details. Output plain text, maximum 300 words.';
}

registerSection('chatSummary', function (ctx) {
    const { settings, $c, saveSettings, summarySystem, toastr, isRoundActive } = ctx;
    const ss = summarySystem;
    const defaultPrompt = getDefaultPrompt(settings.lang);

    // Init
    $c('summary-enabled').prop('checked', !!settings.summaryEnabled);
    $c('summary-reuse').prop('checked', settings.summaryReusePrevious !== false);
    $c('summary-prompt').val(settings.summaryPrompt || defaultPrompt);

    const checkEnabled = () => {
        const locked = isRoundActive ? isRoundActive() : false;
        const on = !!settings.summaryEnabled && !locked;
        $c('summary-lock-warn').toggle(locked);
        $c('summary-reuse').prop('disabled', !settings.summaryEnabled);
        $c('summary-prompt').prop('disabled', !settings.summaryEnabled);
        $c('summary-execute').prop('disabled', !on);
        $c('summary-regenerate').prop('disabled', !on);
        $c('summary-revert').prop('disabled', !on);
        $c('summary-reset').prop('disabled', !on);
        $c('summary-prompt-reset').prop('disabled', !settings.summaryEnabled);
        $c('summary-result-save').prop('disabled', !on);
    };
    checkEnabled();

    // Toggle
    $c('summary-enabled').on('change', () => {
        settings.summaryEnabled = !!$c('summary-enabled').prop('checked');
        checkEnabled();
        saveSettings();
    });

    // Reuse toggle
    $c('summary-reuse').on('change', () => {
        settings.summaryReusePrevious = !!$c('summary-reuse').prop('checked');
        saveSettings();
    });

    // Prompt
    $c('summary-prompt').on('input', () => {
        settings.summaryPrompt = $c('summary-prompt').val();
        saveSettings();
    });
    $c('summary-prompt-reset').on('click', () => {
        $c('summary-prompt').val(defaultPrompt);
        settings.summaryPrompt = '';
        saveSettings();
        toastr.info(settings.lang === 'zh' ? '已恢复默认总结 Prompt' : 'Summary prompt reset to default');
    });

    // Save edited result — handles both single active and multi-summary scan views
    $c('summary-result-save').on('click', async () => {
        if (isRoundActive && isRoundActive()) return;
        const text = $c('summary-result').val();
        const { saveChatConditional } = ctx;

        // Try multi-summary format: --- #N [status] range ---
        const blocks = text.split(/^--- #(\d+) .+? ---$/m);
        if (blocks.length > 1) {
            const allSummaries = ss.getSummaries ? ss.getSummaries() : [];
            let updated = 0;
            for (let i = 0; i < allSummaries.length; i++) {
                // blocks[0] = text before first header
                // blocks[1] = #1, blocks[2] = content1
                // blocks[3] = #2, blocks[4] = content2, etc.
                const idx = 2 * i + 2;
                if (idx < blocks.length && blocks[idx]) {
                    allSummaries[i].content = blocks[idx].trim();
                    updated++;
                }
            }
            if (updated > 0) {
                if (saveChatConditional) await saveChatConditional();
                toastr.info(settings.lang === 'zh' ? `已更新 ${updated} 条总结` : `Updated ${updated} summaries`);
            }
        } else {
            // Single summary view
            const active = ss.getLatestActive();
            if (active) {
                active.content = text;
                if (saveChatConditional) await saveChatConditional();
                toastr.info(settings.lang === 'zh' ? '总结已更新' : 'Summary updated');
            }
        }
        refreshStatus();
    });

    // Execute
    $c('summary-execute').on('click', async () => {
        if (isRoundActive && isRoundActive()) return;
        $c('summary-execute').prop('disabled', true);
        try {
            const entry = await ss.generateSummary();
            refreshStatus();
            toastr.success(settings.lang === 'zh'
                ? `总结完成，覆盖 ${entry.rangeEnd} 条消息`
                : `Summary complete, covers ${entry.rangeEnd} messages`);
        } catch (e) {
            toastr.error(e.message || (settings.lang === 'zh' ? '总结失败' : 'Summary failed'));
        }
        $c('summary-execute').prop('disabled', false);
    });

    // Regenerate
    $c('summary-regenerate').on('click', async () => {
        if (isRoundActive && isRoundActive()) return;
        $c('summary-regenerate').prop('disabled', true);
        try {
            await ss.regenerateLastSummary();
            refreshStatus();
            toastr.success(settings.lang === 'zh' ? '已重新总结' : 'Regenerated summary');
        } catch (e) {
            toastr.error(e.message || (settings.lang === 'zh' ? '重新总结失败' : 'Regenerate failed'));
        }
        $c('summary-regenerate').prop('disabled', false);
    });

    // Revert
    $c('summary-revert').on('click', async () => {
        if (isRoundActive && isRoundActive()) return;
        if (!confirm(settings.lang === 'zh' ? '回退最新总结，恢复原文片段？' : 'Revert latest summary, restore original text?')) return;
        await ss.revertLastSummary();
        refreshStatus();
        toastr.info(settings.lang === 'zh' ? '已回退总结' : 'Summary reverted');
    });

    // Reset
    $c('summary-reset').on('click', async () => {
        if (isRoundActive && isRoundActive()) return;
        if (!confirm(settings.lang === 'zh' ? '关闭所有总结，恢复全部原文？' : 'Deactivate all summaries, restore full original text?')) return;
        await ss.resetAll();
        refreshStatus();
        toastr.info(settings.lang === 'zh' ? '已重置全部总结' : 'All summaries reset');
    });

    function getChatLen() {
        // Access chat length from the system if available, otherwise 0
        const summaries = ss.getSummaries ? ss.getSummaries() : [];
        if (summaries.length > 0) {
            // Use the max rangeEnd as an approximation; the system has actual chat ref
            return Math.max(summaries[summaries.length - 1].rangeEnd || 0, ...summaries.map(s => s.rangeEnd || 0));
        }
        return 0;
    }

    function refreshStatus() {
        const active = ss.getLatestActive();
        const { getChat } = ctx;
        const chatLen = getChat ? getChat().length : 0;
        if (active) {
            const remaining = Math.max(0, chatLen - active.rangeEnd);
            $c('summary-status').text((settings.lang === 'zh'
                ? `上次总结位置：第 ${active.rangeEnd} 条 | 未总结：${remaining} 条 | 总计：${chatLen} 条`
                : `Last summary at: #${active.rangeEnd} | Unsummarized: ${remaining} | Total: ${chatLen}`) + (active.basedOn !== null ? (settings.lang === 'zh' ? '（基于上一条总结）' : ' (based on previous)') : ''));
            $c('summary-result').val(active.content || '');
            $c('summary-result-section').show();
        } else {
            $c('summary-status').text(settings.lang === 'zh'
                ? `未总结 | 总计：${chatLen} 条消息`
                : `No summary | Total: ${chatLen} messages`);
            $c('summary-result').val('');
            $c('summary-result-section').hide();
        }
    }
    refreshStatus();

    // Show result section if active summary exists
    if (ss.getLatestActive()) {
        $c('summary-result-section').show();
    } else {
        $c('summary-result-section').hide();
    }

    // Scan button
    function doScan(skipDisabled = false, silent = false) {
        const allSummaries = ss.getSummaries ? ss.getSummaries() : [];
        const visible = skipDisabled ? allSummaries.filter(s => s.active) : allSummaries;
        if (allSummaries.length === 0) {
            $c('summary-scan-notice').hide();
            $c('summary-result').val('');
            $c('summary-result-section').hide();
            if (!silent) toastr.info(settings.lang === 'zh' ? '未检测到存档总结' : 'No archived summaries found');
            return;
        }
        const activeCount = allSummaries.filter(s => s.active).length;
        const inactiveCount = allSummaries.length - activeCount;
        let msg = settings.lang === 'zh'
            ? `检测到 ${allSummaries.length} 条存档总结`
            : `Found ${allSummaries.length} archived summaries`;
        if (activeCount > 0) msg += settings.lang === 'zh'
            ? `（${activeCount} 条活跃）`
            : ` (${activeCount} active)`;
        if (inactiveCount > 0) msg += settings.lang === 'zh'
            ? `（${inactiveCount} 条已禁用）`
            : ` (${inactiveCount} disabled)`;
        if (skipDisabled) msg += settings.lang === 'zh' ? ' — 已隐藏已禁用' : ' — disabled hidden';
        $c('summary-scan-result').text(msg);
        $c('summary-scan-notice').show();

        if (!visible.length) {
            $c('summary-result').val(settings.lang === 'zh' ? '（全部已禁用，已被隐藏）' : '(All disabled, hidden)');
            $c('summary-result-section').show();
            return;
        }

        // Show summaries for review
        const scanText = visible.map((s, i) => {
            const status = s.active ? (settings.lang === 'zh' ? '活跃' : 'Active') : (settings.lang === 'zh' ? '已禁用' : 'Disabled');
            const range = settings.lang === 'zh' ? `覆盖前${s.rangeEnd}条` : `covers first ${s.rangeEnd}`;
            return `--- #${i + 1} [${status}] ${range} ---\n${s.content}`;
        }).join('\n\n');
        $c('summary-result').val(scanText);
        $c('summary-result-section').show();
    }

    let hideDisabled = false;

    $c('summary-scan-btn').on('click', () => { hideDisabled = false; updateHideBtn(); refreshStatus(); doScan(); });
    $c('summary-refresh').on('click', refreshStatus);

    // Prune disabled summaries
    $c('summary-prune-btn').on('click', async () => {
        const allSummaries = ss.getSummaries ? ss.getSummaries() : [];
        const activeOnly = allSummaries.filter(s => s.active);
        if (activeOnly.length === allSummaries.length) {
            toastr.info(settings.lang === 'zh' ? '没有可清除的已禁用条目' : 'No disabled entries to prune');
            return;
        }
        if (!confirm(settings.lang === 'zh'
            ? `将删除 ${allSummaries.length - activeOnly.length} 条已禁用总结，保留 ${activeOnly.length} 条活跃。确认？`
            : `Delete ${allSummaries.length - activeOnly.length} disabled summaries, keep ${activeOnly.length} active. Confirm?`)) return;
        allSummaries.length = 0;
        allSummaries.push(...activeOnly);
        const { saveChatConditional } = ctx;
        if (saveChatConditional) await saveChatConditional();
        doScan();
        toastr.success(settings.lang === 'zh'
            ? `已清除，保留 ${activeOnly.length} 条活跃总结`
            : `Pruned, ${activeOnly.length} active summaries kept`);
    });

    // Toggle hide disabled
    function updateHideBtn() {
        const icon = $c('summary-hide-btn').find('i');
        icon.removeClass('fa-eye-slash fa-eye');
        icon.addClass(hideDisabled ? 'fa-eye' : 'fa-eye-slash');
        const label = hideDisabled
            ? (settings.lang === 'zh' ? '显示已禁用' : 'Show disabled')
            : (settings.lang === 'zh' ? '隐藏已禁用' : 'Hide disabled');
        $c('summary-hide-btn').contents().last().replaceWith(label);
    }

    $c('summary-hide-btn').on('click', () => {
        hideDisabled = !hideDisabled;
        updateHideBtn();
        doScan(hideDisabled);
    });

    $c('summary-scan-clear').on('click', async () => {
        if (!confirm(settings.lang === 'zh'
            ? '清除全部存档总结？此操作不可撤销。'
            : 'Clear all archived summaries? This cannot be undone.')) return;
        await ss.resetAll();
        const summaries = ss.getSummaries ? ss.getSummaries() : [];
        summaries.length = 0;
        const { saveChatConditional } = ctx;
        if (saveChatConditional) await saveChatConditional();
        $c('summary-scan-notice').hide();
        refreshStatus();
        toastr.info(settings.lang === 'zh' ? '已清除全部总结' : 'All summaries cleared');
    });

    // Auto-scan on init (silent — no toast if empty)
    doScan(false, true);
});
