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

registerSection('storyBlueprintLibrary', function (ctx) {
    const { settings, storyBlueprintLibrarySystem, toastr, getCurrentGroup } = ctx;
    if (!storyBlueprintLibrarySystem) return;

    const isZh = () => (settings.lang || 'zh') === 'zh';
    const L = (zh, en) => isZh() ? zh : en;

    function selectedId() {
        return $('#gd-story-blueprint-library-select').val() || '';
    }

    function syncSelectors() {
        const libraries = storyBlueprintLibrarySystem.getLibraries();
        const $sel = $('#gd-story-blueprint-library-select');
        if (!$sel.length) return;
        const current = $sel.val();
        $sel.find('option:not(:first)').remove();
        for (const lib of libraries) {
            $sel.append(`<option value="${esc(lib.id)}">${esc(lib.name)} (${lib.nodeCount || 0})</option>`);
        }
        if (current && libraries.some(x => x.id === current)) $sel.val(current);
    }

    function refreshLinkedUi() {
        renderList();
        window.__gdRefreshStoryBlueprint?.();
        window.__gdRenderPanelStoryBlueprint?.();
        window.__gdRefreshDashboard?.();
    }

    function renderList() {
        const $list = $('#gd-story-blueprint-library-list');
        const libraries = storyBlueprintLibrarySystem.getLibraries();
        syncSelectors();
        if (!$list.length) return;
        if (!libraries.length) {
            $list.html(`<small style="color:var(--grey70a);">${L('暂无蓝图包。', 'No blueprint libraries yet.')}</small>`);
            return;
        }
        let html = '';
        for (const lib of libraries) {
            html += `<div class="gd-story-blueprint-library-card" data-id="${esc(lib.id)}" style="border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:7px;margin-top:5px;">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                    <div style="min-width:0;flex:1;">
                        <b>${esc(lib.name)}</b>
                        <small style="display:block;color:var(--grey70a);">${esc(lib.description || lib.sourceGroupName || lib.blueprintTitle || '')}</small>
                        <small style="display:block;color:var(--grey70a);font-size:0.75em;">${lib.nodeCount || 0} nodes | ${lib.includeProgress ? L('含进度', 'with progress') : L('仅蓝图', 'blueprint only')} | ${esc(shortDate(lib.updatedAt || lib.createdAt))}</small>
                    </div>
                    <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">
                        <span class="menu_button menu_button_icon gd-sblib-apply" data-id="${esc(lib.id)}" style="font-size:0.78em;color:#4caf50;"><i class="fa-solid fa-check"></i> ${L('应用', 'Apply')}</span>
                        <span class="menu_button menu_button_icon gd-sblib-export" data-id="${esc(lib.id)}" style="font-size:0.78em;"><i class="fa-solid fa-file-export"></i> ${L('导出', 'Export')}</span>
                        <span class="menu_button menu_button_icon gd-sblib-delete" data-id="${esc(lib.id)}" style="font-size:0.75em;color:#ff5555;"><i class="fa-solid fa-trash"></i></span>
                    </div>
                </div>
            </div>`;
        }
        $list.html(html);
    }

    async function saveCurrent() {
        const group = getCurrentGroup?.();
        const name = await callGenericPopup(
            L('<b>保存当前蓝图包</b><br>请输入名称：', '<b>Save Story Blueprint Library</b><br>Enter a name:'),
            POPUP_TYPE.INPUT,
            '',
            { placeholder: L('例如：冒险主线蓝图', 'e.g. Adventure main plot') },
        );
        if (!name || !String(name).trim()) return;
        try {
            const includeProgress = $('#gd-story-blueprint-library-include-progress').prop('checked') !== false;
            const entry = await storyBlueprintLibrarySystem.saveCurrentAsLibrary(String(name).trim(), group?.name || '', { includeProgress });
            refreshLinkedUi();
            toastr.success(L(`蓝图包“${entry.name}”已保存`, `Story Blueprint "${entry.name}" saved`));
        } catch (e) {
            toastr.error((L('保存失败：', 'Save failed: ')) + e.message);
        }
    }

    async function applySelected(id = selectedId()) {
        if (!id) {
            toastr.warning(L('请先选择蓝图包。', 'Select a blueprint library first.'));
            return;
        }
        try {
            const includeProgress = $('#gd-story-blueprint-library-apply-progress').prop('checked') !== false;
            await storyBlueprintLibrarySystem.applyLibrary(id, { includeProgress });
            refreshLinkedUi();
            toastr.success(L('蓝图包已应用', 'Story Blueprint applied'));
        } catch (e) {
            toastr.error((L('应用失败：', 'Apply failed: ')) + e.message);
        }
    }

    $('#gd-story-blueprint-library-save').off('click').on('click', saveCurrent);
    $('#gd-story-blueprint-library-apply').off('click').on('click', () => applySelected());
    $('#gd-story-blueprint-library-import').off('click').on('click', () => $('#gd-story-blueprint-library-import-file').trigger('click'));
    $('#gd-story-blueprint-library-import-file').off('change').on('change', async function () {
        const file = this.files?.[0];
        if (!file) return;
        try {
            const entry = await storyBlueprintLibrarySystem.importFileToLibrary(file);
            refreshLinkedUi();
            toastr.success(L(`已导入蓝图包“${entry.name}”`, `Imported "${entry.name}"`));
        } catch (e) {
            toastr.error((L('导入失败：', 'Import failed: ')) + e.message);
        } finally {
            this.value = '';
        }
    });
    $('#gd-story-blueprint-library-list').off('click', '.gd-sblib-apply').on('click', '.gd-sblib-apply', function () {
        applySelected($(this).data('id'));
    });
    $('#gd-story-blueprint-library-list').off('click', '.gd-sblib-export').on('click', '.gd-sblib-export', function () {
        try { storyBlueprintLibrarySystem.exportLibrary($(this).data('id')); }
        catch (e) { toastr.error((L('导出失败：', 'Export failed: ')) + e.message); }
    });
    $('#gd-story-blueprint-library-list').off('click', '.gd-sblib-delete').on('click', '.gd-sblib-delete', async function () {
        const id = $(this).data('id');
        const lib = storyBlueprintLibrarySystem.getLibrary(id);
        if (!lib) return;
        const libName = esc(lib.name);
        const ok = await callGenericPopup(L(`删除蓝图包“${libName}”？`, `Delete Story Blueprint "${libName}"?`), POPUP_TYPE.CONFIRM);
        if (!ok) return;
        try {
            await storyBlueprintLibrarySystem.deleteLibrary(id);
            refreshLinkedUi();
        } catch (e) {
            toastr.error((L('删除失败：', 'Delete failed: ')) + e.message);
        }
    });

    window.__gdRefreshStoryBlueprintLibrary = renderList;
    renderList();
});
