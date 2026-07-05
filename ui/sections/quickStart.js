/**
 * Quick Start — mirrored controls in drawer 1 ("模式与开始").
 * Profile, Memory, World Books, one-click config + summary.
 */
import { registerSection } from './registry.js';

registerSection('quickStart', function (ctx) {
    const { settings, $c, saveSettings, generateProfilesBatch, getProfiles,
        getCurrentGroup, toastr, world_names,
        memorySystem, summarySystem, loadConfigPreset, configProfileSystem, getCharacters } = ctx;
    const isZh = () => (settings.lang || 'zh') === 'zh';

    const $container = $('#gd-quick-start');
    if (!$container.length) return;

    function escHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ── Build HTML ──────────────────────────────────────────────────

    function buildHtml() {
        let html = '';

        // ── Readiness lights ──
        html += `<div id="gd-qs-readiness" style="margin-bottom:6px;font-size:0.85em;"></div>`;

        // ── Profile ──
        html += `<div style="margin-bottom:6px;">
            <label class="checkbox_label" for="gd-qs-profile-enabled">
                <input type="checkbox" id="gd-qs-profile-enabled">
                <span data-i18n="profileEnabled">启用角色档案</span>
            </label>
            <span class="menu_button menu_button_icon" id="gd-qs-profile-regenerate-all" style="margin-left:8px;font-size:0.8em;">
                <i class="fa-solid fa-arrows-rotate"></i> <span data-i18n="profileRegenerateAll">全部重新生成</span>
            </span>
            <span class="menu_button menu_button_icon" id="gd-qs-profile-refresh" style="margin-left:4px;font-size:0.75em;cursor:pointer;" onclick="window._gdQuickRefreshProfile && window._gdQuickRefreshProfile()">
                <i class="fa-solid fa-rotate"></i> <span data-i18n="profileScanSave">扫描存档档案</span>
            </span>
            <div id="gd-qs-profile-list" style="margin-top:4px;max-height:120px;overflow-y:auto;font-size:0.85em;"></div>
        </div>`;

        // ── Memory ──
        html += `<div style="margin-bottom:6px;">
            <label class="checkbox_label" for="gd-qs-memory-enabled">
                <input type="checkbox" id="gd-qs-memory-enabled">
                <span data-i18n="memoryEnabled">启用角色记忆</span>
            </label>
            <span class="menu_button menu_button_icon" id="gd-qs-memory-extract" style="margin-left:8px;font-size:0.8em;">
                <i class="fa-solid fa-wand-magic-sparkles"></i> <span data-i18n="qsMemoryExtractAll">提取全部</span>
            </span>
            <span class="menu_button menu_button_icon" id="gd-qs-memory-refresh" style="margin-left:4px;font-size:0.75em;cursor:pointer;" onclick="window._gdQuickRefreshMem && window._gdQuickRefreshMem()">
                <i class="fa-solid fa-rotate"></i> <span data-i18n="qsMemoryRefresh">扫描</span>
            </span>
            <div id="gd-qs-memory-list" style="margin-top:4px;font-size:0.85em;"></div>
        </div>`;

        // ── World Books ──
        html += `<div style="margin-bottom:6px;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
                <span style="font-weight:bold;font-size:0.85em;">${isZh() ? '世界书' : 'World Books'}</span>
                <span class="menu_button menu_button_icon" id="gd-qs-wb-refresh" style="font-size:0.7em;padding:1px 6px;cursor:pointer;" title="${isZh() ? '刷新' : 'Refresh'}" onclick="window._gdQuickRefreshWb && window._gdQuickRefreshWb()">
                    <i class="fa-solid fa-rotate"></i>
                </span>
            </div>
            <div id="gd-qs-worldbook-list" style="font-size:0.85em;max-height:100px;overflow-y:auto;"></div>
        </div>`;

        // ── One-click summary ──
        html += `<hr style="margin:4px 0;">
        <span class="menu_button menu_button_icon" id="gd-qs-summary-generate" style="font-size:0.8em;">
            <i class="fa-solid fa-compress"></i> <span data-i18n="qsGenerateSummary">一键总结</span>
        </span>`;

        $container.html(html);
    }

    buildHtml();

    // ═══ Readiness lights ═══════════════════════════════════════════

    function renderReadiness() {
        const $el = $('#gd-qs-readiness');
        if (!$el.length) return;
        const profiles = getProfiles ? getProfiles() : {};
        const profReady = Object.values(profiles).filter(p => p.state === 'ready').length;
        const profTotal = Object.keys(profiles).length;

        let memCount = 0;
        if (memorySystem) {
            const stats = memorySystem.getStats();
            memCount = Object.values(stats).reduce((s, st) => s + st.count, 0);
        }
        const wbCount = (world_names || []).length;
        const wbChecked = Object.values(settings.worldBookSelection || {}).filter(Boolean).length;

        const light = (label, ok, detail) =>
            `<span style="margin-right:10px;"><span style="color:${ok ? '#4caf50' : '#ff9800'};">${ok ? '🟢' : '🟡'}</span> ${label}${detail ? ` (${detail})` : ''}</span>`;

        $el.html(
            light(isZh() ? '档案' : 'Profiles', profTotal > 0 && profReady > 0, `${profReady}/${profTotal}`) +
            light(isZh() ? '记忆' : 'Memory', memCount > 0, memCount) +
            light(isZh() ? '世界书' : 'WBooks', wbCount > 0 && wbChecked > 0, `${wbChecked}/${wbCount}`)
        );
    }

    // ═══ Profile ════════════════════════════════════════════════════

    $c('qs-profile-enabled').prop('checked', settings.profileEnabled ?? false);
    $c('qs-profile-enabled').on('change', function () {
        settings.profileEnabled = !!$(this).prop('checked');
        $c('profile-enabled').prop('checked', settings.profileEnabled);
        $('#gd-profile-section').toggle(settings.profileEnabled);
        saveSettings();
        if (settings.profileEnabled) { refreshQuickProfileList(); renderReadiness(); }
    });

    $c('qs-profile-regenerate-all').on('click', async function () {
        const group = getCurrentGroup();
        if (!group) { toastr.warning(isZh() ? '请先加入群聊' : 'Join a group first'); return; }
        const members = group.members.filter(a => !group.disabled_members?.includes(a));
        if (!members.length) { toastr.warning(isZh() ? '无可用角色' : 'No members'); return; }
        const btn = $(this); btn.prop('disabled', true);
        try {
            await generateProfilesBatch(members);
            const profiles = getProfiles();
            const ready = Object.values(profiles).filter(p => p.state === 'ready').length;
            refreshQuickProfileList(); renderReadiness();
            if (ctx.renderProfileManagementList) ctx.renderProfileManagementList();
            toastr.success(isZh() ? `${ready} 个档案已就绪` : `${ready} profiles ready`);
        } catch (e) { toastr.error(e.message); }
        finally { btn.prop('disabled', false); }
    });

    function refreshQuickProfileList() {
        const $list = $('#gd-qs-profile-list');
        if (!$list.length) return;
        const profiles = getProfiles ? getProfiles() : {};
        const all = Object.values(profiles);
        const ready = all.filter(p => p.state === 'ready');
        const pending = all.filter(p => p.state === 'pending');
        const failed = all.filter(p => p.state === 'failed');
        if (!all.length) {
            $list.html(`<small style="color:var(--grey70a);">${isZh() ? '暂无档案' : 'No profiles'}</small>`);
            return;
        }
        const sc = { ready: '#4caf50', pending: '#ff9800', failed: '#f44336' };
        let html = '';
        for (const p of [...ready, ...pending, ...failed]) {
            html += `<span style="margin-right:8px;white-space:nowrap;"><span style="color:${sc[p.state]};font-size:0.8em;">&#9679;</span> ${escHtml(p.name)}</span>`;
        }
        html += `<small style="color:var(--grey70a);">(${ready.length}/${all.length})</small>`;
        $list.html(html);
    }

    window._gdQuickRefreshProfile = () => { refreshQuickProfileList(); renderReadiness(); };

    // ═══ Memory ═════════════════════════════════════════════════════

    function refreshQuickMemoryList() {
        const $list = $('#gd-qs-memory-list');
        if (!$list.length) return;
        if (!memorySystem) { $list.html(''); return; }
        const group = getCurrentGroup();
        if (!group) return;
        const members = group.members.filter(a => !group.disabled_members?.includes(a));
        const chars = getCharacters ? getCharacters() : [];
        const stats = memorySystem.getStats();
        let count = 0;
        let html = '';
        for (const av of members) {
            const st = stats[av];
            const c = chars.find(ch => ch.avatar === av);
            const name = c?.name || av;
            const n = st?.count || 0;
            count += n;
            html += `<span style="margin-right:8px;white-space:nowrap;">
                <span style="font-size:0.8em;">${escHtml(name)}:</span> <b>${n}</b></span>`;
        }
        if (!count) {
            $list.html(`<small style="color:var(--grey70a);">${isZh() ? '暂无记忆' : 'No memories'}</small>`);
        } else {
            $list.html(`<small style="color:var(--grey70a);">${isZh() ? '共' : 'Total'} ${count} ${isZh() ? '条' : ''}</small> ` + html);
        }
        renderReadiness();
    }

    window._gdQuickRefreshMem = () => { refreshQuickMemoryList(); };

    $c('qs-memory-enabled').prop('checked', settings.memoryEnabled ?? false);
    $c('qs-memory-enabled').on('change', function () {
        settings.memoryEnabled = !!$(this).prop('checked');
        $c('memory-enabled').prop('checked', settings.memoryEnabled);
        saveSettings();
        if (settings.memoryEnabled) refreshQuickMemoryList();
    });

    $c('qs-memory-extract').on('click', async function () {
        if (!memorySystem) return;
        const btn = $(this); btn.prop('disabled', true);
        try {
            await memorySystem.generateForAll();
            refreshQuickMemoryList();
            toastr.success(isZh() ? '记忆提取完成' : 'Memory extraction done');
        } catch (e) { toastr.error(e.message); }
        finally { btn.prop('disabled', false); }
    });

    // ═══ World Books ════════════════════════════════════════════════

    function refreshQuickWorldBookList() {
        const $list = $('#gd-qs-worldbook-list');
        if (!$list.length) return;
        const names = world_names || [];
        if (!names.length) {
            $list.html(`<small style="color:var(--grey70a);">${isZh() ? '无世界书' : 'No world books'}</small>`);
            renderReadiness();
            return;
        }
        const selection = settings.worldBookSelection || {};
        let html = '';
        for (const name of names) {
            const checked = !!selection[name];
            html += `<label class="checkbox_label" style="display:block;font-size:0.8em;${checked ? '' : 'color:var(--grey70a);'}">
                <input type="checkbox" class="gd-qs-wb-check" data-book="${escHtml(name)}" ${checked ? 'checked' : ''}> ${escHtml(name)}
            </label>`;
        }
        $list.html(html);
        $list.find('.gd-qs-wb-check').off('change').on('change', function () {
            settings.worldBookSelection[$(this).attr('data-book')] = !!$(this).prop('checked');
            saveSettings();
            if (ctx.renderWorldBookList) ctx.renderWorldBookList();
            renderReadiness();
        });
        renderReadiness();
    }

    window._gdQuickRefreshWb = () => {
        refreshQuickWorldBookList();
        toastr.info(isZh() ? '世界书列表已刷新' : 'World book list refreshed');
    };

    // ═══ Sync wrap ══════════════════════════════════════════════════

    function wrapRefresh(fn, quickFn) {
        if (typeof fn !== 'function') return fn;
        return async function () { const r = await fn.apply(this, arguments); try { quickFn(); } catch (_) {} return r; };
    }
    if (typeof ctx.renderProfileManagementList === 'function') {
        ctx.renderProfileManagementList = wrapRefresh(ctx.renderProfileManagementList, () => { refreshQuickProfileList(); renderReadiness(); });
    }
    if (typeof ctx.renderWorldBookList === 'function') {
        ctx.renderWorldBookList = wrapRefresh(ctx.renderWorldBookList, () => { refreshQuickWorldBookList(); renderReadiness(); });
    }

    // ═══ One-click summary ═════════════════════════════════════════

    $c('qs-summary-generate').on('click', async function () {
        if (!summarySystem) { toastr.warning(isZh() ? '总结系统未就绪' : 'Summary system unavailable'); return; }
        const btn = $(this); btn.prop('disabled', true);
        try {
            await summarySystem.generateSummary();
            toastr.success(isZh() ? '上下文总结完成' : 'Summary generated');
        } catch (e) { toastr.error(e.message); }
        finally { btn.prop('disabled', false); }
    });

    // ═══ Init ═══════════════════════════════════════════════════════

    renderReadiness();
    if (settings.profileEnabled) refreshQuickProfileList();
    if (settings.memoryEnabled) refreshQuickMemoryList();
    refreshQuickWorldBookList();
});
