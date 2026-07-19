import { registerSection } from './registry.js';

registerSection('profileExport', function (ctx) {
    const { settings, $c, saveSettings, getCurrentGroup, getCharacters,
        getProfiles, getDefaultProfileGeneratorPrompt, getDefaultProfileSchema,
        getDefaultProfileRenderTemplate, exportProfiles, parseImportFile,
        applyImport, loadPreset, getPresetNames, refreshProfileManagementUI } = ctx;

    const isZh = () => (settings.lang || 'zh') === 'zh';

    // Track parsed import data for the UI
    let pendingImportData = null;

    // ── Helpers ──────────────────────────────────────────────────

    function getGroupMembers() {
        const group = getCurrentGroup();
        if (!group) return [];
        return group.members.filter(a => !group.disabled_members?.includes(a));
    }

    function getReadyProfiles() {
        const profiles = getProfiles();
        const members = getGroupMembers();
        return members.filter(a => {
            const p = profiles[a];
            return p && p.state === 'ready';
        });
    }

    // ── Export ───────────────────────────────────────────────────

    function renderExportList() {
        const $list = $('#gd-profile-export-list');
        if (!$list.length) return;

        const profiles = getProfiles();
        const members = getGroupMembers();
        const chars = getCharacters();

        if (!members.length) {
            $list.html(`<small><i>${isZh() ? '当前群聊没有可用角色' : 'No enabled members in current group'}</i></small>`);
            return;
        }

        const hasAnyReady = members.some(a => profiles[a] && profiles[a].state === 'ready');
        if (!hasAnyReady) {
            $list.html(`<small><i>${isZh() ? '暂无就绪的档案，请先生成角色档案' : 'No ready profiles — generate profiles first'}</i></small>`);
            return;
        }

        let html = '';
        members.forEach(avatar => {
            const prof = profiles[avatar];
            const char = chars.find(c => c.avatar === avatar);
            const name = char?.name || prof?.name || avatar;
            const state = prof?.state;
            const ready = state === 'ready';
            html += `<label class="checkbox_label" style="margin:2px 0;">
                <input type="checkbox" class="gd-export-check" data-avatar="${escAttr(avatar)}" ${ready ? 'checked' : 'disabled'}>
                <span>${escHtml(name)} ${!ready ? `<span style="color:#999;">(${state || 'no profile'})</span>` : ''}</span>
            </label>`;
        });
        html += `<div style="margin-top:4px;display:flex;gap:6px;">
            <span class="menu_button menu_button_icon" id="gd-export-select-all" style="font-size:0.85em;">${isZh() ? '全选' : 'Select All'}</span>
            <span class="menu_button menu_button_icon" id="gd-export-deselect-all" style="font-size:0.85em;">${isZh() ? '反选' : 'Invert'}</span>
        </div>`;
        $list.html(html);

        $('#gd-export-select-all').off('click').on('click', () => $('.gd-export-check:not(:disabled)').prop('checked', true));
        $('#gd-export-deselect-all').off('click').on('click', () => {
            $('.gd-export-check:not(:disabled)').each(function () { $(this).prop('checked', !$(this).prop('checked')); });
        });
    }

    // ── Import ───────────────────────────────────────────────────

    function renderImportList(importData) {
        const $list = $('#gd-profile-import-list');
        if (!$list.length) return;

        pendingImportData = importData;

        // Template consistency warning
        $('#gd-profile-import-template-warn').remove();
        if (importData._templateDiffs.length > 0) {
            let warnHtml = `<div id="gd-profile-import-template-warn" style="border:1px solid #ff9800;border-radius:4px;padding:8px;margin-bottom:8px;background:rgba(255,152,0,0.05);">`;
            warnHtml += `<div style="display:flex;justify-content:space-between;align-items:center;">`;
            warnHtml += `<b style="color:#ff9800;">&#9888; ${isZh() ? '模板不一致警告' : 'Template Mismatch Warning'}</b>`;
            warnHtml += `<span class="gd-import-warn-close" style="cursor:pointer;color:var(--grey70a);font-size:1.1em;" title="${isZh() ? '关闭' : 'Dismiss'}">&times;</span>`;
            warnHtml += `</div>`;
            warnHtml += `<small style="display:block;margin-top:4px;color:var(--grey70a);">${isZh() ? '导入文件的模板配置与当前设置不一致，可能导致渲染结果不同。建议导入后检查渲染模板。' : 'Template config in the import file differs from current settings. Rendered output may differ. Review render template after import.'}</small>`;
            warnHtml += `<ul style="margin:4px 0;font-size:0.85em;">`;
            importData._templateDiffs.forEach(d => {
                warnHtml += `<li><b>${escHtml(d.label)}</b>: ${isZh() ? '文件 hash' : 'file hash'} ${d.importHash} vs ${isZh() ? '当前 hash' : 'current hash'} ${d.currentHash}</li>`;
            });
            warnHtml += `</ul></div>`;
            $list.before(warnHtml);
            // Bind dismiss
            $('#gd-profile-import-template-warn .gd-import-warn-close').off('click').on('click', function () {
                $('#gd-profile-import-template-warn').remove();
            });
        }

        if (!importData.profiles.length) {
            $list.html(`<small><i>${isZh() ? '文件中没有档案数据' : 'No profile data in file'}</i></small>`);
            return;
        }

        let html = '';
        importData.profiles.forEach(p => {
            const isNew = p._action === 'new';
            const label = isNew
                ? `<span style="color:#4caf50;">(${isZh() ? '新建' : 'New'})</span>`
                : `<span style="color:#ff9800;">(${isZh() ? '覆盖' : 'Overwrite'})</span>`;
            const summary = (p.profile?.summary || '').substring(0, 80);
            html += `<label class="checkbox_label" style="margin:2px 0;">
                <input type="checkbox" class="gd-import-check" data-avatar="${escAttr(p.avatar)}" checked>
                <span>${escHtml(p.name)} ${label}</span>
                ${summary ? `<small style="display:block;color:var(--grey70a);margin-left:20px;">${escHtml(summary)}</small>` : ''}
            </label>`;
        });
        html += `<div style="margin-top:4px;display:flex;gap:6px;">
            <span class="menu_button menu_button_icon" id="gd-import-select-all" style="font-size:0.85em;">${isZh() ? '全选' : 'Select All'}</span>
            <span class="menu_button menu_button_icon" id="gd-import-deselect-all" style="font-size:0.85em;">${isZh() ? '反选' : 'Invert'}</span>
        </div>`;
        $list.html(html);

        $('#gd-import-select-all').off('click').on('click', () => $('.gd-import-check').prop('checked', true));
        $('#gd-import-deselect-all').off('click').on('click', () => {
            $('.gd-import-check').each(function () { $(this).prop('checked', !$(this).prop('checked')); });
        });
    }

    function handleImportFile(file) {
        const reader = new FileReader();
        reader.onload = function () {
            const result = parseImportFile(reader.result);
            if (!result.ok) {
                toastr.error((isZh() ? '导入失败：' : 'Import failed: ') + result.error);
                console.error('[GroupDirector] Profile import parse error:', result.error);
                return;
            }
            renderImportList(result.data);
            toastr.info(isZh() ? `已解析文件：${result.data.profiles.length} 个档案` : `Parsed: ${result.data.profiles.length} profile(s)`);
        };
        reader.readAsText(file);
    }

    // ── Bindings ─────────────────────────────────────────────────

    // Export list refresh button
    $c('profile-export-refresh').off('click').on('click', () => renderExportList());

    // Export button
    $c('profile-export-btn').off('click').on('click', () => {
        const selected = [];
        $('.gd-export-check:checked').each(function () {
            selected.push($(this).attr('data-avatar'));
        });
        if (!selected.length) {
            toastr.warning(isZh() ? '请至少选择一个角色' : 'Select at least one character');
            return;
        }
        const groupNote = $c('profile-export-note').val() || '';
        exportProfiles(selected, groupNote);
        toastr.success(isZh() ? `已导出 ${selected.length} 个档案` : `Exported ${selected.length} profile(s)`);
    });

    // Import file picker
    $c('profile-import-file').off('change').on('change', function () {
        const file = this.files[0];
        if (file) handleImportFile(file);
        this.value = ''; // Reset so user can re-select the same file
    });

    $c('profile-import-btn').off('click').on('click', () => {
        $('#gd-profile-import-file').click();
    });

    // Preset dropdown
    $c('profile-import-preset').off('change').on('change', async function () {
        const name = $(this).val();
        if (!name) return;
        const result = await loadPreset(name);
        if (!result.ok) {
            toastr.error((isZh() ? '加载预设失败：' : 'Failed to load preset: ') + result.error);
            return;
        }
        renderImportList(result.data);
        toastr.info(isZh() ? `已加载预设：${result.data.source?.groupName || name}` : `Preset loaded: ${result.data.source?.groupName || name}`);
        $(this).val(''); // Reset dropdown
    });

    // Cancel import button
    $c('profile-import-cancel').off('click').on('click', () => {
        pendingImportData = null;
        $('#gd-profile-import-list').empty();
        $('#gd-profile-import-template-warn').remove();
    });

    // Apply import button
    $c('profile-import-apply').off('click').on('click', async () => {
        if (!pendingImportData) {
            toastr.warning(isZh() ? '请先选择导入文件或预设' : 'Select an import file or preset first');
            return;
        }
        const selected = [];
        $('.gd-import-check:checked').each(function () {
            selected.push($(this).attr('data-avatar'));
        });
        if (!selected.length && !$c('profile-import-template').prop('checked')) {
            toastr.warning(isZh() ? '请至少选择一个角色，或勾选导入模板' : 'Select at least one character, or check "import templates"');
            return;
        }
        const btn = $('#gd-profile-import-apply');
        btn.prop('disabled', true);
        try {
            const importTemplate = $c('profile-import-template').prop('checked');
            const result = await applyImport(pendingImportData, selected, { importTemplate });
            refreshProfileManagementUI();
            renderExportList();
            pendingImportData = null;
            $('#gd-profile-import-list').empty();
            $('#gd-profile-import-template-warn').remove();
            let msg = isZh() ? `已导入 ${result.applied} 个档案` : `Imported ${result.applied} profile(s)`;
            if (result.templateImported) msg += isZh() ? ' + 模板配置' : ' + templates';
            toastr.success(msg);
        } catch (e) {
            toastr.error((isZh() ? '导入失败：' : 'Import failed: ') + e.message);
            console.error('[GroupDirector] Profile import apply error:', e);
        } finally {
            btn.prop('disabled', false);
        }
    });

    // Populate preset dropdown
    const presetNames = getPresetNames();
    if (presetNames.length > 0) {
        const $sel = $c('profile-import-preset');
        const currentVal = $sel.val();
        presetNames.forEach(name => {
            if ($sel.find(`option[value="${escAttr(name)}"]`).length === 0) {
                const $opt = $(`<option value="${escAttr(name)}">${escHtml(name)}</option>`);
                $opt.insertBefore($sel.find('option[value=""]').last());
            }
        });
    }

    // Initial render
    renderExportList();
});

// ── Mini HTML escape helpers (browser-safe) ──────────────────────

function escHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
}
