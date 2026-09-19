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

registerSection('profileLibrary', function (ctx) {
    const { settings, profileLibrarySystem, toastr, getCurrentGroup } = ctx;
    if (!profileLibrarySystem) return;

    const isZh = () => (settings.lang || 'zh') === 'zh';
    const L = (zh, en) => isZh() ? zh : en;

    function auto() {
        return profileLibrarySystem.getAutoLoadSettings();
    }

    function selectedId() {
        return $('#gd-profile-library-select').val() || '';
    }

    function refreshLinkedUi({ list = true, dashboard = true } = {}) {
        if (list) renderList();
        if (dashboard) {
            window.__gdRefreshDashboard?.();
            window.__gdRenderPanelProfiles?.();
        }
    }

    function syncControls() {
        const a = auto();
        $('#gd-profile-library-auto-enabled').prop('checked', !!a.enabled);
        $('#gd-profile-library-overwrite').prop('checked', !!a.overwriteExisting);
        $('#gd-profile-library-name-only').prop('checked', !!a.matchNameOnly);
        $('#gd-profile-library-import-template').prop('checked', !!a.importTemplate);
    }

    function populateSelectors() {
        const libraries = profileLibrarySystem.getLibraries();
        for (const id of ['gd-profile-library-select']) {
            const $sel = $(`#${id}`);
            if (!$sel.length) continue;
            const current = $sel.val();
            $sel.find('option:not(:first)').remove();
            for (const lib of libraries) {
                $sel.append(`<option value="${esc(lib.id)}">${esc(lib.name)} (${lib.profileCount || 0})</option>`);
            }
            if (current && libraries.some(x => x.id === current)) $sel.val(current);
        }
    }

    function previewLine(lib) {
        const p = profileLibrarySystem.matchLibraryProfiles(lib, {
            ...auto(),
            matchNameOnly: !!auto().matchNameOnly,
        });
        const usable = p.matches.filter(m => !m.skipped).length;
        const skipped = p.matches.filter(m => m.skipped).length;
        return L(
            `匹配 ${p.matches.length}/${p.memberCount}，可导入 ${usable}，跳过已有 ${skipped}`,
            `Matched ${p.matches.length}/${p.memberCount}, importable ${usable}, skipped ${skipped}`,
        );
    }

    function renderList() {
        const $list = $('#gd-profile-library-list');
        const libraries = profileLibrarySystem.getLibraries();
        if (!$list.length) {
            populateSelectors();
            syncControls();
            return;
        }
        if (!libraries.length) {
            $list.html(`<small style="color:var(--grey70a);">${L('暂无档案包。点击“保存当前”创建。', 'No profile libraries yet. Click Save Current to create one.')}</small>`);
            populateSelectors();
            syncControls();
            return;
        }

        let html = '';
        const a = auto();
        for (const lib of libraries) {
            const isFixed = a.fixedId === lib.id && a.mode === 'fixed';
            html += `<div class="gd-profile-library-card" data-id="${esc(lib.id)}" style="border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:7px;margin-top:5px;">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                    <div style="min-width:0;flex:1;">
                        <b>${esc(lib.name)}</b>${isFixed ? ` <span style="color:#4caf50;font-size:0.8em;">${L('自动', 'auto')}</span>` : ''}
                        <small style="display:block;color:var(--grey70a);">${esc(lib.description || lib.sourceGroupName || '')}</small>
                        <small style="display:block;color:var(--grey70a);font-size:0.75em;">${lib.profileCount || 0} profiles · ${esc(shortDate(lib.updatedAt || lib.createdAt))} · ${esc(previewLine(lib))}</small>
                    </div>
                    <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">
                        <span class="menu_button menu_button_icon gd-plib-apply" data-id="${esc(lib.id)}" style="font-size:0.78em;color:#4caf50;"><i class="fa-solid fa-check"></i> ${L('应用', 'Apply')}</span>
                        <span class="menu_button menu_button_icon gd-plib-auto" data-id="${esc(lib.id)}" style="font-size:0.78em;"><i class="fa-solid fa-bolt"></i> ${L('设为自动', 'Auto')}</span>
                        <span class="menu_button menu_button_icon gd-plib-export" data-id="${esc(lib.id)}" style="font-size:0.78em;"><i class="fa-solid fa-file-export"></i> ${L('导出', 'Export')}</span>
                        <span class="menu_button menu_button_icon gd-plib-delete" data-id="${esc(lib.id)}" style="font-size:0.75em;color:#ff5555;"><i class="fa-solid fa-trash"></i></span>
                    </div>
                </div>
            </div>`;
        }
        $list.html(html);
        populateSelectors();
        syncControls();
    }

    async function promptSaveCurrent() {
        const group = getCurrentGroup?.();
        if (!group) {
            toastr.warning(L('请先进入群聊。', 'Open a group chat first.'));
            return;
        }
        const name = await callGenericPopup(
            L('<b>保存当前档案包</b><br>请输入档案包名称：', '<b>Save Profile Library</b><br>Enter a library name:'),
            POPUP_TYPE.INPUT,
            '',
            { placeholder: L('例如：冒险版角色设定', 'e.g. Adventure cast profiles') },
        );
        if (!name || !String(name).trim()) return;
        try {
            const entry = await profileLibrarySystem.saveCurrentAsLibrary(String(name).trim(), group.name || '');
            refreshLinkedUi();
            toastr.success(L(`档案包“${entry.name}”已保存`, `Profile library "${entry.name}" saved`));
        } catch (e) {
            toastr.error((L('保存失败：', 'Save failed: ')) + e.message);
        }
    }

    async function applySelected(id = selectedId()) {
        if (!id) {
            toastr.warning(L('请先选择档案包。', 'Select a profile library first.'));
            return;
        }
        try {
            const result = await profileLibrarySystem.applyLibrary(id, { ...auto() });
            refreshLinkedUi();
            toastr.success(L(
                `已应用 ${result.applied || 0} 个档案`,
                `Applied ${result.applied || 0} profile(s)`,
            ));
        } catch (e) {
            toastr.error((L('应用失败：', 'Apply failed: ')) + e.message);
        }
    }

    $('#gd-profile-library-save').off('click').on('click', promptSaveCurrent);
    $('#gd-profile-library-apply').off('click').on('click', () => applySelected());

    $('#gd-profile-library-import').off('click').on('click', () => $('#gd-profile-library-import-file').trigger('click'));
    $('#gd-profile-library-import-file').off('change').on('change', async function () {
        const file = this.files?.[0];
        if (!file) return;
        try {
            const entry = await profileLibrarySystem.importFileToLibrary(file);
            refreshLinkedUi();
            toastr.success(L(`已导入档案包“${entry.name}”`, `Imported "${entry.name}"`));
        } catch (e) {
            toastr.error((L('导入失败：', 'Import failed: ')) + e.message);
        } finally {
            this.value = '';
        }
    });

    $('#gd-profile-library-list').off('click', '.gd-plib-apply').on('click', '.gd-plib-apply', function () {
        applySelected($(this).data('id'));
    });

    $('#gd-profile-library-list').off('click', '.gd-plib-auto').on('click', '.gd-plib-auto', async function () {
        const id = $(this).data('id');
        try {
            await profileLibrarySystem.updateAutoLoadSettings({ enabled: true, mode: 'fixed', fixedId: id });
            refreshLinkedUi();
            toastr.success(L('已设为自动补缺档案包', 'Set as auto-load library'));
        } catch (e) {
            syncControls();
            toastr.error((L('保存失败：', 'Save failed: ')) + e.message);
        }
    });

    $('#gd-profile-library-list').off('click', '.gd-plib-export').on('click', '.gd-plib-export', function () {
        try { profileLibrarySystem.exportLibrary($(this).data('id')); }
        catch (e) { toastr.error((L('导出失败：', 'Export failed: ')) + e.message); }
    });

    $('#gd-profile-library-list').off('click', '.gd-plib-delete').on('click', '.gd-plib-delete', async function () {
        const id = $(this).data('id');
        const lib = profileLibrarySystem.getLibrary(id);
        if (!lib) return;
        const libName = esc(lib.name);
        const ok = await callGenericPopup(
            L(`删除档案包“${libName}”？`, `Delete profile library "${libName}"?`),
            POPUP_TYPE.CONFIRM,
        );
        if (!ok) return;
        try {
            await profileLibrarySystem.deleteLibrary(id);
            refreshLinkedUi();
        } catch (e) {
            toastr.error((L('删除失败：', 'Delete failed: ')) + e.message);
        }
    });

    $('#gd-profile-library-auto-enabled').off('change').on('change', async function () {
        const enabled = !!$(this).prop('checked');
        try {
            await profileLibrarySystem.updateAutoLoadSettings({ enabled, mode: auto().mode || 'best' });
            refreshLinkedUi();
        } catch (e) {
            syncControls();
            toastr.error((L('保存失败：', 'Save failed: ')) + e.message);
        }
    });

    $('#gd-profile-library-overwrite').off('change').on('change', async function () {
        try {
            await profileLibrarySystem.updateAutoLoadSettings({ overwriteExisting: !!$(this).prop('checked') });
            refreshLinkedUi();
        } catch (e) {
            syncControls();
            toastr.error((L('保存失败：', 'Save failed: ')) + e.message);
        }
    });

    $('#gd-profile-library-name-only').off('change').on('change', async function () {
        try {
            await profileLibrarySystem.updateAutoLoadSettings({ matchNameOnly: !!$(this).prop('checked') });
            refreshLinkedUi();
        } catch (e) {
            syncControls();
            toastr.error((L('保存失败：', 'Save failed: ')) + e.message);
        }
    });

    $('#gd-profile-library-import-template').off('change').on('change', async function () {
        try {
            await profileLibrarySystem.updateAutoLoadSettings({ importTemplate: !!$(this).prop('checked') });
            refreshLinkedUi();
        } catch (e) {
            syncControls();
            toastr.error((L('保存失败：', 'Save failed: ')) + e.message);
        }
    });

    $('#gd-profile-library-select').off('change').on('change', function () {
        const id = $(this).val();
        $('#gd-dash-panel-profile-library').val(id);
    });

    window.__gdRefreshProfileLibrary = renderList;
    renderList();
});
