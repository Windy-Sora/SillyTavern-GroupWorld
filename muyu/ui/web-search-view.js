import { WEB_DEFAULTS, WEB_RANGES } from '../web/contract.js';
import { createFormFeedback } from './form-feedback.js';
import { bindAutoSave } from './auto-save.js';
import { createServiceStatusView } from './service-status-view.js';

const SERVICE_REPOSITORY = 'https://github.com/Windy-Sora/SillyTavern-Muyu-Services';

/** Composer switch and stable settings editor; toggling never sends the user's draft. */
export function createWebSearchView({ doc, settings, serviceSettings, toolbar, composer, controller, act, openSettings, openServices, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text, parent) => { const el = doc.createElement(tag); if (text) el.textContent = text; parent.append(el); return el; };
    const button = (text, parent) => { const el = node('button', text, parent); el.type = 'button'; el.className = 'menu_button'; return el; };
    const field = (label, type, parent) => { const wrap = node('label', label, parent), el = node('input', '', wrap); el.type = type; if (type !== 'checkbox') el.className = 'text_pole'; return el; };
    const toggle = button('', toolbar); toggle.className += ' gd-muyu-web-toggle';
    const icon = node('span', '', toggle); icon.className = 'fa-solid fa-globe'; icon.setAttribute('aria-hidden', 'true');
    const toggleLabel = node('span', t('联网', 'Web'), toggle);
    const hint = node('small', t('联网已开启 · 必要的搜索词会发送至 Brave，可能计费', 'Web enabled · Necessary queries go to Brave and may incur charges'), composer); hint.className = 'gd-muyu-web-hint'; hint.hidden = true;
    const editor = node('details', '', settings); editor.className = 'gd-muyu-web-settings';
    node('summary', t('联网搜索', 'Web search'), editor);
    node('p', t('小地球只控制暮羽的网页搜索。开启后由暮羽按需搜索，不必逐次授权；全权限模式也遵守这个开关。切换模型连接或刷新后关闭。', 'The globe controls Muyu web search. When enabled, Muyu searches as needed without per-search approval; full access respects this switch. Reconnecting or reloading turns it off.'), editor);
    const installation = node(serviceSettings ? 'details' : 'section', '', serviceSettings || editor); installation.className = 'gd-muyu-web-installation';
    if (serviceSettings) node('summary', t('可选服务 · 文件历史与联网', 'Optional services · File history & web'), installation);
    const serviceView = createServiceStatusView({ doc, parent: installation, controller, lang });
    const showServices = target => (openServices || openSettings)(target);
    const serviceLink = button(t('服务安装与自检…', 'Service installation & checks…'), editor);
    serviceLink.onclick = () => { installation.open = true; showServices(installation); };
    const installationState = node('p', '', installation); installationState.setAttribute('role', 'status');
    const installationActions = node('div', '', installation); installationActions.className = 'gd-muyu-actions';
    const getPlugin = button(t('获取服务插件', 'Get service plugin'), installationActions);
    const checkPlugin = button(t('检查安装状态', 'Check installation'), installationActions);
    const guide = node('details', '', installation);
    node('summary', t('安装与更新说明（可选）', 'Installation and update guide (optional)'), guide);
    node('p', t('联网搜索需要暮羽服务端插件。安装是可选的；不安装仍可聊天、管理配置及使用浏览器或账户设置存储。服务插件具有服务器代码执行能力，请只安装可信来源。', 'Web search requires the Muyu server plugin. Installation is optional: chat, configuration management, browser storage and account-settings storage remain available without it. Server plugins execute server-side code; install trusted sources only.'), guide);
    const repository = node('a', t('打开暮羽服务插件仓库与完整说明 ↗', 'Open Muyu service repository and full instructions ↗'), guide);
    repository.href = SERVICE_REPOSITORY; repository.target = '_blank'; repository.rel = 'noopener noreferrer';
    const steps = node('ol', '', guide);
    node('li', t('在运行酒馆的电脑／服务器上安装，不是在酒馆「安装扩展」里安装。手机通过局域网访问时，也是在电脑上操作。', 'Install on the computer/server running ST, not through ST’s “Install extension”. When using a phone over LAN, install on that computer.'), steps);
    const commandStep = node('li', t('在酒馆根目录运行：', 'Run from the ST root directory:'), steps);
    const command = node('textarea', '', commandStep); command.className = 'text_pole gd-muyu-web-install-command'; command.readOnly = true; command.rows = 2;
    command.value = `git clone ${SERVICE_REPOSITORY}.git plugins/gd-muyu-history`;
    command.setAttribute('aria-label', t('服务插件安装命令', 'Service plugin installation command'));
    const copy = button(t('复制安装命令', 'Copy installation command'), commandStep);
    const copyState = node('span', '', commandStep); copyState.setAttribute('role', 'status');
    copy.onclick = async () => {
        try {
            const clipboard = doc.defaultView?.navigator?.clipboard;
            if (!clipboard?.writeText) throw Error('CLIPBOARD_UNAVAILABLE');
            await clipboard.writeText(command.value); copyState.textContent = t('已复制。', 'Copied.');
        } catch { command.focus?.(); command.select?.(); copyState.textContent = t('请手动复制已选中的命令。', 'Please copy the selected command manually.'); }
    };
    node('li', t('在酒馆 config.yaml 中设置 enableServerPlugins: true，然后重启酒馆。此界面不会自动安装或修改该文件。', 'Set enableServerPlugins: true in ST’s config.yaml, then restart ST. This UI does not install anything or edit that file.'), steps);
    node('li', t('回到这里检查安装状态，再配置独立的 Brave 搜索密钥并开启小地球。安装检测不需要模型连接或搜索密钥，也不调用 Brave。', 'Return here to check installation, then configure a separate Brave key and enable the globe. Installation checks require neither a model connection nor a search key and do not call Brave.'), steps);
    node('small', t('也可下载仓库 ZIP，将全部 .cjs 文件与 package.json 放在 plugins/gd-muyu-history 下，包括 service-status.cjs。已安装旧版时更新原目录，不要重复安装同名插件；更新后重启。检测成功不代表搜索密钥有效。', 'Alternatively download the repository ZIP: put all .cjs files and package.json directly in plugins/gd-muyu-history, including service-status.cjs. Update in place rather than installing duplicate IDs, then restart. Successful detection does not verify the search key.'), guide);
    getPlugin.onclick = () => { installation.open = true; guide.open = true; showServices(guide); };
    node('small', t('搜索服务：Brave Search API。需要独立的搜索密钥；与模型 API Key 无关。', 'Provider: Brave Search API. Requires a separate search key, not your model API key.'), editor);
    const key = field(t('Brave Search API 密钥', 'Brave Search API key'), 'password', editor); key.autocomplete = 'off';
    const remember = field(t('记住搜索密钥', 'Remember search key'), 'checkbox', editor);
    node('small', t('勾选后保存在酒馆插件设置中，未加密，同源脚本及酒馆设置备份可能读取；配置档导出会剔除密钥。不勾选则仅本页保留。搜索密钥不会发给模型。', 'Remembered keys are stored unencrypted in ST extension settings and may be read by same-origin scripts or settings backups; config-profile exports strip them. Otherwise the key stays in this page only. It is never sent to the model.'), editor);
    const limits = node('details', '', editor); limits.className = 'gd-muyu-settings-advanced';
    node('summary', t('搜索次数与资料预算', 'Search limits and data budget'), limits);
    node('small', t('数字完成编辑后自动保存，下一轮生效；不改变密钥或联网开关。', 'Limits auto-save after editing for the next task; credentials and the web switch stay unchanged.'), limits);
    const fields = Object.entries({ maxSearches: t('每任务最多搜索次数', 'Search attempts per task'), maxResults: t('每次最多结果数', 'Results per search'), resultBytes: t('每任务搜索资料预算（UTF-8 字节）', 'Search-result budget per task (UTF-8 bytes)') }).map(([name, label]) => {
        const input = field(label, 'number', limits); [input.min, input.max] = WEB_RANGES[name]; input.step = 1;
        node('small', `${input.min}–${input.max}`, input.parentElement || input.parent); return { name, input };
    });
    const controls = node('div', '', editor); controls.className = 'gd-muyu-actions';
    const save = button(t('更新搜索密钥', 'Update search key'), controls), forget = button(t('清除搜索密钥', 'Forget search key'), controls);
    const saveLimits = button(t('重试保存搜索预算', 'Retry saving search limits'), limits);
    const limitFeedback = createFormFeedback({ doc, parent: limits, fields: fields.map(f => f.input), buttons: [saveLimits], retryButton: saveLimits, lang });
    saveLimits.onclick = () => act(() => limitFeedback.run(() => controller.saveWebSearchLimits(Object.fromEntries(fields.map(({ name, input }) => [name, Number(input.value)]))), () => limitFeedback.validateNumbers()));
    bindAutoSave(fields.map(f => f.input), saveLimits, lang, () => limitFeedback.dirty);
    const stateText = node('small', '', editor);
    const feedback = createFormFeedback({ doc, parent: controls, fields: [key, remember], buttons: [save, forget], lang,
        disabledWhen: control => control === forget && !controller.snapshot().webSearch?.hasKey,
        savedText: t('搜索设置已更新。', 'Search settings updated.'),
        errorText: error => error?.message === 'WEB_KEY_REQUIRED' ? t('请填写独立的搜索密钥。', 'Enter a separate search key.') : t('搜索配置未能保存，输入已保留。', 'Search settings could not be saved. Input retained.') });
    node('small', t('搜索只返回链接与摘要，不读取网页全文。', 'Search returns links and snippets, not full pages.'), editor);
    let signature = '', credentialSignature = '';
    const probe = async () => {
        try { await controller.checkWebSearchInstallation(); }
        catch { guide.open = true; }
    };
    checkPlugin.onclick = () => act(probe);
    toggle.onclick = () => act(async () => {
        const s = controller.snapshot();
        if (!s.webSearch?.enabled && s.webSearch?.backend !== 'available') {
            installation.open = true; guide.open = true; showServices(guide); await probe(); return;
        }
        if (!s.webSearch?.enabled && (!s.enabled || !s.webSearch?.hasKey)) { editor.open = true; openSettings(s.enabled ? key : undefined); return; }
        try { await controller.setWebSearchEnabled(!s.webSearch.enabled); }
        catch (error) { editor.open = true; editor.setAttribute('tabindex', '-1'); openSettings(editor); throw error; }
    });
    save.onclick = () => act(() => feedback.run(async () => {
        const config = {}; for (const { name, input } of fields) { if (!input.value.trim()) throw Error('WEB_CONFIG_INVALID'); config[name] = Number(input.value); }
        await controller.saveWebSearchConfig({ config, apiKey: key.value.trim(), rememberKey: remember.checked }); key.value = ''; signature = '';
    }, () => {
        if (!limitFeedback.validateNumbers()) return false;
        if (!key.value.trim() && !controller.snapshot().webSearch?.hasKey) { feedback.invalid(key, t('请填写 Brave Search API 密钥。', 'Enter a Brave Search API key.')); return false; }
        return true;
    }));
    forget.onclick = () => act(() => feedback.run(async () => { await controller.forgetWebSearchKey(); key.value = ''; signature = ''; }));
    return {
        render(s) {
            serviceView.render();
            const web = s.webSearch || { ...WEB_DEFAULTS, hasKey: false, remembered: false, backend: 'unknown' };
            toggle.hidden = s.mode !== 'assistant';
            toggle.disabled = !!s.resetting || !!web.saving || !!s.readOnly || !web.enabled && !!s.busy;
            toggle.setAttribute('aria-pressed', String(web.enabled === true));
            toggle.setAttribute('aria-label', web.enabled ? t('关闭联网搜索', 'Disable web search') : t('开启联网搜索', 'Enable web search'));
            toggle.title = web.enabled ? t('关闭联网搜索', 'Disable web search') : t('开启联网搜索 · 搜索词发送至 Brave，可能计费', 'Enable web search · Queries go to Brave and may incur charges');
            toggleLabel.hidden = web.enabled !== true;
            hint.hidden = web.enabled !== true || s.mode !== 'assistant';
            const next = JSON.stringify([web.maxSearches, web.maxResults, web.resultBytes]);
            if (signature !== next && !feedback.busy && !limitFeedback.dirty && !limitFeedback.busy) { for (const { name, input } of fields) input.value = String(web[name]); signature = next; limitFeedback.rebase(); }
            const nextCredential = JSON.stringify([web.hasKey, web.remembered]);
            if (credentialSignature !== nextCredential && !feedback.dirty && !feedback.busy) { remember.checked = web.remembered === true; credentialSignature = nextCredential; feedback.rebase(); }
            limitFeedback.update(web.saving || s.resetting || s.busy);
            feedback.update(web.saving || s.resetting || s.busy);
            checkPlugin.disabled = !!web.saving || !!s.resetting || !!s.busy || !!s.readOnly;
            installationState.textContent = web.saving ? t('正在处理搜索设置…', 'Processing search settings…') : ({ available: t('服务已加载 · 不代表搜索密钥或上游连接有效', 'Service loaded · Search key and upstream connectivity not verified'), missing: t('联网需要服务插件 · 未安装、未启用或尚未重启', 'Web search requires the service plugin · Missing, disabled or restart required'), incompatible: t('服务版本不兼容 · 请更新原安装目录并重启', 'Incompatible service version · Update the existing installation and restart'), unavailable: t('暂时无法检查服务 · 请检查酒馆连接后重试', 'Could not check the service · Check the ST connection and retry'), unknown: t('尚未检查服务安装状态 · 无需密钥即可检查', 'Service installation not checked · No key required') }[web.backend] || '');
            if (['missing', 'incompatible'].includes(web.backend)) guide.open = true;
            stateText.textContent = web.hasKey ? t('已提供搜索密钥', 'Search key provided') : t('尚未配置搜索密钥', 'Search key not configured');
        },
        clearKey() { key.value = ''; },
        openServices() { installation.open = true; showServices(installation); },
        dispose() { serviceView.dispose(); },
    };
}
