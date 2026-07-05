import { registerSection } from './registry.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../popup.js';

registerSection('scriptExecutors', function (ctx) {
    const { settings, $c, saveSettings, toastr } = ctx;
    const sys = ctx.scriptExecutorSystem;
    if (!sys) return;

    const isZh = () => (settings.lang || 'zh') === 'zh';
    const L = (zh, en) => isZh() ? zh : en;

    const $list = $('#gd-se-list');

    function renderList() {
        const list = sys.getList();
        if (!list.length) {
            $list.html(`<small style="color:var(--grey70a);">${L('暂无脚本执行器', 'No script executors')}</small>`);
            return;
        }

        const trigLabel = {
            message: L('消息后', 'After Msg'),
            round: L('回合后', 'After Round'),
            decision: L('决策后', 'After Decision'),
            both: L('两者', 'Both'),
            all: L('全部', 'All'),
        };
        const trigColor = { message: '#64b5f6', round: '#ffb74d', decision: '#ce93d8', both: '#81c784', all: '#ef5350' };

        let html = '';
        list.forEach(se => {
            const trig = se.triggerOn || 'both';
            const preview = (se.code || '').slice(0, 50).replace(/\n/g, ' ');
            html += `<div class="gd-se-card" data-id="${escAttr(se.id)}" style="border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:6px;margin-top:4px;">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <div style="flex:1;min-width:0;">
                        <b>${escHtml(se.name)}</b>
                        <span style="font-size:0.75em;color:${trigColor[trig]};margin-left:4px;">[${trigLabel[trig]}]</span>
                        <span style="font-size:0.7em;color:var(--grey70a);margin-left:4px;">pri:${se.priority ?? 0}</span>
                        ${se.enabled ? '' : `<span style="color:var(--grey70a);font-size:0.8em;"> (${L('关闭', 'off')})</span>`}
                        <div style="font-size:0.8em;color:var(--grey70a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(preview)}${(se.code || '').length > 50 ? '...' : ''}</div>
                    </div>
                    <div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px;">
                        <span class="menu_button menu_button_icon gd-se-edit-btn" data-id="${escAttr(se.id)}" style="font-size:0.75em;"><i class="fa-solid fa-pencil"></i></span>
                        <span class="menu_button menu_button_icon gd-se-toggle-btn" data-id="${escAttr(se.id)}" style="font-size:0.75em;color:${se.enabled ? '#4caf50' : '#999'};">${se.enabled ? '<i class="fa-solid fa-toggle-on"></i>' : '<i class="fa-solid fa-toggle-off"></i>'}</span>
                        <span class="menu_button menu_button_icon gd-se-del-btn" data-id="${escAttr(se.id)}" style="font-size:0.75em;color:#ff5555;"><i class="fa-solid fa-trash"></i></span>
                    </div>
                </div>
                <div class="gd-se-edit" data-id="${escAttr(se.id)}" style="display:none;margin-top:4px;">
                    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:4px;">
                        <input type="text" class="gd-se-edit-name text_pole" data-id="${escAttr(se.id)}" value="${escAttr(se.name)}" style="width:130px;" placeholder="${L('名称', 'Name')}">
                        <select class="gd-se-edit-trigger text_pole" data-id="${escAttr(se.id)}" style="width:auto;font-size:0.85em;">
                            <option value="message" ${trig === 'message' ? 'selected' : ''}>${L('消息后', 'After Message')}</option>
                            <option value="round" ${trig === 'round' ? 'selected' : ''}>${L('回合后', 'After Round')}</option>
                            <option value="decision" ${trig === 'decision' ? 'selected' : ''}>${L('决策后', 'After Decision')}</option>
                            <option value="both" ${trig === 'both' ? 'selected' : ''}>${L('两者', 'Both')}</option>
                            <option value="all" ${trig === 'all' ? 'selected' : ''}>${L('全部', 'All')}</option>
                        </select>
                        <label style="font-size:0.8em;margin:0;">${L('优先级', 'Priority')}:<input type="number" class="gd-se-edit-priority text_pole" data-id="${escAttr(se.id)}" value="${se.priority ?? 0}" min="-100" max="100" style="width:50px;margin-left:2px;"></label>
                    </div>
                    <textarea class="gd-se-edit-code text_pole textarea_compact" data-id="${escAttr(se.id)}" rows="6" style="width:100%;font-family:monospace;font-size:0.82em;">${escHtml(se.code)}</textarea>
                    <small style="color:var(--grey70a);display:block;">${L('通过 ctx.params / ctx.shared / ctx.message 访问上下文。返回值默认忽略，切换为共享可传递给后续脚本。', 'Access ctx.params / ctx.shared / ctx.message. Return value ignored by default; switch to Shared to pass to subsequent scripts.')}</small>
                    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px;">
                        <label class="checkbox_label" style="margin:0;font-size:0.82em;"><input type="checkbox" class="gd-se-edit-render-params" data-id="${escAttr(se.id)}" ${se.renderParams ? 'checked' : ''}>${L('渲染参数（单次，仅字符串字段）', 'Render params (single-pass, strings only)')}</label>
                        <label style="font-size:0.82em;margin:0;">${L('返回模式', 'Return')}:
                            <select class="gd-se-edit-return text_pole" data-id="${escAttr(se.id)}" style="width:auto;font-size:0.85em;margin-left:2px;">
                                <option value="ignore" ${se.returnMode !== 'shared' ? 'selected' : ''}>${L('忽略', 'Ignore')}</option>
                                <option value="shared" ${se.returnMode === 'shared' ? 'selected' : ''}>${L('写入共享状态', 'Write to shared')}</option>
                            </select>
                        </label>
                    </div>
                    ${renderParamsEditor(se)}
                    <div style="margin-top:4px;display:flex;gap:4px;">
                        <span class="menu_button menu_button_icon gd-se-save-btn" data-id="${escAttr(se.id)}" style="font-size:0.8em;color:#4caf50;"><i class="fa-solid fa-floppy-disk"></i> ${L('保存', 'Save')}</span>
                        <span class="menu_button menu_button_icon gd-se-cancel-btn" data-id="${escAttr(se.id)}" style="font-size:0.8em;">${L('取消', 'Cancel')}</span>
                    </div>
                </div>
            </div>`;
        });
        $list.html(html);
        bindEvents();
    }

    function renderParamsEditor(se) {
        const params = se.params || [];
        let h = `<div style="margin-top:4px;font-size:0.82em;"><b>${L('参数', 'Params')}</b>`;
        h += `<div class="gd-se-params-table" data-id="${escAttr(se.id)}">`;
        params.forEach((p, pi) => {
            const types = ['string', 'number', 'boolean'];
            h += `<div class="gd-se-param-row" data-id="${escAttr(se.id)}" data-pi="${pi}" style="display:flex;gap:3px;align-items:center;margin:2px 0;">
                <input type="text" class="gd-se-param-key text_pole" data-id="${escAttr(se.id)}" data-pi="${pi}" value="${escAttr(p.key || '')}" placeholder="${L('键', 'Key')}" style="width:60px;font-size:0.82em;">
                <input type="text" class="gd-se-param-label text_pole" data-id="${escAttr(se.id)}" data-pi="${pi}" value="${escAttr(p.label || '')}" placeholder="${L('标签', 'Label')}" style="width:70px;font-size:0.82em;">
                <select class="gd-se-param-type text_pole" data-id="${escAttr(se.id)}" data-pi="${pi}" style="width:auto;font-size:0.8em;">
                    ${types.map(t => `<option value="${t}" ${(p.type || 'string') === t ? 'selected' : ''}>${t}</option>`).join('')}
                </select>
                <input type="text" class="gd-se-param-default text_pole" data-id="${escAttr(se.id)}" data-pi="${pi}" value="${escAttr(String(p.default ?? ''))}" placeholder="${L('默认值', 'Default')}" style="width:80px;font-size:0.82em;">
                <span class="menu_button menu_button_icon gd-se-param-del" data-id="${escAttr(se.id)}" data-pi="${pi}" style="font-size:0.7em;color:#ff5555;cursor:pointer;"><i class="fa-solid fa-xmark"></i></span>
            </div>`;
        });
        h += `</div>`;
        h += `<span class="menu_button menu_button_icon gd-se-param-add" data-id="${escAttr(se.id)}" style="font-size:0.75em;margin-top:2px;"><i class="fa-solid fa-plus"></i> ${L('+ 添加参数', '+ Add Param')}</span>`;
        h += `</div>`;
        return h;
    }

    function collectParams(id) {
        const params = [];
        $(`.gd-se-param-row[data-id="${id}"]`).each(function () {
            const pi = $(this).data('pi');
            const key = $(`.gd-se-param-key[data-id="${id}"][data-pi="${pi}"]`).val()?.trim();
            if (key) {
                params.push({
                    key,
                    label: $(`.gd-se-param-label[data-id="${id}"][data-pi="${pi}"]`).val()?.trim() || key,
                    type: $(`.gd-se-param-type[data-id="${id}"][data-pi="${pi}"]`).val() || 'string',
                    default: parseDefault($(`.gd-se-param-default[data-id="${id}"][data-pi="${pi}"]`).val(), $(`.gd-se-param-type[data-id="${id}"][data-pi="${pi}"]`).val()),
                });
            }
        });
        return params;
    }

    function parseDefault(raw, type) {
        if (raw === undefined || raw === null || raw === '') return '';
        if (type === 'boolean') {
            if (raw === 'true' || raw === true) return true;
            if (raw === 'false' || raw === false) return false;
            return raw;
        }
        if (type === 'number') {
            const n = Number(raw);
            if (!isNaN(n) && String(raw).trim() !== '') return n;
            return raw;
        }
        return String(raw);
    }

    function bindEvents() {
        // Toggle
        $list.find('.gd-se-toggle-btn').off('click').on('click', function () {
            const id = $(this).data('id');
            flushEditToModel();
            sys.toggle(id);
            renderList();
        });

        // Edit toggle
        $list.find('.gd-se-edit-btn').off('click').on('click', function () {
            const id = $(this).data('id');
            const $edit = $(`.gd-se-edit[data-id="${id}"]`);
            const isOpen = $edit.is(':visible');
            // Close all other edit panels
            $('.gd-se-edit').hide();
            if (!isOpen) $edit.show();
        });

        // Save
        $list.find('.gd-se-save-btn').off('click').on('click', function () {
            const id = $(this).data('id');
            const name = $(`.gd-se-edit-name[data-id="${id}"]`).val()?.trim();
            if (!name) { toastr.warning(L('名称不能为空', 'Name required')); return; }
            const updates = {
                name,
                triggerOn: $(`.gd-se-edit-trigger[data-id="${id}"]`).val(),
                priority: parseInt($(`.gd-se-edit-priority[data-id="${id}"]`).val(), 10) || 0,
                code: $(`.gd-se-edit-code[data-id="${id}"]`).val() || '',
                renderParams: $(`.gd-se-edit-render-params[data-id="${id}"]`).prop('checked'),
                returnMode: $(`.gd-se-edit-return[data-id="${id}"]`).val(),
                params: collectParams(id),
            };
            sys.update(id, updates);
            renderList();
        });

        // Cancel
        $list.find('.gd-se-cancel-btn').off('click').on('click', function () {
            const id = $(this).data('id');
            $(`.gd-se-edit[data-id="${id}"]`).hide();
        });

        // Delete
        $list.find('.gd-se-del-btn').off('click').on('click', async function () {
            const id = $(this).data('id');
            if (!await callGenericPopup(L('确定删除此脚本执行器？', 'Delete this script executor?'), POPUP_TYPE.CONFIRM)) return;
            flushEditToModel();
            sys.remove(id);
            renderList();
        });

        // Param add
        $list.find('.gd-se-param-add').off('click').on('click', function (e) {
            e.stopPropagation();
            const id = $(this).data('id');
            const list = sys.getList();
            const se = list.find(e => e.id === id);
            if (!se) return;
            flushEditToModel();
            if (!se.params) se.params = [];
            se.params.push({ key: '', label: '', type: 'string', default: '' });
            saveSettings();
            renderList();
            $(`.gd-se-edit[data-id="${id}"]`).show();
        });

        // Param delete
        $list.find('.gd-se-param-del').off('click').on('click', function (e) {
            e.stopPropagation();
            const id = $(this).data('id');
            const pi = parseInt($(this).data('pi'));
            const list = sys.getList();
            const se = list.find(e => e.id === id);
            if (!se || !se.params) return;
            flushEditToModel();
            se.params.splice(pi, 1);
            saveSettings();
            renderList();
            $(`.gd-se-edit[data-id="${id}"]`).show();
        });
    }

    function flushEditToModel() {
        // Commit all open edit panel values to model before re-render
        $('.gd-se-edit:visible').each(function () {
            const eid = $(this).data('id');
            const entry = sys.getList().find(e => e.id === eid);
            if (!entry) return;
            const eName = $(`.gd-se-edit-name[data-id="${eid}"]`).val()?.trim();
            if (eName) entry.name = eName;
            entry.triggerOn = $(`.gd-se-edit-trigger[data-id="${eid}"]`).val() || entry.triggerOn;
            const pv = parseInt($(`.gd-se-edit-priority[data-id="${eid}"]`).val(), 10);
            entry.priority = Number.isFinite(pv) ? pv : entry.priority;
            entry.code = $(`.gd-se-edit-code[data-id="${eid}"]`).val() || entry.code;
            entry.renderParams = $(`.gd-se-edit-render-params[data-id="${eid}"]`).prop('checked');
            entry.returnMode = $(`.gd-se-edit-return[data-id="${eid}"]`).val() || entry.returnMode;
            entry.params = collectParams(eid);
        });
        saveSettings();
    }

    // ── Add new ──
    $c('se-add-btn').on('click', function () {
        flushEditToModel();
        // Close all edit panels first
        $('.gd-se-edit').hide();
        const name = L('新脚本', 'New Script');
        const entry = sys.add({ name, triggerOn: 'both', code: '// ctx.params / ctx.shared / ctx.message' });
        renderList();
        // Auto-open edit for new entry
        $(`.gd-se-edit[data-id="${escAttr(entry.id)}"]`).show();
    });

    // ── Export ──
    $c('se-export-btn').on('click', function () {
        const list = sys.getList();
        if (!list.length) { toastr.info(L('无脚本执行器可导出', 'No script executors to export')); return; }
        const data = {
            version: 1,
            type: 'script-executor-export',
            exportedAt: new Date().toISOString(),
            executors: list.map(e => ({
                name: e.name, triggerOn: e.triggerOn, priority: e.priority,
                code: e.code, enabled: e.enabled, params: e.params,
                renderParams: e.renderParams, returnMode: e.returnMode,
            })),
            migrations: [],
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'script-executors.json'; a.click();
        URL.revokeObjectURL(url);
    });

    // ── Import ──
    $c('se-import-btn').on('click', async () => {
        const ok = await callGenericPopup(
            L(
                '<b>安全警告</b><br>导入即赋予完全权限。恶意代码可窃取聊天记录、API 密钥、接管页面。请仅导入你完全信任的代码。',
                '<b>Security Warning</b><br>Importing grants full access. Malicious code can steal chat logs, API keys, and hijack the page. Only import code you fully trust.'
            ),
            POPUP_TYPE.CONFIRM,
        );
        if (!ok) return;
        $('#gd-se-import-file').click();
    });
    $('#gd-se-import-file').on('change', async function () {
        const file = this.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (data.type !== 'script-executor-export') throw new Error('Invalid file type');
            if (!Array.isArray(data.executors)) throw new Error('No executors array');

            let imported = 0;
            for (const e of data.executors) {
                const existing = sys.getList(); // fresh each iteration
                const conflict = existing.find(x => x.name === e.name);
                if (conflict) {
                    if (!await callGenericPopup(L(`脚本「${e.name}」已存在，是否覆盖？`, `Script "${e.name}" already exists. Overwrite?`), POPUP_TYPE.CONFIRM)) continue;
                    sys.remove(conflict.id);
                }
                sys.add(e);
                imported++;
            }
            toastr.success(L(`已导入 ${imported} 个脚本执行器`, `Imported ${imported} script executors`));
            flushEditToModel();
            renderList();
        } catch (e) {
            toastr.error(L(`导入失败: ${e.message}`, `Import failed: ${e.message}`));
        } finally {
            this.value = '';
        }
    });

    function escHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function escAttr(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
    }

    renderList();
});
