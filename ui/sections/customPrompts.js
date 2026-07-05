import { registerSection } from './registry.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../popup.js';

registerSection('customPrompts', function (ctx) {
    const { settings, $c, saveSettings, toastr } = ctx;
    const sys = ctx.customPromptsSystem;
    if (!sys) return;

    const isZh = () => (settings.lang || 'zh') === 'zh';

    // Master enable/disable
    $c('cp-enabled').prop('checked', settings.customPromptsEnabled !== false);
    $c('cp-enabled').on('change', function () {
        const on = !!$(this).prop('checked');
        sys.setMasterEnabled(on);
        renderList();
        toastr.info(on
            ? (isZh() ? '自定义 Prompt 已激活' : 'Custom prompts activated')
            : (isZh() ? '自定义 Prompt 已停用' : 'Custom prompts deactivated'));
    });

    function renderList() {
        const $list = $('#gd-custom-prompt-list');
        if (!$list.length) return;
        const list = sys.getList();

        if (!list.length) {
            $list.html(`<small style="color:var(--grey70a);">${isZh() ? '暂无自定义 Prompt' : 'No custom prompts'}</small>`);
            return;
        }

        let html = '';
        list.forEach(cp => {
            const preview = (cp.content || '').substring(0, 60);
            html += `<div class="gd-cp-card" data-id="${escAttr(cp.id)}" style="border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:6px;margin-top:4px;">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <div style="flex:1;min-width:0;">
                        <code style="color:#4caf50;">{{${escHtml(cp.name)}}}</code>
                        ${cp.enabled ? '' : `<span style="color:var(--grey70a);font-size:0.8em;"> (${isZh() ? '关闭' : 'off'})</span>`}
                        <div style="font-size:0.8em;color:var(--grey70a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(preview)}${cp.content.length > 60 ? '...' : ''}</div>
                    </div>
                    <div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px;">
                        <span class="menu_button menu_button_icon gd-cp-edit-btn" data-id="${escAttr(cp.id)}" style="font-size:0.75em;"><i class="fa-solid fa-pencil"></i></span>
                        <span class="menu_button menu_button_icon gd-cp-toggle-btn" data-id="${escAttr(cp.id)}" style="font-size:0.75em;color:${cp.enabled ? '#4caf50' : '#999'};">${cp.enabled ? '<i class="fa-solid fa-toggle-on"></i>' : '<i class="fa-solid fa-toggle-off"></i>'}</span>
                        <span class="menu_button menu_button_icon gd-cp-del-btn" data-id="${escAttr(cp.id)}" style="font-size:0.75em;color:#ff5555;"><i class="fa-solid fa-trash"></i></span>
                    </div>
                </div>
                <div class="gd-cp-edit" data-id="${escAttr(cp.id)}" style="display:none;margin-top:4px;">
                    <input type="text" class="gd-cp-edit-name text_pole" data-id="${escAttr(cp.id)}" value="${escAttr(cp.name)}" style="width:120px;" placeholder="${isZh() ? '名称' : 'Name'}">
                    <small style="color:var(--grey70a);"> (a-z, 0-9, _)</small>
                    <textarea class="gd-cp-edit-content text_pole textarea_compact" data-id="${escAttr(cp.id)}" rows="4" style="width:100%;margin-top:2px;">${escHtml(cp.content)}</textarea>
                    <div style="margin-top:2px;display:flex;gap:4px;">
                        <span class="menu_button menu_button_icon gd-cp-save-btn" data-id="${escAttr(cp.id)}" style="font-size:0.8em;color:#4caf50;"><i class="fa-solid fa-floppy-disk"></i> ${isZh() ? '保存' : 'Save'}</span>
                        <span class="menu_button menu_button_icon gd-cp-cancel-btn" data-id="${escAttr(cp.id)}" style="font-size:0.8em;"><i class="fa-solid fa-xmark"></i> ${isZh() ? '取消' : 'Cancel'}</span>
                    </div>
                </div>
            </div>`;
        });
        $list.html(html);

        // Edit toggle
        $list.find('.gd-cp-edit-btn').off('click').on('click', function () {
            const id = $(this).data('id');
            $(`.gd-cp-edit[data-id="${escAttr(id)}"]`).toggle();
        });
        $list.find('.gd-cp-cancel-btn').off('click').on('click', function () {
            const id = $(this).data('id');
            $(`.gd-cp-edit[data-id="${escAttr(id)}"]`).hide();
        });

        // Save
        $list.find('.gd-cp-save-btn').off('click').on('click', function () {
            const id = $(this).data('id');
            const name = $(`.gd-cp-edit-name[data-id="${escAttr(id)}"]`).val().trim();
            const content = $(`.gd-cp-edit-content[data-id="${escAttr(id)}"]`).val();
            const valid = sys.validateName(name, id);
            if (!valid.ok) { toastr.warning(valid.error); return; }
            try {
                sys.update(id, { name, content });
                if (sys.hasSelfReference(name, content)) {
                    toastr.warning(isZh() ? `自引用警告: {{${name}}} 内容中引用了自身` : `Self-reference: {{${name}}} contains itself`);
                }
                renderList();
                toastr.success(isZh() ? `{{${name}}} 已更新` : `{{${name}}} updated`);
            } catch (e) { toastr.error(e.message); }
        });

        // Toggle
        $list.find('.gd-cp-toggle-btn').off('click').on('click', function () {
            const id = $(this).data('id');
            sys.toggle(id);
            renderList();
        });

        // Delete
        $list.find('.gd-cp-del-btn').off('click').on('click', async function () {
            const id = $(this).data('id');
            const entry = sys.getList().find(e => e.id === id);
            if (!entry) return;
            if (!await callGenericPopup(isZh()
                ? `删除 {{${entry.name}}}？已引用此占位符的位置将变为空。`
                : `Delete {{${entry.name}}}? References to it will become empty.`, POPUP_TYPE.CONFIRM)) return;
            sys.remove(id);
            renderList();
            toastr.info(isZh() ? '已删除' : 'Deleted');
        });
    }

    // ── Add new ─────────────────────────────────────────────────────

    function resetAddForm() {
        $c('cp-new-name').val('');
        $c('cp-new-content').val('');
    }

    $c('cp-add-btn').off('click').on('click', () => {
        const name = $c('cp-new-name').val().trim();
        const content = $c('cp-new-content').val();
        if (!name) { toastr.warning(isZh() ? '请输入名称' : 'Enter a name'); return; }
        try {
            const { selfRef } = sys.add(name, content);
            resetAddForm();
            renderList();
            let msg = `{{${name}}} ${isZh() ? '已创建' : 'created'}`;
            if (selfRef) msg += isZh() ? ' (自引用警告)' : ' (self-reference warning)';
            toastr.success(msg);
        } catch (e) { toastr.error(e.message); }
    });

    // ── Export/Import ───────────────────────────────────────────────

    $c('cp-export-btn').off('click').on('click', () => {
        const list = sys.getList();
        if (!list.length) { toastr.warning(isZh() ? '无自定义 Prompt 可导出' : 'No custom prompts to export'); return; }
        sys.exportPrompts(list.map(e => e.id));
        toastr.success(isZh() ? `已导出 ${list.length} 个 Prompt` : `Exported ${list.length} prompt(s)`);
    });

    $c('cp-import-file').off('change').on('change', function () {
        const file = this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async function () {
            const result = sys.parseImportFile(reader.result);
            if (!result.ok) { toastr.error((isZh() ? '导入失败: ' : 'Import failed: ') + result.error); return; }
            const conflicts = result.data.prompts.filter(p => {
                const list = sys.getList();
                return list.some(e => e.name === p.name);
            });
            let overwrite = false;
            if (conflicts.length > 0) {
                overwrite = await callGenericPopup(isZh()
                    ? `检测到 ${conflicts.length} 个同名 Prompt：${conflicts.map(p => p.name).join(', ')}。\n确定=覆盖同名，取消=仅添加不同名的`
                    : `Found ${conflicts.length} same-name prompt(s): ${conflicts.map(p => p.name).join(', ')}.\nOK=overwrite conflicts, Cancel=add only new ones`, POPUP_TYPE.CONFIRM);
            }
            const result2 = sys.importPrompts(result.data, overwrite);
            renderList();
            let msg = isZh() ? `已导入：${result2.added} 新增` : `Imported: ${result2.added} added`;
            if (result2.overwritten > 0) msg += isZh() ? `, ${result2.overwritten} 覆盖` : `, ${result2.overwritten} overwritten`;
            if (result2.conflicts.length > 0 && !overwrite) msg += isZh() ? `, ${result2.conflicts.length} 跳过` : `, ${result2.conflicts.length} skipped`;
            toastr.success(msg);
        };
        reader.readAsText(file);
        this.value = '';
    });

    $c('cp-import-btn').off('click').on('click', () => $('#gd-cp-import-file').click());

    // ── Initial ─────────────────────────────────────────────────────

    renderList();
});

function escHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
}
