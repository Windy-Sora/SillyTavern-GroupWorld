import { registerSection } from './registry.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../popup.js';

function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readFileText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('File read failed'));
        reader.readAsText(file);
    });
}

function formatValue(value) {
    if (value === undefined || value === null || value === '') return '<span class="gd-muted">(empty)</span>';
    if (Array.isArray(value)) {
        if (!value.length) return '<span class="gd-muted">(empty)</span>';
        return `<ul class="gd-story-value-list">${value.map(v => `<li>${formatValue(v)}</li>`).join('')}</ul>`;
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value);
        if (!entries.length) return '<span class="gd-muted">{}</span>';
        return `<div class="gd-story-subfields">${entries.map(([k, v]) => `
            <div class="gd-story-subfield">
                <span class="gd-story-subfield-key">${esc(k)}</span>
                <span class="gd-story-subfield-value">${formatValue(v)}</span>
            </div>`).join('')}</div>`;
    }
    return esc(value);
}

function encodeAttr(value) {
    return esc(value).replace(/'/g, '&#39;');
}

registerSection('storyBlueprint', function (ctx) {
    const { settings, $c, saveSettings, storyBlueprintSystem, toastr, isRoundActive } = ctx;
    if (!storyBlueprintSystem) return;
    let viewedStepIndex = null;

    function langZh() { return (settings.lang || 'zh') === 'zh'; }

    function syncControls() {
        $c('story-blueprint-enabled').prop('checked', !!settings.storyBlueprintEnabled);
        $c('story-blueprint-auto-continue').prop('checked', !!settings.storyBlueprintAutoContinue);
        $c('story-blueprint-mode').val(settings.storyBlueprintProgressionMode || 'leaf');
        $c('story-blueprint-level').val(settings.storyBlueprintProgressionLevel ?? 0);
        $c('story-blueprint-var').val(storyBlueprintSystem.getCompletionVariable());
        $c('story-blueprint-max-nodes').val(settings.storyBlueprintMaxNodes ?? 8);
        $c('story-blueprint-prompt').val(settings.storyBlueprintPrompt || storyBlueprintSystem.getDefaultPrompt());
        $c('story-blueprint-continue-prompt').val(settings.storyBlueprintContinuePrompt || storyBlueprintSystem.getDefaultContinuePrompt());
        $c('story-blueprint-schema').val(settings.storyBlueprintJsonSchema || storyBlueprintSystem.getDefaultSchema());
        $c('story-blueprint-template').val(settings.storyBlueprintProviderTemplate || storyBlueprintSystem.getDefaultTemplate());
        $c('story-blueprint-level-row').toggle((settings.storyBlueprintProgressionMode || 'leaf') === 'level');
    }

    function renderTree() {
        const progress = storyBlueprintSystem.getProgress();
        const $list = $c('story-blueprint-tree');
        $list.empty();
        if (!progress.steps.length) {
            $list.append(`<div class="gd-muted">${langZh() ? '没有可推进节点' : 'No progression steps'}</div>`);
            return;
        }
        for (let i = 0; i < progress.steps.length; i++) {
            const step = progress.steps[i];
            const state = i < progress.doneCount ? '✓' : i === progress.doneCount && !progress.complete ? '●' : '○';
            const cls = [
                i < progress.doneCount ? 'gd-step-done' : i === progress.doneCount && !progress.complete ? 'gd-step-current' : '',
                viewedStepIndex === i ? 'gd-step-viewing' : '',
            ].filter(Boolean).join(' ');
            const $row = $(`<div class="gd-story-step ${cls}" style="padding-left:${Math.min(step.depth * 14, 56)}px;" title="${langZh() ? '点击查看节点内容' : 'Click to view node content'}">
                <span class="gd-story-step-state">${state}</span>
                <span class="gd-story-step-title">${esc(step.pathText)}</span>
                <span class="gd-story-step-actions">
                    <span class="menu_button menu_button_icon gd-story-set-current" data-index="${i}" title="${langZh() ? '设为当前' : 'Set current'}"><i class="fa-solid fa-location-dot"></i></span>
                    <span class="menu_button menu_button_icon gd-story-edit-step" data-index="${i}" title="${langZh() ? '改标题' : 'Edit title'}"><i class="fa-solid fa-pen-to-square"></i></span>
                    <span class="menu_button menu_button_icon gd-story-delete-step" data-index="${i}" title="${langZh() ? '删除节点' : 'Delete step'}"><i class="fa-solid fa-trash"></i></span>
                </span>
            </div>`);
            $row.on('click', () => {
                viewedStepIndex = i;
                refresh();
            });
            $row.find('.gd-story-set-current').on('click', async (ev) => {
                ev.stopPropagation();
                storyBlueprintSystem.setCurrentStep(i);
                viewedStepIndex = null;
                refresh();
            });
            $row.find('.gd-story-edit-step').on('click', async (ev) => {
                ev.stopPropagation();
                const currentTitle = step.node?.title || step.id || '';
                const nextTitle = await callGenericPopup(
                    langZh() ? '<b>编辑节点标题</b>' : '<b>Edit Step Title</b>',
                    POPUP_TYPE.INPUT,
                    currentTitle,
                    { placeholder: langZh() ? '例如：第1章' : 'e.g. Chapter 1' },
                );
                if (nextTitle === null || nextTitle === false) return;
                try {
                    storyBlueprintSystem.updateStepTitle(i, nextTitle);
                    viewedStepIndex = i;
                    toastr.success(langZh() ? '节点标题已保存' : 'Step title saved');
                    refresh();
                } catch (e) {
                    toastr.error(e.message || (langZh() ? '保存失败' : 'Save failed'));
                }
            });
            $row.find('.gd-story-delete-step').on('click', async (ev) => {
                ev.stopPropagation();
                const title = step.pathText || step.id;
                if (!await callGenericPopup(
                    langZh() ? `删除节点「${esc(title)}」？` : `Delete step "${esc(title)}"?`,
                    POPUP_TYPE.CONFIRM,
                )) return;
                try {
                    storyBlueprintSystem.deleteStep(i);
                    const nextProgress = storyBlueprintSystem.getProgress();
                    if (viewedStepIndex === i || viewedStepIndex >= nextProgress.steps.length) viewedStepIndex = null;
                    toastr.info(langZh() ? '节点已删除' : 'Step deleted');
                    refresh();
                } catch (e) {
                    toastr.error(e.message || (langZh() ? '删除失败' : 'Delete failed'));
                }
            });
            $list.append($row);
        }
    }

    function parseEditedValue(raw, oldValue) {
        if (Array.isArray(oldValue) || (oldValue && typeof oldValue === 'object')) {
            return JSON.parse(raw || (Array.isArray(oldValue) ? '[]' : '{}'));
        }
        if (typeof oldValue === 'number') {
            const n = Number(raw);
            if (!Number.isFinite(n)) throw new Error('not a number');
            return n;
        }
        if (typeof oldValue === 'boolean') {
            const s = String(raw).trim().toLowerCase();
            if (['true', '1', 'yes', 'on'].includes(s)) return true;
            if (['false', '0', 'no', 'off'].includes(s)) return false;
            throw new Error('not a boolean');
        }
        return raw;
    }

    function bindInlineEditors($card, blueprint, current) {
        $card.find('.gd-story-editable').on('click', function () {
            const $field = $(this);
            if ($field.find('textarea').length) return;
            const scope = $field.data('scope');
            const key = String($field.data('key') || '');
            const bucket = scope === 'meta' ? blueprint.meta : current.content;
            if (!bucket || !key) return;
            const oldValue = bucket[key];
            const oldText = typeof oldValue === 'string' ? oldValue : JSON.stringify(oldValue, null, 2);
            const $editor = $(`<textarea class="text_pole textarea_compact gd-story-inline-editor" rows="4"></textarea>`);
            $editor.val(oldText ?? '');
            $field.empty().append($editor);
            $editor.trigger('focus');

            let saved = false;
            const save = () => {
                if (saved) return;
                saved = true;
                try {
                    bucket[key] = parseEditedValue($editor.val(), oldValue);
                    storyBlueprintSystem.setBlueprint(blueprint, { resetProgress: false });
                    toastr.success(langZh() ? '字段已保存' : 'Field saved');
                    refresh();
                } catch (e) {
                    saved = false;
                    toastr.error(`${langZh() ? '保存失败' : 'Save failed'}: ${e.message}`);
                    $editor.trigger('focus');
                }
            };
            $editor.on('blur', save);
            $editor.on('keydown', (ev) => {
                if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
                    ev.preventDefault();
                    save();
                }
                if (ev.key === 'Escape') {
                    saved = true;
                    refresh();
                }
            });
        });
    }

    function bindBlueprintTitleEditor($card, blueprint) {
        $card.find('.gd-story-title-editable').on('click', function () {
            const $field = $(this);
            if ($field.find('input').length) return;
            const oldTitle = blueprint.title || '';
            const $editor = $(`<input type="text" class="text_pole gd-story-title-input" style="width:100%;">`);
            $editor.val(oldTitle);
            $field.empty().append($editor);
            $editor.trigger('focus').trigger('select');

            let saved = false;
            const save = () => {
                if (saved) return;
                saved = true;
                const nextTitle = String($editor.val() || '').trim() || 'Story Blueprint';
                try {
                    blueprint.title = nextTitle;
                    storyBlueprintSystem.setBlueprint(blueprint, { resetProgress: false });
                    toastr.success(langZh() ? '蓝图标题已保存' : 'Blueprint title saved');
                    refresh();
                } catch (e) {
                    saved = false;
                    toastr.error(`${langZh() ? '保存失败' : 'Save failed'}: ${e.message}`);
                    $editor.trigger('focus');
                }
            };
            $editor.on('blur', save);
            $editor.on('keydown', (ev) => {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    save();
                }
                if (ev.key === 'Escape') {
                    saved = true;
                    refresh();
                }
            });
        });
    }

    function renderCurrentCard(data, progress) {
        const $card = $c('story-blueprint-current-card');
        $card.empty();
        const viewedStep = Number.isInteger(viewedStepIndex) ? progress.steps[viewedStepIndex] : null;
        const currentInfo = viewedStep ? {
            id: viewedStep.id,
            depth: viewedStep.depth,
            path: viewedStep.pathText,
            node: viewedStep.node,
            nodeJson: JSON.stringify(viewedStep.node, null, 2),
            content: viewedStep.node?.content || {},
        } : data.current;
        const current = currentInfo?.node || null;
        const blueprint = data.blueprint || null;
        if (!blueprint) {
            $card.append(`<div class="gd-story-empty">${langZh() ? '尚未生成故事蓝图。' : 'No Story Blueprint generated yet.'}</div>`);
            return;
        }
        if (!current && !progress.complete) {
            $card.append(`<div class="gd-story-empty">${langZh() ? '蓝图存在，但当前推进模式没有匹配的节点。请调整推进模式或层级。' : 'Blueprint loaded, but the current progression mode has no matching nodes. Adjust mode or level.'}</div>`);
            return;
        }
        if (progress.complete && !viewedStep) {
            $card.append(`<div class="gd-story-empty">${langZh() ? '当前蓝图已完成。' : 'The current blueprint is complete.'}</div>`);
            return;
        }
        const content = current.content && typeof current.content === 'object' ? current.content : {};
        const fields = Object.entries(content);
        const meta = blueprint.meta && typeof blueprint.meta === 'object' ? blueprint.meta : {};

        $card.append(`
            <div class="gd-story-overview">
                <div>
                    <div class="gd-story-kicker">${langZh() ? '故事' : 'Story'}</div>
                    <div class="gd-story-title gd-story-title-editable" title="${langZh() ? '点击编辑标题' : 'Click to edit title'}">${esc(blueprint.title || 'Story Blueprint')}</div>
                </div>
                <div class="gd-story-progress-pill">${progress.doneCount}/${progress.total}</div>
            </div>
            <div class="gd-story-path">${esc(currentInfo?.path || '')}</div>
            ${viewedStep ? `<div class="gd-story-path">${langZh() ? '正在查看节点，不改变当前进度' : 'Viewing node without changing progress'}</div>` : ''}
            <div class="gd-story-node-head">
                <span class="gd-story-node-type">${esc(current.type || 'node')}</span>
                <span class="gd-story-node-title">${esc(current.title || current.id || '')}</span>
            </div>
        `);
        bindBlueprintTitleEditor($card, blueprint);

        if (Object.keys(meta).length) {
            $card.append(`<div class="gd-story-section-title">${langZh() ? '蓝图 Meta' : 'Blueprint Meta'}</div>`);
            $card.append(`<div class="gd-story-field-grid">${Object.entries(meta).map(([k, v]) => `
                <div class="gd-story-field">
                    <div class="gd-story-field-label">${esc(k)}</div>
                    <div class="gd-story-field-value gd-story-editable" data-scope="meta" data-key="${encodeAttr(k)}" title="${langZh() ? '点击编辑，失焦自动保存' : 'Click to edit, blur to autosave'}">${formatValue(v)}</div>
                </div>`).join('')}</div>`);
        }

        $card.append(`<div class="gd-story-section-title">${langZh() ? '当前节点内容' : 'Current Node Content'}</div>`);
        if (!fields.length) {
            $card.append(`<div class="gd-muted">${langZh() ? '当前节点没有 content 字段。' : 'This node has no content fields.'}</div>`);
            bindInlineEditors($card, blueprint, current);
            return;
        }
        $card.append(`<div class="gd-story-field-grid">${fields.map(([k, v]) => `
            <div class="gd-story-field">
                <div class="gd-story-field-label">${esc(k)}</div>
                <div class="gd-story-field-value gd-story-editable" data-scope="content" data-key="${encodeAttr(k)}" title="${langZh() ? '点击编辑，失焦自动保存' : 'Click to edit, blur to autosave'}">${formatValue(v)}</div>
            </div>`).join('')}</div>`);
        bindInlineEditors($card, blueprint, current);
    }

    function refresh() {
        const state = storyBlueprintSystem.getState();
        const blueprint = storyBlueprintSystem.getBlueprint();
        const progress = storyBlueprintSystem.getProgress();
        const data = storyBlueprintSystem.getProviderData();
        const varName = storyBlueprintSystem.getCompletionVariable();
        const doneValue = progress.completionValue === true ? 'true' : 'false';

        const progressLabel = progress.total
            ? `${progress.doneCount}/${progress.total} | ${progress.complete ? (langZh() ? '已完成' : 'complete') : (data.current?.path || '')}`
            : (langZh() ? '当前推进模式无匹配节点' : 'No matching progression steps');
        const pendingLabel = state.continuePending ? ` | ${langZh() ? '续写中' : 'continuing'}` : '';
        $c('story-blueprint-status').text(blueprint
            ? `${blueprint.title || 'Story Blueprint'} | ${progressLabel}${pendingLabel} | ${varName}=${doneValue}`
            : (langZh() ? '未加载故事蓝图' : 'No Story Blueprint loaded'));

        $c('story-blueprint-json').val(blueprint ? JSON.stringify(blueprint, null, 2) : '');
        renderCurrentCard(data, progress);
        $c('story-blueprint-provider-preview').val(storyBlueprintSystem.renderCurrent());
        $c('story-blueprint-signals').val(JSON.stringify(state.doneSignals || [], null, 2));
        $c('story-blueprint-last-error').text(state.lastError || '');
        $c('story-blueprint-card-status').text(blueprint ? `${progress.doneCount}/${progress.total}` : 'empty');
        renderTree();
        window.__gdRefreshDashboard?.();
    }

    syncControls();
    refresh();
    window.__gdRefreshStoryBlueprint = refresh;

    $c('story-blueprint-refresh').on('click', () => {
        refresh();
        toastr.info(langZh() ? '故事蓝图已刷新' : 'Story Blueprint refreshed');
    });

    $('[data-card="storyBlueprint"] > .gd-card-header').on('click', () => {
        setTimeout(() => {
            if ($('[data-card="storyBlueprint"]').hasClass('is-expanded')) refresh();
        }, 220);
    });

    $c('story-blueprint-enabled').on('change', () => {
        settings.storyBlueprintEnabled = !!$c('story-blueprint-enabled').prop('checked');
        if (settings.storyBlueprintEnabled) storyBlueprintSystem.ensureCompletionVariable();
        storyBlueprintSystem.clearCompletionSignal(settings.storyBlueprintEnabled ? 'enabled-reset' : 'disabled-reset');
        saveSettings();
        refresh();
    });

    $c('story-blueprint-auto-continue').on('change', () => {
        settings.storyBlueprintAutoContinue = !!$c('story-blueprint-auto-continue').prop('checked');
        saveSettings();
    });

    $c('story-blueprint-mode').on('change', () => {
        settings.storyBlueprintProgressionMode = $c('story-blueprint-mode').val() || 'leaf';
        $c('story-blueprint-level-row').toggle(settings.storyBlueprintProgressionMode === 'level');
        saveSettings();
        refresh();
    });

    $c('story-blueprint-level').on('input', () => {
        settings.storyBlueprintProgressionLevel = Math.max(0, parseInt($c('story-blueprint-level').val()) || 0);
        saveSettings();
        refresh();
    });

    $c('story-blueprint-var').on('change blur', () => {
        settings.storyBlueprintCompletionVariable = storyBlueprintSystem.normalizeCompletionVariable($c('story-blueprint-var').val());
        $c('story-blueprint-var').val(settings.storyBlueprintCompletionVariable);
        storyBlueprintSystem.ensureCompletionVariable();
        saveSettings();
        refresh();
    });

    $c('story-blueprint-max-nodes').on('input', () => {
        settings.storyBlueprintMaxNodes = Math.max(1, parseInt($c('story-blueprint-max-nodes').val()) || 8);
        saveSettings();
    });

    $c('story-blueprint-prompt').on('input', () => { settings.storyBlueprintPrompt = $c('story-blueprint-prompt').val(); saveSettings(); });
    $c('story-blueprint-continue-prompt').on('input', () => { settings.storyBlueprintContinuePrompt = $c('story-blueprint-continue-prompt').val(); saveSettings(); });
    $c('story-blueprint-schema').on('input', () => { settings.storyBlueprintJsonSchema = $c('story-blueprint-schema').val(); saveSettings(); });
    $c('story-blueprint-template').on('input', () => {
        settings.storyBlueprintProviderTemplate = $c('story-blueprint-template').val();
        saveSettings();
        $c('story-blueprint-provider-preview').val(storyBlueprintSystem.renderCurrent());
    });

    $c('story-blueprint-template-reset').on('click', () => {
        settings.storyBlueprintProviderTemplate = '';
        $c('story-blueprint-template').val(storyBlueprintSystem.getDefaultTemplate());
        saveSettings();
        refresh();
    });

    $c('story-blueprint-prompt-reset').on('click', () => {
        settings.storyBlueprintPrompt = '';
        $c('story-blueprint-prompt').val(storyBlueprintSystem.getDefaultPrompt());
        saveSettings();
        toastr.info(langZh() ? '已恢复默认生成 Prompt' : 'Generation prompt reset to default');
    });

    $c('story-blueprint-continue-prompt-reset').on('click', () => {
        settings.storyBlueprintContinuePrompt = '';
        $c('story-blueprint-continue-prompt').val(storyBlueprintSystem.getDefaultContinuePrompt());
        saveSettings();
        toastr.info(langZh() ? '已恢复默认续写 Prompt' : 'Continuation prompt reset to default');
    });

    $c('story-blueprint-schema-reset').on('click', () => {
        settings.storyBlueprintJsonSchema = '';
        $c('story-blueprint-schema').val(storyBlueprintSystem.getDefaultSchema());
        saveSettings();
    });

    async function runGenerate(mode) {
        if (isRoundActive?.()) return;
        const id = mode === 'continue' ? 'story-blueprint-continue' : 'story-blueprint-generate';
        $c(id).prop('disabled', true);
        try {
            await storyBlueprintSystem.generateBlueprint(mode);
            toastr.success(mode === 'continue'
                ? (langZh() ? '故事蓝图已续写' : 'Story Blueprint continued')
                : (langZh() ? '故事蓝图已生成' : 'Story Blueprint generated'));
            refresh();
        } catch (e) {
            toastr.error(e.message || (langZh() ? '故事蓝图生成失败' : 'Story Blueprint generation failed'));
            refresh();
        } finally {
            $c(id).prop('disabled', false);
        }
    }

    $c('story-blueprint-new').on('click', async () => {
        if (storyBlueprintSystem.getBlueprint()) {
            const ok = await callGenericPopup(
                langZh() ? '新建蓝图会替换当前故事蓝图并重置进度，继续？' : 'Create a new blueprint and reset current progress?',
                POPUP_TYPE.CONFIRM,
            );
            if (!ok) return;
        }
        storyBlueprintSystem.createBlankBlueprint();
        viewedStepIndex = 0;
        toastr.success(langZh() ? '已新建空白故事蓝图' : 'Blank Story Blueprint created');
        refresh();
    });

    $c('story-blueprint-add-chapter').on('click', () => {
        storyBlueprintSystem.appendBlankChapter();
        const progress = storyBlueprintSystem.getProgress();
        viewedStepIndex = Math.max(0, progress.steps.length - 1);
        toastr.success(langZh() ? '已添加章节' : 'Chapter added');
        refresh();
    });

    $c('story-blueprint-generate').on('click', () => runGenerate('new'));
    $c('story-blueprint-continue').on('click', () => runGenerate('continue'));
    $c('story-blueprint-raw-toggle').on('click', () => $c('story-blueprint-raw-panel').slideToggle(160));

    $c('story-blueprint-save-json').on('click', () => {
        try {
            const parsed = JSON.parse($c('story-blueprint-json').val() || '{}');
            const valid = storyBlueprintSystem.validateBlueprintInput(parsed);
            if (!valid.ok) throw new Error(valid.error);
            storyBlueprintSystem.setBlueprint(valid.blueprint, { resetProgress: false });
            toastr.success(langZh() ? '故事蓝图已保存' : 'Story Blueprint saved');
            refresh();
        } catch (e) {
            toastr.error(`Invalid JSON: ${e.message}`);
        }
    });

    $c('story-blueprint-reset-progress').on('click', async () => {
        if (!await callGenericPopup(langZh() ? '重置故事蓝图进度？' : 'Reset Story Blueprint progress?', POPUP_TYPE.CONFIRM)) return;
        storyBlueprintSystem.resetProgress();
        refresh();
    });

    $c('story-blueprint-rollback').on('click', () => {
        if (storyBlueprintSystem.rollbackOne()) toastr.info(langZh() ? '已回滚一步' : 'Rolled back one step');
        refresh();
    });

    $c('story-blueprint-health').on('click', () => {
        const result = storyBlueprintSystem.healthCheck();
        const text = result.ok ? (langZh() ? '蓝图检查通过' : 'Blueprint looks valid') : result.issues.join('\n');
        toastr[result.ok ? 'success' : 'warning'](text);
        $c('story-blueprint-health-result').text(text);
    });

    $c('story-blueprint-clear').on('click', async () => {
        if (!await callGenericPopup(langZh() ? '删除当前故事蓝图和进度？' : 'Delete current Story Blueprint and progress?', POPUP_TYPE.CONFIRM)) return;
        storyBlueprintSystem.resetBlueprint();
        refresh();
    });

    $c('story-blueprint-export').on('click', () => {
        downloadJson('group-director-story-blueprint.json', storyBlueprintSystem.buildExportFile(true));
    });

    $c('story-blueprint-import').on('click', () => $c('story-blueprint-import-file').trigger('click'));
    $c('story-blueprint-import-file').on('change', async function () {
        const file = this.files?.[0];
        if (!file) return;
        try {
            const text = await readFileText(file);
            const result = storyBlueprintSystem.applyImportText(text, { includeProgress: true });
            if (!result.ok) throw new Error(result.error);
            toastr.success(langZh() ? '故事蓝图已导入' : 'Story Blueprint imported');
            refresh();
        } catch (e) {
            toastr.error(e.message || (langZh() ? '导入失败' : 'Import failed'));
        } finally {
            this.value = '';
        }
    });
});
