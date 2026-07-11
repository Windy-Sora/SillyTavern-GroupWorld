import { registerSection } from './registry.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../popup.js';

registerSection('configProfiles', function (ctx) {
    const { settings, $c, saveSettings, toastr, configProfileSystem, getConfigPresetNames, loadConfigPreset } = ctx;
    if (!configProfileSystem) return;

    const sys = configProfileSystem;
    const isZh = () => (settings.lang || 'zh') === 'zh';

    // ── Drawer checkboxes state ──────────────────────────────────────

    const drawerDefaults = {
        directorLlm: true,
        worldBooks: true,
        profilesAndData: true,
        contextLedger: true,
        multimodal: false,
        assetManager: false,
        agentsTools: true,
    };

    function getDrawerSelection() {
        const sel = {};
        for (const k of Object.keys(drawerDefaults)) {
            sel[k] = $c(`cfg-drawer-${k}`).prop('checked') || false;
        }
        return sel;
    }

    // ── Render profile list ──────────────────────────────────────────

    function renderList() {
        const $list = $('#gd-config-profiles-list');
        if (!$list.length) return;

        const profiles = sys.getProfiles();
        if (!profiles.length) {
            $list.html(`<small style="color:var(--grey70a);">${isZh() ? '暂无配置档，点击"保存当前为配置档"创建' : 'No config profiles. Click "Save current as profile" to create one.'}</small>`);
            return;
        }

        let html = '';
        profiles.forEach(p => {
            const dateStr = new Date(p.createdAt).toLocaleString();
            const drawerCount = Object.values(p.drawers).filter(Boolean).length;
            html += `<div class="gd-config-profile-card" data-id="${escAttr(p.id)}" style="border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:8px;margin-top:6px;">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <div style="flex:1;min-width:0;">
                        <b>${escHtml(p.name)}</b>
                        <small style="color:var(--grey70a);display:block;">${escHtml(p.description || '')}</small>
                        <small style="color:var(--grey70a);font-size:0.75em;">${dateStr} · ${drawerCount} ${isZh() ? '个抽屉' : 'drawers'}</small>
                    </div>
                    <div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px;">
                        <span class="menu_button menu_button_icon gd-cfg-apply-btn" data-id="${escAttr(p.id)}" style="font-size:0.8em;color:#4caf50;">
                            <i class="fa-solid fa-check"></i> ${isZh() ? '应用' : 'Apply'}
                        </span>
                        <span class="menu_button menu_button_icon gd-cfg-export-btn" data-id="${escAttr(p.id)}" style="font-size:0.8em;">
                            <i class="fa-solid fa-file-zipper"></i> ${isZh() ? '导出' : 'Export'}
                        </span>
                        <span class="menu_button menu_button_icon gd-cfg-delete-btn" data-id="${escAttr(p.id)}" style="font-size:0.75em;color:#ff5555;">
                            <i class="fa-solid fa-trash"></i>
                        </span>
                    </div>
                </div>
            </div>`;
        });
        $list.html(html);

        // Apply
        $list.find('.gd-cfg-apply-btn').off('click').on('click', async function () {
            const id = $(this).data('id');
            const profile = sys.getProfiles().find(p => p.id === id);
            if (!profile) return;
            if (!await callGenericPopup(isZh()
                ? `应用配置档「${profile.name}」？当前设置将被覆盖。`
                : `Apply config profile "${profile.name}"? Current settings will be overwritten.`, POPUP_TYPE.CONFIRM)) return;

            // Check for customPrompt conflicts before applying
            const incoming = profile.settings?.customPrompts;
            let mergeMode = 'keep';
            if (incoming && Array.isArray(incoming) && incoming.length > 0) {
                const existing = (settings.customPrompts || []);
                const existingNames = new Set(existing.map(e => e.name));
                const conflicts = incoming.filter(e => existingNames.has(e.name)).map(e => e.name);
                if (conflicts.length > 0) {
                    const msg = isZh()
                        ? `检测到 ${conflicts.length} 个同名自定义 Prompt：${conflicts.join(', ')}。\n\n点"确定"保留现有（仅添加不同名的），点"取消"跳过全部自定义 Prompt 导入。`
                        : `Found ${conflicts.length} custom prompt(s) with same name: ${conflicts.join(', ')}.\n\nOK = keep existing + add only different names. Cancel = skip all custom prompts.`;
                    const choice = await callGenericPopup(msg, POPUP_TYPE.CONFIRM);
                    if (!choice) {
                        mergeMode = 'skip';
                    }
                }
            }

            const result = sys.applyProfile(id, mergeMode);
            await window.__gdReloadExtension?.();
            let msg = isZh()
                ? `已应用「${profile.name}」，${result.changed.length} 项设置已更新。`
                : `Applied "${profile.name}", ${result.changed.length} setting(s) updated.`;
            if (result.customPromptConflicts?.length > 0) {
                msg += isZh()
                    ? ` ${result.customPromptConflicts.length} 个同名 Prompt 已保留现有。`
                    : ` ${result.customPromptConflicts.length} same-name prompt(s) kept existing.`;
            }
            if (mergeMode === 'skip') {
                msg += isZh() ? ' 自定义 Prompt 未导入。' : ' Custom prompts not imported.';
            }
            toastr.success(msg);
        });

        // Export
        $list.find('.gd-cfg-export-btn').off('click').on('click', async function () {
            const id = $(this).data('id');
            const btn = $(this); btn.prop('disabled', true);
            try {
                await sys.exportProfileAsZip(id);
                toastr.success(isZh() ? '配置档已导出为 .zip' : 'Config profile exported as .zip');
            } catch (e) {
                toastr.error((isZh() ? '导出失败: ' : 'Export failed: ') + e.message);
            } finally { btn.prop('disabled', false); }
        });

        // Delete
        $list.find('.gd-cfg-delete-btn').off('click').on('click', async function () {
            const id = $(this).data('id');
            const profile = sys.getProfiles().find(p => p.id === id);
            if (!profile) return;
            if (!await callGenericPopup(isZh() ? `删除配置档「${profile.name}」？` : `Delete config profile "${profile.name}"?`, POPUP_TYPE.CONFIRM)) return;
            sys.deleteProfile(id);
            renderList();
            populatePresetDropdown();
            window.__gdRefreshDashboard?.();
            toastr.info(isZh() ? '已删除' : 'Deleted');
        });
    }

    // ── Save current ─────────────────────────────────────────────────

    $c('cfg-save-btn').off('click').on('click', function () {
        const name = $c('cfg-save-name').val().trim();
        if (!name) {
            toastr.warning(isZh() ? '请输入配置档名称' : 'Enter a profile name');
            return;
        }
        const desc = $c('cfg-save-desc').val().trim();
        const drawers = getDrawerSelection();
        if (!Object.values(drawers).some(Boolean)) {
            toastr.warning(isZh() ? '请至少选择一个抽屉' : 'Select at least one drawer');
            return;
        }
        sys.saveCurrentAsProfile(name, desc, drawers);
        $c('cfg-save-name').val('');
        $c('cfg-save-desc').val('');
        renderList();
        populatePresetDropdown();
        window.__gdRefreshDashboard?.();
        toastr.success(isZh() ? `配置档「${name}」已保存` : `Config profile "${name}" saved`);
    });

    // ── Import .zip ──────────────────────────────────────────────────

    $c('cfg-import-file').off('change').on('change', async function () {
        const file = this.files[0];
        if (!file) return;
        const btn = $c('cfg-import-btn'); btn.prop('disabled', true);
        try {
            const isJson = file.name.endsWith('.json');
            const profile = isJson
                ? await sys.importProfileFromJson(file)
                : await sys.importProfileFromZip(file);
            renderList();
            populatePresetDropdown();
            window.__gdRefreshDashboard?.();
            toastr.success(isZh() ? `已导入配置档「${profile.name}」` : `Config profile "${profile.name}" imported`);
        } catch (e) {
            toastr.error((isZh() ? '导入失败: ' : 'Import failed: ') + e.message);
        } finally { btn.prop('disabled', false); this.value = ''; }
    });

    $c('cfg-import-btn').off('click').on('click', async () => {
        const ok = await callGenericPopup(
            isZh()
                ? '<b>安全警告</b><br>配置档可能包含可执行脚本（脚本执行器、Provider）。恶意代码可窃取聊天记录、API 密钥。请仅导入你完全信任的来源。'
                : '<b>Security Warning</b><br>Config profiles may contain executable scripts (executors, providers). Malicious code can steal chat logs and API keys. Only import from trusted sources.',
            POPUP_TYPE.CONFIRM,
        );
        if (!ok) return;
        $('#gd-cfg-import-file').click();
    });

    // ── Preset dropdown ───────────────────────────────────────────────
    const PROF_PREFIX = '__prof__:';

    function populatePresetDropdown() {
        const $sel = $c('cfg-preset');
        if (!$sel.length) return;
        const current = $sel.val();
        $sel.find('option:not(:first)').remove();
        $sel.find('optgroup').remove();
        // System presets
        const presets = getConfigPresetNames();
        if (presets.length) {
            const $grp = $('<optgroup>').attr('label', isZh() ? '内置配置档' : 'System Presets');
            for (const name of presets) {
                $grp.append(`<option value="${escAttr(name)}">${escHtml(name)}</option>`);
            }
            $sel.append($grp);
        }
        // User profiles
        const profiles = sys.getProfiles();
        if (profiles.length) {
            const $grp = $('<optgroup>').attr('label', isZh() ? '我的配置档' : 'My Profiles');
            for (const p of profiles) {
                $grp.append(`<option value="${PROF_PREFIX}${escAttr(p.id)}">${escHtml(p.name)}</option>`);
            }
            $sel.append($grp);
        }
        if (current) $sel.val(current);
    }

    populatePresetDropdown();

    $c('cfg-preset').off('change').on('change', async function () {
        const rawValue = $(this).val();
        if (!rawValue) return;
        const btn = $(this); btn.prop('disabled', true);
        try {
            if (rawValue.startsWith(PROF_PREFIX)) {
                // User profile — just select it (user can then click apply on the card)
                $(this).val(rawValue);
            } else {
                // System preset — load to list
                await loadConfigPreset(rawValue);
                renderList();
                populatePresetDropdown();
                window.__gdRefreshDashboard?.();
                toastr.success(isZh() ? `已加载「${rawValue}」` : `"${rawValue}" loaded`);
                $(this).val('');
            }
        } catch (e) {
            toastr.error((isZh() ? '加载失败: ' : 'Load failed: ') + e.message);
        } finally { btn.prop('disabled', false); }
    });

    // ── Initial ──────────────────────────────────────────────────────

    renderList();
    window.__gdRefreshConfigList = renderList;
});

function escHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
}
