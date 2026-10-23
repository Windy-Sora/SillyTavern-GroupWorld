import { createServiceDiagnosticsView } from './service-diagnostics-view.js';
/** Local status only; deliberately not an Agent tool or permission grant. */
export function createServiceStatusView({ doc, parent, controller, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text, container = parent) => { const el = doc.createElement(tag); el.textContent = text; container.append(el); return el; };
    const group = (title, description) => {
        const el = node('details', ''); el.className = 'gd-muyu-service-group';
        node('summary', title, el); node('small', description, el); return el;
    };
    node('small', t('可选增强，不安装也能聊天。先检查服务，再按需开启；能力开关、资料外发授权和写入批准是三件不同的事。', 'Optional enhancements; chat works without installation. Check the service, then enable what you need. Capability switches, data consent and write approval are separate.'));
    const output = node('p', t('尚未检查服务版本与能力。', 'Service version and capabilities not checked.')); output.setAttribute('role', 'status');
    const actions = node('div', ''); actions.className = 'gd-muyu-actions';
    const check = doc.createElement('button'); check.textContent = t('检查服务能力', 'Check service capabilities'); actions.append(check);
    const storage = doc.createElement('button'); storage.textContent = t('测试历史存储（写入临时文件）', 'Test history storage (writes a temporary file)'); actions.append(storage);
    for (const button of [check, storage]) { button.type = 'button'; button.className = 'menu_button'; }
    node('small', t('自检只在点击后写入、读取并清理独立临时文件，不修改对话。不验证磁盘剩余空间、搜索密钥或其他酒馆功能。', 'On click, the test writes, reads and removes an isolated temporary file; conversations are untouched. It does not verify free disk space, search keys or other ST features.'));
    const errors = {
        HISTORY_IDENTITY_UNAVAILABLE: t('未取得有效账户目录，请检查服务插件并重启酒馆。', 'No valid account directory. Check the service and restart ST.'),
        SERVICE_STORAGE_PERMISSION: t('没有存储写入权限，请检查服务器目录权限。', 'Storage access denied. Check server directory permissions.'),
        SERVICE_STORAGE_FULL: t('写入时磁盘空间不足。', 'Disk space was insufficient during the write.'),
        SERVICE_STORAGE_UNAVAILABLE: t('存储自检失败，请检查服务器存储。', 'Storage test failed. Check server storage.'),
        SERVICE_INCOMPATIBLE: t('检测协议不兼容，请更新服务并重启酒馆。', 'Incompatible check protocol. Update the service and restart ST.'),
        SERVICE_CHECK_BUSY: t('本账户已有自检正在运行，请稍后重试。', 'A storage check is already running for this account. Try again later.'),
    };
    let busy = false, disposed = false, state = null;
    const diagnosticsView = createServiceDiagnosticsView({ doc, parent, controller, lang });
    const documentGroup = group(t('本地资料与工作区', 'Local documents & workspace'), t('现有文档需先开启检索才能取得更新基线。草稿不等于写入，也不会自动应用到酒馆。', 'Enable document search to obtain baselines for existing files. Drafts are not writes and do not apply to ST.'));
    const documentsLabel = node('label', '', documentGroup);
    const documents = doc.createElement('input'); documents.type = 'checkbox'; documents.checked = controller.documentsEnabled?.() === true;
    const documentsText = doc.createElement('span'); documentsText.textContent = t('启用本地资料检索（默认关闭）', 'Enable local document search (off by default)');
    documentsLabel.append(documents); documentsLabel.append(documentsText);
    node('small', t('只读服务端白名单文本；启用不代表授权外发，按现有资料权限处理。额外目录由服务器管理员配置，不开放任意磁盘路径。', 'Reads server-approved text only. Enabling is not consent to send data; existing data permissions apply. Additional roots are configured by the server administrator, not arbitrary model-supplied paths.'), documentGroup);
    const pageGroup = group(t('公开网页正文', 'Public web pages'), t('独立于小地球搜索；无需 Brave 密钥。', 'Independent of globe search; no Brave key required.'));
    const pagesLabel = node('label', '', pageGroup);
    const pages = doc.createElement('input'); pages.type = 'checkbox'; pages.checked = controller.pagesEnabled?.() === true;
    const pagesText = doc.createElement('span'); pagesText.textContent = t('允许读取公开网页正文（默认关闭）', 'Allow public web page reading (off by default)');
    pagesLabel.append(pages); pagesLabel.append(pagesText);
    node('small', t('此开关允许下一任务按需访问公开网站；网址与查询参数发送到该网站，正文发送到当前模型。无需搜索密钥，不携带酒馆Cookie，不访问内网，不支持登录、PDF或动态网页。可能增加调用与流量。', 'This switch permits public website requests in the next task. URLs and query parameters go to the website; text goes to the current model. No search key, ST cookies, internal network access, login, PDF or dynamic page rendering. Calls and traffic may increase.'), pageGroup);
    const workspaceLabel=node('label','',documentGroup),workspace=doc.createElement('input');workspace.type='checkbox';workspace.checked=controller.workspaceEnabled?.()===true;
    workspaceLabel.append(workspace);const workspaceText=doc.createElement('span');workspaceText.textContent=t('启用工作区文档草稿（默认关闭）','Enable workspace document drafts (off by default)');workspaceLabel.append(workspaceText);
    node('small',t('只创建或更新暮羽私有工作区的文本／JSON。读取授权不批准写入；普通模式需逐份批准，全权限也须明确执行意图。不修改酒馆或GroupWorld配置，不安装或执行代码。','Creates/updates private Muyu text/JSON documents only. Read consent is not write approval; normal mode requires exact review, full access requires explicit execute intent. No ST/GroupWorld application, installation or code execution.'),documentGroup);
    const jsonGroup=group(t('文本校验','Text validation'),t('只检查提交的 JSON 文本，不访问文件。','Checks submitted JSON text only; no file access.'));
    const jsonLabel=node('label','',jsonGroup),json=doc.createElement('input');json.type='checkbox';json.checked=controller.jsonEnabled?.()===true;
    jsonLabel.append(json);const jsonText=doc.createElement('span');jsonText.textContent=t('启用JSON语法校验（默认关闭）','Enable JSON syntax validation (off by default)');jsonLabel.append(jsonText);
    node('small',t('仅校验模型提交的文本，不读取或写入文件；语法通过不代表业务配置可用。','Checks submitted text only, no file reads/writes. Valid syntax does not establish business compatibility.'),jsonGroup);
    const capabilityRows = [
        [documents, documentGroup, 'documentSearch'], [workspace, documentGroup, 'workspaceWrite'],
        [pages, pageGroup, 'webFetch'], [json, jsonGroup, 'jsonValidate'],
    ].map(([input, container, protocol]) => {
        const status = node('small', '', input.parentElement || input.parent || container);
        status.className = 'gd-muyu-service-capability-state';
        return { input, protocol, status };
    });
    function render() {
        const s = controller.snapshot();
        check.disabled = busy || !!s.busy || !!s.resetting;
        storage.disabled = check.disabled || state?.status !== 'available' || !state.capabilities.storageCheck;
        diagnosticsView.render(state?.status === 'available' && state.capabilities.diagnostics === true, check.disabled);
        documents.checked = controller.documentsEnabled?.() === true;
        documents.disabled = check.disabled || typeof controller.setDocumentsEnabled !== 'function' || !documents.checked && !(state?.status === 'available' && state.toolProtocols?.documentSearch === 1);
        pages.checked = controller.pagesEnabled?.() === true;
        pages.disabled = check.disabled || typeof controller.setPagesEnabled !== 'function' || !pages.checked && !(state?.status === 'available' && state.toolProtocols?.webFetch === 1);
        workspace.checked=controller.workspaceEnabled?.()===true;workspace.disabled=check.disabled||typeof controller.setWorkspaceEnabled!=='function'||!workspace.checked&&!(state?.status==='available'&&state.toolProtocols?.workspaceWrite===1);
        json.checked=controller.jsonEnabled?.()===true;json.disabled=check.disabled||typeof controller.setJsonEnabled!=='function'||!json.checked&&!(state?.status==='available'&&state.toolProtocols?.jsonValidate===1);
        for (const { input, protocol, status } of capabilityRows) {
            const supported = state?.status === 'available' && state.toolProtocols?.[protocol] === 1;
            status.textContent = state === null
                ? t('尚未检查 · ', 'Not checked · ') + (input.checked ? t('已保存开启偏好', 'enabled preference saved') : t('默认关闭', 'off'))
                : !supported
                    ? t('当前服务不可用或不支持', 'Unavailable or unsupported') + (input.checked ? t(' · 偏好保留，工具不会提供', ' · preference retained, tool not offered') : '')
                    : input.checked ? t('支持 · 已开启，下一任务按需使用', 'Supported · enabled for the next task') : t('支持 · 未开启', 'Supported · off');
        }
    }
    async function run(action, pending = t('正在保存偏好…', 'Saving preference…')) {
        if (disposed || busy || controller.snapshot().busy || controller.snapshot().resetting) return;
        busy = true; render(); output.textContent = pending;
        try { const text = await action(); if (!disposed) output.textContent = text; }
        catch (error) { if (!disposed) output.textContent = errors[error?.message] || t('服务检查暂不可用，请检查酒馆连接后重试。', 'Service check unavailable. Check the ST connection and retry.'); }
        finally { busy = false; if (!disposed) render(); }
    }
    check.onclick = () => run(async () => {
        state = null;
        const result = await controller.checkServices(); if (disposed) return ''; state = result;
        if (result.status !== 'available') return ({ legacy: t('旧版服务已加载；原有功能不变。更新并重启后可检查能力与存储。', 'Legacy service loaded; existing features are unchanged. Update and restart for capability/storage checks.'),
            missing: t('未发现服务：可能未安装、未启用或未重启。无需服务也可正常聊天与保存到浏览器／账户设置。', 'Service not found: missing, disabled or restart required. Chat and browser/account-settings storage remain usable.'),
            incompatible: errors.SERVICE_INCOMPATIBLE }[result.status] || errors.SERVICE_INCOMPATIBLE);
        const yes = t('支持', 'supported'), no = t('不支持', 'unsupported');
        return t('服务版本', 'Service version') + ': ' + result.serviceVersion + ' · ' +
            t('文件历史', 'File history') + ': ' + (result.capabilities.history ? yes : no) + ' · ' +
            t('搜索', 'Search') + ': ' + (result.capabilities.search ? yes : no) + '\n' +
            t('本地资料检索', 'Local document search') + ': ' + (result.toolProtocols?.documentSearch === 1 ? yes : no) + ' · ' +
            t('公开网页正文', 'Public page text') + ': ' + (result.toolProtocols?.webFetch === 1 ? yes : no) + ' · ' +
            t('工作区草稿','Workspace drafts')+': '+(result.toolProtocols?.workspaceWrite===1?yes:no)+' · '+
            t('JSON校验','JSON validation')+': '+(result.toolProtocols?.jsonValidate===1?yes:no)+' · '+
            t('每命名空间容量：', 'Per-namespace limits: ') + result.limits.records + t('份对话', ' conversations') + ' / ' + (result.limits.totalBytes / 1048576) + ' MiB · ' +
            t('每份', 'Each') + ' ' + (result.limits.recordBytes / 1048576) + ' MiB / ' + result.limits.messages + t('条消息；存储写入尚未测试。', ' messages; storage writes not yet tested.');
    }, t('正在检查…', 'Checking…'));
    documents.onchange = () => {
        const enabled = documents.checked;
        return run(async () => {
            const result = await controller.setDocumentsEnabled(enabled);
            if (!enabled) return t('本地资料工具已关闭。', 'Local document tools disabled.');
            if (disposed) return ''; state = result;
            return result.status === 'available' && result.toolProtocols?.documentSearch === 1
                ? t('本地资料检索已启用；下一任务可按需使用，读取仍遵守资料授权。', 'Local document search enabled for the next task; reads still require data consent.')
                : t('启用偏好已保存，但当前服务不支持这项能力。请更新全部服务文件并重启酒馆；普通对话不受影响。', 'Preference saved, but the current service lacks this capability. Update all service files and restart ST; normal chat is unaffected.');
        });
    };
    pages.onchange = () => {
        const enabled = pages.checked;
        return run(async () => {
            const result = await controller.setPagesEnabled(enabled);
            if (!enabled) return t('公开网页读取已关闭。', 'Public page reading disabled.');
            if (disposed) return ''; state = result;
            return result.status === 'available' && result.toolProtocols?.webFetch === 1
                ? t('已允许下一任务按需读取公开网页；网址外发到目标网站，正文外发到模型。', 'Public page requests allowed for the next task; URLs go to websites and text to the model.')
                : t('偏好已保存，但服务不支持网页正文。更新服务全部文件并重启酒馆，普通对话不受影响。', 'Preference saved, but this service lacks page reading. Update all service files and restart ST; normal chat is unaffected.');
        });
    };
    workspace.onchange=()=>{const enabled=workspace.checked;return run(async()=>{const v=await controller.setWorkspaceEnabled(enabled);if(disposed)return '';if(enabled)state=v;return !enabled?t('工作区工具已关闭，旧草稿失效。','Workspace tools disabled; prior drafts invalidated.'):v?.toolProtocols?.workspaceWrite===1?t('工作区草稿已启用，下一任务生效；写入仍需精确批准。','Workspace drafts enabled for next task; exact approval is still required.'):t('偏好已保存，但服务不支持；请更新并重启酒馆。','Preference saved but unsupported; update and restart ST.');});};
    json.onchange=()=>{const enabled=json.checked;return run(async()=>{const v=await controller.setJsonEnabled(enabled);if(disposed)return '';if(enabled)state=v;return !enabled?t('JSON校验已关闭。','JSON validation disabled.'):v?.toolProtocols?.jsonValidate===1?t('JSON语法校验已启用，下一任务生效。','JSON syntax validation enabled for next task.'):t('偏好已保存，但服务不支持；请更新并重启酒馆。','Preference saved but unsupported; update and restart ST.');});};
    storage.onclick = () => {
        if (storage.disabled || disposed) return;
        return run(async () => {
            const result = await controller.checkServiceStorage();
            if (result.status === 'ok') return t('自检通过：临时文件写入、读回与清理成功。不代表已有对话已保存或未来写入必然成功。', 'Test passed: temporary write, read-back and cleanup succeeded. This does not confirm existing conversations are saved or guarantee future writes.');
            return (errors[result.error] || errors.SERVICE_STORAGE_UNAVAILABLE) + ' · ' + t('失败阶段', 'Failed stage') + ': ' +
                ({ prepare: t('准备目录', 'prepare directory'), write: t('写入', 'write'), read: t('读回', 'read'), cleanup: t('清理', 'cleanup') }[result.stage] || t('未知', 'unknown')) +
                (result.cleanup === 'failed' ? t(' · 临时文件未清理成功，请检查服务端目录权限。', ' · Temporary cleanup failed; check server permissions.') : '');
        }, t('正在测试临时文件…', 'Testing a temporary file…'));
    };
    render(); return { render, dispose() { disposed = true; diagnosticsView.dispose(); } };
}
