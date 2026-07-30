import { registerSection } from './registry.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../popup.js';
import { DEFAULT_MEMORY_PROMPT, DEFAULT_MEMORY_SCHEMA, DEFAULT_MEMORY_RENDER, DEFAULT_MEMORY_COMPRESS_PROMPT } from '../../agents/memory.js';

registerSection('memory', function (ctx) {
    const { settings, $c, saveSettings, getCurrentGroup, toastr, memorySystem } = ctx;
    if (!memorySystem) return;
    const getCharacters = () => window.characters || [];
    const lang = settings.lang || 'zh';
    const L = (zh, en) => lang === 'zh' ? zh : en;

    const $section = $('#gd-memory-section');
    const $list = $('#gd-memory-list');

    // ── Bind values ──
    $c('memory-enabled').prop('checked', settings.memoryEnabled ?? false);
    $section.toggle(settings.memoryEnabled ?? false);
    $c('memory-token-budget').val(settings.memoryTokenBudget ?? 2000);
    $c('memory-prompt').val(settings.memoryPrompt || DEFAULT_MEMORY_PROMPT);
    $c('memory-json-schema').val(settings.memoryJsonSchema || DEFAULT_MEMORY_SCHEMA);
    $c('memory-render-template').val(settings.memoryRenderTemplate || DEFAULT_MEMORY_RENDER);
    $c('memory-compress-prompt').val(settings.memoryCompressPrompt || DEFAULT_MEMORY_COMPRESS_PROMPT);
    $c('memory-keep-recent').val(settings.memoryKeepRecent ?? 5);
    $c('memory-max-entries').val(settings.memoryMaxEntries ?? 200);

    // Auto memory
    $c('auto-memory-enabled').prop('checked', !!settings.autoMemoryEnabled);
    $c('auto-memory-interval').val(settings.autoMemoryInterval ?? 10);
    $c('auto-memory-speakers').prop('checked', settings.autoMemorySpeakers === true);
    $c('auto-memory-enabled').on('change', function () {
        settings.autoMemoryEnabled = !!$(this).prop('checked');
        $('#gd-auto-memory-row').toggle(settings.autoMemoryEnabled);
        saveSettings();
        window.__gdRefreshDashboard?.();
    });
    $c('auto-memory-speakers').on('change', function () { settings.autoMemorySpeakers = !!$(this).prop('checked'); saveSettings(); });
    $c('auto-memory-interval').on('input', function () {
        settings.autoMemoryInterval = Math.max(1, parseInt($(this).val(), 10) || 10);
        saveSettings();
    });
    $('#gd-auto-memory-row').toggle(!!settings.autoMemoryEnabled);

    // ── Events ──
    $c('memory-enabled').on('change', function () {
        settings.memoryEnabled = !!$(this).prop('checked');
        $section.toggle(settings.memoryEnabled);
        $c('qs-memory-enabled').prop('checked', settings.memoryEnabled);
        if (settings.memoryEnabled) renderMemoryList();
        saveSettings();
        window.__gdRefreshDashboard?.();
    });
    $c('memory-token-budget').on('input', function () { settings.memoryTokenBudget = Math.max(100, parseInt($(this).val(), 10) || 2000); saveSettings(); });
    $c('memory-prompt').on('input', function () { settings.memoryPrompt = $(this).val(); saveSettings(); });
    $c('memory-json-schema').on('input', function () { settings.memoryJsonSchema = $(this).val(); saveSettings(); });
    $c('memory-render-template').on('input', function () { settings.memoryRenderTemplate = $(this).val(); saveSettings(); });
    $c('memory-keep-recent').on('input', function () { settings.memoryKeepRecent = Math.max(1, parseInt($(this).val(), 10) || 5); saveSettings(); });
    $c('memory-max-entries').on('input', function () { settings.memoryMaxEntries = Math.max(10, parseInt($(this).val(), 10) || 200); saveSettings(); memorySystem.pruneAfter().catch(e => console.warn('[GD] pruneAfter failed:', e)); });

    $c('memory-prompt-reset').on('click', () => { settings.memoryPrompt = ''; $c('memory-prompt').val(DEFAULT_MEMORY_PROMPT); saveSettings(); });
    $c('memory-schema-reset').on('click', () => { settings.memoryJsonSchema = ''; $c('memory-json-schema').val(DEFAULT_MEMORY_SCHEMA); saveSettings(); });
    $c('memory-render-reset').on('click', () => { settings.memoryRenderTemplate = ''; $c('memory-render-template').val(DEFAULT_MEMORY_RENDER); saveSettings(); });
    $c('memory-compress-prompt').on('input', function () { settings.memoryCompressPrompt = $(this).val(); saveSettings(); });
    $c('memory-compress-prompt-reset').on('click', () => { settings.memoryCompressPrompt = ''; $c('memory-compress-prompt').val(DEFAULT_MEMORY_COMPRESS_PROMPT); saveSettings(); });

    // ── Actions ──
    $c('memory-refresh').on('click', () => renderMemoryList());
    $c('memory-detect-orphans').on('click', function () {
        const orphans = memorySystem.detectOrphans();
        if (!orphans.length) { toastr.info(L('所有记忆完好', 'All memories intact')); return; }
        toastr.warning(orphans.map(o => `${o.name}: ${o.staleCount}`).join(', ') + L(' 条失联', ' orphaned'));
    });
    $c('memory-reset').on('click', async () => {
        if (!await callGenericPopup(L('重置所有角色的全部记忆？', 'Reset ALL memories?'), POPUP_TYPE.CONFIRM)) return;
        await memorySystem.resetAll();
        renderMemoryList();
        window.__gdRefreshDashboard?.();
    });

    // ── Render ──
    function renderMemoryList() {
        const group = getCurrentGroup();
        const members = group?.members?.filter(a => !group.disabled_members?.includes(a)) ?? [];
        if (!members.length) {
            $list.html(`<small style="color:var(--grey70a);">${L('请先在群聊中打开此设置面板', 'Open from a group chat')}</small>`);
            return;
        }

        let html = '';
        const stats = memorySystem.getStats();
        let total = 0;

        for (const avatar of members) {
            const char = getCharacters().find(c => c.avatar === avatar);
            const name = char?.name || avatar;
            const mems = memorySystem.listMemories(avatar);
            const count = mems.length;
            total += count;

            html += `<div style="margin-top:6px;border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:6px;">
                <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;" class="gd-mem-char-toggle" data-av="${escAttr(avatar)}">
                    <span><b>${escHtml(name)}</b> <span style="font-size:0.85em;color:var(--grey70a);">${count} ${L('条记忆', 'memories')}</span></span>
                    <span style="display:flex;gap:4px;">
                        <span class="menu_button menu_button_icon gd-mem-gen-btn" data-av="${escAttr(avatar)}" style="font-size:0.8em;"><i class="fa-solid fa-wand-magic-sparkles"></i> ${L('提取', 'Extract')}</span>
                        <span class="menu_button menu_button_icon gd-mem-compress-btn" data-av="${escAttr(avatar)}" style="font-size:0.8em;"><i class="fa-solid fa-compress"></i> ${L('压缩', 'Compress')}</span>
                        <span class="menu_button menu_button_icon gd-mem-revert-btn" data-av="${escAttr(avatar)}" style="font-size:0.8em;"><i class="fa-solid fa-undo"></i></span>
                        <i class="fa-solid fa-chevron-down gd-mem-chevron" data-av="${escAttr(avatar)}"></i>
                    </span>
                </div>
                <div class="gd-mem-entries" data-av="${escAttr(avatar)}" style="display:none;margin-top:4px;">`;

            if (!count) {
                html += `<small style="color:var(--grey70a);">${L('暂无记忆', 'No memories yet')}</small>`;
            } else {
                for (let ri = mems.length - 1; ri >= 0; ri--) {
                    const m = mems[ri];
                    html += `<div style="display:flex;align-items:flex-start;justify-content:space-between;padding:2px 0;border-bottom:1px solid var(--SmartThemeBorderColor);font-size:0.85em;">
                        <span style="flex:1;">${m.compressed ? '[压缩] ' : ''}${escHtml(m.event)} <span style="color:var(--grey70a);">[${escHtml(m.mood)}]</span></span>
                        <span style="white-space:nowrap;display:flex;gap:2px;">
                            <span class="menu_button menu_button_icon gd-mem-edit-btn" data-av="${escAttr(avatar)}" data-ix="${ri}" style="font-size:0.7em;"><i class="fa-solid fa-pencil"></i></span>
                            <span class="menu_button menu_button_icon gd-mem-del-btn" data-av="${escAttr(avatar)}" data-ix="${ri}" style="font-size:0.7em;color:#ff5555;"><i class="fa-solid fa-trash"></i></span>
                        </span>
                    </div>`;
                }
            }

            html += `</div></div>`;
        }

        // Summary line
        const summary = L(`${members.length} 个角色, 共 ${total} 条记忆`, `${members.length} chars, ${total} total entries`);
        $list.html(`<small style="color:var(--grey70a);margin-bottom:4px;">${summary}</small>` + html);

        // Toggle expand
        $list.find('.gd-mem-char-toggle').off('click').on('click', function () {
            const av = $(this).data('av');
            const el = $list.find(`.gd-mem-entries[data-av="${av}"]`);
            const chevron = $list.find(`.gd-mem-chevron[data-av="${av}"]`);
            el.toggle();
            chevron.toggleClass('fa-chevron-down fa-chevron-up');
        });

        // Extract for character
        $list.find('.gd-mem-gen-btn').off('click').on('click', async function (e) {
            e.stopPropagation();
            const avatar = $(this).data('av');
            if (!await callGenericPopup(L('为此角色提取新记忆？将调用 LLM。', 'Extract new memories? Will call LLM.'), POPUP_TYPE.CONFIRM)) return;
            const btn = $(this); btn.prop('disabled', true);
            try {
                const result = await memorySystem.generateForCharacter(avatar);
                toastr.success(L(`提取了 ${result.length} 条记忆`, `Extracted ${result.length} entries`));
                renderMemoryList();
                window.__gdRefreshDashboard?.();
            } catch (e) { toastr.error(e.message); }
            finally { btn.prop('disabled', false); }
        });

        // Compress for character
        $list.find('.gd-mem-compress-btn').off('click').on('click', async function (e) {
            e.stopPropagation();
            const avatar = $(this).data('av');
            if (!await callGenericPopup(L('压缩该角色旧记忆？', 'Compress old memories?'), POPUP_TYPE.CONFIRM)) return;
            const btn = $(this); btn.prop('disabled', true);
            try {
                const result = await memorySystem.compressOldMemories(avatar, settings.memoryKeepRecent ?? 5);
                if (result) {
                    toastr.success(L(`已压缩: ${result.removed} → ${result.compressed} 摘要 + ${result.kept} 保留`, `Compressed`));
                } else { toastr.info(L('无需压缩', 'Nothing to compress')); }
                renderMemoryList();
                window.__gdRefreshDashboard?.();
            } catch (e) { toastr.error(e.message); }
            finally { btn.prop('disabled', false); }
        });

        // Revert for character
        $list.find('.gd-mem-revert-btn').off('click').on('click', async function (e) {
            e.stopPropagation();
            const avatar = $(this).data('av');
            if (!await callGenericPopup(L('回退最近一次提取？', 'Revert last extraction?'), POPUP_TYPE.CONFIRM)) return;
            try {
                await memorySystem.revertLast(avatar, settings.memoryKeepRecent ?? 5);
                renderMemoryList();
                window.__gdRefreshDashboard?.();
            } catch (e) { toastr.error(e.message); }
        });

        // Edit
        $list.find('.gd-mem-edit-btn').off('click').on('click', function () {
            const avatar = $(this).attr('data-av');
            const idx = parseInt($(this).attr('data-ix'));
            if (isNaN(idx)) return;
            const mems = memorySystem.listMemories(avatar);
            const m = mems[idx];
            if (!m) return;
            $('#gd-mem-edit-idx').val(idx);
            $('#gd-mem-edit-avatar').val(avatar);
            $('#gd-mem-edit-event').val(m.event || '');
            $('#gd-mem-edit-mood').val(m.mood || 'neutral');
            $('#gd-mem-edit-panel').show();
        });

        // Delete
        $list.find('.gd-mem-del-btn').off('click').on('click', async function () {
            const avatar = $(this).attr('data-av');
            const idx = parseInt($(this).attr('data-ix'));
            if (isNaN(idx)) return;
            if (!await callGenericPopup(L('删除这条记忆？', 'Delete this memory?'), POPUP_TYPE.CONFIRM)) return;
            await memorySystem.deleteEntry(avatar, idx);
            renderMemoryList();
            window.__gdRefreshDashboard?.();
        });
    }

    // Edit panel
    $c('mem-edit-save').on('click', async function () {
        const avatar = $c('mem-edit-avatar').val();
        const idx = parseInt($c('mem-edit-idx').val());
        const event = $c('mem-edit-event').val().trim();
        if (!event) { toastr.warning(L('内容不能为空', 'Content required')); return; }
        try {
            await memorySystem.updateEntry(avatar, idx, { event, mood: $c('mem-edit-mood').val() });
            $('#gd-mem-edit-panel').hide();
            renderMemoryList();
            window.__gdRefreshDashboard?.();
        } catch (e) { toastr.error(e.message); }
    });
    $c('mem-edit-cancel').on('click', () => { $('#gd-mem-edit-panel').hide(); });

    function escHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function escAttr(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
    }

    // Expose for other sections (e.g. memory export)
    ctx.renderMemoryList = renderMemoryList;

    if (settings.memoryEnabled) renderMemoryList();
});
