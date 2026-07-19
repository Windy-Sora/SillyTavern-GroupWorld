import { registerSection } from './registry.js';

registerSection('npcExport', function (ctx) {
    const { settings, $c, saveSettings, getCurrentGroup,
        exportNpcs, parseNpcImportFile, applyNpcImport, loadNpcPreset, getNpcPresetNames,
        renderNpcList } = ctx;

    const isZh = () => (settings.lang || 'zh') === 'zh';
    let pendingImportData = null;

    function getNpcs() {
        // npcSystem is available on ctx
        return ctx.npcSystem?.getNpcs?.() || [];
    }

    function renderExportList() {
        const $list = $('#gd-npc-export-list');
        if (!$list.length) return;

        const npcs = getNpcs();
        if (!npcs.length) {
            $list.html(`<small><i>${isZh() ? '暂无 NPC，请先生成' : 'No NPCs — generate first'}</i></small>`);
            return;
        }

        let html = '';
        npcs.forEach((n, i) => {
            const desc = (n.description || '').substring(0, 60);
            html += `<label class="checkbox_label" style="margin:2px 0;">
                <input type="checkbox" class="gd-npc-export-check" data-idx="${i}" checked>
                <span>${escHtml(n.name)}</span>
                ${desc ? `<small style="display:block;color:var(--grey70a);margin-left:20px;">${escHtml(desc)}</small>` : ''}
            </label>`;
        });
        html += `<div style="margin-top:4px;display:flex;gap:6px;">
            <span class="menu_button menu_button_icon" id="gd-npc-export-select-all" style="font-size:0.85em;">${isZh() ? '全选' : 'Select All'}</span>
            <span class="menu_button menu_button_icon" id="gd-npc-export-deselect-all" style="font-size:0.85em;">${isZh() ? '反选' : 'Invert'}</span>
        </div>`;
        $list.html(html);

        $('#gd-npc-export-select-all').off('click').on('click', () => $('.gd-npc-export-check').prop('checked', true));
        $('#gd-npc-export-deselect-all').off('click').on('click', () => {
            $('.gd-npc-export-check').each(function () { $(this).prop('checked', !$(this).prop('checked')); });
        });
    }

    function renderImportList(importData) {
        const $list = $('#gd-npc-import-list');
        if (!$list.length) return;

        pendingImportData = importData;

        $('#gd-npc-import-template-warn').remove();
        if (importData._templateDiffs.length > 0) {
            let warnHtml = `<div id="gd-npc-import-template-warn" style="border:1px solid #ff9800;border-radius:4px;padding:8px;margin-bottom:8px;background:rgba(255,152,0,0.05);">`;
            warnHtml += `<div style="display:flex;justify-content:space-between;align-items:center;">`;
            warnHtml += `<b style="color:#ff9800;">&#9888; ${isZh() ? 'Prompt 不一致警告' : 'Prompt Mismatch Warning'}</b>`;
            warnHtml += `<span class="gd-npc-import-warn-close" style="cursor:pointer;color:var(--grey70a);font-size:1.1em;" title="${isZh() ? '关闭' : 'Dismiss'}">&times;</span>`;
            warnHtml += `</div>`;
            warnHtml += `<small style="display:block;margin-top:4px;color:var(--grey70a);">${isZh() ? '导入文件的 NPC 生成 Prompt 与当前设置不一致，可能影响后续生成风格的统一性。' : 'The NPC generation prompt in the import file differs from current settings. Future generations may differ in style.'}</small>`;
            warnHtml += `<ul style="margin:4px 0;font-size:0.85em;">`;
            importData._templateDiffs.forEach(d => {
                warnHtml += `<li><b>${escHtml(d.label)}</b>: ${isZh() ? '文件 hash' : 'file hash'} ${d.importHash} vs ${isZh() ? '当前 hash' : 'current hash'} ${d.currentHash}</li>`;
            });
            warnHtml += `</ul></div>`;
            $list.before(warnHtml);
            $('#gd-npc-import-template-warn .gd-npc-import-warn-close').off('click').on('click', function () {
                $('#gd-npc-import-template-warn').remove();
            });
        }

        if (!importData.npcs.length) {
            $list.html(`<small><i>${isZh() ? '文件中没有 NPC 数据' : 'No NPC data in file'}</i></small>`);
            return;
        }

        let html = '';
        importData.npcs.forEach(n => {
            const isNew = n._action === 'new';
            const label = isNew
                ? `<span style="color:#4caf50;">(${isZh() ? '新建' : 'New'})</span>`
                : `<span style="color:#ff9800;">(${isZh() ? '覆盖' : 'Overwrite'})</span>`;
            const desc = (n.description || '').substring(0, 80);
            html += `<label class="checkbox_label" style="margin:2px 0;">
                <input type="checkbox" class="gd-npc-import-check" data-name="${escAttr(n.name)}" checked>
                <span>${escHtml(n.name)} ${label}</span>
                ${desc ? `<small style="display:block;color:var(--grey70a);margin-left:20px;">${escHtml(desc)}</small>` : ''}
            </label>`;
        });
        html += `<div style="margin-top:4px;display:flex;gap:6px;">
            <span class="menu_button menu_button_icon" id="gd-npc-import-select-all" style="font-size:0.85em;">${isZh() ? '全选' : 'Select All'}</span>
            <span class="menu_button menu_button_icon" id="gd-npc-import-deselect-all" style="font-size:0.85em;">${isZh() ? '反选' : 'Invert'}</span>
        </div>`;
        $list.html(html);

        $('#gd-npc-import-select-all').off('click').on('click', () => $('.gd-npc-import-check').prop('checked', true));
        $('#gd-npc-import-deselect-all').off('click').on('click', () => {
            $('.gd-npc-import-check').each(function () { $(this).prop('checked', !$(this).prop('checked')); });
        });
    }

    function handleImportFile(file) {
        const reader = new FileReader();
        reader.onload = function () {
            const result = parseNpcImportFile(reader.result);
            if (!result.ok) {
                toastr.error((isZh() ? '导入失败：' : 'Import failed: ') + result.error);
                console.error('[GroupDirector] NPC import parse error:', result.error);
                return;
            }
            renderImportList(result.data);
            toastr.info(isZh() ? `已解析文件：${result.data.npcs.length} 个 NPC` : `Parsed: ${result.data.npcs.length} NPC(s)`);
        };
        reader.readAsText(file);
    }

    // ── Bindings ──────────────────────────────────────────────────

    $c('npc-export-refresh').off('click').on('click', () => renderExportList());

    $c('npc-export-btn').off('click').on('click', () => {
        const npcs = getNpcs();
        const selected = [];
        $('.gd-npc-export-check:checked').each(function () {
            const idx = parseInt($(this).data('idx'));
            if (idx >= 0 && idx < npcs.length) selected.push(npcs[idx]);
        });
        if (!selected.length) {
            toastr.warning(isZh() ? '请至少选择一个 NPC' : 'Select at least one NPC');
            return;
        }
        const groupNote = $c('npc-export-note').val() || '';
        exportNpcs(selected, groupNote);
        toastr.success(isZh() ? `已导出 ${selected.length} 个 NPC` : `Exported ${selected.length} NPC(s)`);
    });

    $c('npc-import-file').off('change').on('change', function () {
        const file = this.files[0];
        if (file) handleImportFile(file);
        this.value = '';
    });

    $c('npc-import-btn').off('click').on('click', () => {
        $('#gd-npc-import-file').click();
    });

    $c('npc-import-preset').off('change').on('change', async function () {
        const name = $(this).val();
        if (!name) return;
        const result = await loadNpcPreset(name);
        if (!result.ok) {
            toastr.error((isZh() ? '加载预设失败：' : 'Failed to load preset: ') + result.error);
            return;
        }
        renderImportList(result.data);
        toastr.info(isZh() ? `已加载预设：${result.data.source?.groupName || name}` : `Preset loaded: ${result.data.source?.groupName || name}`);
        $(this).val('');
    });

    $c('npc-import-cancel').off('click').on('click', () => {
        pendingImportData = null;
        $('#gd-npc-import-list').empty();
        $('#gd-npc-import-template-warn').remove();
    });

    $c('npc-import-apply').off('click').on('click', async () => {
        if (!pendingImportData) {
            toastr.warning(isZh() ? '请先选择导入文件或预设' : 'Select an import file or preset first');
            return;
        }
        const selected = [];
        $('.gd-npc-import-check:checked').each(function () {
            selected.push($(this).attr('data-name'));
        });
        if (!selected.length && !$c('npc-import-template').prop('checked')) {
            toastr.warning(isZh() ? '请至少选择一个 NPC，或勾选导入 Prompt' : 'Select at least one NPC, or check "import prompt"');
            return;
        }
        const btn = $('#gd-npc-import-apply');
        btn.prop('disabled', true);
        try {
            const importTemplate = $c('npc-import-template').prop('checked');
            const result = await applyNpcImport(pendingImportData, selected, { importTemplate });
            if (renderNpcList) renderNpcList();
            renderExportList();
            pendingImportData = null;
            $('#gd-npc-import-list').empty();
            $('#gd-npc-import-template-warn').remove();
            let msg = isZh() ? `已导入 ${result.applied} 个 NPC` : `Imported ${result.applied} NPC(s)`;
            if (result.templateImported) msg += isZh() ? ' + Prompt' : ' + Prompt';
            toastr.success(msg);
        } catch (e) {
            toastr.error((isZh() ? '导入失败：' : 'Import failed: ') + e.message);
            console.error('[GroupDirector] NPC import apply error:', e);
        } finally {
            btn.prop('disabled', false);
        }
    });

    // Populate preset dropdown
    const presetNames = getNpcPresetNames();
    if (presetNames.length > 0) {
        const $sel = $c('npc-import-preset');
        presetNames.forEach(name => {
            if ($sel.find(`option[value="${escAttr(name)}"]`).length === 0) {
                const $opt = $(`<option value="${escAttr(name)}">${escHtml(name)}</option>`);
                $opt.insertBefore($sel.find('option[value=""]').last());
            }
        });
    }

    // Initial
    renderExportList();
});

// ── Mini HTML escape helpers ──────────────────────────────────────

function escHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
}
