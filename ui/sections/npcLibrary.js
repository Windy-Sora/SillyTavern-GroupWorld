import { registerSection } from './registry.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../popup.js';

function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function shortDate(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleString(); } catch (_) { return ''; }
}

registerSection('npcLibrary', function (ctx) {
    const { settings, npcLibrarySystem, toastr, getCurrentGroup, renderNpcList } = ctx;
    if (!npcLibrarySystem) return;

    const isZh = () => (settings.lang || 'zh') === 'zh';
    const L = (zh, en) => isZh() ? zh : en;

    function selectedId() {
        return $('#gd-npc-library-select').val() || '';
    }

    function syncSelectors() {
        const libraries = npcLibrarySystem.getLibraries();
        const $sel = $('#gd-npc-library-select');
        if (!$sel.length) return;
        const current = $sel.val();
        $sel.find('option:not(:first)').remove();
        for (const lib of libraries) {
            $sel.append(`<option value="${esc(lib.id)}">${esc(lib.name)} (${lib.npcCount || 0})</option>`);
        }
        if (current && libraries.some(x => x.id === current)) $sel.val(current);
    }

    function refreshLinkedUi() {
        renderList();
        renderNpcList?.();
        window.__gdRenderPanelNpcs?.();
        window.__gdRefreshDashboard?.();
    }

    function renderList() {
        const $list = $('#gd-npc-library-list');
        const libraries = npcLibrarySystem.getLibraries();
        syncSelectors();
        if (!$list.length) return;
        if (!libraries.length) {
            $list.html(`<small style="color:var(--grey70a);">${L('暂无 NPC 包。', 'No NPC libraries yet.')}</small>`);
            return;
        }
        let html = '';
        for (const lib of libraries) {
            const preview = npcLibrarySystem.previewLibrary(lib.id);
            html += `<div class="gd-npc-library-card" data-id="${esc(lib.id)}" style="border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:7px;margin-top:5px;">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                    <div style="min-width:0;flex:1;">
                        <b>${esc(lib.name)}</b>
                        <small style="display:block;color:var(--grey70a);">${esc(lib.description || lib.sourceGroupName || '')}</small>
                        <small style="display:block;color:var(--grey70a);font-size:0.75em;">${lib.npcCount || 0} NPCs | ${L('新建', 'new')} ${preview.newCount || 0}, ${L('覆盖', 'overwrite')} ${preview.overwriteCount || 0} | ${esc(shortDate(lib.updatedAt || lib.createdAt))}</small>
                    </div>
                    <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">
                        <span class="menu_button menu_button_icon gd-npclib-apply" data-id="${esc(lib.id)}" style="font-size:0.78em;color:#4caf50;"><i class="fa-solid fa-check"></i> ${L('应用', 'Apply')}</span>
                        <span class="menu_button menu_button_icon gd-npclib-export" data-id="${esc(lib.id)}" style="font-size:0.78em;"><i class="fa-solid fa-file-export"></i> ${L('导出', 'Export')}</span>
                        <span class="menu_button menu_button_icon gd-npclib-delete" data-id="${esc(lib.id)}" style="font-size:0.75em;color:#ff5555;"><i class="fa-solid fa-trash"></i></span>
                    </div>
                </div>
            </div>`;
        }
        $list.html(html);
    }

    async function saveCurrent() {
        const group = getCurrentGroup?.();
        const name = await callGenericPopup(
            L('<b>保存当前 NPC 包</b><br>请输入名称：', '<b>Save NPC Library</b><br>Enter a name:'),
            POPUP_TYPE.INPUT,
            '',
            { placeholder: L('例如：冒险版 NPC', 'e.g. Adventure NPCs') },
        );
        if (!name || !String(name).trim()) return;
        try {
            const entry = npcLibrarySystem.saveCurrentAsLibrary(String(name).trim(), group?.name || '');
            refreshLinkedUi();
            toastr.success(L(`NPC 包“${entry.name}”已保存`, `NPC library "${entry.name}" saved`));
        } catch (e) {
            toastr.error((L('保存失败：', 'Save failed: ')) + e.message);
        }
    }

    async function applySelected(id = selectedId()) {
        if (!id) {
            toastr.warning(L('请先选择 NPC 包。', 'Select an NPC library first.'));
            return;
        }
        try {
            const importTemplate = $('#gd-npc-library-import-template').prop('checked') === true;
            const result = await npcLibrarySystem.applyLibrary(id, { importTemplate });
            refreshLinkedUi();
            let msg = L(`已应用 ${result.applied || 0} 个 NPC`, `Applied ${result.applied || 0} NPC(s)`);
            if (result.templateImported) msg += ' + Prompt';
            toastr.success(msg);
        } catch (e) {
            toastr.error((L('应用失败：', 'Apply failed: ')) + e.message);
        }
    }

    $('#gd-npc-library-save').off('click').on('click', saveCurrent);
    $('#gd-npc-library-apply').off('click').on('click', () => applySelected());
    $('#gd-npc-library-import').off('click').on('click', () => $('#gd-npc-library-import-file').trigger('click'));
    $('#gd-npc-library-import-file').off('change').on('change', async function () {
        const file = this.files?.[0];
        if (!file) return;
        try {
            const entry = await npcLibrarySystem.importFileToLibrary(file);
            refreshLinkedUi();
            toastr.success(L(`已导入 NPC 包“${entry.name}”`, `Imported "${entry.name}"`));
        } catch (e) {
            toastr.error((L('导入失败：', 'Import failed: ')) + e.message);
        } finally {
            this.value = '';
        }
    });
    $('#gd-npc-library-list').off('click', '.gd-npclib-apply').on('click', '.gd-npclib-apply', function () {
        applySelected($(this).data('id'));
    });
    $('#gd-npc-library-list').off('click', '.gd-npclib-export').on('click', '.gd-npclib-export', function () {
        try { npcLibrarySystem.exportLibrary($(this).data('id')); }
        catch (e) { toastr.error((L('导出失败：', 'Export failed: ')) + e.message); }
    });
    $('#gd-npc-library-list').off('click', '.gd-npclib-delete').on('click', '.gd-npclib-delete', async function () {
        const id = $(this).data('id');
        const lib = npcLibrarySystem.getLibrary(id);
        if (!lib) return;
        const libName = esc(lib.name);
        const ok = await callGenericPopup(L(`删除 NPC 包“${libName}”？`, `Delete NPC library "${libName}"?`), POPUP_TYPE.CONFIRM);
        if (!ok) return;
        npcLibrarySystem.deleteLibrary(id);
        refreshLinkedUi();
    });

    window.__gdRefreshNpcLibrary = renderList;
    renderList();
});
