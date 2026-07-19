import { registerSection } from './registry.js';
import { DEFAULT_NPC_PROMPT } from '../../agents/npc.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../popup.js';

registerSection('npc', function (ctx) {
    const { settings, $c, saveSettings, getCurrentGroup, toastr } = ctx;
    const lang = settings.lang || 'zh';
    const L = (zh, en) => lang === 'zh' ? zh : en;
    const npcSystem = ctx.npcSystem;
    if (!npcSystem) return;

    const $section = $('#gd-npc-section');
    const $toggle = $c('npc-enabled');
    const $generateBtn = $c('npc-generate');
    const $scanBtn = $c('npc-scan');
    const $list = $c('npc-list');

    // ── Bind values ──
    $toggle.prop('checked', settings.npcEnabled ?? false);
    $section.toggle(settings.npcEnabled ?? false);
    $c('npc-max-count').val(settings.npcMaxCount ?? 10);
    $c('npc-batch-size').val(settings.npcBatchSize ?? 3);
    $c('npc-generate-firstmes').prop('checked', settings.npcGenerateFirstMes ?? false);
    $c('npc-prompt').val(settings.npcPrompt || DEFAULT_NPC_PROMPT);

    // ── Events ──
    $toggle.on('change', function () {
        settings.npcEnabled = !!$(this).prop('checked');
        $section.toggle(settings.npcEnabled);
        if (settings.npcEnabled) renderNpcList();
        saveSettings();
    });

    $c('npc-max-count').on('input', function () {
        settings.npcMaxCount = Math.max(0, parseInt($(this).val()) || 10);
        saveSettings();
    });

    $c('npc-batch-size').on('input', function () {
        settings.npcBatchSize = Math.max(1, Math.min(parseInt($(this).val()) || 3, settings.npcMaxCount || 10));
        saveSettings();
    });

    $c('npc-generate-firstmes').on('change', function () {
        settings.npcGenerateFirstMes = !!$(this).prop('checked');
        saveSettings();
    });

    $c('npc-prompt').on('input', function () {
        settings.npcPrompt = $(this).val();
        saveSettings();
    });

    $c('npc-prompt-reset').on('click', function () {
        settings.npcPrompt = '';
        $c('npc-prompt').val(DEFAULT_NPC_PROMPT);
        saveSettings();
        toastr.info(L('已恢复默认 Prompt', 'Prompt reset to default'));
    });

    $generateBtn.on('click', async function () {
        const btn = $(this);
        btn.prop('disabled', true);
        try {
            const result = await npcSystem.generateNpcs();
            if (result && result.length > 0) {
                toastr.success(L(`成功生成 ${result.length} 个 NPC`, `Generated ${result.length} NPCs`));
                renderNpcList();
            }
        } catch (e) {
            toastr.error(L('NPC 生成失败: ' + e.message, 'NPC generation failed: ' + e.message));
            console.error('[GroupDirector] NPC generation error:', e);
        } finally {
            btn.prop('disabled', false);
        }
    });

    $scanBtn.on('click', function () {
        const npcs = npcSystem.getNpcs();
        if (npcs.length === 0) {
            toastr.info(L('存档中暂无 NPC', 'No NPCs found in save data'));
        } else {
            toastr.success(L(`扫描到 ${npcs.length} 个 NPC`, `Found ${npcs.length} NPCs`));
        }
        renderNpcList();
    });

    // ── Helpers ──
    function esc(s) {
        if (!s) return '';
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function trunc(s, n) {
        if (!s) return '';
        return s.length > n ? s.substring(0, n) + '...' : s;
    }

    // ── Render NPC list ──
    function renderNpcList() {
        const npcs = npcSystem.getNpcs();
        if (!npcs.length) {
            $list.html(`<small style="color:var(--grey70a);">${L('暂无 NPC，点击上方按钮生成', 'No NPCs yet. Click Generate above.')}</small>`);
            return;
        }

        let html = `<small style="color:var(--grey70a);">${npcs.length} ${L('个 NPC', ' NPCs')}</small>`;
        npcs.forEach((npc, i) => {
            const importedBadge = npc.imported
                ? `<span style="color:green;font-size:0.8em;">&#10003; ${L('已导入', 'Imported')} (${esc(npc.importedAvatar || '')})</span>`
                : '';
            const importBtn = `<span class="menu_button menu_button_icon gd-npc-import" data-idx="${i}" style="font-size:0.8em;"><i class="fa-solid fa-user-plus"></i> ${L('导入为角色卡', 'Import as Card')}</span>`;

            html += `
                <div class="gd-npc-card" style="border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:6px;margin-top:4px;" data-idx="${i}">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <b>${esc(npc.name)}</b>
                        <div style="display:flex;gap:4px;align-items:center;">
                            ${importedBadge}
                            ${importBtn}
                            <span class="menu_button menu_button_icon gd-npc-edit" data-idx="${i}" style="font-size:0.8em;"><i class="fa-solid fa-pencil"></i> ${L('编辑', 'Edit')}</span>
                            <span class="menu_button menu_button_icon gd-npc-delete" data-idx="${i}" style="font-size:0.75em;color:#ff5555;"><i class="fa-solid fa-trash"></i></span>
                        </div>
                    </div>
                    <div class="gd-npc-view-${i}">
                        <div style="font-size:0.85em;color:var(--grey80a);margin-top:2px;">${esc(trunc(npc.description, 150))}</div>
                        <div style="font-size:0.8em;color:var(--grey70a);margin-top:2px;">
                            <b>${L('性格', 'Personality')}:</b> ${esc(trunc(npc.personality || '', 80))}
                            &nbsp;|&nbsp; <b>${L('场景', 'Scenario')}:</b> ${esc(trunc(npc.scenario || '', 80))}
                        </div>
                        ${npc.first_mes ? `<div style="font-size:0.8em;color:var(--grey70a);margin-top:2px;"><b>First Mes:</b> ${esc(trunc(npc.first_mes, 120))}</div>` : ''}
                    </div>
                    <div class="gd-npc-edit-${i}" style="display:none;margin-top:4px;">
                        <label style="font-size:0.85em;">${L('名称', 'Name')}</label>
                        <input type="text" class="gd-npc-edit-name text_pole" data-idx="${i}" style="width:100%;" value="${esc(npc.name)}">
                        <label style="font-size:0.85em;margin-top:4px;">${L('描述', 'Description')}</label>
                        <textarea class="gd-npc-edit-desc text_pole textarea_compact" data-idx="${i}" rows="3" style="width:100%;">${esc(npc.description)}</textarea>
                        <label style="font-size:0.85em;margin-top:4px;">${L('性格', 'Personality')}</label>
                        <input type="text" class="gd-npc-edit-personality text_pole" data-idx="${i}" style="width:100%;" value="${esc(npc.personality || '')}">
                        <label style="font-size:0.85em;margin-top:4px;">${L('场景', 'Scenario')}</label>
                        <input type="text" class="gd-npc-edit-scenario text_pole" data-idx="${i}" style="width:100%;" value="${esc(npc.scenario || '')}">
                        ${npc.first_mes !== undefined ? `<label style="font-size:0.85em;margin-top:4px;">First Mes</label>
                        <textarea class="gd-npc-edit-firstmes text_pole textarea_compact" data-idx="${i}" rows="2" style="width:100%;">${esc(npc.first_mes || '')}</textarea>` : ''}
                        <div style="margin-top:4px;display:flex;gap:4px;">
                            <span class="menu_button menu_button_icon gd-npc-save" data-idx="${i}" style="font-size:0.85em;"><i class="fa-solid fa-floppy-disk"></i> ${L('保存', 'Save')}</span>
                            <span class="menu_button menu_button_icon gd-npc-cancel" data-idx="${i}" style="font-size:0.85em;"><i class="fa-solid fa-xmark"></i> ${L('取消', 'Cancel')}</span>
                        </div>
                    </div>
                </div>`;
        });

        $list.html(html);

        // Delete
        $list.find('.gd-npc-delete').on('click', async function () {
            const idx = parseInt($(this).data('idx'));
            if (await callGenericPopup(L(`确定删除 NPC「${npcs[idx].name}」？`, `Delete NPC "${npcs[idx].name}"?`), POPUP_TYPE.CONFIRM)) {
                npcSystem.deleteNpc(idx);
                renderNpcList();
            }
        });

        // Import
        $list.find('.gd-npc-import').on('click', async function () {
            const idx = parseInt($(this).data('idx'));
            const btn = $(this);
            btn.prop('disabled', true);
            try {
                const avatarName = await npcSystem.importNpcAsCharacter(idx);
                toastr.success(L(`NPC「${npcs[idx].name}」已导入为角色卡: ${avatarName}`, `NPC "${npcs[idx].name}" imported as: ${avatarName}`));
                renderNpcList();
            } catch (e) {
                toastr.error(L('导入失败: ' + e.message, 'Import failed: ' + e.message));
                btn.prop('disabled', false);
            }
        });

        // Edit toggle
        $list.find('.gd-npc-edit').on('click', function () {
            const idx = parseInt($(this).data('idx'));
            // Close all other edit panels to prevent data loss from multi-edit
            const npcs = npcSystem.getNpcs();
            npcs.forEach((_, i) => {
                if (i !== idx) {
                    $(`.gd-npc-edit-${i}`).hide();
                    $(`.gd-npc-view-${i}`).show();
                }
            });
            $(`.gd-npc-view-${idx}`).hide();
            $(`.gd-npc-edit-${idx}`).show();
        });

        // Cancel edit
        $list.find('.gd-npc-cancel').on('click', function () {
            const idx = parseInt($(this).data('idx'));
            $(`.gd-npc-edit-${idx}`).toggle(false);
            $(`.gd-npc-view-${idx}`).toggle(true);
        });

        // Save edit
        $list.find('.gd-npc-save').on('click', function () {
            const idx = parseInt($(this).data('idx'));
            const nameEl = $list.find(`.gd-npc-edit-name[data-idx="${idx}"]`);
            const descEl = $list.find(`.gd-npc-edit-desc[data-idx="${idx}"]`);
            const persEl = $list.find(`.gd-npc-edit-personality[data-idx="${idx}"]`);
            const scenEl = $list.find(`.gd-npc-edit-scenario[data-idx="${idx}"]`);
            const fmEl = $list.find(`.gd-npc-edit-firstmes[data-idx="${idx}"]`);

            const name = (nameEl.val() || '').trim();
            if (!name) {
                toastr.warning(L('名称不能为空', 'Name is required'));
                return;
            }

            // Check for duplicate names (exclude self)
            const otherNpcs = npcSystem.getNpcs().filter((_, j) => j !== idx);
            if (otherNpcs.some(n => n.name.toLowerCase() === name.toLowerCase())) {
                toastr.warning(L('名称与已有 NPC 重复', 'Name duplicates an existing NPC'));
                return;
            }

            const updates = {
                name,
                description: (descEl.val() || '').trim(),
                personality: (persEl.val() || '').trim(),
                scenario: (scenEl.val() || '').trim(),
            };
            if (fmEl.length) {
                updates.first_mes = (fmEl.val() || '').trim();
            }

            npcSystem.updateNpc(idx, updates);
            toastr.success(L('已保存', 'Saved'));
            renderNpcList();
        });
    }

    // Expose render function for other sections (e.g. NPC export)
    ctx.renderNpcList = renderNpcList;

    // Initial render
    if (settings.npcEnabled) renderNpcList();
});
