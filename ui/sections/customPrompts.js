import { registerSection } from './registry.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../popup.js';

registerSection('customPrompts', function (ctx) {
    const { settings, $c, saveSettings, toastr } = ctx;
    const sys = ctx.customPromptsSystem;
    if (!sys) return;

    const isZh = () => (settings.lang || 'zh') === 'zh';
    const scopeLabel = (scope) => ({
        global: isZh() ? '通用' : 'Global',
        character: isZh() ? '当前角色' : 'Character',
        mixed: isZh() ? '高级 JSON' : 'Advanced JSON',
    }[scope] || (isZh() ? '通用' : 'Global'));
    const dataPresets = () => [
        { id: 'profileSummary', label: isZh() ? '档案摘要' : 'Profile summary', value: '{{?character_profiles:$character.summary}}' },
        { id: 'profileTraits', label: isZh() ? '档案特征' : 'Profile traits', value: '{{?character_profiles:$character.traits}}' },
        { id: 'memoryCurrent', label: isZh() ? '最近记忆' : 'Current memory', value: '{{charMemoryCurrent}}' },
        { id: 'memoryAll', label: isZh() ? '全部记忆' : 'All memory', value: '{{charMemory}}' },
        { id: 'critique', label: isZh() ? '角色批判' : 'Character critique', value: '{{charCritique}}' },
        { id: 'lore', label: isZh() ? '角色世界书' : 'Character lore', value: '{{characterLore}}' },
        { id: 'vars', label: isZh() ? '角色变量' : 'Character vars', value: '{{charVars}}' },
        { id: 'custom', label: isZh() ? '自定义模板' : 'Custom template', value: '' },
    ];

    function parseDataObject(text) {
        const raw = String(text || '').trim();
        if (!raw) return {};
        try {
            const parsed = JSON.parse(raw);
            return parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed : {};
        } catch (_) {
            return {};
        }
    }

    function stringifyDataObject(obj) {
        return JSON.stringify(obj || {}, null, 2);
    }

    function renderDataBuilderHtml(prefix, dataJson, scope = 'global', providerName = 'name') {
        const obj = parseDataObject(dataJson);
        const entries = Object.entries(obj);
        const presets = dataPresets();
        const roleMode = scope === 'character';
        const mixedMode = scope === 'mixed';
        const providerRef = providerName || 'name';
        if (mixedMode) {
            const example = `{
  "global": {
    "season": "夏天"
  },
  "characters": {
    "Alice": {
      "age": "10岁"
    },
    "Bob": {
      "age": "30岁"
    }
  }
}`;
            return `<div class="gd-cp-data-builder-inner" data-prefix="${escAttr(prefix)}" data-scope="${escAttr(scope)}" data-provider="${escAttr(providerRef)}">
                <div style="border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:6px;margin-top:4px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;">
                        <small style="color:var(--grey70a);font-weight:bold;">${isZh() ? '高级 JSON' : 'Advanced JSON'}</small>
                        <small style="color:var(--grey70a);">{{?${escHtml(providerRef)}:path}}</small>
                    </div>
                    <small style="display:block;color:var(--grey70a);margin-top:4px;">${isZh()
                        ? '适合同时保存全局字段、角色映射和嵌套结构。这里不使用小卡片，直接编辑上方 JSON 文本。'
                        : 'Use this for global fields, character maps, and nested structures. Edit the JSON textarea directly.'}</small>
                    <pre style="white-space:pre-wrap;font-size:0.78em;margin:4px 0 0;color:var(--grey70a);">${escHtml(example)}</pre>
                    <small style="display:block;color:var(--grey70a);margin-top:4px;">${isZh()
                        ? `示例读取：{{?${escHtml(providerRef)}:global.season}} / {{?${escHtml(providerRef)}:characters.$character.age}}`
                        : `Examples: {{?${escHtml(providerRef)}:global.season}} / {{?${escHtml(providerRef)}:characters.$character.age}}`}</small>
                </div>
            </div>`;
        }
        const presetIdForValue = (value) => {
            const match = presets.find(p => p.id !== 'custom' && p.value === value);
            return match?.id || 'custom';
        };
        const optionsFor = (selected = 'profileSummary') => presets.map(p => {
            const isSelected = p.id === selected ? ' selected' : '';
            return `<option value="${escAttr(p.id)}"${isSelected}>${escHtml(p.label)}</option>`;
        }).join('');
        const rows = entries.length ? entries.map(([key, value]) => {
            const text = typeof value === 'string' ? value : JSON.stringify(value);
            const options = optionsFor(presetIdForValue(text));
            return `<div class="gd-cp-data-row" data-field="${escAttr(key)}" style="border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:5px;margin-top:4px;">
                <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
                    <input type="text" class="gd-cp-data-field text_pole" value="${escAttr(key)}" style="width:110px;" placeholder="${roleMode ? (isZh() ? '角色名' : 'Character') : (isZh() ? '字段' : 'Field')}">
                    ${roleMode ? '' : `<select class="gd-cp-data-preset text_pole" style="width:auto;font-size:0.82em;">${options}</select>`}
                    <span class="menu_button menu_button_icon gd-cp-data-save" style="font-size:0.75em;color:#4caf50;"><i class="fa-solid fa-floppy-disk"></i></span>
                    <span class="menu_button menu_button_icon gd-cp-data-delete" style="font-size:0.75em;color:#ff5555;"><i class="fa-solid fa-trash"></i></span>
                </div>
                <textarea class="gd-cp-data-value text_pole textarea_compact" rows="2" style="width:100%;margin-top:3px;" placeholder="${roleMode ? (isZh() ? '这个角色对应的值，例如 10岁' : 'Value for this character, e.g. 10 years old') : ''}">${escHtml(text)}</textarea>
            </div>`;
        }).join('') : `<small style="display:block;color:var(--grey70a);margin-top:3px;">${roleMode
            ? (isZh() ? '暂无角色映射。用下面的小表单逐个添加角色和值。' : 'No character mappings yet. Add characters and values below.')
            : (isZh() ? '暂无角色字段。用下面的小表单逐个添加。' : 'No character fields yet. Add fields one by one below.')}</small>`;

        return `<div class="gd-cp-data-builder-inner" data-prefix="${escAttr(prefix)}" data-scope="${escAttr(scope)}" data-provider="${escAttr(providerRef)}">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:4px;">
                <small style="color:var(--grey70a);font-weight:bold;">${roleMode ? (isZh() ? '角色映射' : 'Character map') : (isZh() ? '当前角色字段' : 'Current character fields')}</small>
                <small style="color:var(--grey70a);">${roleMode ? `{{?${escHtml(providerRef)}:$character}}` : (isZh() ? '保存后写回 JSON' : 'Saved into JSON')}</small>
            </div>
            <div class="gd-cp-data-rows">${rows}</div>
            <div class="gd-cp-data-add" style="border:1px dashed var(--SmartThemeBorderColor);border-radius:4px;padding:5px;margin-top:4px;">
                <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
                    <input type="text" class="gd-cp-data-new-field text_pole" style="width:110px;" placeholder="${roleMode ? (isZh() ? '角色名' : 'Character') : (isZh() ? '字段名' : 'Field')}">
                    ${roleMode ? '' : `<select class="gd-cp-data-new-preset text_pole" style="width:auto;font-size:0.82em;">${optionsFor('profileSummary')}</select>`}
                    <span class="menu_button menu_button_icon gd-cp-data-add-btn" style="font-size:0.75em;"><i class="fa-solid fa-plus"></i> ${roleMode ? (isZh() ? '添加角色' : 'Add character') : (isZh() ? '添加字段' : 'Add field')}</span>
                </div>
                <textarea class="gd-cp-data-new-value text_pole textarea_compact" rows="2" style="width:100%;margin-top:3px;" placeholder="${roleMode ? (isZh() ? '这个角色对应的值，例如 10岁' : 'Value for this character, e.g. 10 years old') : (isZh() ? '选择来源后自动填入，也可手写模板' : 'Choose a source or write a template')}"></textarea>
            </div>
        </div>`;
    }

    function getDataTextarea($builder) {
        const prefix = $builder.find('.gd-cp-data-builder-inner').attr('data-prefix');
        if (prefix === 'new') return $('#gd-cp-new-data');
        return $(`.gd-cp-edit-data[data-id="${escAttr(prefix)}"]`);
    }

    function refreshBuilder($builder, dataJson, scope, providerName) {
        const prefix = $builder.find('.gd-cp-data-builder-inner').attr('data-prefix') || $builder.attr('data-prefix') || 'new';
        const currentScope = scope || $builder.find('.gd-cp-data-builder-inner').attr('data-scope') || 'global';
        const currentProvider = providerName || $builder.find('.gd-cp-data-builder-inner').attr('data-provider') || 'name';
        $builder.html(renderDataBuilderHtml(prefix, dataJson, currentScope, currentProvider));
        bindOneBuilder($builder);
    }

    function setPresetValue($select, $textarea) {
        const preset = dataPresets().find(p => p.id === $select.val());
        if (preset && preset.id !== 'custom') $textarea.val(preset.value);
    }

    function bindOneBuilder($builder) {
        $builder.find('.gd-cp-data-preset').off('change').on('change', function () {
            setPresetValue($(this), $(this).closest('.gd-cp-data-row').find('.gd-cp-data-value'));
        });
        $builder.find('.gd-cp-data-new-preset').off('change').on('change', function () {
            setPresetValue($(this), $(this).closest('.gd-cp-data-add').find('.gd-cp-data-new-value'));
        }).trigger('change');
        $builder.find('.gd-cp-data-save').off('click').on('click', function () {
            const $row = $(this).closest('.gd-cp-data-row');
            const oldField = $row.attr('data-field');
            const field = String($row.find('.gd-cp-data-field').val() || '').trim();
            const value = $row.find('.gd-cp-data-value').val();
            if (!field) { toastr.warning(isZh() ? '字段名不能为空' : 'Field is required'); return; }
            const $textarea = getDataTextarea($builder);
            const obj = parseDataObject($textarea.val());
            if (oldField && oldField !== field) delete obj[oldField];
            obj[field] = value;
            $textarea.val(stringifyDataObject(obj));
            refreshBuilder($builder, $textarea.val());
            toastr.success(isZh() ? '字段已保存' : 'Field saved');
        });
        $builder.find('.gd-cp-data-delete').off('click').on('click', function () {
            const field = $(this).closest('.gd-cp-data-row').attr('data-field');
            const $textarea = getDataTextarea($builder);
            const obj = parseDataObject($textarea.val());
            delete obj[field];
            $textarea.val(Object.keys(obj).length ? stringifyDataObject(obj) : '');
            refreshBuilder($builder, $textarea.val());
        });
        $builder.find('.gd-cp-data-add-btn').off('click').on('click', function () {
            const $box = $(this).closest('.gd-cp-data-add');
            const field = String($box.find('.gd-cp-data-new-field').val() || '').trim();
            const value = $box.find('.gd-cp-data-new-value').val();
            if (!field) { toastr.warning(isZh() ? '字段名不能为空' : 'Field is required'); return; }
            const $textarea = getDataTextarea($builder);
            const obj = parseDataObject($textarea.val());
            obj[field] = value;
            $textarea.val(stringifyDataObject(obj));
            refreshBuilder($builder, $textarea.val());
        });
    }

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
            const hasData = !!String(cp.dataJson || '').trim();
            html += `<div class="gd-cp-card" data-id="${escAttr(cp.id)}" style="border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:6px;margin-top:4px;">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <div style="flex:1;min-width:0;">
                        <code style="color:#4caf50;">{{${escHtml(cp.name)}}}</code>
                        ${cp.enabled ? '' : `<span style="color:var(--grey70a);font-size:0.8em;"> (${isZh() ? '关闭' : 'off'})</span>`}
                        <small style="color:var(--grey70a);margin-left:4px;">${scopeLabel(cp.scope)}${hasData ? ' / JSON' : ''}</small>
                        <div style="font-size:0.8em;color:var(--grey70a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(preview)}${cp.content.length > 60 ? '...' : ''}</div>
                    </div>
                    <div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px;">
                        <span class="menu_button menu_button_icon gd-cp-edit-btn" data-id="${escAttr(cp.id)}" style="font-size:0.75em;"><i class="fa-solid fa-pencil"></i></span>
                        <span class="menu_button menu_button_icon gd-cp-toggle-btn" data-id="${escAttr(cp.id)}" style="font-size:0.75em;color:${cp.enabled ? '#4caf50' : '#999'};">${cp.enabled ? '<i class="fa-solid fa-toggle-on"></i>' : '<i class="fa-solid fa-toggle-off"></i>'}</span>
                        <span class="menu_button menu_button_icon gd-cp-del-btn" data-id="${escAttr(cp.id)}" style="font-size:0.75em;color:#ff5555;"><i class="fa-solid fa-trash"></i></span>
                    </div>
                </div>
                <div class="gd-cp-edit" data-id="${escAttr(cp.id)}" style="display:none;margin-top:4px;">
                    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                        <input type="text" class="gd-cp-edit-name text_pole" data-id="${escAttr(cp.id)}" value="${escAttr(cp.name)}" style="width:120px;" placeholder="${isZh() ? '名称' : 'Name'}">
                        <select class="gd-cp-edit-scope text_pole" data-id="${escAttr(cp.id)}" style="width:auto;font-size:0.85em;">
                            <option value="global" ${(cp.scope || 'global') === 'global' ? 'selected' : ''}>${isZh() ? '通用' : 'Global'}</option>
                            <option value="character" ${cp.scope === 'character' ? 'selected' : ''}>${isZh() ? '当前角色' : 'Character'}</option>
                            <option value="mixed" ${cp.scope === 'mixed' ? 'selected' : ''}>${isZh() ? '高级 JSON' : 'Advanced JSON'}</option>
                        </select>
                        <small style="color:var(--grey70a);"> (a-z, 0-9, _)</small>
                    </div>
                    <textarea class="gd-cp-edit-content text_pole textarea_compact" data-id="${escAttr(cp.id)}" rows="4" style="width:100%;margin-top:2px;">${escHtml(cp.content)}</textarea>
                    <textarea class="gd-cp-edit-data text_pole textarea_compact" data-id="${escAttr(cp.id)}" rows="4" style="width:100%;margin-top:2px;" placeholder="${isZh() ? '可选 JSON 数据。值里可写 {{占位符}} / {{?provider:$character.path}}' : 'Optional JSON data. Values may contain {{placeholders}} / {{?provider:$character.path}}'}">${escHtml(cp.dataJson || '')}</textarea>
                    <small style="color:var(--grey70a);">${cp.scope === 'character'
                        ? (isZh() ? `角色映射可用 {{?${escHtml(cp.name)}:$character}} 读取当前角色值。` : `Character map can be queried with {{?${escHtml(cp.name)}:$character}}.`)
                        : cp.scope === 'mixed'
                            ? (isZh() ? `高级 JSON 可用 {{?${escHtml(cp.name)}:path}} 读取任意路径。` : `Advanced JSON can be queried with {{?${escHtml(cp.name)}:path}}.`)
                        : `${isZh() ? 'JSON 会作为 data 暴露，可用 {{?' : 'JSON is exposed as data, query with {{?'}${escHtml(cp.name)}:field}}`}</small>
                    <div class="gd-cp-data-builder" data-prefix="${escAttr(cp.id)}" style="margin-top:4px;">
                        ${renderDataBuilderHtml(cp.id, cp.dataJson || '', cp.scope || 'global', cp.name)}
                    </div>
                    <div style="margin-top:2px;display:flex;gap:4px;">
                        <span class="menu_button menu_button_icon gd-cp-save-btn" data-id="${escAttr(cp.id)}" style="font-size:0.8em;color:#4caf50;"><i class="fa-solid fa-floppy-disk"></i> ${isZh() ? '保存' : 'Save'}</span>
                        <span class="menu_button menu_button_icon gd-cp-cancel-btn" data-id="${escAttr(cp.id)}" style="font-size:0.8em;"><i class="fa-solid fa-xmark"></i> ${isZh() ? '取消' : 'Cancel'}</span>
                    </div>
                </div>
            </div>`;
        });
        $list.html(html);
        $list.find('.gd-cp-data-builder').each(function () { bindOneBuilder($(this)); });
        $list.find('.gd-cp-edit-data').off('blur').on('blur', function () {
            const id = $(this).attr('data-id');
            const $builder = $(`.gd-cp-data-builder[data-prefix="${escAttr(id)}"]`);
            const scope = $(`.gd-cp-edit-scope[data-id="${escAttr(id)}"]`).val() || 'global';
            const name = $(`.gd-cp-edit-name[data-id="${escAttr(id)}"]`).val().trim() || 'name';
            refreshBuilder($builder, $(this).val(), scope, name);
        });
        $list.find('.gd-cp-edit-scope').off('change.gdBuilder').on('change.gdBuilder', function () {
            const id = $(this).attr('data-id');
            const $builder = $(`.gd-cp-data-builder[data-prefix="${escAttr(id)}"]`);
            const dataJson = $(`.gd-cp-edit-data[data-id="${escAttr(id)}"]`).val();
            const name = $(`.gd-cp-edit-name[data-id="${escAttr(id)}"]`).val().trim() || 'name';
            refreshBuilder($builder, dataJson, $(this).val() || 'global', name);
        });
        $list.find('.gd-cp-edit-name').off('blur.gdBuilder').on('blur.gdBuilder', function () {
            const id = $(this).attr('data-id');
            const $builder = $(`.gd-cp-data-builder[data-prefix="${escAttr(id)}"]`);
            const dataJson = $(`.gd-cp-edit-data[data-id="${escAttr(id)}"]`).val();
            const scope = $(`.gd-cp-edit-scope[data-id="${escAttr(id)}"]`).val() || 'global';
            refreshBuilder($builder, dataJson, scope, $(this).val().trim() || 'name');
        });

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
            const dataJson = $(`.gd-cp-edit-data[data-id="${escAttr(id)}"]`).val();
            const scope = $(`.gd-cp-edit-scope[data-id="${escAttr(id)}"]`).val() || 'global';
            const valid = sys.validateName(name, id);
            if (!valid.ok) { toastr.warning(valid.error); return; }
            const dataValid = sys.validateDataJson(dataJson);
            if (!dataValid.ok) { toastr.warning(dataValid.error); return; }
            try {
                sys.update(id, { name, content, dataJson, scope });
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
            const promptName = escHtml(entry.name);
            if (!await callGenericPopup(isZh()
                ? `删除 {{${promptName}}}？已引用此占位符的位置将变为空。`
                : `Delete {{${promptName}}}? References to it will become empty.`, POPUP_TYPE.CONFIRM)) return;
            sys.remove(id);
            renderList();
            toastr.info(isZh() ? '已删除' : 'Deleted');
        });
    }

    // ── Add new ─────────────────────────────────────────────────────

    function resetAddForm() {
        $c('cp-new-name').val('');
        $c('cp-new-content').val('');
        $c('cp-new-data').val('');
        $c('cp-new-scope').val('global');
        refreshBuilder($('#gd-cp-new-data-builder'), '', 'global', 'name');
    }

    $c('cp-add-btn').off('click').on('click', () => {
        const name = $c('cp-new-name').val().trim();
        const content = $c('cp-new-content').val();
        const dataJson = $c('cp-new-data').val();
        const scope = $c('cp-new-scope').val() || 'global';
        if (!name) { toastr.warning(isZh() ? '请输入名称' : 'Enter a name'); return; }
        const dataValid = sys.validateDataJson(dataJson);
        if (!dataValid.ok) { toastr.warning(dataValid.error); return; }
        try {
            const { selfRef } = sys.add(name, content, true, { dataJson, scope });
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
                const conflictNames = conflicts.map(p => escHtml(p.name)).join(', ');
                overwrite = await callGenericPopup(isZh()
                    ? `检测到 ${conflicts.length} 个同名 Prompt：${conflictNames}。\n确定=覆盖同名，取消=仅添加不同名的`
                    : `Found ${conflicts.length} same-name prompt(s): ${conflictNames}.\nOK=overwrite conflicts, Cancel=add only new ones`, POPUP_TYPE.CONFIRM);
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

    $('#gd-cp-new-data-builder').attr('data-prefix', 'new').html(renderDataBuilderHtml('new', $c('cp-new-data').val() || '', $c('cp-new-scope').val() || 'global', String($c('cp-new-name').val() ?? '').trim() || 'name'));
    bindOneBuilder($('#gd-cp-new-data-builder'));
    $c('cp-new-data').off('blur').on('blur', function () {
        refreshBuilder($('#gd-cp-new-data-builder'), $(this).val(), $c('cp-new-scope').val() || 'global', String($c('cp-new-name').val() ?? '').trim() || 'name');
    });
    $c('cp-new-scope').off('change.gdBuilder').on('change.gdBuilder', function () {
        refreshBuilder($('#gd-cp-new-data-builder'), $c('cp-new-data').val(), $(this).val() || 'global', String($c('cp-new-name').val() ?? '').trim() || 'name');
    });
    $c('cp-new-name').off('blur.gdBuilder').on('blur.gdBuilder', function () {
        refreshBuilder($('#gd-cp-new-data-builder'), $c('cp-new-data').val(), $c('cp-new-scope').val() || 'global', $(this).val().trim() || 'name');
    });
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
