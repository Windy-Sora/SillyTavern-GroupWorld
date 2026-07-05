import { registerSection } from './registry.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../popup.js';

registerSection('summaryExport', function (ctx) {
    const { settings, $c, getCurrentGroup, summaryExportSystem, renderPrompt } = ctx;
    if (!summaryExportSystem) return;

    const sys = summaryExportSystem;
    const isZh = () => (settings.lang || 'zh') === 'zh';

    function renderPanel() {
        const $container = $('#gd-summary-imported-list');
        if (!$container.length) return;

        const list = sys.getImportedSummaries();
        if (!list.length) {
            $container.html(`<small style="color:var(--grey70a);">${isZh() ? '暂无导入的摘要' : 'No imported summaries'}</small>`);
            return;
        }

        // Update export button state
        updateExportBtnState();

        let html = `<small style="color:var(--grey70a);">${list.length} ${isZh() ? '条' : 'entries'}</small>`;
        list.forEach(s => {
            const dateStr = new Date(s.createdAt).toLocaleString();
            const contentPreview = (s.content || '').substring(0, 80);
            html += `
                <div class="gd-summary-imported-card" style="border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:6px;margin-top:4px;">
                    <div style="display:flex;align-items:center;gap:6px;">
                        <input type="checkbox" class="gd-summary-enabled" data-id="${escAttr(s.id)}" ${s.enabled !== false ? 'checked' : ''}>
                        <span style="flex:1;min-width:0;font-weight:bold;font-size:0.9em;">${escHtml(s.name)}</span>
                        <small style="color:var(--grey70a);font-size:0.75em;flex-shrink:0;">${dateStr}</small>
                        <span class="menu_button menu_button_icon gd-summary-delete" data-id="${escAttr(s.id)}" style="font-size:0.7em;color:#ff5555;flex-shrink:0;" title="${isZh() ? '删除' : 'Delete'}"><i class="fa-solid fa-trash"></i></span>
                    </div>
                    <div style="font-size:0.8em;color:var(--grey70a);margin-top:2px;margin-left:22px;">${escHtml(contentPreview)}${(s.content || '').length > 80 ? '...' : ''}</div>
                </div>`;
        });

        // Preview
        html += `<div style="margin-top:6px;">
            <span class="menu_button menu_button_icon" id="gd-summary-imported-preview" style="font-size:0.8em;"><i class="fa-solid fa-eye"></i> ${isZh() ? '预览渲染结果' : 'Preview Rendered'}</span>
            <div id="gd-summary-imported-preview-output" style="display:none;margin-top:4px;padding:6px;border:1px solid var(--SmartThemeBorderColor);border-radius:4px;background:var(--grey10a);max-height:200px;overflow-y:auto;font-size:0.85em;white-space:pre-wrap;"></div>
        </div>`;

        $container.html(html);

        // Enable/disable toggle
        $container.find('.gd-summary-enabled').off('change').on('change', async function () {
            const id = $(this).data('id');
            await sys.setEnabled(id, $(this).prop('checked'));
        });

        // Delete
        $container.find('.gd-summary-delete').off('click').on('click', async function () {
            const id = $(this).data('id');
            const entry = list.find(s => s.id === id);
            if (await callGenericPopup(isZh() ? `确定删除摘要「${entry?.name || ''}」？` : `Delete summary "${entry?.name || ''}"?`, POPUP_TYPE.CONFIRM)) {
                await sys.deleteImportedSummary(id);
                renderPanel();
            }
        });

        // Preview
        $('#gd-summary-imported-preview').off('click').on('click', async function () {
            const $out = $('#gd-summary-imported-preview-output');
            if ($out.is(':visible')) { $out.hide(); return; }
            const rendered = sys.renderEnabledSummaries();
            const text = rendered.content || `(${isZh() ? '无启用的摘要' : 'No enabled summaries'})`;
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
        const active = sys.getActiveLiveSummary();
        const $btn = $c('summary-export-btn');
        if (!active || !active.content) {
            $btn.addClass('disabled').css('opacity', '0.5');
        } else {
            $btn.removeClass('disabled').css('opacity', '');
        }
    }

    // ── Bindings ──────────────────────────────────────────────────

    $c('summary-import-panel-refresh').off('click').on('click', () => renderPanel());

    // Export active summary
    $c('summary-export-btn').off('click').on('click', () => {
        const active = sys.getActiveLiveSummary();
        if (!active || !active.content) {
            toastr.warning(isZh() ? '没有激活的摘要可导出，请先生成上下文总结' : 'No active summary to export. Generate a chat summary first.');
            return;
        }
        const groupNote = $c('summary-export-note').val() || '';
        sys.exportActiveSummary(groupNote);
        toastr.success(isZh() ? '已导出当前摘要' : 'Active summary exported');
    });

    // Import file
    $c('summary-import-file').off('change').on('change', function () {
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
                isZh() ? '为这个摘要命名：' : 'Name this summary:',
                defaultName
            );
            if (!name || !name.trim()) return;
            await sys.addImportedSummary(data, name.trim());
            renderPanel();
            toastr.success(isZh() ? `已导入摘要「${name.trim()}」` : `Summary "${name.trim()}" imported`);
        };
        reader.readAsText(file);
        this.value = '';
    });

    $c('summary-import-btn').off('click').on('click', () => {
        $('#gd-summary-import-file').click();
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
