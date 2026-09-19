import { registerSection } from './registry.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../popup.js';
import { matchesDataId, toBoundedInt } from './custom-agent-helpers.js';

registerSection('customAgents', function (ctx) {
    const { settings, $c, toastr, customAgentSystem } = ctx;
    if (!customAgentSystem) return;

    const isZh = () => (settings.lang || 'zh') === 'zh';
    const L = (zh, en) => isZh() ? zh : en;

    const $list = $('#gd-ca-list');

    function getList() {
        return customAgentSystem.getList();
    }

    function escHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function escAttr(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
    }
    function $byId(selector, id) {
        return $list.find(selector).filter((_, element) => matchesDataId($(element).attr('data-id'), id));
    }

    function renderList() {
        const list = getList();
        if (!list.length) {
            $list.html(`<small style="color:var(--grey70a);">${L('暂无自定义 Agent', 'No custom agents')}</small>`);
            return;
        }

        let html = '';
        list.forEach(inst => {
            const data = customAgentSystem.getData(inst.id);
            const order = toBoundedInt(inst.order, 0, 0, 999);
            const autoInterval = toBoundedInt(inst.autoInterval, 10, 1, 200);
            const statusText = data
                ? L(`已覆盖 ${data.rangeEnd} 条消息`, `Covered ${data.rangeEnd} msgs`)
                : L('未执行', 'Not executed');

            html += `<div class="gd-ca-card" data-id="${escAttr(inst.id)}" style="border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:6px;margin-top:4px;cursor:pointer;">
                <div class="gd-ca-header" data-id="${escAttr(inst.id)}" style="display:flex;align-items:center;justify-content:space-between;">
                    <div style="flex:1;min-width:0;">
                        <b>${escHtml(inst.name || '(unnamed)')}</b>
                        <span style="font-size:0.75em;color:#64b5f6;margin-left:4px;">{{${escHtml(inst.providerName || '?')}}}</span>
                        <span style="font-size:0.7em;color:var(--grey70a);margin-left:4px;">${L('顺序', 'order')}:${order}</span>
                        ${inst.enabled ? '' : `<span style="color:var(--grey70a);font-size:0.8em;"> (${L('关闭', 'off')})</span>`}
                        <div style="font-size:0.8em;color:var(--grey70a);">${statusText}</div>
                    </div>
                    <div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px;align-items:center;">
                        <span class="menu_button menu_button_icon gd-ca-exec-btn" data-id="${escAttr(inst.id)}" style="font-size:0.75em;color:#4caf50;" title="${L('手动执行', 'Execute')}"><i class="fa-solid fa-play"></i></span>
                        <span class="menu_button menu_button_icon gd-ca-toggle-btn" data-id="${escAttr(inst.id)}" style="font-size:0.75em;color:${inst.enabled ? '#4caf50' : '#999'};">${inst.enabled ? '<i class="fa-solid fa-toggle-on"></i>' : '<i class="fa-solid fa-toggle-off"></i>'}</span>
                        <span class="menu_button menu_button_icon gd-ca-del-btn" data-id="${escAttr(inst.id)}" style="font-size:0.75em;color:#ff5555;"><i class="fa-solid fa-trash"></i></span>
                    </div>
                </div>
                <div class="gd-ca-edit" data-id="${escAttr(inst.id)}" style="display:none;margin-top:6px;border-top:1px solid var(--SmartThemeBorderColor);padding-top:4px;">
                    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:4px;">
                        <input type="text" class="gd-ca-edit-name text_pole" data-id="${escAttr(inst.id)}" value="${escAttr(inst.name)}" style="width:100px;" placeholder="${L('名称', 'Name')}">
                        <span style="font-size:0.85em;">{{</span>
                        <input type="text" class="gd-ca-edit-pn text_pole" data-id="${escAttr(inst.id)}" value="${escAttr(inst.providerName)}" style="width:100px;" placeholder="${L('providerName', 'providerName')}">
                        <span style="font-size:0.85em;">}}</span>
                        <label style="font-size:0.8em;margin:0;">${L('顺序', 'Order')}:<input type="number" class="gd-ca-edit-order text_pole" data-id="${escAttr(inst.id)}" value="${order}" min="0" max="999" style="width:50px;margin-left:2px;"></label>
                    </div>
                    <label for="gd-ca-edit-prompt-${escAttr(inst.id)}" style="font-size:0.85em;display:block;margin-top:2px;">${L('Prompt', 'Prompt')}</label>
                    <textarea class="gd-ca-edit-prompt text_pole textarea_compact" data-id="${escAttr(inst.id)}" rows="4" style="width:100%;font-size:0.85em;">${escHtml(inst.prompt)}</textarea>
                    <label for="gd-ca-edit-schema-${escAttr(inst.id)}" style="font-size:0.85em;display:block;margin-top:2px;">${L('Schema（可选，留空不解析 JSON）', 'Schema (optional)')}</label>
                    <textarea class="gd-ca-edit-schema text_pole textarea_compact" data-id="${escAttr(inst.id)}" rows="3" style="width:100%;font-size:0.82em;font-family:monospace;">${escHtml(inst.schema || '')}</textarea>
                    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:4px;">
                        <label class="checkbox_label" style="margin:0;font-size:0.85em;">
                            <input type="checkbox" class="gd-ca-edit-auto" data-id="${escAttr(inst.id)}" ${inst.autoEnabled ? 'checked' : ''} ${inst.enabled ? '' : 'disabled'}>
                            ${L('自动触发', 'Auto')}
                        </label>
                        <label style="font-size:0.82em;margin:0;">${L('每', 'Every')}
                            <input type="number" class="gd-ca-edit-interval text_pole" data-id="${escAttr(inst.id)}" value="${autoInterval}" min="1" max="200" step="1" style="width:50px;margin-left:2px;">
                            ${L('条新消息', 'msgs')}
                        </label>
                    </div>
                    ${data ? `<hr style="margin:4px 0;">
                    <label style="font-size:0.85em;display:block;">${L('结果', 'Result')} <small style="color:var(--grey70a);">(${L('覆盖', 'covered')} ${data.rangeEnd} ${L('条', 'msgs')})</small>
                    <span class="menu_button menu_button_icon gd-ca-result-refresh" data-id="${escAttr(inst.id)}" style="font-size:0.7em;margin-left:4px;"><i class="fa-solid fa-rotate"></i></span>
                    </label>
                    <textarea class="gd-ca-edit-result text_pole textarea_compact" data-id="${escAttr(inst.id)}" rows="4" style="width:100%;font-size:0.82em;font-family:monospace;">${escHtml(typeof data.data === 'object' ? JSON.stringify(data.data, null, 2) : String(data.content || ''))}</textarea>
                    <span class="menu_button menu_button_icon gd-ca-result-save" data-id="${escAttr(inst.id)}" style="font-size:0.75em;color:#4caf50;"><i class="fa-solid fa-floppy-disk"></i> ${L('保存结果编辑', 'Save edits')}</span>` : ''}
                    <div style="margin-top:4px;display:flex;gap:4px;">
                        <span class="menu_button menu_button_icon gd-ca-save-btn" data-id="${escAttr(inst.id)}" style="font-size:0.8em;color:#4caf50;"><i class="fa-solid fa-floppy-disk"></i> ${L('保存', 'Save')}</span>
                        <span class="menu_button menu_button_icon gd-ca-cancel-btn" data-id="${escAttr(inst.id)}" style="font-size:0.8em;">${L('取消', 'Cancel')}</span>
                    </div>
                </div>
            </div>`;
        });
        $list.html(html);
        bindEvents();
    }

    function bindEvents() {
        // Toggle edit panel on card header click — prompt if unsaved
        $list.find('.gd-ca-header').off('click').on('click', async function () {
            const id = $(this).data('id');
            const $edit = $byId('.gd-ca-edit', id);
            if ($edit.is(':visible')) {
                if (isEditDirty(id)) {
                    const ok = await callGenericPopup(
                        L('配置已更改，是否保存？', 'Changes made. Save?'),
                        POPUP_TYPE.CONFIRM,
                    );
                    if (ok) {
                        const saved = await saveFromEditPanel(id, true);
                        if (!saved) {
                            toastr.warning(L('保存失败，请检查配置', 'Save failed, check config'));
                            return;
                        }
                    }
                }
                $edit.hide();
            } else {
                snapshotEditState(id);
                $('.gd-ca-edit').hide();
                $edit.show();
            }
        });

        // Action buttons: stop propagation so clicking them doesn't toggle
        $list.find('.gd-ca-exec-btn, .gd-ca-toggle-btn, .gd-ca-del-btn').off('click').on('click', function (e) {
            e.stopPropagation();
        });

        // Toggle enable
        $list.find('.gd-ca-toggle-btn').off('click').on('click', async function () {
            const id = $(this).data('id');
            try {
                await customAgentSystem.toggle(id);
                renderList();
            } catch (error) {
                toastr.error(L(`切换失败: ${error.message}`, `Toggle failed: ${error.message}`));
            }
        });

        // ─── Unsaved changes tracking ─────────────────────
        const _editSnapshots = {};

        function snapshotEditState(id) {
            _editSnapshots[id] = {
                name: $byId('.gd-ca-edit-name', id).val()?.trim(),
                providerName: $byId('.gd-ca-edit-pn', id).val()?.trim(),
                prompt: $byId('.gd-ca-edit-prompt', id).val() || '',
                schema: $byId('.gd-ca-edit-schema', id).val() || '',
                order: $byId('.gd-ca-edit-order', id).val() || '0',
                autoEnabled: $byId('.gd-ca-edit-auto', id).prop('checked'),
                autoInterval: $byId('.gd-ca-edit-interval', id).val() || '10',
            };
        }

        function isEditDirty(id) {
            const snap = _editSnapshots[id];
            if (!snap) return false;
            return snap.name !== $byId('.gd-ca-edit-name', id).val()?.trim()
                || snap.providerName !== $byId('.gd-ca-edit-pn', id).val()?.trim()
                || snap.prompt !== ($byId('.gd-ca-edit-prompt', id).val() || '')
                || snap.schema !== ($byId('.gd-ca-edit-schema', id).val() || '')
                || snap.order !== ($byId('.gd-ca-edit-order', id).val() || '0')
                || snap.autoEnabled !== $byId('.gd-ca-edit-auto', id).prop('checked')
                || snap.autoInterval !== ($byId('.gd-ca-edit-interval', id).val() || '10');
        }

        async function saveFromEditPanel(id, showToast = false) {
            const list = getList();
            const inst = list.find(a => a.id === id);
            if (!inst) return false;

            const name = $byId('.gd-ca-edit-name', id).val()?.trim();
            const providerName = $byId('.gd-ca-edit-pn', id).val()?.trim();
            if (!name || !providerName) return false;

            const otherWithSamePN = list.find(a => a.id !== id && a.providerName === providerName);
            if (otherWithSamePN) return false;

            try {
                await customAgentSystem.update(id, {
                    name,
                    providerName,
                    prompt: $byId('.gd-ca-edit-prompt', id).val() || '',
                    schema: $byId('.gd-ca-edit-schema', id).val() || '',
                    order: toBoundedInt($byId('.gd-ca-edit-order', id).val(), 0, 0, 999),
                    autoInterval: toBoundedInt($byId('.gd-ca-edit-interval', id).val(), 10, 1, 200),
                    autoEnabled: inst.enabled && $byId('.gd-ca-edit-auto', id).prop('checked'),
                });
            } catch (error) {
                toastr.error(L(`保存失败: ${error.message}`, `Save failed: ${error.message}`));
                return false;
            }
            renderList();
            if (showToast) toastr.success(L(`"${name}" 已保存`, `"${name}" saved`));
            return true;
        }

        // Refresh result
        $list.find('.gd-ca-result-refresh').off('click').on('click', function (e) {
            e.stopPropagation();
            const id = $(this).data('id');
            const store = customAgentSystem.getData(id);
            const $ta = $byId('.gd-ca-edit-result', id);
            if (store && $ta.length) {
                $ta.val(typeof store.data === 'object' ? JSON.stringify(store.data, null, 2) : String(store.content || ''));
            }
        });

        // Save result edits
        $list.find('.gd-ca-result-save').off('click').on('click', async function (e) {
            e.stopPropagation();
            const id = $(this).data('id');
            const newContent = $byId('.gd-ca-edit-result', id).val() || '';
            try {
                if (!await customAgentSystem.updateResult(id, newContent)) return;
                toastr.success(L('结果已保存', 'Result saved'));
            } catch (error) {
                toastr.error(L(`结果保存失败: ${error.message}`, `Result save failed: ${error.message}`));
            }
        });

        // Save button
        $list.find('.gd-ca-save-btn').off('click').on('click', async function () {
            const id = $(this).data('id');
            const ok = await saveFromEditPanel(id, true);
            if (!ok) {
                toastr.warning(L('保存失败：名称或 providerName 无效或已被占用', 'Save failed: name or providerName invalid or taken'));
            }
            $byId('.gd-ca-edit', id).show();
        });

        // Cancel
        $list.find('.gd-ca-cancel-btn').off('click').on('click', function () {
            const id = $(this).data('id');
            $byId('.gd-ca-edit', id).hide();
        });

        // Delete
        $list.find('.gd-ca-del-btn').off('click').on('click', async function (e) {
            e.stopPropagation();
            const id = $(this).data('id');
            const list = getList();
            const inst = list.find(a => a.id === id);
            const name = inst?.name || id;
            const popupName = escHtml(name);

            if (!await callGenericPopup(
                L(`确定删除「${popupName}」？`, `Delete "${popupName}"?`),
                POPUP_TYPE.CONFIRM,
            )) return;

            try {
                await customAgentSystem.remove(id);
                renderList();
                toastr.success(L(`"${name}" 已删除`, `"${name}" deleted`));
            } catch (error) {
                toastr.error(L(`删除失败: ${error.message}`, `Delete failed: ${error.message}`));
            }
        });

        // Execute
        $list.find('.gd-ca-exec-btn').off('click').on('click', async function () {
            const id = $(this).data('id');
            const list = getList();
            const inst = list.find(a => a.id === id);
            if (!inst) return;
            if (!inst.prompt) { toastr.warning(L('Prompt 不能为空', 'Prompt required')); return; }

            const $btn = $(this);
            $btn.css('opacity', '0.5');
            try {
                toastr.info(L(`正在执行 "${inst.name}"...`, `Executing "${inst.name}"...`));
                await customAgentSystem.execute(inst);
                toastr.success(L(`"${inst.name}" 执行完成`, `"${inst.name}" done`));
                renderList();
            } catch (e) {
                toastr.error(L(`执行失败: ${e.message}`, `Execute failed: ${e.message}`));
            } finally {
                $btn.css('opacity', '1');
            }
        });

        // When enabled toggles, sync auto checkbox disabled state
        $list.find('.gd-ca-toggle-btn').on('click', function () {
            // The auto checkbox disabled state is managed in the toggle handler above
            // which re-renders the list. No need for additional logic here.
        });
    }

    // ── Add new ──
    // ── Export ──
    $c('ca-export-btn').on('click', function () {
        const list = getList();
        if (!list.length) { toastr.info(L('无自定义 Agent 可导出', 'No agents to export')); return; }
        const blob = new Blob([JSON.stringify(customAgentSystem.createExportData(), null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'custom-agents.json'; a.click();
        URL.revokeObjectURL(url);
    });

    // ── Import ──
    $c('ca-import-btn').on('click', function () {
        $('#gd-ca-import-file').click();
    });
    $('#gd-ca-import-file').on('change', async function () {
        const file = this.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            const result = await customAgentSystem.importAgents(data, {
                resolveConflict: async ({ incoming }) => await callGenericPopup(
                    L(`providerName "${escHtml(incoming.providerName)}" 已存在，是否覆盖？`, `Provider "${escHtml(incoming.providerName)}" exists. Overwrite?`),
                    POPUP_TYPE.CONFIRM,
                ) ? 'overwrite' : 'skip',
            });
            renderList();
            toastr.success(L(`已导入 ${result.imported} 个自定义 Agent`, `Imported ${result.imported} agents`));
        } catch (e) {
            toastr.error(L(`导入失败: ${e.message}`, `Import failed: ${e.message}`));
        } finally {
            this.value = '';
        }
    });

    $c('ca-add-btn').on('click', async function () {
        const list = getList();
        const providerName = customAgentSystem.suggestProviderName();
        const name = L('新 Agent', 'New Agent');
        try {
            const created = await customAgentSystem.add({
                name, providerName, prompt: '', schema: '', enabled: false,
                autoEnabled: false, autoInterval: 10, order: Math.min(list.length + 1, 999),
            });
            renderList();
            $byId('.gd-ca-edit', created.id).show();
            toastr.info(L(`已创建 "${name}"，请编辑配置`, `"${name}" created, edit config`));
        } catch (error) {
            toastr.error(L(`创建失败: ${error.message}`, `Create failed: ${error.message}`));
        }
    });

    renderList();
});
