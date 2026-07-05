import { registerSection } from './registry.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../popup.js';

registerSection('critiqueExport', function (ctx) {
    const { settings, $c, getCurrentGroup, critiqueExportSystem, renderPrompt } = ctx;
    if (!critiqueExportSystem) return;

    const sys = critiqueExportSystem;
    const isZh = () => (settings.lang || 'zh') === 'zh';

    function renderPanel() {
        const $container = $('#gd-critique-imported-list');
        if (!$container.length) return;

        const list = sys.getImportedCritiques();
        if (!list.length) {
            $container.html(`<small style="color:var(--grey70a);">${isZh() ? '暂无导入的批判' : 'No imported critiques'}</small>`);
            return;
        }

        // Update export button state
        updateExportBtnState();

        let html = `<small style="color:var(--grey70a);">${list.length} ${isZh() ? '条' : 'entries'}</small>`;
        list.forEach(s => {
            const dateStr = new Date(s.createdAt).toLocaleString();
            const contentPreview = (s.content || '').substring(0, 80);
            html += `
                <div class="gd-critique-imported-card" style="border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:6px;margin-top:4px;">
                    <div style="display:flex;align-items:center;gap:6px;">
                        <input type="checkbox" class="gd-critique-enabled" data-id="${escAttr(s.id)}" ${s.enabled !== false ? 'checked' : ''}>
                        <span style="flex:1;min-width:0;font-weight:bold;font-size:0.9em;">${escHtml(s.name)}</span>
                        <small style="color:var(--grey70a);font-size:0.75em;flex-shrink:0;">${dateStr}</small>
                        <span class="menu_button menu_button_icon gd-critique-delete" data-id="${escAttr(s.id)}" style="font-size:0.7em;color:#ff5555;flex-shrink:0;" title="${isZh() ? '删除' : 'Delete'}"><i class="fa-solid fa-trash"></i></span>
                    </div>
                    <div style="font-size:0.8em;color:var(--grey70a);margin-top:2px;margin-left:22px;">${escHtml(contentPreview)}${(s.content || '').length > 80 ? '...' : ''}</div>
                </div>`;
        });

        // Preview
        html += `<div style="margin-top:6px;">
            <span class="menu_button menu_button_icon" id="gd-critique-imported-preview" style="font-size:0.8em;"><i class="fa-solid fa-eye"></i> ${isZh() ? '预览渲染结果' : 'Preview Rendered'}</span>
            <div id="gd-critique-imported-preview-output" style="display:none;margin-top:4px;padding:6px;border:1px solid var(--SmartThemeBorderColor);border-radius:4px;background:var(--grey10a);max-height:200px;overflow-y:auto;font-size:0.85em;white-space:pre-wrap;"></div>
        </div>`;

        $container.html(html);

        // Enable/disable toggle
        $container.find('.gd-critique-enabled').off('change').on('change', async function () {
            const id = $(this).data('id');
            await sys.setEnabled(id, $(this).prop('checked'));
        });

        // Delete
        $container.find('.gd-critique-delete').off('click').on('click', async function () {
            const id = $(this).data('id');
            const entry = list.find(s => s.id === id);
            if (await callGenericPopup(isZh() ? `确定删除批判「${entry?.name || ''}」？` : `Delete critique "${entry?.name || ''}"?`, POPUP_TYPE.CONFIRM)) {
                await sys.deleteImportedCritique(id);
                renderPanel();
            }
        });

        // Preview
        $('#gd-critique-imported-preview').off('click').on('click', async function () {
            const $out = $('#gd-critique-imported-preview-output');
            if ($out.is(':visible')) { $out.hide(); return; }
            const rendered = sys.renderEnabledCritiques();
            const text = rendered.content || `(${isZh() ? '无启用的批判' : 'No enabled critiques'})`;
            // Run through renderPrompt so any nested {{...}} are resolved
            try {
                const resolved = await renderPrompt(text, {}, { maxPasses: 2, recursive: true, debugPlaceholders: false });
                $out.text(resolved);
            } catch (e) {
                $out.text(text);
            }
            $out.show();
        });
    }

    function updateExportBtnState() {
        const active = sys.getActiveLiveCritique();
        const $btn = $c('critique-export-btn');
        if (!active || !active.content) {
            $btn.addClass('disabled').css('opacity', '0.5');
        } else {
            $btn.removeClass('disabled').css('opacity', '');
        }
    }

    // ── Bindings ──────────────────────────────────────────────────

    $c('critique-import-panel-refresh').off('click').on('click', () => renderPanel());

    // Export active critique
    $c('critique-export-btn').off('click').on('click', () => {
        const active = sys.getActiveLiveCritique();
        if (!active || !active.content) {
            toastr.warning(isZh() ? '没有激活的批判可导出，请先生成 AI 批判' : 'No active critique to export. Generate a chat critique first.');
            return;
        }
        const groupNote = $c('critique-export-note').val() || '';
        sys.exportActiveCritique(groupNote);
        toastr.success(isZh() ? '已导出当前批判' : 'Active critique exported');
    });

    // Import file
    $c('critique-import-file').off('change').on('change', function () {
        const file = this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async function () {
            const result = sys.parseImportFile(reader.result);
            if (!result.ok) {
                toastr.error((isZh() ? '导入失败：' : 'Import failed: ') + result.error);
                return;
            }
            const data = result.data;
            const defaultName = data.source?.groupNote || data.source?.groupName || file.name.replace('.json', '');
            const name = prompt(
                isZh() ? '为这个批判命名：' : 'Name this critique:',
                defaultName
            );
            if (!name || !name.trim()) return;
            await sys.addImportedCritique(data, name.trim());
            renderPanel();
            toastr.success(isZh() ? `已导入批判「${name.trim()}」` : `Critique "${name.trim()}" imported`);
        };
        reader.readAsText(file);
        this.value = '';
    });

    $c('critique-import-btn').off('click').on('click', () => {
        $('#gd-critique-import-file').click();
    });

    // Initial
    renderPanel();
});

function escHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
}
