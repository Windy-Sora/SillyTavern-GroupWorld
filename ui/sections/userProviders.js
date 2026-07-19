import { registerSection } from './registry.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../popup.js';

registerSection('userProviders', function (ctx) {
    const { settings, toastr, userProviderLoader, CapabilityRegistry, renderPrompt, getProviders } = ctx;
    if (!userProviderLoader) return;
    const lang = settings.lang || 'zh';
    const L = (zh, en) => lang === 'zh' ? zh : en;

    // ── Provider import ──
    const $pList = $('#gd-user-provider-list');
    const $pFile = $('#gd-user-provider-file');

    renderList('provider', $pList);

    const deps = {
        log: ctx.log || console.log,
        registerProvider: window.GroupDirector?.registerProvider,
        CapabilityRegistry: window.GroupDirector?.CapabilityRegistry,
    };

    const $pWarn = $(`<div class="neutral_warning" style="margin:6px 0;">
        ${L(
            '⚠ 安全警告：导入即赋予完全权限。恶意代码可窃取聊天记录、API 密钥、接管页面。请仅导入你完全信任的代码。',
            '⚠ Security: importing grants full access. Malicious code can steal chat logs, API keys, and hijack the page. Only import code you fully trust.'
        )}
    </div>`);
    $('#gd-user-provider-import').closest('.gd-row-buttons').before($pWarn);

    $('#gd-user-provider-import').on('click', () => { $pFile.trigger('click'); });
    $pFile.on('change', handleImport('provider', $pFile, '#gd-user-provider-import', $pList, deps));

    // ── Capability import ──
    const $cList = $('#gd-user-capability-list');
    const $cFile = $('#gd-user-capability-file');

    renderList('capability', $cList);

    const $cWarn = $(`<div class="neutral_warning" style="margin:6px 0;">
        ${L(
            '⚠ 安全警告：导入即赋予完全权限。恶意代码可窃取聊天记录、API 密钥、接管页面。请仅导入你完全信任的代码。',
            '⚠ Security: importing grants full access. Malicious code can steal chat logs, API keys, and hijack the page. Only import code you fully trust.'
        )}
    </div>`);
    $('#gd-user-capability-import').closest('.gd-row-buttons').before($cWarn);

    $('#gd-user-capability-import').on('click', () => { $cFile.trigger('click'); });
    $cFile.on('change', handleImport('capability', $cFile, '#gd-user-capability-import', $cList, deps));

    // ── Helpers ──
    function handleImport(type, $file, btnId, $list, deps) {
        return async function () {
            const file = this.files?.[0];
            if (!file) return;
            const btn = $(btnId);
            btn.prop('disabled', true);
            try {
                const result = await userProviderLoader.importAsset(file, type, deps);
                if (result.ok) {
                    toastr.success(L(`已导入: ${result.name}`, `Imported: ${result.name}`));
                    renderList(type, $list);
                } else {
                    toastr.error((L('导入失败', 'Import failed') + ': ') + (result.error || ''));
                }
            } catch (e) {
                toastr.error(L('导入出错: ' + e.message, 'Import error: ' + e.message));
            }
            btn.prop('disabled', false);
            $(this).val('');
        };
    }

    function renderList(type, $list) {
        const items = userProviderLoader.listAssets(type);
        if (!items.length) {
            $list.html(`<small style="color:var(--grey70a);">${L('暂无', 'None')}</small>`);
            return;
        }
        let html = '';
        items.forEach(p => {
            const time = new Date(p.importedAt).toLocaleString();
            const idTags = (p.ids || []).length > 0
                ? ` → <code style="font-size:0.8em;">${p.ids.map(esc).join('</code> <code style="font-size:0.8em;">')}</code>`
                : '';
            html += `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--SmartThemeBorderColor);">
                    <span><b>${esc(p.name)}</b>${idTags} <span style="font-size:0.8em;color:var(--grey70a);">${time}</span></span>
                    <div style="display:flex;gap:4px;">
                        <span class="menu_button menu_button_icon gd-user-asset-test" data-type="${type}" data-name="${esc(p.name)}" style="font-size:0.75em;"><i class="fa-solid fa-flask"></i> ${L('测试', 'Test')}</span>
                        <span class="menu_button menu_button_icon gd-user-asset-delete" data-type="${type}" data-name="${esc(p.name)}" style="font-size:0.75em;color:#ff5555;"><i class="fa-solid fa-trash"></i></span>
                    </div>
                </div>`;
        });
        $list.html(html);

        $list.find('.gd-user-asset-test').on('click', async function () {
            const name = $(this).attr('data-name');
            const t = $(this).attr('data-type');
            const btn = $(this);
            btn.prop('disabled', true);

            // Use the first registered ID, fall back to file name
            const items = userProviderLoader.listAssets(t);
            const item = items.find(i => i.name === name);
            const registeredId = (item?.ids?.length > 0) ? item.ids[0] : name;

            try {
                if (t === 'provider' && renderPrompt) {
                    const id = registeredId;
                    const result = await renderPrompt(`{{${id}}}`, {});
                    alert(L(
                        `Provider "${id}" 渲染结果:\n\n${result || '(空)'}`,
                        `Provider "${id}" rendered:\n\n${result || '(empty)'}`
                    ));
                } else if (t === 'capability' && CapabilityRegistry) {
                    const cap = CapabilityRegistry.get(registeredId);
                    if (cap) {
                        const info = `id: ${cap.id}\nenabled: ${cap.enabled}\ndescription: ${cap.description || '—'}\nschema: ${JSON.stringify(cap.schema, null, 2)}`;
                        alert(L(
                            `Capability "${name}" 信息:\n\n${info}`,
                            `Capability "${name}" info:\n\n${info}`
                        ));
                    } else {
                        const list = CapabilityRegistry.list().map(c => `${c.id} | ${c.displayName || c.id} | enabled: ${c.enabled}`).join('\n');
                        alert(L(
                            `Capability "${name}" 未精确匹配。已注册的能力:\n\n${list}`,
                            `Capability "${name}" not matched. Registered:\n\n${list}`
                        ));
                    }
                }
            } catch (e) {
                toastr.error(L('测试失败: ' + e.message, 'Test failed: ' + e.message));
            } finally {
                btn.prop('disabled', false);
            }
        });

        $list.find('.gd-user-asset-delete').on('click', async function () {
            const name = $(this).attr('data-name');
            const t = $(this).attr('data-type');
            if (await callGenericPopup(L(`删除 "${name}"？重启后生效。`, `Delete "${name}"? Takes effect after reload.`), POPUP_TYPE.CONFIRM)) {
                await userProviderLoader.deleteAsset(name, t);
                renderList(t, type === 'provider' ? $pList : $cList);
                toastr.info(L(`已删除 "${name}"`, `Deleted "${name}"`));
            }
        });
    }

    function esc(s) {
        if (!s) return '';
        const div = document.createElement('div');
        div.textContent = String(s);
        return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
});
