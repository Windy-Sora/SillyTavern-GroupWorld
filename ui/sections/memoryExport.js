import { registerSection } from './registry.js';

registerSection('memoryExport', function (ctx) {
    const { settings, $c, saveSettings, getCurrentGroup, getCharacters, toastr,
        memoryExportSystem, renderMemoryList } = ctx;
    if (!memoryExportSystem) return;

    const sys = memoryExportSystem;
    const isZh = () => (settings.lang || 'zh') === 'zh';
    let pendingImportData = null;

    // ── Export ──────────────────────────────────────────────────────

    function renderExportList() {
        const $list = $('#gd-memory-export-list');
        if (!$list.length) return;

        const chars = sys.getExportableCharacters();
        if (!chars.length) {
            $list.html(`<small><i>${isZh() ? '暂无有记忆的角色' : 'No characters with memories'}</i></small>`);
            return;
        }

        let html = '';
        chars.forEach(c => {
            html += `<label class="checkbox_label" style="margin:2px 0;">
                <input type="checkbox" class="gd-mem-export-check" data-avatar="${escAttr(c.avatar)}" checked>
                <span>${escHtml(c.name)} <small style="color:var(--grey70a);">(${c.count} ${isZh() ? '条' : 'entries'})</small></span>
            </label>`;
        });
        html += `<div style="margin-top:4px;display:flex;gap:6px;">
            <span class="menu_button menu_button_icon" id="gd-mem-export-select-all" style="font-size:0.85em;">${isZh() ? '全选' : 'All'}</span>
            <span class="menu_button menu_button_icon" id="gd-mem-export-deselect-all" style="font-size:0.85em;">${isZh() ? '反选' : 'Invert'}</span>
        </div>`;
        $list.html(html);

        $('#gd-mem-export-select-all').off('click').on('click', () => $('.gd-mem-export-check').prop('checked', true));
        $('#gd-mem-export-deselect-all').off('click').on('click', () => {
            $('.gd-mem-export-check').each(function () { $(this).prop('checked', !$(this).prop('checked')); });
        });
    }

    // ── Import ──────────────────────────────────────────────────────

    function renderImportPanel(importData) {
        const $list = $('#gd-memory-import-list');
        if (!$list.length) return;

        pendingImportData = importData;
        const matches = importData._matches;
        const decisions = sys.buildDefaultDecisions(matches);

        // Template consistency warning
        $('#gd-memory-import-template-warn').remove();
        if (importData._templateDiffs.length > 0) {
            let w = `<div id="gd-memory-import-template-warn" style="border:1px solid #ff9800;border-radius:4px;padding:8px;margin-bottom:8px;background:rgba(255,152,0,0.05);">`;
            w += `<div style="display:flex;justify-content:space-between;align-items:center;">`;
            w += `<b style="color:#ff9800;">&#9888; ${isZh() ? '模板不一致警告' : 'Template Mismatch Warning'}</b>`;
            w += `<span class="gd-mem-import-warn-close" style="cursor:pointer;color:var(--grey70a);font-size:1.1em;">&times;</span>`;
            w += `</div>`;
            w += `<small style="display:block;margin-top:4px;color:var(--grey70a);">${isZh() ? '导入文件的模板配置与当前设置不一致。可勾选下方"同时导入模板"一并更新。' : 'Template config differs from current settings. Check "import templates" below to update.'}</small>`;
            w += `<ul style="margin:4px 0;font-size:0.85em;">`;
            importData._templateDiffs.forEach(d => {
                w += `<li><b>${escHtml(d.label)}</b>: file ${d.importHash} vs current ${d.currentHash}</li>`;
            });
            w += `</ul></div>`;
            $list.before(w);
            $('#gd-memory-import-template-warn .gd-mem-import-warn-close').off('click').on('click', () => {
                $('#gd-memory-import-template-warn').remove();
            });
        }

        if (Object.keys(matches).length === 0) {
            $list.html(`<small><i>${isZh() ? '文件中没有记忆数据' : 'No memory data in file'}</i></small>`);
            return;
        }

        let html = '';
        for (const [importedAvatar, m] of Object.entries(matches)) {
            const d = decisions[importedAvatar];
            const matchLabel = m.match
                ? (m.match.matchType === 'exact' ? `<span style="color:#4caf50;">${isZh() ? '精确匹配' : 'Exact'}</span>`
                    : m.match.matchType === 'name' ? `<span style="color:#2196f3;">${isZh() ? '名称匹配' : 'Name'}</span> → ${escHtml(m.match.avatar)}`
                    : `<span style="color:#ff9800;">${isZh() ? '模糊匹配' : 'Fuzzy'}</span> → ${escHtml(m.match.avatar)}`)
                : `<span style="color:#f44336;">${isZh() ? '未匹配' : 'No match'}</span>`;

            const compressedInfo = m.compressedCount > 0
                ? `<small style="color:var(--grey70a);"> (${m.compressedCount} ${isZh() ? '条压缩' : 'compressed'})</small>`
                : '';

            html += `<div class="gd-mem-import-card" data-import-avatar="${escAttr(importedAvatar)}" style="border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:8px;margin-top:6px;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <b>${escHtml(m.importedName)}</b>
                        <small style="color:var(--grey70a);"> → ${escHtml(m.importedAvatar)}</small>
                        <small style="color:var(--grey70a);"> (${m.entryCount} ${isZh() ? '条' : ''})${compressedInfo}</small>
                    </div>
                    <label class="checkbox_label">
                        <input type="checkbox" class="gd-mem-import-enabled" data-import-avatar="${escAttr(importedAvatar)}" ${d.enabled ? 'checked' : ''}>
                        <span style="font-size:0.9em;">${isZh() ? '导入' : 'Import'}</span>
                    </label>
                </div>
                <div style="margin-top:4px;font-size:0.85em;">
                    <span>${isZh() ? '匹配' : 'Match'}: ${matchLabel}</span>
                    ${!m.match ? `
                        <select class="gd-mem-import-target text_pole" data-import-avatar="${escAttr(importedAvatar)}" style="margin-left:6px;font-size:0.85em;">
                            <option value="">${isZh() ? '跳过' : 'Skip'}</option>
                            ${buildTargetOptions()}
                        </select>` : ''}
                    <select class="gd-mem-import-mode text_pole" data-import-avatar="${escAttr(importedAvatar)}" style="margin-left:6px;font-size:0.85em;">
                        <option value="append" selected>${isZh() ? '追加（去重）' : 'Append (dedup)'}</option>
                        <option value="replace">${isZh() ? '替换全部' : 'Replace all'}</option>
                    </select>
                    ${m.compressedCount > 0 ? `
                        <label class="checkbox_label" style="margin-left:6px;">
                            <input type="checkbox" class="gd-mem-import-skip-compressed" data-import-avatar="${escAttr(importedAvatar)}">
                            <span style="font-size:0.8em;">${isZh() ? '跳过压缩记忆' : 'Skip compressed'}</span>
                        </label>` : ''}
                </div>
            </div>`;
        }
        $list.html(html);
    }

    function buildTargetOptions() {
        const group = getCurrentGroup();
        if (!group) return '';
        const members = group.members.filter(a => !group.disabled_members?.includes(a));
        const chars = getCharacters();
        return members.map(av => {
            const c = chars.find(ch => ch.avatar === av);
            return `<option value="${escAttr(av)}">${escHtml(c?.name || av)}</option>`;
        }).join('');
    }

    function collectDecisions() {
        const decisions = {};
        if (!pendingImportData) return decisions;
        const matches = pendingImportData._matches;

        for (const [importedAvatar] of Object.entries(matches)) {
            const $card = $(`.gd-mem-import-card`).filter(function () { return $(this).attr('data-import-avatar') === importedAvatar; });
            const enabled = $card.find('.gd-mem-import-enabled').prop('checked');
            const mode = $card.find('.gd-mem-import-mode').val() || 'append';
            const skipCompressed = $card.find('.gd-mem-import-skip-compressed').prop('checked') || false;

            let targetAvatar;
            const match = matches[importedAvatar].match;
            if (match) {
                targetAvatar = match.avatar;
            } else {
                targetAvatar = $card.find('.gd-mem-import-target').val();
            }

            decisions[importedAvatar] = {
                enabled: enabled && !!targetAvatar,
                targetAvatar,
                mode,
                skipCompressed,
            };
        }
        return decisions;
    }

    // ── Bindings ────────────────────────────────────────────────────

    $c('memory-export-refresh').off('click').on('click', () => renderExportList());

    $c('memory-export-btn').off('click').on('click', () => {
        const selected = [];
        $('.gd-mem-export-check:checked').each(function () {
            selected.push($(this).data('avatar'));
        });
        if (!selected.length) {
            toastr.warning(isZh() ? '请至少选择一个角色' : 'Select at least one character');
            return;
        }
        const groupNote = $c('memory-export-note').val() || '';
        const result = sys.exportMemories(selected, groupNote);
        if (!result) {
            toastr.warning(isZh() ? '所选角色无记忆数据' : 'No memory data for selected characters');
            return;
        }
        toastr.success(isZh() ? `已导出 ${Object.keys(result.memories).length} 个角色的记忆` : `Exported ${Object.keys(result.memories).length} character(s) memories`);
    });

    $c('memory-import-file').off('change').on('change', function () {
        const file = this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function () {
            const result = sys.parseImportFile(reader.result);
            if (!result.ok) {
                toastr.error((isZh() ? '导入失败：' : 'Import failed: ') + result.error);
                return;
            }
            renderImportPanel(result.data);
            const count = Object.keys(result.data._matches).length;
            toastr.info(isZh() ? `已解析：${count} 个角色` : `Parsed: ${count} character(s)`);
        };
        reader.readAsText(file);
        this.value = '';
    });

    $c('memory-import-btn').off('click').on('click', () => $('#gd-memory-import-file').click());

    $c('memory-import-cancel').off('click').on('click', () => {
        pendingImportData = null;
        $('#gd-memory-import-list').empty();
        $('#gd-memory-import-template-warn').remove();
    });

    $c('memory-import-apply').off('click').on('click', async () => {
        if (!pendingImportData) {
            toastr.warning(isZh() ? '请先选择导入文件' : 'Select an import file first');
            return;
        }
        const decisions = collectDecisions();
        const enabledCount = Object.values(decisions).filter(d => d.enabled).length;
        if (!enabledCount && !$c('memory-import-template').prop('checked')) {
            toastr.warning(isZh() ? '请至少启用一个角色，或勾选导入模板' : 'Enable at least one character, or check "import templates"');
            return;
        }

        const btn = $('#gd-memory-import-apply');
        btn.prop('disabled', true);
        try {
            const importTemplate = $c('memory-import-template').prop('checked');
            const result = await sys.applyMemoryImport(pendingImportData, decisions, { importTemplate });

            // Refresh memory list if render function available
            if (renderMemoryList) {
                try { renderMemoryList(); } catch (_) {}
            }
            renderExportList();
            pendingImportData = null;
            $('#gd-memory-import-list').empty();
            $('#gd-memory-import-template-warn').remove();

            let msg = isZh() ? `已导入 ${result.applied} 条记忆` : `Imported ${result.applied} entry(s)`;
            if (result.templateImported) msg += isZh() ? ' + 模板' : ' + templates';
            toastr.success(msg);
        } catch (e) {
            toastr.error((isZh() ? '导入失败：' : 'Import failed: ') + e.message);
            console.error('[GroupDirector] Memory import error:', e);
        } finally {
            btn.prop('disabled', false);
        }
    });

    // Initial
    renderExportList();
});

function escHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
}
