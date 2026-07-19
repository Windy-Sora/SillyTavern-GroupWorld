import { registerSection } from './registry.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../popup.js';

registerSection('dashboard', function (ctx) {
    const {
        settings, $c, saveSettings, getDirectorHistory, getProfiles,
        memorySystem, npcSystem, loadConfigPreset, getConfigPresetNames,
        isRoundActive, saveChatConditional, getChat, toastr, exportGroup, importGroup,
        configProfileSystem, onLatestEntryEdited, storyBlueprintSystem,
    } = ctx;

    // ── Card collapse state persistence ──────────────────────────
    if (!settings.uiState) settings.uiState = {};
    if (!settings.uiState.cardStates) settings.uiState.cardStates = {};

    function saveUiState() { saveSettings(); }

    function initCard(cardEl) {
        const name = cardEl.dataset.card;
        const $card = $(cardEl);
        const $body = $card.find('.gd-card-body');

        // Restore persisted state
        if (name && settings.uiState.cardStates[name]) {
            $card.addClass('is-expanded');
            $body.show();
        }

        $card.find('.gd-card-header').on('click', () => {
            const expanded = $card.hasClass('is-expanded');
            if (expanded) {
                $card.removeClass('is-expanded');
                $body.slideUp(180);
                if (name) { settings.uiState.cardStates[name] = false; saveUiState(); }
            } else {
                $card.addClass('is-expanded');
                $body.slideDown(180);
                if (name) { settings.uiState.cardStates[name] = true; saveUiState(); }
            }
        });
    }

    // Init all collapsible cards
    document.querySelectorAll('.gd-card-collapsible').forEach(initCard);

    // ── Dashboard: mode indicator ──────────────────────────────
    const $dot = $('#gd-status-dot');
    const $badge = $('#gd-mode-badge');
    const $label = $('#gd-mode-label');
    const lang = settings.lang || 'zh';

    function refreshMode() {
        const l = settings.lang || 'zh';
        const mode = settings.mode;
        $dot.removeClass('is-live is-formula is-off');
        if (mode === 'llm') {
            $dot.addClass('is-live');
            $badge.text(l === 'zh' ? 'LLM' : 'LLM').show();
            $label.text(l === 'zh' ? '导演 · LLM 模式' : 'Director · LLM');
        } else if (mode === 'formula') {
            $dot.addClass('is-formula');
            $badge.text(l === 'zh' ? '公式' : 'Formula').show();
            $label.text(l === 'zh' ? '导演 · 公式模式' : 'Director · Formula');
        } else {
            $dot.addClass('is-off');
            $badge.hide();
            $label.text(l === 'zh' ? '导演 · 已关闭' : 'Director · Off');
        }
    }

    // ── Dashboard: last decision ────────────────────────────────
    function refreshDecision() {
        const history = getDirectorHistory();
        const $wrapper = $('#gd-dashboard-decision');
        const $speakers = $('#gd-decision-speakers');
        const $reason = $('#gd-decision-reason');

        if (!history.length) {
            $wrapper.hide();
            return;
        }
        const last = history[history.length - 1];
        const names = Array.isArray(last.speakers) ? last.speakers : [];
        $speakers.text(names.join(' → ') || (lang === 'zh' ? '(无)' : '(none)'));
        if (last.reason) {
            $reason.text(last.reason).show();
        } else {
            $reason.hide();
        }
        $wrapper.show();
    }

    // ── Dashboard: stats ─────────────────────────────────────────
    function refreshStats() {
        try {
            const profiles = getProfiles?.() || {};
            const entries = Object.values(profiles).filter(p => p && p.state === 'ready');
            $('#gd-stat-profiles .gd-stat-value').text(entries.length);
        } catch (_) {}

        try {
            const stats = memorySystem.getStats?.() || {};
            const total = Object.values(stats).reduce((s, v) => s + (v.count || 0), 0);
            $('#gd-stat-memories .gd-stat-value').text(total);
        } catch (_) {}

        try {
            const npcs = npcSystem.getNpcs?.() || [];
            $('#gd-stat-npcs .gd-stat-value').text(npcs.length);
        } catch (_) {}

        try {
            const history = getDirectorHistory();
            $('#gd-stat-ledger .gd-stat-value').text(history.length);
        } catch (_) {}

        try {
            const p = storyBlueprintSystem?.getProgress?.();
            $('#gd-stat-story-blueprint .gd-stat-value').text(p?.total ? `${p.doneCount}/${p.total}` : '-');
        } catch (_) {}
    }

    // ── Dashboard: card status labels ────────────────────────────
    function refreshCardStatuses() {
        try {
            const profiles = getProfiles?.() || {};
            const ready = Object.values(profiles).filter(p => p && p.state === 'ready').length;
            const $s = $('#gd-card-status-profile');
            $s.text(ready ? ready + ' ready' : settings.profileEnabled ? '...' : 'off');
            $s.css('color', ready ? '#4caf50' : '');
        } catch (_) {}

        try {
            const stats = memorySystem.getStats?.() || {};
            const total = Object.values(stats).reduce((s, v) => s + (v.count || 0), 0);
            const $s = $('#gd-card-status-memory');
            $s.text(total ? total + ' entries' : settings.memoryEnabled ? '...' : 'off');
            $s.css('color', total ? '#4caf50' : '');
        } catch (_) {}

        try {
            const npcs = npcSystem.getNpcs?.() || [];
            const $s = $('#gd-card-status-npc');
            $s.text(npcs.length ? npcs.length + ' NPCs' : settings.npcEnabled ? '...' : 'off');
            $s.css('color', npcs.length ? '#4caf50' : '');
        } catch (_) {}

        try {
            const history = getDirectorHistory();
            const $s = $('#gd-card-status-ledger');
            $s.text(history.length ? history.length + ' rounds' : 'empty');
            $s.css('color', history.length ? '#4caf50' : '');
        } catch (_) {}

        try {
            const $s = $('#gd-card-status-ps-msg');
            $s.text(settings.postSpeechMessageEnabled ? 'ON' : 'off');
            $s.css('color', settings.postSpeechMessageEnabled ? '#4caf50' : '');
        } catch (_) {}

        try {
            const $s = $('#gd-card-status-ps-round');
            $s.text(settings.postSpeechRoundEnabled ? 'ON' : 'off');
            $s.css('color', settings.postSpeechRoundEnabled ? '#4caf50' : '');
        } catch (_) {}

        try {
            const presets = getConfigPresetNames?.() || [];
            const $s = $('#gd-card-status-config');
            if (presets.length) { $s.text(presets.length + ' saved').show(); }
        } catch (_) {}

        try {
            const p = storyBlueprintSystem?.getProgress?.();
            const $s = $('#gd-story-blueprint-card-status');
            if ($s.length) {
                $s.text(p?.total ? `${p.doneCount}/${p.total}` : settings.storyBlueprintEnabled ? 'empty' : 'off');
                $s.css('color', p?.total ? '#4caf50' : '');
            }
        } catch (_) {}
    }

    // ── Dashboard: preset/profile selector ──────────────────────
    const PROF_PREFIX = '__prof__:'; // value prefix to distinguish user profiles from system presets

    function refreshPresetSelector() {
        const presets = getConfigPresetNames?.() || [];
        const sysProfiles = ctx.configProfileSystem?.getProfiles?.() || [];
        // Update both dashboard dropdown and card dropdown
        for (const selId of ['gd-dash-cfg-preset', 'gd-cfg-preset']) {
            const $sel = $(`#${selId}`);
            if (!$sel.length) continue;
            const current = $sel.val();
            $sel.find('option:not(:first)').remove();
            $sel.find('optgroup').remove();
            // System presets
            if (presets.length) {
                const $grp = $('<optgroup>').attr('label', lang === 'zh' ? '内置配置档' : 'System Presets');
                for (const name of presets) {
                    $grp.append(`<option value="${name.replace(/"/g, '&quot;')}">${esc(name)}</option>`);
                }
                $sel.append($grp);
            }
            // User profiles
            if (sysProfiles.length) {
                const $grp = $('<optgroup>').attr('label', lang === 'zh' ? '我的配置档' : 'My Profiles');
                for (const p of sysProfiles) {
                    $grp.append(`<option value="${PROF_PREFIX}${p.id}">${esc(p.name)}</option>`);
                }
                $sel.append($grp);
            }
            if (current) $sel.val(current);
            if (selId === 'gd-dash-cfg-preset') $sel.trigger('change');
        }
    }

    // Sync config profile list card with dashboard operations
    function syncConfigList() {
        const $card = $('#gd-config-profiles-list').closest('.gd-card-collapsible');
        if ($card.length && !$card.hasClass('is-expanded')) {
            $card.addClass('is-expanded');
            $card.find('.gd-card-body').show();
        }
        if (typeof window.__gdRefreshConfigList === 'function') {
            window.__gdRefreshConfigList();
        }
    }

    // ── Dashboard: expandable stat panels ───────────────────────
    const statPanels = {
        summary:  { stat: 'gd-stat-summary',  panel: 'gd-dash-panel-summary',  list: 'gd-dash-panel-summary-list' },
        profiles: { stat: 'gd-stat-profiles', panel: 'gd-dash-panel-profiles', list: 'gd-dash-panel-profiles-list' },
        memories: { stat: 'gd-stat-memories', panel: 'gd-dash-panel-memories', list: 'gd-dash-panel-memories-list' },
        npcs:     { stat: 'gd-stat-npcs',     panel: 'gd-dash-panel-npcs',     list: 'gd-dash-panel-npcs-list' },
        ledger:   { stat: 'gd-stat-ledger',   panel: 'gd-dash-panel-ledger',   list: 'gd-dash-panel-ledger-list' },
        storyBlueprint: { stat: 'gd-stat-story-blueprint', panel: 'gd-dash-panel-story-blueprint', list: 'gd-dash-panel-story-blueprint-list' },
    };

    function esc(s) { if (!s) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    function openSettingsLabel() {
        return (settings.lang || 'zh') === 'zh' ? '打开设置' : 'Open settings';
    }

    function openSettingsCard(cardName) {
        const $card = $(`[data-card="${cardName}"]`).first();
        if (!$card.length) return;
        const $drawer = $card.closest('.inline-drawer-content');
        const $drawerRoot = $card.closest('.inline-drawer');
        if ($drawer.length && !$drawer.is(':visible')) {
            $drawer.show();
            $drawerRoot.find('> .inline-drawer-toggle .inline-drawer-icon')
                .removeClass('fa-circle-chevron-right right')
                .addClass('fa-circle-chevron-down down');
        }
        if (!$card.hasClass('is-expanded')) {
            $card.addClass('is-expanded');
            if (cardName) {
                settings.uiState.cardStates[cardName] = true;
                saveUiState();
            }
            $card.find('> .gd-card-body').show();
        }
        try { $card[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
    }

    function appendOpenSettingsButton($list, cardName) {
        const $bar = $(`<div style="display:flex;justify-content:flex-end;margin-bottom:6px;">
            <span class="menu_button menu_button_icon gd-dash-open-settings"><i class="fa-solid fa-sliders"></i> ${esc(openSettingsLabel())}</span>
        </div>`);
        $bar.find('.gd-dash-open-settings').on('click', () => openSettingsCard(cardName));
        $list.append($bar);
    }

    function makeToggleRow($row, $detail) {
        $row.css('cursor', 'pointer');
        $row.on('click', (e) => { if (!$(e.target).closest('.gd-edit-btn, .gd-edit-textarea, .gd-edit-save, .gd-edit-cancel').length) { $detail.toggle(120); } });
    }

    // Inline edit helper: replaces a detail text with a textarea on "edit" click
    function makeEditable($detail, field, getValue, setValue, afterSave, formatFn) {
        const $display = $detail.find(`.gd-edit-field[data-field="${field}"]`);
        if (!$display.length) return;

        function attachBtn() {
            const $btn = $(`<span class="gd-edit-btn menu_button menu_button_icon" style="font-size:0.7em;cursor:pointer;margin-left:4px;">${lang === 'zh' ? '编辑' : 'Edit'}</span>`);
            $display.append($btn);
            $btn.on('click', function (e) {
                e.stopPropagation();
                const $disp = $(this).closest('.gd-edit-field');
                if (!$disp.length) return;
                const val = getValue();
                const $ta = $(`<textarea class="gd-edit-textarea text_pole textarea_compact" style="width:100%;margin:2px 0;font-size:0.85em;" rows="3">${esc(val || '')}</textarea>`);
                const $btns = $(`<span style="display:flex;gap:4px;margin:2px 0;"><span class="gd-edit-save menu_button menu_button_icon" style="font-size:0.75em;color:#4caf50;">${lang === 'zh' ? '保存' : 'Save'}</span><span class="gd-edit-cancel menu_button menu_button_icon" style="font-size:0.75em;">${lang === 'zh' ? '取消' : 'Cancel'}</span></span>`);
                $disp.hide();
                $disp.after($ta, $btns);
                $ta.focus();
                $ta.on('keydown', (ev) => { if (ev.ctrlKey && ev.key === 'Enter') { $btns.find('.gd-edit-save').trigger('click'); } });
                $btns.find('.gd-edit-cancel').on('click', (ev2) => { ev2.stopPropagation(); $ta.remove(); $btns.remove(); $disp.show(); });
                $btns.find('.gd-edit-save').on('click', async (ev2) => {
                    ev2.stopPropagation();
                    const newVal = $ta.val();
                    setValue(newVal);
                    $disp.html(formatFn ? formatFn(newVal) : esc(newVal));
                    $ta.remove(); $btns.remove(); $disp.show();
                    attachBtn();
                    if (afterSave) await afterSave();
                });
            });
        }

        attachBtn();
    }

    function renderPanelSummary() {
        const active = ctx.summarySystem?.getLatestActive?.();
        const $list = $('#gd-dash-panel-summary-list').empty();
        appendOpenSettingsButton($list, 'summary');
        if (!active) {
            $list.append(`<small>${lang === 'zh' ? '暂无上下文总结' : 'No summary yet'}</small>`);
        } else {
            const $row = $(`<div class="gd-list-item gd-list-expandable"><span class="gd-list-name">${lang === 'zh' ? '当前总结' : 'Active summary'}</span><span class="gd-list-meta">${active.rangeEnd || '?'} msgs</span></div>`);
            const $detail = $(`<div class="gd-list-detail" style="display:none;padding:4px 8px;font-size:0.9em;color:var(--grey70a);"><div class="gd-edit-field" data-field="summary-content">${esc(active.content || '')}</div></div>`);
            if (active.content) {
                makeEditable($detail, 'summary-content',
                    () => active.content,
                    (v) => { active.content = v; },
                    async () => { await saveChatConditional(); refreshSummaryStat(); $('#gd-summary-result').val(active.content); window.__gdRefreshSummaryStatus?.(); }
                );
            }
            makeToggleRow($row, $detail);
            $list.append($row, $detail);
        }

        // Controls at panel bottom (always visible, sync with drawer)
        const sOn = !!settings.summaryEnabled;
        const asOn = !!settings.autoSummaryEnabled;
        const asInt = settings.autoSummaryInterval ?? 10;
        $list.append(`<hr style="margin:6px 0;opacity:0.3;"><div style="display:flex;align-items:center;gap:6px;font-size:0.82em;flex-wrap:wrap;">` +
            `<label class="checkbox_label" style="margin:0;"><input type="checkbox" id="gd-dash-panel-summary-enabled" ${sOn ? 'checked' : ''}>${lang === 'zh' ? '启用总结' : 'Enable'}</label>` +
            `<label class="checkbox_label" style="margin:0;"><input type="checkbox" id="gd-dash-panel-auto-summary" ${asOn ? 'checked' : ''}>${lang === 'zh' ? '自动' : 'Auto'}</label>` +
            `<span>${lang === 'zh' ? '每' : 'Every'}</span><input type="number" value="${asInt}" id="gd-dash-panel-auto-summary-int" class="text_pole" min="1" max="200" style="width:50px;margin:0;"><span>${lang === 'zh' ? '条触发' : 'msgs'}</span>` +
            `</div>`);
        $('#gd-dash-panel-summary-enabled').on('change', function () {
            settings.summaryEnabled = !!$(this).prop('checked');
            $('#gd-summary-enabled').prop('checked', settings.summaryEnabled);
            saveSettings();
        });
        $('#gd-dash-panel-auto-summary').on('change', function () {
            settings.autoSummaryEnabled = !!$(this).prop('checked');
            $('#gd-auto-summary-enabled').prop('checked', settings.autoSummaryEnabled);
            $('#gd-auto-summary-row').toggle(settings.autoSummaryEnabled);
            saveSettings();
        });
        $('#gd-dash-panel-auto-summary-int').on('input', function () {
            settings.autoSummaryInterval = Math.max(1, parseInt($(this).val()) || 10);
            $('#gd-auto-summary-interval').val(settings.autoSummaryInterval);
            saveSettings();
        });
    }

    function renderPanelProfiles() {
        const profiles = getProfiles?.() || {};
        const chars = ctx.getCharacters?.() || [];
        const $list = $('#gd-dash-panel-profiles-list').empty();
        appendOpenSettingsButton($list, 'profile');
        const entries = Object.entries(profiles).filter(([, p]) => p);
        if (!entries.length) { $list.append(`<small>${lang === 'zh' ? '暂无角色档案' : 'No profiles'}</small>`); return; }
        for (const [av, p] of entries) {
            const c = chars.find(c => c.avatar === av);
            const name = c?.name || p.name || av;
            const state = p.state || 'unknown';
            const color = { ready: '#4caf50', pending: '#ff9800', failed: '#f44336' }[state] || '';
            const profile = p.profile || {};
            const summarize = () => [esc(profile.summary), profile.tags && (lang === 'zh' ? '标签：' : 'Tags: ') + esc([].concat(profile.tags).join(', ')), profile.motivation && (lang === 'zh' ? '动机：' : 'Motivation: ') + esc(profile.motivation)].filter(Boolean).join('<br>');
            const $row = $(`<div class="gd-list-item gd-list-expandable"><span class="gd-list-name">${esc(name)} ▸</span><span class="gd-list-meta" style="color:${color}">${state}</span></div>`);
            const $detail = $(`<div class="gd-list-detail" style="display:none;padding:4px 8px;font-size:0.9em;color:var(--grey70a);"><div class="gd-edit-field" data-field="profile-summary">${summarize() || (lang === 'zh' ? '(空)' : '(empty)')}</div></div>`);
            makeEditable($detail, 'profile-summary',
                () => summarize(),
                (v) => { profile.summary = v; },
                () => saveChatConditional(),
                () => summarize()
            );
            makeToggleRow($row, $detail);
            $list.append($row, $detail);
        }
    }

    function renderPanelMemories() {
        const stats = memorySystem.getStats?.() || {};
        const $list = $('#gd-dash-panel-memories-list').empty();
        appendOpenSettingsButton($list, 'memory');
        const entries = Object.entries(stats);
        if (!entries.length) { $list.append(`<small>${lang === 'zh' ? '暂无角色记忆' : 'No memories'}</small>`); return; }
        for (const [av, s] of entries) {
            const mems = memorySystem.listMemories?.(av) || [];
            const recent = mems.slice(-5).reverse();
            const detailRows = recent.map((m, idx) => `<div class="gd-edit-field" data-field="mem-${av}-${mems.indexOf(m)}">· ${esc(m.event || '')} ${m.mood ? `[${esc(m.mood)}]` : ''}</div>`).join('');
            const $row = $(`<div class="gd-list-item gd-list-expandable"><span class="gd-list-name">${esc(s.name || av)} ▸</span><span class="gd-list-meta">${s.count || 0} ${lang === 'zh' ? '条' : 'entries'}</span></div>`);
            const $detail = $(`<div class="gd-list-detail" style="display:none;padding:4px 8px;font-size:0.9em;color:var(--grey70a);">${detailRows || (lang === 'zh' ? '(空)' : '(empty)')}</div>`);
            for (const m of recent) {
                const mi = mems.indexOf(m);
                makeEditable($detail, `mem-${av}-${mi}`,
                    () => m.event,
                    (v) => { m.event = v; },
                    () => saveChatConditional(),
                    (v) => `· ${esc(v)}${m.mood ? ` [${esc(m.mood)}]` : ''}`
                );
            }
            makeToggleRow($row, $detail);
            $list.append($row, $detail);
        }
        // Auto-memory controls at panel bottom
        const amOn = !!settings.autoMemoryEnabled;
        const amInt = settings.autoMemoryInterval ?? 10;
        $list.append(`<hr style="margin:6px 0;opacity:0.3;"><div style="display:flex;align-items:center;gap:6px;font-size:0.82em;"><label class="checkbox_label" style="margin:0;"><input type="checkbox" id="gd-dash-panel-auto-memory" ${amOn ? 'checked' : ''}>${lang === 'zh' ? '自动提取' : 'Auto-extract'}</label><span>${lang === 'zh' ? '每' : 'Every'}</span><input type="number" value="${amInt}" id="gd-dash-panel-auto-memory-int" class="text_pole" min="1" max="200" style="width:50px;margin:0;"><span>${lang === 'zh' ? '条触发' : 'msgs'}</span></div>`);
        $('#gd-dash-panel-auto-memory').on('change', function () { settings.autoMemoryEnabled = !!$(this).prop('checked'); saveSettings(); });
        $('#gd-dash-panel-auto-memory-int').on('input', function () { settings.autoMemoryInterval = Math.max(1, parseInt($(this).val()) || 10); saveSettings(); });
    }

    function renderPanelNpcs() {
        const npcs = npcSystem.getNpcs?.() || [];
        const $list = $('#gd-dash-panel-npcs-list').empty();
        appendOpenSettingsButton($list, 'npc');
        if (!npcs.length) { $list.append(`<small>${lang === 'zh' ? '暂无 NPC' : 'No NPCs'}</small>`); return; }
        npcs.forEach((n, ni) => {
            const shortDesc = (n.description || '').slice(0, 40);
            const fields = { desc: n.description, personality: n.personality, scenario: n.scenario };
            const line = (label, key) => fields[key] ? `<div class="gd-edit-field" data-field="npc-${ni}-${key}">${lang === 'zh' ? label : label.replace(/描述/, 'Desc').replace(/性格/, 'Personality').replace(/背景/, 'Scenario')}: ${esc(fields[key])}</div>` : '';
            const detail = [line('描述', 'desc'), line('性格', 'personality'), line('背景', 'scenario')].filter(Boolean).join('<br>');
            const $row = $(`<div class="gd-list-item gd-list-expandable"><span class="gd-list-name">${esc(n.name || '?')} ▸</span><span class="gd-list-meta">${esc(shortDesc)}${n.description?.length > 40 ? '...' : ''}</span></div>`);
            const $detail = $(`<div class="gd-list-detail" style="display:none;padding:4px 8px;font-size:0.9em;color:var(--grey70a);">${detail || (lang === 'zh' ? '(空)' : '(empty)')}</div>`);
            for (const key of ['desc', 'personality', 'scenario']) {
                if (fields[key]) {
                    const npcLabel = lang === 'zh'
                        ? { desc: '描述', personality: '性格', scenario: '背景' }[key]
                        : { desc: 'Desc', personality: 'Personality', scenario: 'Scenario' }[key];
                    makeEditable($detail, `npc-${ni}-${key}`,
                        () => ({ desc: n.description, personality: n.personality, scenario: n.scenario }[key]),
                        (v) => { if (key === 'desc') n.description = v; else if (key === 'personality') n.personality = v; else n.scenario = v; },
                        () => saveChatConditional(),
                        (v) => `${npcLabel}: ${esc(v)}`
                    );
                }
            }
            makeToggleRow($row, $detail);
            $list.append($row, $detail);
        });
    }

    function renderPanelLedger() {
        const history = getDirectorHistory();
        const $list = $('#gd-dash-panel-ledger-list').empty();
        appendOpenSettingsButton($list, 'ledger');
        if (!history.length) { $list.append(`<small>${lang === 'zh' ? '暂无账本记录' : 'No ledger entries'}</small>`); return; }
        const recent = history.slice(-8).reverse();
        for (let i = 0; i < recent.length; i++) {
            const e = recent[i];
            const speakers = Array.isArray(e.speakers) ? e.speakers.join(', ') : '';
            const reason = e.reason || '';
            const scriptEntries = e.scripts && typeof e.scripts === 'object' ? Object.entries(e.scripts) : [];
            const scriptsHtml = scriptEntries.length
                ? `<div style="margin-top:2px;">${lang === 'zh' ? '剧本：' : 'Scripts: '}` +
                  scriptEntries.map(([k, v], si) =>
                      `<div class="gd-edit-field" data-field="ledger-${history.length - 1 - i}-script-${si}" style="color:var(--grey70a);">${esc(k)}: ${esc(String(v).slice(0, 80))}${String(v).length > 80 ? '...' : ''}</div>`
                  ).join('') + '</div>'
                : '';
            const detailHtml = [
                reason && `<div class="gd-edit-field" data-field="ledger-${history.length - 1 - i}-reason">${lang === 'zh' ? '理由：' : 'Reason: '}${esc(reason)}</div>`,
                scriptsHtml,
            ].filter(Boolean).join('');
            const reasonShort = reason.slice(0, 50);
            const $row = $(`<div class="gd-list-item gd-list-expandable"><span class="gd-list-name">#${history.length - i} ${esc(speakers)} ▸</span><span class="gd-list-meta">${esc(reasonShort)}${reason.length > 50 ? '...' : ''}</span></div>`);
            const $detail = $(`<div class="gd-list-detail" style="display:none;padding:4px 8px;font-size:0.9em;color:var(--grey70a);">${detailHtml || (lang === 'zh' ? '(无详情)' : '(no details)')}</div>`);
            if (reason) {
                const ri = history.length - 1 - i;
                makeEditable($detail, `ledger-${ri}-reason`,
                    () => history[ri].reason || '',
                    (v) => { history[ri].reason = v; },
                    () => {
                        saveChatConditional();
                        if (ri === history.length - 1) onLatestEntryEdited();
                    },
                    (v) => `${lang === 'zh' ? '理由：' : 'Reason: '}${esc(v)}`
                );
            }
            scriptEntries.forEach(([k], si) => {
                const ri = history.length - 1 - i;
                makeEditable($detail, `ledger-${ri}-script-${si}`,
                    () => history[ri].scripts?.[k] || '',
                    (v) => { if (history[ri].scripts) history[ri].scripts[k] = v; },
                    () => {
                        saveChatConditional();
                        if (ri === history.length - 1) onLatestEntryEdited();
                    },
                    (v) => `${esc(k)}: ${esc(String(v).slice(0, 80))}${String(v).length > 80 ? '...' : ''}`
                );
            });
            makeToggleRow($row, $detail);
            $list.append($row, $detail);
        }
    }

    function renderPanelStoryBlueprint() {
        const $list = $('#gd-dash-panel-story-blueprint-list').empty();
        appendOpenSettingsButton($list, 'storyBlueprint');
        const state = storyBlueprintSystem?.getState?.();
        const p = storyBlueprintSystem?.getProgress?.();
        const data = storyBlueprintSystem?.getProviderData?.();
        if (!p || !p.total) {
            const hasBlueprint = !!data?.blueprint;
            $list.append(`<small>${hasBlueprint
                ? (lang === 'zh' ? '蓝图存在，但当前推进模式无匹配节点' : 'Blueprint loaded, but no matching progression steps')
                : (lang === 'zh' ? '暂无故事蓝图' : 'No Story Blueprint')}</small>`);
        } else {
            $list.append(`<div class="gd-list-item"><span class="gd-list-name">${esc(data?.blueprint?.title || 'Story Blueprint')}</span><span class="gd-list-meta">${p.doneCount}/${p.total}</span></div>`);
            $list.append(`<div style="font-size:0.9em;color:var(--grey70a);padding:4px 0;">${esc(p.complete ? (lang === 'zh' ? '已完成' : 'complete') : (data?.current?.path || ''))}</div>`);
            $list.append(`<div style="font-size:0.85em;color:var(--grey70a);">${settings.storyBlueprintEnabled ? (lang === 'zh' ? 'Provider 已启用' : 'Provider enabled') : (lang === 'zh' ? 'Provider 未启用' : 'Provider disabled')}</div>`);
        }
        if (state?.continuePending) {
            $list.append(`<div style="font-size:0.85em;color:#ff9800;">${lang === 'zh' ? '后台续写中...' : 'Continuing in background...'}</div>`);
        }
        $list.append(`<hr style="margin:6px 0;opacity:0.3;"><div style="display:flex;align-items:center;gap:6px;font-size:0.82em;flex-wrap:wrap;">` +
            `<label class="checkbox_label" style="margin:0;"><input type="checkbox" id="gd-dash-panel-story-enabled" ${settings.storyBlueprintEnabled ? 'checked' : ''}>${lang === 'zh' ? '启用' : 'Enable'}</label>` +
            `<span class="menu_button menu_button_icon" id="gd-dash-panel-story-generate" style="font-size:0.8em;"><i class="fa-solid fa-wand-magic-sparkles"></i> ${lang === 'zh' ? '生成蓝图' : 'Generate'}</span>` +
            `<span class="menu_button menu_button_icon" id="gd-dash-panel-story-preview" style="font-size:0.8em;"><i class="fa-solid fa-eye"></i> ${lang === 'zh' ? '预览' : 'Preview'}</span>` +
            `</div><textarea id="gd-dash-panel-story-preview-text" class="text_pole textarea_compact" rows="5" style="width:100%;font-family:monospace;font-size:0.82em;margin-top:4px;display:none;" readonly></textarea>`);
        $('#gd-dash-panel-story-enabled').on('change', function () {
            settings.storyBlueprintEnabled = !!$(this).prop('checked');
            $('#gd-story-blueprint-enabled').prop('checked', settings.storyBlueprintEnabled);
            if (settings.storyBlueprintEnabled) storyBlueprintSystem?.ensureCompletionVariable?.();
            storyBlueprintSystem?.clearCompletionSignal?.(settings.storyBlueprintEnabled ? 'enabled-reset' : 'disabled-reset');
            saveSettings();
            refreshAll();
        });
        $('#gd-dash-panel-story-generate').on('click', function () {
            if (!settings.storyBlueprintEnabled) {
                settings.storyBlueprintEnabled = true;
                $('#gd-story-blueprint-enabled').prop('checked', true);
                storyBlueprintSystem?.ensureCompletionVariable?.();
                saveSettings();
            }
            $('#gd-story-blueprint-generate').trigger('click');
        });
        $('#gd-dash-panel-story-preview').on('click', function () {
            const $t = $('#gd-dash-panel-story-preview-text');
            $t.val(storyBlueprintSystem?.renderCurrent?.() || '').toggle();
        });
    }

    const panelRenderers = { summary: renderPanelSummary, profiles: renderPanelProfiles, memories: renderPanelMemories, npcs: renderPanelNpcs, ledger: renderPanelLedger, storyBlueprint: renderPanelStoryBlueprint };

    let openPanel = null;
    function togglePanel(name) {
        const cfg = statPanels[name];
        if (!cfg) return;
        const $panel = $(`#${cfg.panel}`);
        if (openPanel === name) {
            $panel.slideUp(150);
            openPanel = null;
        } else {
            if (openPanel) { $(`#${statPanels[openPanel].panel}`).slideUp(100); }
            if ($wbPanel.is(':visible')) { $wbPanel.slideUp(100); }
            panelRenderers[name]?.();
            $panel.slideDown(150);
            openPanel = name;
        }
    }

    // Bind stat clicks
    for (const [name, cfg] of Object.entries(statPanels)) {
        $(`#${cfg.stat}`).on('click', () => togglePanel(name));
    }
    // Bind close buttons
    $('.gd-dash-panel-close').on('click', function () {
        const name = $(this).data('panel');
        $(`#${statPanels[name]?.panel}`).slideUp(150);
        if (openPanel === name) openPanel = null;
    });

    // ── Dashboard: world book inline list ───────────────────────
    const $wbPanel = $('#gd-dash-worldbooks');
    const $wbCount = $('#gd-dash-worldbooks-count');
    const $wbList = $('#gd-dash-worldbook-list');

    function refreshSummaryStat() {
        const active = ctx.summarySystem?.getLatestActive?.();
        const $val = $('#gd-stat-summary .gd-stat-value');
        if (active) {
            const total = ctx.getChat?.()?.length || 0;
            const covered = active.rangeEnd || 0;
            $val.text(`${covered}/${total}`);
        } else {
            $val.text('-');
        }
    }

    function refreshWorldBookStat() {
        const sel = settings.worldBookSelection || {};
        const names = ctx.world_names || [];
        const checked = names.filter(n => sel[n] === true).length;
        $('#gd-stat-worldbooks .gd-stat-value').text(names.length ? `${checked}/${names.length}` : '-');
    }

    function renderDashWorldBookList() {
        if (!settings.worldBookSelection) settings.worldBookSelection = {};
        const names = ctx.world_names || [];
        const sel = settings.worldBookSelection;
        $wbList.empty();
        appendOpenSettingsButton($wbList, 'worldbooks');
        if (!names.length) {
            $wbList.append(`<small>${lang === 'zh' ? '未找到任何世界书' : 'No world books found'}</small>`);
            return;
        }
        const $toolbar = $('<div style="margin-bottom:4px;display:flex;gap:4px;"></div>');
        const $all = $(`<span class="menu_button menu_button_icon" style="font-size:0.75em;cursor:pointer;"><i class="fa-solid fa-check-double"></i> ${lang === 'zh' ? '全选' : 'All'}</span>`);
        const $none = $(`<span class="menu_button menu_button_icon" style="font-size:0.75em;cursor:pointer;"><i class="fa-solid fa-xmark"></i> ${lang === 'zh' ? '取消' : 'None'}</span>`);
        $all.on('click', () => { for (const n of names) sel[n] = true; saveSettings(); renderDashWorldBookList(); refreshWorldBookStat(); window.__gdRefreshWorldBookList?.(); });
        $none.on('click', () => { for (const n of names) sel[n] = false; saveSettings(); renderDashWorldBookList(); refreshWorldBookStat(); window.__gdRefreshWorldBookList?.(); });
        $toolbar.append($all, $none);
        $wbList.append($toolbar);
        let totalChecked = 0;
        for (const name of names) {
            const checked = sel[name] === true;
            if (checked) totalChecked++;
            const $label = $(`<label class="checkbox_label" style="display:flex;align-items:center;gap:4px;"></label>`);
            const $input = $(`<input type="checkbox">`);
            $input.prop('checked', checked);
            $input.on('change', function () { sel[name] = !!$(this).prop('checked'); saveSettings(); refreshWorldBookStat(); window.__gdRefreshWorldBookList?.(); });
            $label.append($input, name);
            $wbList.append($label);
        }
        $wbCount.text(lang === 'zh' ? `已选 ${totalChecked}/${names.length}` : `${totalChecked}/${names.length} selected`);
    }

    // Toggle world book panel via stat click
    $('#gd-stat-worldbooks').on('click', () => {
        if ($wbPanel.is(':visible')) {
            $wbPanel.slideUp(150);
        } else {
            if (openPanel) { $(`#${statPanels[openPanel].panel}`).slideUp(100); openPanel = null; }
            renderDashWorldBookList();
            $wbPanel.slideDown(150);
        }
    });
    $('#gd-dash-worldbooks-close').on('click', () => $wbPanel.slideUp(150));

    // ── Dashboard: manual preset list refresh ───────────────────
    $('#gd-dash-preset-refresh').on('click', function () {
        refreshPresetSelector();
        const $icon = $(this).find('i');
        $icon.addClass('fa-spin');
        setTimeout(() => $icon.removeClass('fa-spin'), 500);
    });

    // Show/hide delete button based on selection (only user profiles)
    $('#gd-dash-cfg-preset').on('change', function () {
        const val = $(this).val();
        $('#gd-dash-preset-delete').toggle(!!val && val.startsWith(PROF_PREFIX));
    });

    // ── Dashboard: delete selected config profile ────────────────
    $('#gd-dash-preset-delete').on('click', async () => {
        const $sel = $('#gd-dash-cfg-preset');
        const rawValue = $sel.val();
        if (!rawValue || !rawValue.startsWith(PROF_PREFIX)) return;
        const id = rawValue.slice(PROF_PREFIX.length);
        const profile = (configProfileSystem.getProfiles() || []).find(p => p.id === id);
        const name = profile?.name || id;
        const ok = await callGenericPopup(
            (lang === 'zh' ? `确定删除配置档「${name}」？此操作不可撤销。` : `Delete config profile "${name}"? This cannot be undone.`),
            POPUP_TYPE.CONFIRM,
        );
        if (!ok) return;
        try {
            configProfileSystem.deleteProfile(id);
            $sel.val('');
            $('#gd-dash-preset-delete').hide();
            refreshPresetSelector();
            syncConfigList();
            toastr.success(lang === 'zh' ? `配置档「${name}」已删除` : `Config profile "${name}" deleted`);
        } catch (e) {
            toastr.error((lang === 'zh' ? '删除失败: ' : 'Delete failed: ') + e.message);
        }
    });

    // ── Dashboard: preset/profile apply ──────────────────────────
    $('#gd-dashboard-preset-apply').on('click', async () => {
        const rawValue = $('#gd-dash-cfg-preset').val();
        if (!rawValue) { toastr?.warning?.(lang === 'zh' ? '请先选择一个配置档' : 'Select a profile first'); return; }
        const btn = $('#gd-dashboard-preset-apply'); btn.prop('disabled', true);
        try {
            if (rawValue.startsWith(PROF_PREFIX)) {
                // User profile — apply directly by ID
                const id = rawValue.slice(PROF_PREFIX.length);
                ctx.configProfileSystem?.applyProfile(id);
                try { await window.__gdReloadExtension?.(); } catch (e) { console.error('[dashboard] reload after apply failed:', e); }
                const p = ctx.configProfileSystem?.getProfiles?.().find(p => p.id === id);
                toastr?.success?.(lang === 'zh'
                    ? `已应用「${p?.name || id}」`
                    : `"${p?.name || id}" applied.`);
            } else {
                // System preset — load then apply
                const profile = await loadConfigPreset(rawValue);
                ctx.configProfileSystem?.applyProfile(profile.id);
                try { await window.__gdReloadExtension?.(); } catch (e) { console.error('[dashboard] reload after apply failed:', e); }
                toastr?.success?.(lang === 'zh'
                    ? `已应用「${profile.name}」`
                    : `"${profile.name}" applied.`);
            }
            syncConfigList();
        } catch (e) {
            toastr?.error?.(lang === 'zh' ? `应用失败: ${e.message}` : `Failed: ${e.message}`);
        } finally { btn.prop('disabled', false); }
    });

    // ── Dashboard: export config profile ────────────────────────
    $('#gd-dash-export-cfg').on('click', async () => {
        const lang = settings.lang || 'zh';
        const allDrawers = {
            directorLlm: true, worldBooks: true, profilesAndData: true,
            contextLedger: true, multimodal: true, assetManager: true, agentsTools: true,
        };
        const format = $('#gd-dash-export-format').val();
        const btn = $('#gd-dash-export-cfg'); btn.prop('disabled', true);
        try {
            const name = await callGenericPopup(
                lang === 'zh' ? '<b>导出配置档</b><br>请输入导出名称：' : '<b>Export Config Profile</b><br>Enter export name:',
                POPUP_TYPE.INPUT,
                '',
                { placeholder: lang === 'zh' ? '例如：我的RP配置' : 'e.g. My RP Config' },
            );
            if (!name || !name.trim()) { btn.prop('disabled', false); return; }
            await configProfileSystem.exportCurrentSettings(allDrawers, format, name.trim());
            toastr.success(format === 'json'
                ? (lang === 'zh' ? '配置清单已导出' : 'Config manifest exported')
                : (lang === 'zh' ? '配置档已导出' : 'Config profile exported'));
        } catch (e) {
            toastr.error((lang === 'zh' ? '导出失败: ' : 'Export failed: ') + e.message);
        } finally { btn.prop('disabled', false); }
    });

    // ── Dashboard: save config profile ────────────────────────
    $('#gd-dash-save-cfg').on('click', async function () {
        const btn = $(this); if (btn.prop('disabled')) return;
        const lang = settings.lang || 'zh';
        btn.prop('disabled', true);
        const name = await callGenericPopup(
            lang === 'zh' ? '<b>保存配置档</b><br>请输入配置档名称：' : '<b>Save Config Profile</b><br>Enter profile name:',
            POPUP_TYPE.INPUT,
            '',
            { placeholder: lang === 'zh' ? '例如：我的RP配置' : 'e.g. My RP Config' },
        );
        if (!name || !name.trim()) { btn.prop('disabled', false); return; }
        const desc = '';
        const allDrawers = {
            directorLlm: true, worldBooks: true, profilesAndData: true,
            contextLedger: true, multimodal: true, assetManager: true, agentsTools: true,
        };
        try {
            configProfileSystem.saveCurrentAsProfile(name.trim(), desc, allDrawers);
            syncConfigList();
            refreshAll();
            toastr.success(lang === 'zh' ? `配置档「${name.trim()}」已保存` : `Config profile "${name.trim()}" saved`);
        } catch (e) {
            toastr.error((lang === 'zh' ? '保存失败: ' : 'Save failed: ') + e.message);
        } finally { btn.prop('disabled', false); }
    });

    // ── Dashboard: import config profile ────────────────────────
    $('#gd-dash-import-cfg').on('click', async () => {
        const ok = await callGenericPopup(
            lang === 'zh'
                ? '<b>安全警告</b><br>配置档可能包含可执行脚本（脚本执行器、Provider）。恶意代码可窃取聊天记录、API 密钥。请仅导入你完全信任的来源。'
                : '<b>Security Warning</b><br>Config profiles may contain executable scripts (executors, providers). Malicious code can steal chat logs and API keys. Only import from trusted sources.',
            POPUP_TYPE.CONFIRM,
        );
        if (!ok) return;
        $('#gd-dash-import-file').click();
    });
    $('#gd-dash-import-file').on('change', async function () {
        const file = this.files[0];
        if (!file) return;
        const btn = $('#gd-dash-import-cfg'); btn.prop('disabled', true);
        try {
            const isJson = file.name.endsWith('.json');
            const profile = isJson
                ? await configProfileSystem.importProfileFromJson(file)
                : await configProfileSystem.importProfileFromZip(file);
            toastr?.success?.(lang === 'zh'
                ? `已导入「${profile.name}」，请刷新页面以完全生效`
                : `"${profile.name}" imported. Refresh page for full effect.`);
            syncConfigList();
            refreshAll();
        } catch (e) {
            toastr?.error?.(lang === 'zh' ? `导入失败: ${e.message}` : `Import failed: ${e.message}`);
        } finally { btn.prop('disabled', false); this.value = ''; }
    });

    // ── Dashboard: export/import group ──────────────────────────
    $('#gd-dash-export-group').on('click', async () => {
        const btn = $('#gd-dash-export-group'); btn.prop('disabled', true);
        try { await exportGroup(); } catch (e) {
            toastr.error((lang === 'zh' ? '导出失败: ' : 'Export failed: ') + e.message);
        } finally { btn.prop('disabled', false); }
    });
    $('#gd-dash-import-group').on('click', () => $('#gd-dash-import-group-file').click());
    $('#gd-dash-import-group-file').on('change', async function () {
        const file = this.files?.[0];
        if (!file) return;
        const btn = $('#gd-dash-import-group'); btn.prop('disabled', true);
        try { await importGroup(file); } catch (e) {
            toastr.error((lang === 'zh' ? '导入失败: ' : 'Import failed: ') + e.message);
        } finally { btn.prop('disabled', false); this.value = ''; }
    });

    // ── Dashboard: quick action buttons ─────────────────────────

    // 扫描存档: profile scan + refresh memory list
    $('#gd-dash-scan').on('click', () => {
        const group = ctx.getCurrentGroup?.();
        if (!group) { toastr?.warning?.(lang === 'zh' ? '请先在群聊中打开此设置面板' : 'Open settings from a group chat first'); return; }
        $('#gd-profile-scan-save').trigger('click');
        $('#gd-memory-refresh').trigger('click');
        setTimeout(refreshAll, 1500);
    });

    // 生成档案
    $('#gd-dash-profiles').on('click', () => {
        const group = ctx.getCurrentGroup?.();
        if (!group) { toastr?.warning?.(lang === 'zh' ? '请先在群聊中打开此设置面板' : 'Open settings from a group chat first'); return; }
        $('#gd-profile-regenerate-all').trigger('click');
        setTimeout(refreshAll, 2000);
    });

    // 提取记忆: directly call generateForCharacter for each group member
    $('#gd-dash-memories').on('click', async () => {
        const group = ctx.getCurrentGroup?.();
        if (!group) { toastr?.warning?.(lang === 'zh' ? '请先在群聊中打开此设置面板' : 'Open settings from a group chat first'); return; }
        const members = group.members.filter(a => !group.disabled_members?.includes(a));
        if (!members.length) { toastr?.warning?.(lang === 'zh' ? '当前群聊没有可用角色' : 'No enabled members'); return; }
        toastr?.info?.(lang === 'zh' ? `正在为 ${members.length} 个角色提取记忆...` : `Extracting memories for ${members.length} characters...`);
        const btn = $('#gd-dash-memories'); btn.prop('disabled', true);
        let done = 0;
        for (const avatar of members) {
            try { await memorySystem.generateForCharacter(avatar); } catch (e) { console.warn('[GroupDirector] Memory extraction failed for', avatar, e); }
            done++;
        }
        btn.prop('disabled', false);
        toastr?.success?.(lang === 'zh' ? `已为 ${done} 个角色完成记忆提取` : `Memory extraction done for ${done} characters`);
        refreshAll();
    });

    // 执行总结
    $('#gd-dash-summary').on('click', () => {
        const group = ctx.getCurrentGroup?.();
        if (!group) { toastr?.warning?.(lang === 'zh' ? '请先在群聊中打开此设置面板' : 'Open settings from a group chat first'); return; }
        // Prevent double-click: the drawer execute button is disabled while running
        if ($('#gd-summary-execute').prop('disabled')) return;
        if (!settings.summaryEnabled) {
            settings.summaryEnabled = true;
            saveSettings();
            $('#gd-summary-enabled').prop('checked', true);
            $('#gd-summary-execute').prop('disabled', false);
            toastr?.info?.(lang === 'zh' ? '已自动启用上下文总结' : 'Chat summary auto-enabled');
        }
        $('#gd-dash-summary').prop('disabled', true);
        toastr?.info?.(lang === 'zh' ? '正在执行总结，请稍候...' : 'Running summary, please wait...', '', { timeOut: 3000 });
        $('#gd-summary-execute').trigger('click');
        // Summary is an async LLM call (~5-15s). Poll for completion.
        const poll = setInterval(() => {
            if (!$('#gd-summary-execute').prop('disabled')) {
                clearInterval(poll);
                $('#gd-dash-summary').prop('disabled', false);
                refreshAll();
            }
        }, 500);
        // Safety timeout: re-enable after 60s regardless
        setTimeout(() => { clearInterval(poll); $('#gd-dash-summary').prop('disabled', false); }, 60000);
    });

    function refreshQuickActions() {
        const group = !!ctx.getCurrentGroup?.();
        $('#gd-dash-scan').toggle(group && (settings.profileEnabled || settings.memoryEnabled));
        $('#gd-dash-profiles').toggle(group && settings.profileEnabled);
        $('#gd-dash-memories').toggle(group && settings.memoryEnabled);
        $('#gd-dash-summary').toggle(group);
        $('#gd-dash-vars').toggle(group);
        if (!group) $('#gd-dash-panel-vars').hide();
    }

    // ── Script detail card toggle ───────────────────────────────
    $('#gd-llm-script-enabled').on('input', function () {
        $('#gd-script-detail').toggle(!!$(this).prop('checked'));
    });
    // Init script detail state
    $('#gd-script-detail').toggle(!!settings.llmScriptEnabled);

    // ── Continuity detail toggle ─────────────────────────────────
    $('#gd-llm-script-continuity').on('input', function () {
        $('#gd-continuity-detail').toggle(!!$(this).prop('checked'));
    });
    $('#gd-continuity-detail').toggle(!!settings.llmScriptContinuity);

    // ── Refresh all dashboard data ───────────────────────────────
    function refreshAll() {
        refreshMode();
        refreshDecision();
        refreshStats();
        refreshCardStatuses();
        refreshQuickActions();
        refreshPresetSelector();
        refreshSummaryStat();
        refreshWorldBookStat();
        window.__gdRefreshVariables?.();
    }

    // Initial load
    refreshMode();
    refreshDecision();
    refreshStats();
    refreshCardStatuses();
    refreshQuickActions();
    refreshPresetSelector();
    refreshSummaryStat();
    refreshWorldBookStat();
    window.__gdRefreshVariables?.();

    // Refresh when any GD drawer is toggled
    $('.group-director-settings .inline-drawer-toggle').on('click', function () {
        setTimeout(refreshAll, 300);
    });

    // Auto-refresh when the GD settings panel is opened (ST drawer expands)
    const panelEl = document.getElementById('gd-settings-panel');
    if (panelEl) {
        panelEl.__gdPanelObserver?.disconnect();
        let panelRefreshQueued = false;
        const panelObserver = new MutationObserver(() => {
            // 防重入 + 去抖：合并短时间多次触发，避免与其它插件的 observer 互相点燃
            if (panelRefreshQueued) return;
            panelRefreshQueued = true;
            requestAnimationFrame(() => {
                panelRefreshQueued = false;
                if (!panelEl.classList.contains('closedDrawer')) {
                    refreshAll();
                }
            });
        });
        panelEl.__gdPanelObserver = panelObserver;
        panelObserver.observe(panelEl, { attributes: true, attributeFilter: ['class'] });
    }

    // Expose refresh for other sections
    window.__gdRefreshDashboard = refreshAll;
    window.__gdRenderPanelSummary = renderPanelSummary;
    window.__gdRefreshSummaryStat = refreshSummaryStat;
});
