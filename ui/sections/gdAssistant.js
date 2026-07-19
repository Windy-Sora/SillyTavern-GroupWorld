import { registerSection } from './registry.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../popup.js';
import { getCharacters } from '../../../../../../script.js';

registerSection('gdAssistant', function (ctx) {
    const { settings, $c, toastr } = ctx;
    if (!$c('dash-get-assistant').length) return;

    const L = (zh, en) => (settings.lang || 'zh') === 'zh' ? zh : en;
    const ASSET_BASE = 'scripts/extensions/third-party/SillyTavern-GroupDirector/assets/gd-assistant';

    // ── CSRF helpers ──
    let _csrfToken = null;
    async function getCsrfToken() {
        if (_csrfToken) return _csrfToken;
        const resp = await fetch('/csrf-token');
        const data = await resp.json();
        _csrfToken = data.token;
        return _csrfToken;
    }
    function csrfHeaders() {
        return _csrfToken ? { 'X-CSRF-Token': _csrfToken } : {};
    }
    function jsonHeaders() {
        return Object.assign({ 'Content-Type': 'application/json' }, csrfHeaders());
    }
    function formHeaders() {
        return csrfHeaders(); // no Content-Type — browser sets with boundary
    }

    $c('dash-get-assistant').on('click', async function () {
        const ok = await callGenericPopup(
            L(
                '<b>🦉 领养暮羽</b><br>一只住在 GD 插件里的猫头鹰娘——会写代码、懂架构、不甩术语。<br>领回家就能直接问，紫色台灯下随时待命。<br><br>将导入角色卡「暮羽」+ 配套助手世界书，同名角色/世界书将覆盖更新。',
                '<b>🦉 Adopt Mu</b><br>An owl girl living inside GD — writes code, knows architecture, skips the jargon.<br>Take her home and ask away, she\'s always there under her purple lamp.<br><br>Imports "Mu" character card + companion world book. Same name will be overwritten.'
            ),
            POPUP_TYPE.CONFIRM,
        );
        if (!ok) return;

        const $btn = $c('dash-get-assistant');
        $btn.prop('disabled', true).css('opacity', '0.6');
        const originalText = $btn.html();

        try {
            // Ensure CSRF token before any POST requests
            try { await getCsrfToken(); } catch (e) {
                throw new Error('Failed to get CSRF token: ' + e.message);
            }

            // ── Step 1: Fetch character.json ──
            const charResp = await fetch(`${ASSET_BASE}/character.json`);
            if (!charResp.ok) throw new Error(`character.json fetch failed: ${charResp.status}`);
            const charData = await charResp.json();

            // ── Step 2: Create character ──
            toastr.info(L('正在创建角色...', 'Creating character...'), '', { timeOut: 3000 });

            const createResp = await fetch('/api/characters/create', {
                method: 'POST',
                headers: jsonHeaders(),
                body: JSON.stringify(charData),
            });
            if (!createResp.ok) {
                const errText = await createResp.text();
                throw new Error(`Character create failed: ${errText}`);
            }
            const avatarKey = await createResp.text();
            console.log('[GD Assistant] Character created:', avatarKey);

            // ── Step 3: Upload avatar ──
            try {
                const avatarResp = await fetch(`${ASSET_BASE}/avatar.png`);
                if (avatarResp.ok) {
                    const avatarBlob = await avatarResp.blob();
                    const formData = new FormData();
                    formData.append('avatar', avatarBlob, 'avatar.png');
                    formData.append('avatar_url', avatarKey);

                    const uploadResp = await fetch('/api/characters/edit-avatar', {
                        method: 'POST',
                        headers: formHeaders(),
                        body: formData,
                    });
                    if (uploadResp.ok) {
                        console.log('[GD Assistant] Avatar uploaded');
                    } else {
                        console.warn('[GD Assistant] Avatar upload failed, status:', uploadResp.status);
                    }
                }
            } catch (e) {
                console.warn('[GD Assistant] Avatar upload error:', e.message);
                // Non-fatal: character already created
            }

            // ── Step 4: Import world book ──
            toastr.info(L('正在导入世界书...', 'Importing world book...'), '', { timeOut: 3000 });

            const wbResp = await fetch(`${ASSET_BASE}/world-book.json`);
            if (!wbResp.ok) throw new Error(`world-book.json fetch failed: ${wbResp.status}`);
            const wbData = await wbResp.json();

            // Create world book via API
            const wbJsonStr = JSON.stringify(wbData);
            const wbBlob = new Blob([wbJsonStr], { type: 'application/json' });
            const wbFormData = new FormData();
            wbFormData.append('avatar', wbBlob, 'GD_Dev_Assistant.json');

            const wbImportResp = await fetch('/api/worldinfo/import', {
                method: 'POST',
                headers: formHeaders(),
                body: wbFormData,
            });
            if (!wbImportResp.ok) {
                throw new Error(`World book import failed: ${wbImportResp.status}`);
            }
            const wbResult = await wbImportResp.json();
            console.log('[GD Assistant] World book imported:', wbResult.name);

            // 刷新前端角色列表（getCharacters 内部会 printCharacters 渲染）
            await getCharacters();

            // ── Done ──
            toastr.success(
                L(
                    '暮羽领养成功！已在角色列表中，打开「暮羽」开始对话——她已经在紫色台灯下等着了 🦉',
                    'Mu adopted! Find "Mu" in your character list and start chatting — she\'s waiting under her purple lamp 🦉'
                ),
                '',
                { timeOut: 8000 }
            );

        } catch (e) {
            console.error('[GD Assistant] Import failed:', e);
            toastr.error(
                L(`导入失败: ${e.message}`, `Import failed: ${e.message}`),
                '',
                { timeOut: 8000 }
            );
        } finally {
            $btn.prop('disabled', false).css('opacity', '1').html(originalText);
        }
    });
});
