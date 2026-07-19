import { registerSection } from './registry.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../popup.js';

function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function parseJsonish(raw, type) {
    if (type === 'number') return Number(raw);
    if (type === 'boolean') return raw === true || raw === 'true' || raw === 'on';
    if (type === 'array' || type === 'object') return raw ? JSON.parse(raw) : (type === 'array' ? [] : {});
    return raw;
}

function tryParseJsonish(raw, type) {
    try {
        return { ok: true, value: parseJsonish(raw, type) };
    } catch (e) {
        return { ok: false, error: e.message || String(e) };
    }
}

function formatValue(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
}

function sameValue(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return a === b; }
}

registerSection('variables', function (ctx) {
    const { settings, variableSystem, getCharacters, getCurrentGroup, toastr } = ctx;
    if (!variableSystem) return;

    let selectedId = null;
    let autosaveTimer = null;
    const DASH_HIDE_INACTIVE_KEY = 'gd.variables.hideInactiveCharacterRows';
    let hideInactiveCharacterRows = localStorage?.getItem(DASH_HIDE_INACTIVE_KEY) === '1';
    const TEXT = {
        zh: {
            variables: '变量',
            newVariable: '新建变量',
            templatePlaceholder: '内置模板...',
            addTemplate: '添加模板',
            refresh: '刷新',
            maintenancePreview: '维护说明预览',
            emptyStatus: '空',
            varsStatus: n => `${n} 个变量`,
            noVars: '暂无变量。可以新建变量，或使用内置模板。',
            charValues: n => `${n} 个角色值`,
            locked: '已锁定',
            deleteConfirm: id => `删除变量 "${id}"？`,
            copied: '已复制',
            id: 'ID',
            label: '显示名',
            scope: '作用域',
            type: '类型',
            update: '更新方式',
            inject: '注入方式',
            min: '最小值',
            max: '最大值',
            enumValues: '枚举值（逗号分隔）',
            rule: '维护规则',
            defaultValue: '默认值 / 全局值',
            canUpdate: '允许 Director 更新',
            showDashboard: '显示在仪表盘',
            lock: '锁定',
            characterValues: '角色变量值',
            save: '保存',
            cancel: '取消',
            saved: '变量已保存',
            global: '全局',
            characters: '角色',
            recentUpdates: '最近更新',
            noDashVars: '没有仪表盘变量。可在上方添加模板/新建变量，或打开变量设置后勾选“显示在仪表盘”。',
            updated: '变量已更新',
            quickAdd: '快速添加',
            openSettings: '打开设置',
            exportVars: '导出变量',
            importVars: '导入变量',
            jumpPlaceholder: '定位变量...',
            imported: n => `已导入 ${n} 个变量`,
            importFailed: e => `导入失败: ${e}`,
            scopeGlobal: '全局',
            scopeCharacter: '角色',
            injectAlways: '总是注入',
            injectManual: '手动调用',
        },
        en: {
            variables: 'Variables',
            newVariable: 'New Variable',
            templatePlaceholder: 'Built-in templates...',
            addTemplate: 'Add Template',
            refresh: 'Refresh',
            maintenancePreview: 'Maintenance Preview',
            emptyStatus: 'empty',
            varsStatus: n => `${n} vars`,
            noVars: 'No variables yet. Add one or use a template.',
            charValues: n => `${n} character values`,
            locked: 'locked',
            deleteConfirm: id => `Delete variable "${id}"?`,
            copied: 'Copied',
            id: 'ID',
            label: 'Label',
            scope: 'Scope',
            type: 'Type',
            update: 'Update',
            inject: 'Inject',
            min: 'Min',
            max: 'Max',
            enumValues: 'Enum values (comma separated)',
            rule: 'Rule',
            defaultValue: 'Default / Global value',
            canUpdate: 'Director can update',
            showDashboard: 'Show in dashboard',
            lock: 'Locked',
            characterValues: 'Character values',
            save: 'Save',
            cancel: 'Cancel',
            saved: 'Variable saved',
            global: 'Global',
            characters: 'Characters',
            recentUpdates: 'Recent updates',
            noDashVars: 'No dashboard variables. Add a template/new variable above, or open settings and enable "Show in dashboard".',
            updated: 'Variable updated',
            quickAdd: 'Quick Add',
            openSettings: 'Open Settings',
            exportVars: 'Export Variables',
            importVars: 'Import Variables',
            jumpPlaceholder: 'Jump to variable...',
            imported: n => `${n} variable(s) imported`,
            importFailed: e => `Import failed: ${e}`,
            scopeGlobal: 'global',
            scopeCharacter: 'character',
            injectAlways: 'always',
            injectManual: 'manual',
        },
    };
    function t(key, ...args) {
        const dict = TEXT[(settings?.lang || 'zh') === 'zh' ? 'zh' : 'en'];
        const value = dict[key];
        return typeof value === 'function' ? value(...args) : value;
    }
    function staleLabel() {
        return (settings?.lang || 'zh') === 'zh' ? '可能过期' : 'possibly stale';
    }
    function revertLabel() {
        return (settings?.lang || 'zh') === 'zh' ? '返回上一次记录' : 'Revert to previous record';
    }
    function hideInactiveLabel() {
        return (settings?.lang || 'zh') === 'zh' ? '隐藏无更新角色变量' : 'Hide unchanged character vars';
    }
    function autoSaveLabel() {
        return (settings?.lang || 'zh') === 'zh' ? '自动保存' : 'Autosave';
    }
    function referenceFormatLabel() {
        return (settings?.lang || 'zh') === 'zh' ? '引用格式' : 'Reference format';
    }

    function defs() { return variableSystem.getDefs(); }
    function chars() { return getCharacters?.() || []; }
    function visibleChars() {
        const all = chars();
        const group = getCurrentGroup?.();
        if (!group?.members?.length) return all;
        const enabled = group.members.filter(a => !group.disabled_members?.includes(a));
        return enabled.map(a => all.find(c => c.avatar === a)).filter(Boolean);
    }
    function applyStaticLabels() {
        $('#gd-dash-vars').text(t('variables'));
        $('.gd-dash-panel-vars .gd-dash-panel-header > span:first').text(t('variables'));
        $('[data-card="variables"] > .gd-card-header span').filter(function () { return $(this).text() === '变量' || $(this).text() === 'Variables'; }).text(t('variables'));
        $('#gd-var-add').html(`<i class="fa-solid fa-plus"></i> ${esc(t('newVariable'))}`);
        $('#gd-var-template option:first').text(t('templatePlaceholder'));
        $('#gd-var-add-template').html(`<i class="fa-solid fa-wand-magic-sparkles"></i> ${esc(t('addTemplate'))}`);
        $('#gd-var-refresh').html(`<i class="fa-solid fa-rotate"></i> ${esc(t('refresh'))}`);
        if (!$('#gd-var-export').length && $('#gd-var-refresh').length) {
            $('#gd-var-refresh').before(`<span class="menu_button menu_button_icon" id="gd-var-export"><i class="fa-solid fa-file-export"></i> ${esc(t('exportVars'))}</span>`);
            $('#gd-var-refresh').before(`<span class="menu_button menu_button_icon" id="gd-var-import"><i class="fa-solid fa-file-import"></i> ${esc(t('importVars'))}</span>`);
            bindStandaloneImportExport();
        } else {
            $('#gd-var-export').html(`<i class="fa-solid fa-file-export"></i> ${esc(t('exportVars'))}`);
            $('#gd-var-import').html(`<i class="fa-solid fa-file-import"></i> ${esc(t('importVars'))}`);
        }
        $('[data-card="variablesMaintenancePreview"] > .gd-card-header span').filter(function () { return $(this).text() === '维护说明预览' || $(this).text() === 'Maintenance Preview'; }).text(t('maintenancePreview'));
        $('[data-card="variablesMaintenancePreview"] > .gd-card-header').off('click').on('click.gdVarsStop', function (e) {
            e.stopImmediatePropagation();
            const $card = $(this).closest('[data-card="variablesMaintenancePreview"]');
            $card.toggleClass('is-expanded');
            $card.find('> .gd-card-body').slideToggle(180);
        });
    }

    function renderTemplates() {
        const $sel = $('#gd-var-template');
        if (!$sel.length) return;
        const current = $sel.val();
        $sel.find('option:not(:first)').remove();
        for (const tpl of variableSystem.getTemplates()) {
            $sel.append(`<option value="${esc(tpl.id)}">${esc(tpl.label)} (${esc(tpl.scope)})</option>`);
        }
        if (current) $sel.val(current);
    }

    function renderList() {
        const $list = $('#gd-var-list');
        if (!$list.length) return;
        const all = defs().sort((a, b) => a.scope.localeCompare(b.scope) || a.dashboardOrder - b.dashboardOrder || a.id.localeCompare(b.id));
        $('#gd-card-status-vars').text(all.length ? t('varsStatus', all.length) : t('emptyStatus'));
        $list.empty();
        if (!all.length) {
            $list.append(`<small style="color:var(--grey70a)">${esc(t('noVars'))}</small>`);
            return;
        }
        for (const def of all) {
            const value = def.scope === 'global'
                ? variableSystem.getValue(def)
                : t('charValues', visibleChars().length);
            const $row = $(`
                <div class="gd-var-row" data-id="${esc(def.id)}" style="border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:6px;margin-bottom:6px;">
                    <div class="gd-var-row-head" style="display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center;cursor:pointer;">
                    <div>
                        <b>${esc(def.label)}</b> <code>${esc(def.id)}</code>
                        <small style="color:var(--grey70a);display:block;">${esc(def.scope === 'global' ? t('scopeGlobal') : t('scopeCharacter'))} / ${esc(def.type)} / ${esc(def.updateMode)}${def.locked ? ` / ${esc(t('locked'))}` : ''}</small>
                        <small style="color:var(--grey70a);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(formatValue(value))}</small>
                    </div>
                    <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">
                        <span class="menu_button menu_button_icon gd-var-copy" data-token="{{?vars:${def.scope === 'global' ? `global.${def.id}.value` : `character.${def.id}.values.$avatar`}}}"><i class="fa-solid fa-copy"></i></span>
                        <span class="menu_button menu_button_icon gd-var-delete" style="color:#ff5555;"><i class="fa-solid fa-trash"></i></span>
                    </div>
                    </div>
                    <div class="gd-var-row-editor" style="display:${selectedId === def.id ? 'block' : 'none'};margin-top:8px;border-top:1px solid var(--SmartThemeBorderColor);padding-top:8px;"></div>
                </div>
            `);
            $row.find('.gd-var-row-head').on('click', (e) => {
                if ($(e.target).closest('.gd-var-copy, .gd-var-delete').length) return;
                selectedId = selectedId === def.id ? null : def.id;
                refresh();
            });
            $row.find('.gd-var-delete').on('click', async (e) => {
                e.stopPropagation();
                if (!await callGenericPopup(t('deleteConfirm', def.id), POPUP_TYPE.CONFIRM)) return;
                variableSystem.deleteDefinition(def.id);
                if (selectedId === def.id) selectedId = null;
                refresh();
            });
            $row.find('.gd-var-copy').on('click', async function (e) {
                e.stopPropagation();
                const token = $(this).data('token');
                try { await navigator.clipboard?.writeText(token); toastr?.info?.(t('copied')); } catch (_) { toastr?.info?.(token); }
            });
            $list.append($row);
            if (selectedId === def.id) renderEditor($row.find('.gd-var-row-editor'));
        }
    }

    function renderEditor($target = null) {
        const $editor = $target || $('#gd-var-editor');
        if (!$editor.length) return;
        if (!selectedId) { $editor.hide().empty(); return; }
        const def = variableSystem.getDefinition(selectedId);
        if (!def) { selectedId = null; $editor.hide().empty(); return; }
        const globalValue = def.scope === 'global' ? variableSystem.getValue(def) : def.defaultValue;
        $editor.empty().show().append(`
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <label>${esc(t('id'))}<input id="gd-var-edit-id" class="text_pole" value="${esc(def.id)}"></label>
                <label>${esc(t('label'))}<input id="gd-var-edit-label" class="text_pole" value="${esc(def.label)}"></label>
                <label>${esc(t('scope'))}<select id="gd-var-edit-scope" class="text_pole"><option value="global">${esc(t('scopeGlobal'))}</option><option value="character">${esc(t('scopeCharacter'))}</option></select></label>
                <label>${esc(t('type'))}<select id="gd-var-edit-type" class="text_pole"><option value="string">string</option><option value="number">number</option><option value="boolean">boolean</option><option value="enum">enum</option><option value="object">object</option><option value="array">array</option></select></label>
                <label>${esc(t('update'))}<select id="gd-var-edit-update" class="text_pole"><option value="replace">replace</option><option value="delta">delta</option><option value="append">append</option><option value="merge">merge</option></select></label>
                <label>${esc(t('inject'))}<select id="gd-var-edit-inject" class="text_pole"><option value="always">${esc(t('injectAlways'))}</option><option value="manual">${esc(t('injectManual'))}</option></select></label>
                <label>${esc(t('min'))}<input id="gd-var-edit-min" class="text_pole" type="number" value="${Number.isFinite(def.min) ? esc(def.min) : ''}"></label>
                <label>${esc(t('max'))}<input id="gd-var-edit-max" class="text_pole" type="number" value="${Number.isFinite(def.max) ? esc(def.max) : ''}"></label>
            </div>
            <label style="display:block;margin-top:6px;">${esc(t('enumValues'))}<input id="gd-var-edit-enum" class="text_pole" value="${esc((def.enumValues || []).join(', '))}"></label>
            <label style="display:block;margin-top:6px;">${esc(t('rule'))}<textarea id="gd-var-edit-rule" class="text_pole textarea_compact" rows="3" style="width:100%;">${esc(def.rule)}</textarea></label>
            <label style="display:block;margin-top:6px;">${esc(t('defaultValue'))}<textarea id="gd-var-edit-value" class="text_pole textarea_compact" rows="3" style="width:100%;font-family:monospace;">${esc(formatValue(globalValue))}</textarea></label>
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;">
                <label class="checkbox_label"><input type="checkbox" id="gd-var-edit-auto"> <span>${esc(t('canUpdate'))}</span></label>
                <label class="checkbox_label"><input type="checkbox" id="gd-var-edit-dashboard"> <span>${esc(t('showDashboard'))}</span></label>
                <label class="checkbox_label"><input type="checkbox" id="gd-var-edit-locked"> <span>${esc(t('lock'))}</span></label>
            </div>
            <div id="gd-var-char-values" style="display:none;margin-top:8px;max-height:260px;overflow-y:auto;border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:6px;"></div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center;">
                <small style="color:var(--grey70a);">${esc(autoSaveLabel())}</small>
                <span style="flex:1"></span>
                <small style="color:var(--grey70a);">${esc(referenceFormatLabel())}:</small>
                <code>{{?vars:${def.scope === 'global' ? `global.${def.id}.value` : `character.${def.id}.values.$avatar`}}}</code>
            </div>
        `);
        $('#gd-var-edit-scope').val(def.scope);
        $('#gd-var-edit-type').val(def.type);
        $('#gd-var-edit-update').val(def.updateMode);
        $('#gd-var-edit-inject').val(def.injectMode);
        $('#gd-var-edit-auto').prop('checked', def.autoUpdate);
        $('#gd-var-edit-dashboard').prop('checked', def.showInDashboard);
        $('#gd-var-edit-locked').prop('checked', def.locked);

        function renderCharValues() {
            const scope = $('#gd-var-edit-scope').val();
            const $wrap = $('#gd-var-char-values');
            if (scope !== 'character') { $wrap.hide().empty(); return; }
            $wrap.show().empty().append(`<b>${esc(t('characterValues'))}</b>`);
            for (const c of visibleChars()) {
                const value = variableSystem.getValue(def, c.avatar);
                $wrap.append(`
                    <label style="display:grid;grid-template-columns:120px 1fr;gap:6px;align-items:center;margin-top:4px;">
                        <span>${esc(c.name)}</span>
                        <input class="text_pole gd-var-char-value" data-avatar="${esc(c.avatar)}" value="${esc(formatValue(value))}">
                    </label>
                `);
            }
        }
        renderCharValues();
        const saveCurrentEditor = (options = {}) => {
            const oldId = def.id;
            const defaultParsed = tryParseJsonish($('#gd-var-edit-value').val(), $('#gd-var-edit-type').val());
            if (!defaultParsed.ok) {
                toastr?.error?.(defaultParsed.error);
                return;
            }
            const newDef = {
                id: $('#gd-var-edit-id').val(),
                label: $('#gd-var-edit-label').val(),
                scope: $('#gd-var-edit-scope').val(),
                type: $('#gd-var-edit-type').val(),
                updateMode: $('#gd-var-edit-update').val(),
                injectMode: $('#gd-var-edit-inject').val(),
                min: $('#gd-var-edit-min').val(),
                max: $('#gd-var-edit-max').val(),
                enumValues: $('#gd-var-edit-enum').val(),
                rule: $('#gd-var-edit-rule').val(),
                autoUpdate: $('#gd-var-edit-auto').prop('checked'),
                showInDashboard: $('#gd-var-edit-dashboard').prop('checked'),
                locked: $('#gd-var-edit-locked').prop('checked'),
                defaultValue: defaultParsed.value,
            };
            const parsedCharValues = [];
            if (newDef.scope === 'character') {
                $('#gd-var-char-values .gd-var-char-value').each(function () {
                    const parsed = tryParseJsonish($(this).val(), newDef.type);
                    if (!parsed.ok) {
                        parsedCharValues.push({ ok: false, error: parsed.error });
                        return false;
                    }
                    parsedCharValues.push({ ok: true, avatar: $(this).data('avatar'), value: parsed.value });
                });
                const failed = parsedCharValues.find(v => !v.ok);
                if (failed) {
                    toastr?.error?.(failed.error);
                    return;
                }
            }
            if (newDef.id !== oldId) variableSystem.deleteDefinition(oldId);
            const saved = variableSystem.upsertDefinition(newDef);
            selectedId = saved.id;
            if (saved.scope === 'global') {
                variableSystem.setValue(saved.id, newDef.defaultValue, { source: 'manual', updateMode: 'replace' });
            } else {
                for (const parsed of parsedCharValues) {
                    variableSystem.setValue(saved.id, parsed.value, { target: parsed.avatar, source: 'manual', updateMode: 'replace' });
                }
            }
            renderMaintenancePreview();
            renderDashboardVars();
            if (options.refreshList !== false) refresh();
        };
        function scheduleAutosave(options = {}) {
            clearTimeout(autosaveTimer);
            autosaveTimer = setTimeout(() => saveCurrentEditor(options), 250);
        }
        $('#gd-var-edit-scope, #gd-var-edit-type').on('change', () => {
            renderCharValues();
            scheduleAutosave();
        });
        $('#gd-var-edit-update, #gd-var-edit-inject, #gd-var-edit-auto, #gd-var-edit-dashboard, #gd-var-edit-locked').on('change', () => scheduleAutosave());
        $('#gd-var-edit-id, #gd-var-edit-label, #gd-var-edit-min, #gd-var-edit-max, #gd-var-edit-enum, #gd-var-edit-rule, #gd-var-edit-value').on('change blur', () => scheduleAutosave());
        $('#gd-var-char-values .gd-var-char-value').on('change blur', () => scheduleAutosave({ refreshList: false }));
    }

    function renderMaintenancePreview() {
        $('#gd-var-maint-preview').val(variableSystem.renderMaintenance());
    }

    function renderDashboardVars() {
        const $panel = $('#gd-dash-panel-vars-list');
        if (!$panel.length) return;
        const all = defs().filter(d => d.showInDashboard);
        const rawItems = buildDashboardItems(all);
        const items = hideInactiveCharacterRows ? rawItems.filter(item => item.scope !== 'character' || hasDashboardActivity(item)) : rawItems;
        const log = variableSystem.getLog().slice(-5).reverse();
        $panel.empty();
        $panel.css({ maxHeight: 'min(70vh, 620px)', overflowY: 'auto', paddingRight: '4px' });
        appendDashboardToolbar($panel, items);
        if (!all.length) {
            const $empty = $(`
                <div style="border:1px dashed var(--SmartThemeBorderColor);border-radius:4px;padding:8px;">
                    <small style="color:var(--grey70a);display:block;margin-bottom:6px;">${esc(t('noDashVars'))}</small>
                    <span class="menu_button menu_button_icon gd-dash-var-empty-settings"><i class="fa-solid fa-sliders"></i> ${esc(t('openSettings'))}</span>
                </div>
            `);
            $empty.find('.gd-dash-var-empty-settings').on('click', openVariableSettings);
            $panel.append($empty);
            return;
        }
        appendDashboardIndex($panel, items);
        const globals = items.filter(item => item.scope === 'global');
        if (globals.length) {
            $panel.append(`<b>${esc(t('global'))}</b>`);
            for (const item of globals) appendDashboardValue($panel, item);
        }
        const charItems = items.filter(item => item.scope === 'character');
        if (charItems.length) {
            $panel.append(`<hr><b>${esc(t('characters'))}</b>`);
            const openByDefault = visibleChars().length <= 3 && charItems.length <= 24;
            for (const c of visibleChars()) {
                const perChar = charItems.filter(item => item.target === c.avatar);
                if (!perChar.length) continue;
                const staleCount = perChar.filter(item => item.stale).length;
                const filledCount = perChar.filter(item => formatValue(item.value)).length;
                const $box = $(`
                    <details class="gd-dash-var-char-group" data-avatar="${esc(c.avatar)}" ${openByDefault || staleCount ? 'open' : ''} style="border:1px solid var(--SmartThemeBorderColor);border-radius:4px;margin-top:6px;">
                        <summary style="display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center;cursor:pointer;padding:6px;list-style:none;">
                            <b style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(c.name)}</b>
                            <small style="color:${staleCount ? '#d89b00' : 'var(--grey70a)'};">${filledCount}/${perChar.length}${staleCount ? ` · ${esc(staleLabel())}` : ''}</small>
                        </summary>
                        <div class="gd-dash-var-char-body" style="padding:0 6px 6px;max-height:240px;overflow-y:auto;"></div>
                    </details>
                `);
                const $body = $box.find('.gd-dash-var-char-body');
                for (const item of perChar) appendDashboardValue($body, item);
                $panel.append($box);
            }
        }
        if (log.length) {
            $panel.append(`<hr><b>${esc(t('recentUpdates'))}</b>`);
            for (const e of log) {
                const target = e.target ? ` / ${esc(chars().find(c => c.avatar === e.target)?.name || e.target)}` : '';
                $panel.append(`<small style="display:block;color:var(--grey70a);">${esc(e.id)}${target}: ${esc(formatValue(e.oldValue))} -> ${esc(formatValue(e.newValue))}${e.ignored ? ' (ignored)' : ''}</small>`);
            }
        }
    }

    function buildDashboardItems(all) {
        const items = [];
        for (const def of all) {
            if (def.scope === 'global') {
                const status = variableSystem.getValueStatus?.(def) || {};
                const latest = status.latest || latestUpdateFor(def);
                items.push({
                    key: def.id,
                    scope: 'global',
                    label: def.label,
                    def,
                    target: null,
                    targetName: '',
                    value: displayValueFor(def),
                    latest,
                    stale: !!status.stale,
                });
            } else {
                for (const c of visibleChars()) {
                    const status = variableSystem.getValueStatus?.(def, c.avatar) || {};
                    const latest = status.latest || latestUpdateFor(def, c.avatar);
                    items.push({
                        key: `${def.id}@@${c.avatar}`,
                        scope: 'character',
                        label: def.label,
                        def,
                        target: c.avatar,
                        targetName: c.name,
                        value: displayValueFor(def, c.avatar),
                        latest,
                        stale: !!status.stale,
                    });
                }
            }
        }
        return items;
    }

    function latestUpdateFor(def, target = null) {
        const log = variableSystem.getLog().slice().reverse();
        return log.find(e => e && !e.ignored && e.id === def.id && (target ? sameCharacterTarget(e.target, target) : !e.target)) || null;
    }

    function sameCharacterTarget(a, b) {
        if (!a || !b) return false;
        if (a === b) return true;
        const resolvedA = variableSystem.resolveAvatar?.(a) || a;
        const resolvedB = variableSystem.resolveAvatar?.(b) || b;
        return resolvedA === resolvedB;
    }

    function displayValueFor(def, target = null) {
        const value = variableSystem.getValue(def, target);
        if (value !== undefined && value !== null && formatValue(value) !== '') return value;
        const latest = latestUpdateFor(def, target);
        return latest ? latest.newValue : value;
    }

    function hasDashboardActivity(item) {
        if (item.stale) return true;
        if (item.value === undefined || item.value === null) return false;
        if (sameValue(item.value, item.def.defaultValue)) return false;
        return formatValue(item.value) !== '';
    }

    function appendDashboardIndex($panel, items) {
        if (!items.length) return;
        const $wrap = $(`<div class="gd-dash-var-index" style="border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:6px;margin-bottom:8px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:4px;max-height:180px;overflow-y:auto;"></div>`);
        for (const item of items) {
            const title = item.scope === 'character' ? `${item.targetName} / ${item.label}` : item.label;
            const $chip = $(`
                <div class="gd-dash-var-index-item" data-var-key="${esc(item.key)}" style="display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center;text-align:left;min-width:0;border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:5px 6px;cursor:pointer;background:rgba(127,127,127,0.06);">
                    <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(title)}</span>
                    <b style="max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${item.stale ? 'color:#d89b00;' : ''}" title="${esc(formatValue(item.value))}${item.stale ? ` (${staleLabel()})` : ''}">${item.stale ? '<i class="fa-solid fa-triangle-exclamation"></i> ' : ''}${esc(formatValue(item.value) || '-')}</b>
                    ${item.latest?.reason ? `<small style="grid-column:1 / -1;color:var(--grey70a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(item.latest.reason)}">${esc(item.latest.reason)}</small>` : ''}
                </div>
            `);
            $chip.on('click', () => focusDashboardVar(item.key));
            $wrap.append($chip);
        }
        $panel.append($wrap);
    }

    function appendDashboardValue($parent, item) {
        const { def, target, key, value, latest } = item;
        const $row = $(`
            <div class="gd-dash-var-row" data-var-key="${esc(key)}" style="display:grid;grid-template-columns:120px 1fr auto auto auto;gap:4px;align-items:center;margin-top:4px;">
                <span title="${esc(def.id)}">${esc(def.label)}</span>
                <span class="gd-dash-var-display" style="min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;border:1px solid transparent;padding:3px 4px;border-radius:4px;${item.stale ? 'color:#d89b00;' : ''}" title="${esc(formatValue(value))}${item.stale ? ` (${staleLabel()})` : ''}">${item.stale ? '<i class="fa-solid fa-triangle-exclamation"></i> ' : ''}${esc(formatValue(value) || '-')}</span>
                <span class="menu_button menu_button_icon gd-dash-var-edit"><i class="fa-solid fa-pen"></i></span>
                ${latest ? `<span class="menu_button menu_button_icon gd-dash-var-revert" title="${esc(revertLabel())}"><i class="fa-solid fa-rotate-left"></i></span>` : ''}
                <span class="menu_button menu_button_icon gd-dash-var-lock" title="${esc(t('lock'))}">${def.locked ? '<i class="fa-solid fa-lock"></i>' : '<i class="fa-solid fa-lock-open"></i>'}</span>
                ${item.stale ? `<small style="grid-column:2 / -1;color:#d89b00;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(staleLabel())}">${esc(staleLabel())}</small>` : ''}
                ${latest ? `<small style="grid-column:2 / -1;color:var(--grey70a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(latest.reason || latest.source || '')}">${esc(latest.source || '')}${latest.reason ? `: ${esc(latest.reason)}` : ''}</small>` : ''}
            </div>
        `);
        function enterEdit() {
            if ($row.data('editing')) return;
            $row.data('editing', true);
            const $input = $(`<input class="text_pole gd-dash-var-value" value="${esc(formatValue(displayValueFor(def, target)))}">`);
            const $save = $(`<span class="menu_button menu_button_icon gd-dash-var-save"><i class="fa-solid fa-floppy-disk"></i></span>`);
            const $cancel = $(`<span class="menu_button menu_button_icon gd-dash-var-cancel"><i class="fa-solid fa-xmark"></i></span>`);
            $row.find('.gd-dash-var-display').replaceWith($input);
            $row.find('.gd-dash-var-edit').replaceWith($save);
            $row.find('.gd-dash-var-lock').before($cancel);
            $input.trigger('focus').trigger('select');
            $save.on('click', () => {
                const parsed = tryParseJsonish($input.val(), def.type);
                if (!parsed.ok) {
                    toastr?.error?.(parsed.error);
                    return;
                }
                const result = variableSystem.setValue(def.id, parsed.value, { target, source: 'manual', updateMode: 'replace' });
                if (!result.ok) toastr?.error?.(result.error);
                else { toastr?.info?.(t('updated')); refresh(); }
            });
            $cancel.on('click', refresh);
            $input.on('keydown', (e) => {
                if (e.key === 'Enter' && def.type !== 'object' && def.type !== 'array') $save.trigger('click');
                if (e.key === 'Escape') refresh();
            });
        }
        $row.find('.gd-dash-var-display, .gd-dash-var-edit').on('click', enterEdit);
        $row.find('.gd-dash-var-lock').on('click', () => {
            variableSystem.upsertDefinition({ ...def, locked: !def.locked });
            refresh();
        });
        $row.find('.gd-dash-var-revert').on('click', () => {
            const result = variableSystem.revertValue?.(def.id, target);
            if (!result?.ok) toastr?.error?.(result?.error || 'revert failed');
            else { toastr?.info?.(t('updated')); refresh(); }
        });
        $parent.append($row);
    }

    function appendDashboardToolbar($panel, items = []) {
        const $bar = $(`
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
                <select id="gd-dash-var-jump" class="text_pole" style="width:auto;max-width:220px;">
                    <option value="">${esc(t('jumpPlaceholder'))}</option>
                </select>
                <select id="gd-dash-var-template" class="text_pole" style="width:auto;max-width:220px;">
                    <option value="">${esc(t('templatePlaceholder'))}</option>
                </select>
                <span class="menu_button menu_button_icon" id="gd-dash-var-add-template"><i class="fa-solid fa-wand-magic-sparkles"></i> ${esc(t('addTemplate'))}</span>
                <span class="menu_button menu_button_icon" id="gd-dash-var-new"><i class="fa-solid fa-plus"></i> ${esc(t('newVariable'))}</span>
                <span class="menu_button menu_button_icon" id="gd-dash-var-export"><i class="fa-solid fa-file-export"></i> ${esc(t('exportVars'))}</span>
                <span class="menu_button menu_button_icon" id="gd-dash-var-import"><i class="fa-solid fa-file-import"></i> ${esc(t('importVars'))}</span>
                <label class="checkbox_label" style="margin-left:4px;"><input type="checkbox" id="gd-dash-var-hide-inactive"> <span>${esc(hideInactiveLabel())}</span></label>
                <span style="flex:1"></span>
                <span class="menu_button menu_button_icon" id="gd-dash-var-open-settings"><i class="fa-solid fa-sliders"></i> ${esc(t('openSettings'))}</span>
            </div>
        `);
        $bar.find('#gd-dash-var-hide-inactive').prop('checked', hideInactiveCharacterRows).on('change', function () {
            hideInactiveCharacterRows = $(this).prop('checked');
            localStorage?.setItem(DASH_HIDE_INACTIVE_KEY, hideInactiveCharacterRows ? '1' : '0');
            renderDashboardVars();
        });
        const $jump = $bar.find('#gd-dash-var-jump');
        const globalShown = items.filter(item => item.scope === 'global');
        if (globalShown.length) {
            const $grp = $('<optgroup>').attr('label', t('global'));
            for (const item of globalShown) {
                $grp.append(`<option value="${esc(item.key)}">${esc(item.label)}</option>`);
            }
            $jump.append($grp);
        }
        const charShown = items.filter(item => item.scope === 'character');
        if (charShown.length) {
            const $grp = $('<optgroup>').attr('label', t('characters'));
            for (const item of charShown) {
                $grp.append(`<option value="${esc(item.key)}">${esc(item.targetName)} / ${esc(item.label)}</option>`);
            }
            $jump.append($grp);
        }
        const $sel = $bar.find('#gd-dash-var-template');
        for (const tpl of variableSystem.getTemplates()) {
            $sel.append(`<option value="${esc(tpl.id)}">${esc(tpl.label)} (${esc(tpl.scope === 'global' ? t('scopeGlobal') : t('scopeCharacter'))})</option>`);
        }
        $bar.find('#gd-dash-var-add-template').on('click', () => {
            const id = $sel.val();
            if (!id) return;
            const def = variableSystem.addTemplate(id);
            if (def) selectedId = def.id;
            refresh();
        });
        $bar.find('#gd-dash-var-new').on('click', () => {
            const n = defs().length + 1;
            const def = variableSystem.upsertDefinition({ id: `var_${n}`, label: `${t('variables')} ${n}`, scope: 'global', type: 'string', value: '', rule: '', showInDashboard: true });
            selectedId = def.id;
            refresh();
            openVariableSettings();
        });
        $bar.find('#gd-dash-var-export').on('click', () => variableSystem.exportToFile({ includeLog: true }));
        $bar.find('#gd-dash-var-import').on('click', importVariablesFromPicker);
        $bar.find('#gd-dash-var-open-settings').on('click', openVariableSettings);
        $jump.on('change', function () {
            const key = $(this).val();
            if (!key) return;
            focusDashboardVar(key);
            $(this).val('');
        });
        $panel.append($bar);
    }

    function focusDashboardVar(key) {
        const $panel = $('#gd-dash-panel-vars-list');
        const $row = $panel.find('.gd-dash-var-row').filter(function () {
            return $(this).attr('data-var-key') === key;
        }).first();
        if ($row.length) {
            const $details = $row.closest('details.gd-dash-var-char-group');
            if ($details.length) $details.prop('open', true);
            try { $row[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
            $row.css('outline', '2px solid var(--SmartThemeQuoteColor)');
            setTimeout(() => $row.css('outline', ''), 1000);
        }
    }

    function bindStandaloneImportExport() {
        $('#gd-var-export').off('click').on('click', () => variableSystem.exportToFile({ includeLog: true }));
        $('#gd-var-import').off('click').on('click', importVariablesFromPicker);
    }

    function importVariablesFromPicker() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.style.display = 'none';
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const result = await variableSystem.importFromFile(file, { mode: 'merge', includeLog: true });
                if (!result.ok) throw new Error(result.error);
                refresh();
                toastr?.success?.(t('imported', result.count || 0));
            } catch (e) {
                toastr?.error?.(t('importFailed', e.message || e));
            } finally {
                input.remove();
            }
        });
        document.body.appendChild(input);
        input.click();
    }

    function openVariableSettings() {
        const $card = $('[data-card="variables"]').first();
        if (!$card.length) return;
        const $drawer = $card.closest('.inline-drawer-content');
        const $drawerRoot = $card.closest('.inline-drawer');
        if ($drawer.length && !$drawer.is(':visible')) {
            $drawer.show();
            $drawerRoot.find('> .inline-drawer-toggle .inline-drawer-icon')
                .removeClass('fa-circle-chevron-right')
                .addClass('fa-circle-chevron-down down');
        }
        if (!$card.hasClass('is-expanded')) {
            $card.addClass('is-expanded');
            $card.find('> .gd-card-body').show();
        }
        try { $card[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
    }

    function refresh() {
        applyStaticLabels();
        renderTemplates();
        renderList();
        $('#gd-var-editor').hide().empty();
        renderMaintenancePreview();
        renderDashboardVars();
    }

    $('#gd-var-add').on('click', () => {
        const n = defs().length + 1;
        const def = variableSystem.upsertDefinition({ id: `var_${n}`, label: `${t('variables')} ${n}`, scope: 'global', type: 'string', value: '', rule: '', showInDashboard: true });
        selectedId = def.id;
        refresh();
    });
    $('#gd-var-add-template').on('click', () => {
        const id = $('#gd-var-template').val();
        if (!id) return;
        const def = variableSystem.addTemplate(id);
        if (def) selectedId = def.id;
        refresh();
    });
    $('#gd-var-refresh').on('click', refresh);
    bindStandaloneImportExport();
    $('#gd-dash-vars').on('click', () => {
        if (!getCurrentGroup?.()) {
            $('#gd-dash-panel-vars').hide();
            return;
        }
        $('#gd-dash-panel-vars').toggle();
        renderDashboardVars();
    });
    $('.gd-dash-panel-close[data-panel="vars"]').on('click', () => $('#gd-dash-panel-vars').hide());

    window.__gdRefreshVariables = refresh;
    refresh();
});
