import { createBuiltinArtifactViews } from './artifact-views.js';
import { createSkillView } from './skill-view.js';
import { createDisplayPreferencesView } from './display-preferences-view.js';
import { createThemeSwitcher } from './theme-switcher.js';
import { createStPromptSnapshotsView } from './st-prompt-snapshots-view.js';
import { createStDiagnosticsView } from './st-diagnostics-view.js';
import { createDiagnosticExportView } from './diagnostic-export-view.js';
import { UI_LABELS } from './navigation-metadata.js';
import { createSkillPicker } from './skill-picker.js';
import { MAX_MESSAGE_BYTES } from '../context/policy.js';
import { memoryFields } from '../modules/config-draft/contracts.js';
import { processLabel } from './process-view.js';
import { taskCatalog } from '../modules/catalog.js';
import { RUN_DEFAULTS, RUN_RANGES } from '../core/budget.js';
import { formatBudget, budgetReasonLabel } from './budget-view.js';
import { createHistoryView } from './history-view.js';
import { historyErrorLabel } from './history-error.js';
import { createContextView } from './context-view.js';
import { createInstructionView } from './instruction-view.js';
import { createAgentMemoryView } from './agent-memory-view.js';
import { createSettingsLayout } from './settings-layout.js';
import { createInteractionView } from './interaction-view.js';
import { createPermissionView } from './permission-view.js';
import { permissionDisplayTitle } from './catalog-labels.js';
import { createReceiptView } from './receipt-view.js';
import { createCheckpointView } from './checkpoint-view.js';
import { createWebSearchView } from './web-search-view.js';
import { createConnectionTools } from './connection-tools.js';
import { createConnectionForm, validateConnectionFields } from './connection-form.js';
import { createFormFeedback } from './form-feedback.js';
import { bindAutoSave } from './auto-save.js';
import { createTranscriptView } from './transcript-view.js';
import { createScrollFollow } from './scroll-follow.js';
import { errorDestination } from './error-navigation.js';

/** Safe Markdown view. The controller owns all state and execution. */
export function mountMuyuPanel(root, controller, { lang = 'zh', navigateMemory = () => {}, navigateDirector = () => {}, standalone = false, actionsRoot = null, resetLayout = () => {}, setSidebarOpen, setViewExpanded = () => {} } = {}) {
    root.__gdMuyuDispose?.(); const doc = root.ownerDocument, en = lang === 'en';
    const t = (zh, english) => en ? english : zh;
    const permissionTitle = id => permissionDisplayTitle(id, lang);
    const unified = controller.snapshot().mode === 'assistant';
    const artifactViews = createBuiltinArtifactViews();
    const legacyRoot = doc.createElement('div'); // Detached compatibility controls for legacy embedders only.
    const node = (tag, text, parent = root) => { const e = doc.createElement(tag); if (text) e.textContent = text; parent.append(e); return e; };
    const button = (label, parent) => { const e = node('button', label, parent); e.type = 'button'; e.className = 'menu_button'; return e; };
    const field = (label, type, parent) => { const wrapper = node('label', label, parent), input = node('input', '', wrapper); input.type = type; if (type !== 'checkbox') input.className = 'text_pole'; return input; };
    root.classList.add('gd-muyu-entry');
    // Theme belongs to the floating host, never documentElement or Tavern settings.
    let appearanceHost = root;
    while (appearanceHost && !appearanceHost.classList?.contains?.('gd-floating-root')) appearanceHost = appearanceHost.parentElement || appearanceHost.parent;
    const shell = node(standalone ? 'div' : 'details', ''), title = node(standalone ? 'h3' : 'summary', t('暮羽助手 · 实验版', 'Muyu assistant · Experimental'), shell);
    title.setAttribute('aria-label', title.textContent);
    shell.className = standalone ? 'gd-muyu-chat-shell' : '';
    if (standalone) { root.classList.add('gd-muyu-floating'); title.hidden = true; }
    const body = node('div', '', shell); body.className = 'gd-muyu-panel';
    const themeSwitcher = createThemeSwitcher({ doc, parent: actionsRoot, controller, act, lang });
    const gear = button('⚙', actionsRoot || body); gear.className += ' gd-muyu-settings-toggle'; gear.setAttribute('aria-label', t('暮羽配置', 'Muyu settings')); gear.title = t('暮羽配置', 'Muyu settings');
    const connection = node('section', '', body); connection.className = 'gd-muyu-settings'; connection.hidden = true;
    const back = button(t('返回聊天', 'Back to chat'), connection);
    const settingsLayout = createSettingsLayout({ doc, root: connection, lang });
    const connectionForm = createConnectionForm({ doc, parent: settingsLayout.pages.connection, lang });
    const { source, hostStatus, hostTest, hostTestStatus, endpoint, model, key, profile, thinking, effort, rememberKey, autoConnect, savedKeyStatus, forgetKey } = connectionForm;
    let hostProbe = null;
    source.addEventListener('change', () => { hostProbe?.abort(); hostTestStatus.textContent = ''; });
    const initialConnection = controller.snapshot().connection;
    const savedConnection = controller.snapshot().savedConnection;
    if (savedConnection && initialConnection?.source === 'st') {
        endpoint.value = savedConnection.endpoint; model.value = savedConnection.model; profile.value = savedConnection.profile || 'deepseek';
        thinking.checked = savedConnection.thinking; effort.value = savedConnection.reasoningEffort || 'high';
    }
    source.value = initialConnection?.source || (initialConnection || savedConnection ? 'independent' : controller.snapshot().hostConnection?.available ? 'st' : 'independent');
    connectionForm.refreshOptions();
    rememberKey.checked = initialConnection?.source === 'st' ? !!savedConnection : initialConnection ? initialConnection.remembered !== false : true;
    autoConnect.checked = initialConnection?.source === 'st' ? savedConnection?.autoConnect === true : initialConnection ? initialConnection.autoConnect === true : savedConnection ? savedConnection.autoConnect === true : true;
    rememberKey.onchange = () => { if (!rememberKey.checked) autoConnect.checked = false; };
    autoConnect.onchange = () => { if (autoConnect.checked) rememberKey.checked = true; };
    const connect = button(t(...UI_LABELS.enableConnection), connectionForm.actions), disable = button(t('禁用连接', 'Disable connection'), connectionForm.actions);
    const connectionFeedback = createFormFeedback({ doc, parent: connectionForm.actions, fields: [source, endpoint, model, key, profile, thinking, effort, rememberKey, autoConnect], buttons: [connect, disable, forgetKey], lang,
        dirtyText: t('表单已修改，尚未启用这些修改。', 'Draft changed; these changes are not active.'), busyText: t('正在启用连接…', 'Enabling connection…'), savedText: t('连接已启用。', 'Connection enabled.'),
        errorText: error => error?.message === 'CREDENTIAL_SAVE_FAILED' ? t('密钥设置未能确认保存，输入已保留。', 'Credential settings could not be saved. Input retained.') : t('连接未能启用，输入已保留，请检查配置。', 'Connection could not be enabled. Input retained; check the configuration.') });
    const validateConnectionDraft = kind => validateConnectionFields(connectionForm, controller.snapshot().savedConnection, (field, code) => {
        const labels = { 'Invalid model endpoint': t('请输入有效的 HTTPS 完整地址，以 /chat/completions 结尾，不带查询参数。', 'Enter a valid full HTTPS URL ending in /chat/completions, without query parameters.'), 'Invalid model credential': t('请填写有效密钥；只有同地址已保存的密钥可留空复用。', 'Enter a valid key, or leave blank to reuse a saved key at the same endpoint.'), 'Invalid model name': t('请输入模型 ID（1–128 字符）。', 'Enter a model ID (1–128 characters).') };
        connectionFeedback.invalid(field, labels[code] || t('请检查协议与思考选项。', 'Check protocol and thinking options.'));
    }, kind);
    connectionFeedback.rebase();
    const connectionTools = createConnectionTools({ doc, parent: connectionForm.modelArea, endpoint, model, key, profile, thinking, effort, controller, lang, validate: validateConnectionDraft, onDraftChange: () => connectionFeedback.edited() });
    node('small', t('禁用停止任务，但不删除历史；密钥请使用“清除已保存密钥”。', 'Disabling stops tasks, not history storage. Use Forget saved key to erase the saved credential.'), settingsLayout.pages.connection);
    node('h3', t('上下文与权限', 'Context and permissions'), settingsLayout.pages.data);
    node('p', t('资料读取授权在本连接内复用，并按聊天隔离。撤销会停止任务、清除运行产物并打开空白会话；已有对话是否再次外发由上下文设置中的自动允许／逐次审批决定，不恢复新读取权限。不能撤回已发送的数据。', 'Read grants are reused per connection and isolated per chat. Revoking stops tasks, clears live artifacts and opens a blank conversation. Resending existing history follows the automatic/approval context setting, without restoring fresh read access. Sent data cannot be recalled.'), settingsLayout.pages.data);
    const diagnosticPermission = field(t('插件诊断信息（白名单配置、匿名统计与运行状态）', 'Plugin diagnostics (whitelist settings, anonymous counts and state)'), 'checkbox', unified ? legacyRoot : settingsLayout.pages.data);
    const chatPermission = field(t('当前聊天资料（消息、总结、档案、记忆正文及名称）', 'Current chat data (messages, summary, profiles, memories and names)'), 'checkbox', unified ? legacyRoot : settingsLayout.pages.data);
    const extendedPermission = field(t('扩展剧情上下文（当前已加载历史分段读取、参聊角色卡、导演历史账本正文）', 'Extended story context (loaded chat history in ranges, participant cards, director ledger bodies)'), 'checkbox', unified ? legacyRoot : settingsLayout.pages.data);
    const accessLabel = node('label', t('授权模式', 'Access mode'), settingsLayout.pages.data);
    const fullAccessToggle = node('select', '', accessLabel); fullAccessToggle.className = 'text_pole';
    for (const [value, label] of [['ask', t('逐项审批', 'Ask for access')], ['all', t('阅读全开，修改审批', 'Allow reads; approve changes')], ['full', t('全权限（危险，仅本连接）', 'Full access (dangerous; this connection)')]]) { const option = node('option', label, fullAccessToggle); option.value = value; }
    node('small', t('阅读全开会将按需读取的资料发送给当前模型服务商，不批准写入、代码执行或业务生成。偏好保存在本地插件设置；联网仍由小地球控制。运行或等待授权时请先停止／取消任务再切换。', 'Allow reads sends requested data to the current model provider. It does not authorize writes, code execution or business generation. The preference is saved in local extension settings; web search follows the globe. Stop/cancel running or pending authorization tasks before switching.'), settingsLayout.pages.data);
    const fullAccessConfirm = node('section', '', settingsLayout.pages.data); fullAccessConfirm.className = 'gd-muyu-danger-confirm'; fullAccessConfirm.hidden = true;
    node('strong', t('确认开启全权限模式？', 'Enable full-access mode?'), fullAccessConfirm);
    node('p', t('开启后可读取资料、执行 Provider 代码并直接应用配置；可能修改数据、产生费用，且无法可靠撤销。仅本连接有效。', 'This permits reads, Provider code execution and direct settings writes. It may change data, incur costs and cannot reliably be undone. This connection only.'), fullAccessConfirm);
    const acceptFullAccess = button(t('我了解风险，开启', 'I understand the risk, enable'), fullAccessConfirm);
    const cancelFullAccess = button(t('保持关闭', 'Keep disabled'), fullAccessConfirm);
    node('small', t('开启后，本连接内的资料读取、已注册 Provider 代码执行及暮羽明确提出的配置／整单写入无需逐次确认。代码可能联网、修改数据或产生费用；保存可能部分完成且无法可靠撤销。仍受工具白名单、当前聊天范围和预算限制。更换连接或刷新即关闭。', 'While enabled, reads, registered Provider code execution, and Muyu-requested settings/bundle writes need no per-action approval. Code may access the network, change data or incur costs; saves may partially complete and cannot reliably be undone. Tool allowlists, chat scope and budgets still apply. Reconnection or reload turns it off.'), settingsLayout.pages.data);
    const permissionSettings = node('section', '', settingsLayout.pages.data);
    for (const child of Array.from(settingsLayout.pages.data.children)) {
        if (child !== permissionSettings && !['gd-muyu-settings-hint', 'gd-muyu-settings-page-title'].includes(child.className)) permissionSettings.append(child);
    }
    const budgetSettings = node('details', '', settingsLayout.pages.limits); budgetSettings.className = 'gd-muyu-settings-card'; node('summary', t('运行与预算', 'Execution budgets'), budgetSettings);
    node('small', t('自动保存：完成数字编辑后保存；无效输入不生效，保存失败可重试。', 'Auto-save after finishing numeric edits. Invalid values do not apply; failed saves can be retried.'), budgetSettings);
    node('p', t('保存后从下一轮生效，不改变正在执行的任务。模型调用上限包含最后一次无工具收尾。默认超时300秒，可设置10–1800秒；增加预算可能增加费用。', 'Saved settings apply to the next run only. Model-call limit includes final answer-only closure. Default timeout: 300 seconds; configurable from 10–1800 seconds. Higher budgets may cost more.'), budgetSettings);
    const budgetGrid = node('div', '', budgetSettings); budgetGrid.className = 'gd-muyu-settings-grid';
    const budgetFields = Object.entries({ modelCalls: t('模型调用次数', 'Model calls'), toolCalls: t('工具调用次数', 'Tool calls'), timeMs: t('单轮超时（秒）', 'Run timeout (seconds)'), maxTokens: t('单次模型输出上限（Token）', 'Output tokens per model call'), providerBytes: t('资料读取预算（UTF-8字节）', 'Provider data budget (UTF-8 bytes)') }).map(([name, label]) => {
        const input = field(label, 'number', budgetGrid), scale = name === 'timeMs' ? 1000 : 1;
        input.min = RUN_RANGES[name][0] / scale; input.max = RUN_RANGES[name][1] / scale; input.step = 1;
        node('small', `${input.min}–${input.max}`, input.parentElement || input.parent);
        return { name, input, scale };
    });
    node('small', t('回答被截断：调整输出上限。提示输入超限：调整下方上下文预算。读取资料不够：调整资料读取预算。', 'Truncated answer: adjust output tokens. Input limit reached: adjust context budget below. Data limit reached: adjust the provider data budget.'), budgetSettings);
    const budgetActions = node('div', '', budgetSettings); budgetActions.className = 'gd-muyu-settings-actions';
    const saveBudget = button(t('保存运行预算', 'Save execution budgets'), budgetActions), resetBudget = button(t('恢复默认预算并保存', 'Restore and save defaults'), budgetActions);
    const budgetFeedback = createFormFeedback({ doc, parent: budgetActions, fields: budgetFields.map(f => f.input), buttons: [saveBudget, resetBudget], retryButton: saveBudget, lang, savedText: t('设置已更新，下次任务生效。', 'Settings updated; applies to the next task.') });
    bindAutoSave(budgetFields.map(f => f.input), saveBudget, lang, () => budgetFeedback.dirty);
    node('small', unified ? t('暮羽需要资料时会说明来源、用途与发送目的地，请按需批准。读取授权不批准修改；不会读取其他聊天或整个角色库。', 'Muyu requests sources when needed and shows the purpose and destination. Read access does not approve changes or access other chats or the whole character library.') : t('扩展权限独立开启并在当前聊天内复用，不读取其他聊天或整个角色库。角色卡内的提示词和导演原因仅作资料，不代表实际执行。', 'Extended access is opt-in and reused only in this chat, not other chats or the whole character library. Card prompts and director reasons are data, not proof of execution.'), settingsLayout.pages.data);
    budgetSettings.open = true;
    if (standalone) button(t('重置窗口大小', 'Reset window size'), settingsLayout.pages.behavior).onclick = resetLayout;
    const workspace = node('div', '', body); workspace.className = 'gd-muyu-workspace';
    const sidebarRoot = node('div', '', workspace); sidebarRoot.className = 'gd-muyu-sidebar-slot';
    const chat = node('div', '', workspace); chat.className = 'gd-muyu-chat';
    const historyView = createHistoryView({ doc, settings: settingsLayout.pages.storage, chat, workspace, sidebarRoot, controller, act, lang, setSidebarOpen, openServices: () => webSearchView.openServices(), launcherActions: actionsRoot });
    const setupBar = node('div', '', chat); setupBar.className = 'gd-muyu-connection-entry';
    const setupLabel = node('strong', t('AI 接口', 'AI connection'), setupBar);
    const setup = button(t('配置连接', 'Configure connection'), setupBar);
    const tools = node('details', '', chat); tools.className = 'gd-muyu-conversation-tools';
    node('summary', t('会话工具 · 上下文与开销', 'Conversation tools · Context & usage'), tools);
    const toolContent = node('div', '', tools); toolContent.className = 'gd-muyu-conversation-tools-content';
    const diagnosticExportView = createDiagnosticExportView({ doc, parent: toolContent, controller, lang });
    const transcript = node('div', '', chat); transcript.className = 'gd-muyu-transcript';
    const welcome = node('div', '', transcript); welcome.className = 'gd-muyu-welcome';
    node('h3', t('今天想一起解决什么？', 'What shall we work on today?'), welcome);
    node('p', t('你好，我是暮羽，你的猫头鹰搭档。聊剧情、查资料、排问题，或一起调整配置、管理世界书和角色卡——直接说你想做什么就好。', 'Hi, I’m Muyu, your owl companion. We can explore the story, look things up, troubleshoot, adjust settings, or manage world books and character cards—just tell me what you have in mind.'), welcome).className = 'gd-muyu-welcome-description';
    node('p', t('聊剧情、查资料，或一起打理酒馆。', 'Explore the story, look things up, or tend the tavern together.'), welcome).className = 'gd-muyu-welcome-compact';
    node('p', t('我在，想一起处理什么？', 'I’m here. What shall we work on?'), welcome).className = 'gd-muyu-welcome-input';
    const history = node('div', '', transcript); history.className = 'gd-muyu-history'; history.setAttribute('aria-label', t('对话记录', 'Conversation'));
    const cards = node('div', '', transcript);
    const receiptView = createReceiptView({ doc, parent: transcript, controller, act, lang, locateArtifact: (id, revision) => { const element = transcriptView.findArtifact(id, revision); if (element) scrollFollow.locate(element); } });
    const checkpointView = createCheckpointView({ doc, parent: transcript, controller, act, lang });
    const interactionView = createInteractionView({ doc, parent: transcript, controller, act, lang });
    const permissionView = createPermissionView({ doc, parent: transcript, settings: settingsLayout.pages.data, controller, act, lang });
    const latest = button(t('返回最新内容', 'Return to latest'), chat); latest.className += ' gd-muyu-return-latest'; latest.hidden = true;
    const fullAccessBanner = node('small', t('⚠ 全权限模式已开启：暮羽可读取资料、执行 Provider 并直接应用其请求的修改；请留意任务和操作回执。', '⚠ Full-access mode: Muyu may read data, execute Providers and apply requested changes without further confirmation. Watch task progress and receipts.'), chat);
    fullAccessBanner.className = 'gd-muyu-full-access-warning'; fullAccessBanner.hidden = true;
    const composer = node('div', '', chat); composer.className = 'gd-muyu-composer';
    const status = node('p', '', composer); status.className = 'gd-muyu-chat-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const permissionSummary = button('', toolContent); permissionSummary.className += ' gd-muyu-permission-summary';
    const usageDetails = node('details', '', toolContent); node('summary', t('本轮开销与限制', 'Run usage and limits'), usageDetails); const usageText = node('p', '', usageDetails);
    const contextView = createContextView({ doc, settings: settingsLayout.pages.limits, parent: toolContent, controller, act, lang });
    const instructionView = createInstructionView({ doc, settings: settingsLayout.pages.behavior, controller, act, lang });
    const displayView = createDisplayPreferencesView({ doc, settings: settingsLayout.pages.behavior, controller, act, lang });
    const promptSnapshotsView = createStPromptSnapshotsView({doc,settings:settingsLayout.pages.data,controller,act,lang});
    const diagnosticsView = createStDiagnosticsView({ doc, settings: settingsLayout.pages.data, controller, act, lang });
    const skillView = controller.snapshot().skills?.available ? createSkillView({ doc, settings: settingsLayout.pages.skills, controller, act, lang }) : { render() {} };
    const agentMemoryView = createAgentMemoryView({ doc, settings: settingsLayout.pages.storage, controller, act, lang });
    const inputBox = node('div', '', composer); inputBox.className = 'gd-muyu-input-box';
    const skillPicker = controller.snapshot().skills?.available ? createSkillPicker({ doc, parent: inputBox, controller, act, lang }) : { render() {} };
    const inputLabel = node('label', t('给暮羽的消息', 'Message to Muyu'), inputBox), input = node('textarea', '', inputLabel); input.className = 'text_pole'; input.rows = 3; input.maxLength = MAX_MESSAGE_BYTES;
    const recoveryBar = node('div', '', inputBox); recoveryBar.className = 'gd-muyu-recovery'; recoveryBar.hidden = true;
    const recoveryNote = node('small', '', recoveryBar), restoreInput = button(t('恢复失败问题到输入框', 'Restore failed question to composer'), recoveryBar);
    let recoveryRunId = null;
    inputLabel.className = 'gd-muyu-input-label'; input.setAttribute('aria-label', t('给暮羽的消息', 'Message to Muyu'));
    input.placeholder = t('向暮羽提问，或描述你想排查的问题…', 'Ask Muyu a question, or describe what needs investigating…');
    const inputToolbar = node('div', '', inputBox); inputToolbar.className = 'gd-muyu-input-toolbar';
    const toolsButton = button('⋯', inputToolbar); toolsButton.className += ' gd-muyu-mobile-tools';
    toolsButton.setAttribute('aria-label', t('会话工具与开销', 'Conversation tools and usage'));
    toolsButton.onclick = () => { tools.open = !tools.open; updateViewSize(); };
    tools.addEventListener('toggle', () => { if (!disposed) updateViewSize(); });
    const webSearchView = createWebSearchView({ doc, settings: settingsLayout.pages.skills, serviceSettings: settingsLayout.pages.storage, openServices: target => showSettings(true, 'storage', target), toolbar: inputToolbar, composer, controller, act, openSettings: target => target ? showSettings(true, 'skills', target) : showSettings(true, 'connection', endpoint), lang });
    const modeLabel = node('label', t('任务', 'Task'), unified ? legacyRoot : inputToolbar), mode = node('select', '', modeLabel); mode.className = 'text_pole'; modeLabel.className = 'gd-muyu-mode';
    for (const [value, task] of Object.entries(taskCatalog)) { const option = node('option', t(...task.label), mode); option.value = value; }
    const authorization = node('section', '', unified ? legacyRoot : composer); authorization.className = 'gd-muyu-authorization'; authorization.hidden = true;
    node('strong', t('授权与发送', 'Authorize and send'), authorization);
    const activeConnection = node('small', '', authorization);
    node('p', t('你的输入及本会话历史会发给该服务。草稿不会自动应用。', 'Your input and this conversation history go to this service. Drafts are never applied automatically.'), authorization);
    const consent = field(t('本次允许发送白名单设置和匿名记忆统计（不含正文或身份）', 'Allow whitelist settings and anonymous memory counts for this request (no bodies or identities)'), 'checkbox', authorization);
    const consentLabel = consent.parentElement || consent.parent;
    const consentText = doc.createElement('span');
    // Keep the checkbox node stable while switching task-specific permission wording.
    consentLabel.textContent = ''; consentLabel.replaceChildren(); consentLabel.className = 'gd-muyu-consent'; consentLabel.append(consentText); consentLabel.append(consent);
    const scope = node('fieldset', '', authorization); node('legend', t('本次允许草稿修改的字段（影响所有聊天）', 'Fields this draft may change (all chats)'), scope);
    const labels = [t('记忆总开关', 'Memory enabled'), t('自动提取开关', 'Automatic extraction'), t('新增消息间隔', 'New-message interval'), t('仅发言角色', 'Speakers only')];
    const fields = memoryFields.map((name, i) => [name, field(labels[i], 'checkbox', scope)]);
    const confirm = button(t('确认发送', 'Confirm and send'), authorization), cancelAuth = button(t('返回编辑', 'Keep editing'), authorization);
    const withoutData = button(t('仅发送问题，不读取聊天资料', 'Send without chat data'), authorization);
    const followLabel = node('label', t('修改已有草稿，或开始新任务', 'Revise a draft, or start a new task'), unified ? legacyRoot : composer), follow = node('select', '', followLabel); follow.className = 'text_pole';
    const actions = node('div', '', inputToolbar); actions.className = 'gd-muyu-actions';
    const send = button(t('发送', 'Send'), actions), stop = button(t('停止', 'Stop'), actions);
    send.className += ' gd-muyu-send'; stop.className += ' gd-muyu-stop';
    const inputHint = node('small', t('Ctrl+Enter 发送 · Enter 换行', 'Ctrl+Enter to send · Enter for a new line'), composer); inputHint.className = 'gd-muyu-input-hint';
    const historyAuthorization = node('section', '', composer); historyAuthorization.className = 'gd-muyu-interaction'; historyAuthorization.hidden = true;
    node('strong', t('继续对话需要确认历史外发', 'Confirm sending conversation history'), historyAuthorization);
    const historySources = node('p', '', historyAuthorization);
    node('small', t('旧回答可能引用这些资料。本连接内允许此会话携带已有对话；不会授权重新读取酒馆资料、修改配置或执行代码。更换连接或撤销资料权限后需重新确认。', 'Earlier answers may quote these sources. Allow this conversation’s existing history for this connection only; this does not grant fresh host reads, writes or code execution. Reconnect or revoke data access to reset.'), historyAuthorization);
    const historyActions = node('div', '', historyAuthorization); historyActions.className = 'gd-muyu-actions';
    const allowHistory = button(t('允许携带已有对话', 'Allow existing history'), historyActions);
    const omitHistory = button(t('本次不带历史', 'Omit history this send'), historyActions);
    allowHistory.onclick = () => act(() => controller.allowHistory());
    omitHistory.onclick = () => act(() => controller.setOmitHistory(true));
    const errors = node('p', '', body); errors.setAttribute('role', 'alert');
    const errorActions = node('div', '', body); errorActions.className = 'gd-muyu-error-actions'; errorActions.hidden = true;
    const errorEntry = button('', errorActions);
    let localErrorCode = null, localErrorIdentity = '', localErrorRun = null;
    const errorIdentity = s => JSON.stringify([s.viewKey, s.viewToken, s.connection]);
    function clearError() { errors.textContent = ''; localErrorCode = null; errorActions.hidden = true; }
    let unsubscribe, disposed = false, lastView = '', lastConnection = null, lastRunConfig = '';
    const transcriptView = createTranscriptView({ doc, history, cards, controller, act, lang, views: artifactViews, navigateDirector, navigateMemory, locateReceipt: id => { const element = receiptView.find(id); if (element) scrollFollow.locate(element); } });
    const scrollFollow = createScrollFollow({ viewport: transcript, onPosition: (key, top) => controller.setScrollPosition?.(key, top), onState: state => {
        latest.hidden = state.following;
        latest.setAttribute('data-unread', String(state.unread));
        latest.textContent = state.unread ? t('有新内容 · 返回最新内容', 'New content · Return to latest') : t('返回最新内容', 'Return to latest');
    } });
    latest.onclick = () => scrollFollow.latest();
    function resetAuthorization() { authorization.hidden = true; consent.checked = false; fields.forEach(([, f]) => { f.checked = false; }); }
    function updateViewSize() {
        const s = controller.snapshot();
        setViewExpanded(!!(!connection.hidden || s.interaction?.status === 'pending' || !historyAuthorization.hidden || !authorization.hidden || tools.open));
    }
    function showSettings(show, category, target) {
        if (!show) settingsLayout.setVisible(false);
        connection.hidden = !show; workspace.hidden = chat.hidden = show; gear.setAttribute('aria-expanded', String(show)); clearError();
        historyView.setVisible(!show);
        resetAuthorization(); if (!show) { key.value = ''; webSearchView.clearKey(); }
        updateViewSize();
        (show ? back : input).focus?.({ preventScroll: true });
        if (show) { settingsLayout.setVisible(true); if (category) settingsLayout.select(category, { target }); }
    }
    gear.onclick = () => showSettings(connection.hidden); back.onclick = () => showSettings(false); setup.onclick = () => showSettings(true, 'connection', endpoint);
    permissionSummary.onclick = () => showSettings(true, 'data', permissionView.settingsTarget);
    gear.setAttribute('aria-expanded', 'false');
    const notices = {
        HOST_CONNECTION_CHANGED: t('酒馆连接或密钥已变化，旧任务和授权已清除。请在模型连接中重新启用；未发送消息已保留。', 'ST connection or credentials changed. Old tasks and grants were cleared. Re-enable under Connection; unsent text was retained.'),
        HOST_CONNECTION_UNAVAILABLE: t('酒馆聊天补全连接未配置或版本接口不可用，请配置酒馆或选择独立接口。', 'ST Chat Completion connection is unavailable. Configure ST or use a separate connection.'),
        HOST_CONNECTION_UNSUPPORTED: t('此酒馆连接或自定义请求参数尚未适配，请使用独立接口。', 'This ST connection or custom request parameters are unsupported. Use a separate connection.'),
        HOST_MODEL_REQUEST_FAILED: t('酒馆后端请求失败，请检查酒馆连接、密钥与模型；未自动重试或切换接口。', 'ST backend request failed. Check the ST connection, credentials and model; no automatic retry or source switch occurred.'),
        HISTORY_SYNC_FAILED: t('任务已继续，但会话记录同步失败。请保留当前页面并检查日志或导出记录；不会因此撤销已批准的资料权限。', 'Task continued, but conversation record sync failed. Keep this page open and check logs or export the conversation; approved read permissions were not rolled back.'),
        CONTEXT_LIMIT: t('输入超过手动预算或请求体安全上限；未发送超限请求。可整理历史、缩短输入或调整预算。', 'Input exceeds the manual budget or request-size safety limit; the oversized request was not sent. Summarize history, shorten input or adjust the budget.'),
        CONTEXT_INCOMPLETE: t('无法完整携带摘要之后的历史，已停止以避免遗漏你的修正。请整理历史、增加预算，或明确选择不携带历史。', 'Stopped because the full history after the summary cannot fit. Summarize history, increase the budget, or explicitly omit history.'),
        MODEL_NETWORK_ERROR: t('网络请求失败，可能涉及 CORS；不代表密钥错误。', 'Network request failed; CORS is possible. This does not establish an invalid key.'),
        MODEL_AUTH_ERROR: t('服务拒绝认证或访问，请检查密钥与权限。', 'Service rejected authentication/access. Check credentials and permissions.'),
        MODEL_RATE_LIMIT: t('服务限流，请稍后手动重试。', 'Service rate limit; retry manually later.'),
        MODEL_SERVICE_ERROR: t('模型服务暂时失败。', 'Model service failed.'),
        MODEL_OUTPUT_TRUNCATED: t('模型输出被截断；查看本轮输出上限与服务商限制。', 'Model output was truncated; check the output limit and service restrictions.'),
        SUMMARY_TOO_LARGE: t('摘要超过 512 KiB 安全上限，未保存；原文和已有摘要保留。', 'Summary exceeded the 512 KiB safety limit and was not saved; originals and the existing summary remain.'),
        SUMMARY_NOT_SMALLER: t('摘要连同包装没有比原文更小，未替换已有摘要。', 'The framed summary did not reduce the original size; the existing summary was not replaced.'),
        AUTO_COMPACTION_BLOCKED: t('自动整理已因连续失败暂停，完整请求仍超预算，未发送。请手动整理、调整预算或明确恢复自动整理。', 'Automatic summarization is paused after repeated failures and the full request still exceeds budget; nothing was sent. Summarize manually, adjust budgets or explicitly resume.'),
        MODEL_HISTORY_UNAVAILABLE: t('服务缺少工具思考回传所需信息，未静默关闭思考。', 'Required thinking/tool history is unavailable; thinking was not silently disabled.'),
        TIMEOUT: t('任务超时，正在等待上游清理。', 'Task timed out; awaiting upstream cleanup.'),
        BUDGET_EXCEEDED: t('已达到任务预算，未继续调用。', 'Run budget reached; no further calls.'),
        MODEL_PROTOCOL_ERROR: t('模型响应或思考回传不符合接口协议；请检查接口与模型兼容性。', 'Model response or thinking replay violates the protocol; check endpoint/model compatibility.'),
        MODEL_FAILED: t('模型请求在本地准备或执行阶段失败；请查看过程中的安全错误码。', 'Model request failed during local preparation or execution; check the safe process error code.'),
        NO_CANDIDATE: t('模型未提交有效配置候选，未生成可用草稿。', 'No valid configuration candidate was submitted.'),
        RESULT_NEEDS_REVIEW: t('未能发布可信产物，证据可能缺失或已变化，请重新排查或生成。', 'Could not publish a verified artifact; evidence may be missing or changed. Run again.'),
        AUTO_APPLY_REQUIRES_REVIEW: t('本轮有未解决的工具失败，已保留草稿但未自动应用；请检查后手动确认。', 'A tool failure remains unresolved. Drafts were kept but not applied automatically; review and confirm them manually.'),
    };
    function showError(error) {
        const code = error?.message;
        const state = controller.snapshot(); localErrorCode = code; localErrorIdentity = errorIdentity(state); localErrorRun = state.runs.at(-1)?.id;
        if (notices[code]) { errors.textContent = notices[code]; return; }
        const webErrors = {
            WEB_KEY_REQUIRED: t('请配置独立的 Brave Search API 密钥；模型密钥不能用于搜索。', 'Configure a separate Brave Search API key; your model key cannot be used for search.'),
            WEB_BACKEND_MISSING: t('暮羽搜索服务未加载。请安装或更新服务端插件，开启 enableServerPlugins 并重启酒馆。', 'Muyu search service is not loaded. Install/update the server plugin, enable enableServerPlugins and restart ST.'),
            WEB_BACKEND_UNAVAILABLE: t('无法连接暮羽搜索服务，请检查酒馆服务是否运行。', 'Cannot reach the Muyu search service. Check that ST is running.'),
            WEB_BACKEND_INCOMPATIBLE: t('暮羽搜索服务版本不兼容，请更新原服务插件目录并重启酒馆。', 'Incompatible Muyu search service. Update the existing server plugin and restart ST.'),
            WEB_CONFIG_INVALID: t('搜索配置无效，请检查密钥与标注范围内的整数预算。', 'Invalid search settings. Check the key and integer budgets within the shown ranges.'),
            WEB_CONFIG_SAVE_FAILED: t('搜索配置未能确认保存，请重试。', 'Search settings persistence was not confirmed. Retry.'),
        };
        if (webErrors[code]) { errors.textContent = webErrors[code]; return; }
        if (code?.startsWith('ACTION_') || code === 'WRITE_UNAVAILABLE') { errors.textContent = t('应用请求不可用、已处理或已过期。请检查当前草稿并重新生成预览。', 'Application request unavailable, consumed or stale. Check the draft and generate a fresh preview.'); return; }
        if (code === 'INTERACTION_PENDING') { errors.textContent = t('请先回答或取消当前澄清问题。', 'Answer or cancel the pending clarification first.'); return; }
        if (code === 'INTERACTION_STALE' || code === 'INVALID_INTERACTION_ANSWER') { errors.textContent = t('问题已失效或回答无效；请检查当前问题，回答最多2000字符。', 'The question expired or the answer is invalid; check the active question (maximum 2000 characters).'); return; }
        if (code === 'INVALID_INSTRUCTION_CONFIG' || code === 'INSTRUCTION_CONFIG_SAVE_FAILED' || code === 'INSTRUCTION_CONFIG_UNAVAILABLE') { errors.textContent = t('行为偏好超出限制或未能确认保存；原配置仍有效，请检查并重试。', 'Behavior preferences exceed limits or saving was not confirmed; previous configuration remains active. Check and retry.'); return; }
        if (notices[code]) { errors.textContent = notices[code]; return; }
        if (code === 'NOTHING_TO_SUMMARIZE') { errors.textContent = t('暂无可整理的完整旧问答；保留近期问答，单次过长的问答不会截断整理。', 'No eligible complete older turns. Recent turns are retained and oversized turns are not split.'); return; }
        if (code === 'DISPLAY_CONFIG_SAVE_FAILED') { errors.textContent = t('主题未能保存，仍使用原配色，请重试。', 'Theme could not be saved; the previous appearance remains active. Retry.'); return; }
        if (code === 'INVALID_CONTEXT_CONFIG' || code === 'CONTEXT_CONFIG_SAVE_FAILED') { errors.textContent = t('上下文设置无效或保存失败，仍使用原配置。', 'Invalid context settings or save failed; previous configuration remains active.'); return; }
        if (historyErrorLabel(code, lang)) { errors.textContent = historyErrorLabel(code, lang); return; }
        if (code?.startsWith('HISTORY_')) { errors.textContent = code === 'HISTORY_PERMISSION_REQUIRED' ? t('旧对话含需授权的资料。可在会话工具中选择本次不带历史、在配置中授权，或新建对话。', 'Old history requires authorization. Omit history in conversation tools, authorize in settings, or start a new conversation.') : code === 'HISTORY_CAPACITY' ? t('已达到历史容量限制，请导出备份；单会话满时可新建对话。', 'History capacity reached. Export a backup; start a new conversation if this one is full.') : t('历史操作未完成，未自动覆盖或清除记录。请检查存储状态并重试。', 'History operation failed; records were not automatically overwritten or cleared. Check storage and retry.'); return; }
        if (code === 'CREDENTIAL_SAVE_FAILED') { errors.textContent = t('未能确认密钥设置已保存，请检查酒馆存储状态后重试。', 'Could not confirm credential persistence. Check ST storage and retry.'); return; }
        if (code === 'INVALID_RUN_CONFIG' || code === 'RUN_CONFIG_SAVE_FAILED') { errors.textContent = code === 'INVALID_RUN_CONFIG' ? t('预算必须是标注范围内的整数，未保存。', 'Budgets must be integers within the displayed bounds; not saved.') : t('未能确认预算保存，仍使用原配置。', 'Budget save was not confirmed; previous configuration remains active.'); return; }
        const recoveryErrors = { RECOVERY_NO_INTENT: ['此记录缺少完整恢复资料，请重新提出需求。', 'This record lacks complete recovery data. Submit a fresh request.'], RECOVERY_CONSUMED: ['此记录已经交给新的恢复操作，请查看其后续记录。', 'This record already has a recovery attempt. Review its follow-up record.'], RECOVERY_WRONG_TARGET: ['请先打开原酒馆聊天；不能在其他聊天续跑。', 'Open the original ST chat. Recovery cannot run in a different chat.'], RECOVERY_UNCERTAIN: ['有步骤的执行或保存结果不确定，请先人工核对；不会直接重跑。', 'A step has an uncertain execution or save result. Verify it manually; no direct replay.'], RECOVERY_COMPLETE: ['没有明确未执行的步骤，不需要续跑。', 'No definitely unexecuted steps remain.'], RECOVERY_CONFLICT: ['当前数据与原基线或已完成结果不符，已停止；请重新提出需求。', 'Current data differs from the original baseline or completed results. Stopped; submit a fresh request.'], RECOVERY_SAVE_FAILED: ['恢复检查点无法保存，未开始的操作已停止，请核对已有结果。', 'Recovery checkpoint could not be saved. Unstarted operations stopped; verify existing results.'] };
        if (code === 'RECOVERY_UNDO_UNSUPPORTED') { errors.textContent = t('此操作没有受支持的完整字段备份，不能直接撤回。仅支持保存已确认的普通配置，不恢复整仓、删除变量或执行代码。', 'This operation has no supported complete field backup. Undo only supports confirmed ordinary settings, not whole-store restoration, variable deletion or code execution.'); return; }
        if (recoveryErrors[code]) { errors.textContent = t(...recoveryErrors[code]); return; }
        if (code === 'RECOVERY_STALE' || code === 'DRAFT_EXISTS') { errors.textContent = code === 'DRAFT_EXISTS' ? t('输入框已有草稿；先处理或清空草稿，再恢复旧问题。', 'The composer already has a draft. Keep or clear it before restoring the old question.') : t('恢复记录或预览已变化，请重新核对；不会使用旧批准继续。', 'Recovery record or preview changed. Verify again; old approval cannot continue.'); return; }
        const known = { CONSENT_REQUIRED: t('请确认本次数据外发范围。', 'Confirm data sharing for this request.'), FIELD_SCOPE_REQUIRED: t('请选择本次可修改的字段。', 'Choose fields for this draft.'), CHAT_REQUIRED: t('请先打开聊天。', 'Open a chat first.'), EMPTY_INPUT: t('请输入问题。', 'Enter a question.'), NOT_READY: t('请先启用连接，或等待任务清理结束。', 'Enable a connection or wait for cleanup.'), STALE_DRAFT: t('草稿或配置已变化，请重新生成预览。', 'Draft/settings changed; generate a fresh preview.') };
        errors.textContent = known[code] || t('操作未完成，请检查连接配置、状态和输入。网络失败也可能是 CORS，禁止据此断言密钥错误。', 'Operation failed. Check connection, state and input. Network failure may be CORS, not necessarily invalid credentials.');
    }
    async function act(fn) { clearError(); try { await fn(); } catch (e) { showError(e); } if (!disposed && (standalone || shell.open)) render(); }
    function render() {
        if (disposed) return; const s = controller.snapshot();
        if (appearanceHost) appearanceHost.setAttribute('data-muyu-theme', ['dusk', 'light'].includes(s.displayConfig?.theme) ? s.displayConfig.theme : 'host');
        themeSwitcher.render(s);
        const newInteraction = scrollFollow.begin(s);
        historyView.render(s);
        webSearchView.render(s);
        contextView.render(s);
        receiptView.render(s);
        checkpointView.render(s);
        instructionView.render(s); displayView.render(s);
        diagnosticsView.render(s);
        promptSnapshotsView.render(s);
        agentMemoryView.render(s); skillView.render(s); skillPicker.render(s);
        interactionView.render(s);
        permissionView.render(s);
        fullAccessToggle.value = s.fullAccess ? 'full' : s.permissionConfig?.readAccess || 'ask'; fullAccessToggle.disabled = s.resetting || s.busy || s.savingPermissionConfig || s.interaction?.status === 'pending';
        acceptFullAccess.disabled = !s.enabled || s.resetting || s.busy;
        if (!s.enabled || s.resetting || s.fullAccess) fullAccessConfirm.hidden = true;
        setupLabel.textContent = t('AI 接口：', 'AI connection: ') + (s.enabled ? s.connection?.model || t('已连接', 'Connected') : t('未启用', 'Not enabled'));
        fullAccessBanner.hidden = !s.fullAccess && s.permissionConfig?.readAccess !== 'all';
        fullAccessBanner.textContent = s.fullAccess ? t('⚠ 全权限：读取、代码执行及请求的修改可直接进行。', '⚠ Full access: reads, code execution and requested changes may proceed directly.') : t('阅读全开 · 修改与执行需确认', 'Reads allowed · Changes and execution require approval');
        const config = s.runConfig || RUN_DEFAULTS, configSignature = JSON.stringify(config);
        if (configSignature !== lastRunConfig && !budgetFeedback.dirty && !budgetFeedback.busy) { for (const f of budgetFields) f.input.value = String(config[f.name] / f.scale); lastRunConfig = configSignature; budgetFeedback.rebase(); }
        saveBudget.disabled = resetBudget.disabled = !!s.savingRunConfig || s.resetting;
        budgetFeedback.update(s.savingRunConfig || s.resetting);
        const view = s.viewToken;
        const previousConnection = lastConnection;
        if (view !== lastView) { resetAuthorization(); lastView = view; }
        if (s.connection && JSON.stringify(s.connection) !== lastConnection) { source.value = s.connection.source || 'independent'; if (source.value !== 'st') { endpoint.value = s.connection.endpoint; model.value = s.connection.model; profile.value = s.connection.profile || 'deepseek'; thinking.checked = s.connection.thinking; effort.value = s.connection.reasoningEffort || 'high'; rememberKey.checked = s.connection.remembered !== false; autoConnect.checked = s.connection.autoConnect === true; } connectionForm.refreshOptions(); lastConnection = JSON.stringify(s.connection); }
        hostStatus.textContent = s.hostConnection?.available ? t('酒馆当前连接：', 'Current ST connection: ') + s.hostConnection.provider + ' · ' + s.hostConnection.model + ' · ' + s.hostConnection.endpoint : t('当前酒馆连接未配置、版本接口不可用或尚未支持。请配置酒馆的聊天补全连接，或使用独立接口。', 'ST connection is unavailable or unsupported. Configure a supported Chat Completion connection in ST or use a separate connection.');
        activeConnection.textContent = s.connection ? t('当前请求目标：', 'Active request destination: ') + s.connection.model + ' · ' + s.connection.endpoint : '';
        connectionForm.activeStatus.textContent = s.enabled && s.connection ? t('当前使用：', 'Currently using: ') + s.connection.model + ' · ' + s.connection.endpoint : t('当前未启用连接。', 'No active connection.');
        const task = taskCatalog[s.mode], granted = s.permissions?.[s.mode === 'chat' ? 'chat' : 'diagnostics'] === true;
        consentText.textContent = s.mode === 'chat' ? t(...task.consent) : t('允许本连接会话内读取记忆与导演白名单配置、匿名统计、运行状态和所选配置草稿；不含角色身份或聊天正文', 'Allow whitelist memory/director settings, anonymous counts, runtime state and selected drafts for this connection session; no character identities or chat bodies');
        consentLabel.hidden = granted; withoutData.hidden = s.mode !== 'chat';
        diagnosticPermission.checked = !!s.permissions?.diagnostics; chatPermission.checked = !!s.permissions?.chat; extendedPermission.checked = !!s.permissions?.extended;
        diagnosticPermission.disabled = !s.enabled || s.resetting || s.permissionConfig?.readAccess === 'all'; chatPermission.disabled = !s.enabled || s.resetting || !s.hasChat || s.permissionConfig?.readAccess === 'all';
        extendedPermission.disabled = chatPermission.disabled;
        permissionSummary.textContent = t('可读取：', 'Access: ') + [t('内置资料', 'Built-in docs'), ...(s.permissions?.diagnostics ? [t('诊断信息', 'Diagnostics')] : []), ...(s.permissions?.chat ? [t('当前聊天资料', 'This chat')] : [])].join(' · ');
        if (s.permissions?.extended) permissionSummary.textContent += t(' · 扩展剧情上下文', ' · Extended story context');
        if (unified) permissionSummary.textContent = t('资料权限 · ', 'Data access · ') + (s.sourceGrants?.length ? t('已允许 ', 'Allowed: ') + s.sourceGrants.length + t(' 项', ' sources') : t('需要时由暮羽申请', 'Muyu asks when needed'));
        if (s.fullAccess) permissionSummary.textContent = t('⚠ 全权限模式已开启', '⚠ Full-access mode enabled');
        else if (s.permissionConfig?.readAccess === 'all') permissionSummary.textContent = t('阅读全开 · 修改与执行需确认', 'Reads allowed · Changes and execution require approval');
        savedKeyStatus.textContent = s.savedConnection ? t('已保存密钥；相同接口可留空使用。', 'Saved key available; leave blank for the same endpoint.') : t('未保存密钥', 'No saved key');
        forgetKey.disabled = !s.savedConnection || s.resetting;
        if (!lastConnection && s.savedConnection && !s.connection) { endpoint.value = s.savedConnection.endpoint; model.value = s.savedConnection.model; profile.value = s.savedConnection.profile || 'deepseek'; thinking.checked = s.savedConnection.thinking; effort.value = s.savedConnection.reasoningEffort || 'high'; connectionForm.refreshOptions(); rememberKey.checked = true; autoConnect.checked = s.savedConnection.autoConnect === true; lastConnection = 'saved'; }
        status.textContent = [s.enabled ? t('已启用', 'Enabled') : t('未启用', 'Disabled'), (unified ? s.targetKind === 'chat' : task.scope === 'chat') ? t('绑定：当前聊天', 'Bound to current chat') : t('绑定：全局会话', 'Bound to global conversation'), s.resetting || s.draining ? t('等待上游清理…', 'Waiting for cleanup…') : s.busy ? t('运行中…', 'Running…') : t('空闲', 'Idle'), notices[s.notice] || ''].filter(Boolean).join(' · ');
        const latestProcess = s.runs.at(-1)?.process;
        if (localErrorCode && (localErrorIdentity !== errorIdentity(s) || localErrorRun !== s.runs.at(-1)?.id)) clearError();
        const errorCode = localErrorCode || s.notice || (s.runs.at(-1)?.status === 'failed' ? latestProcess?.error : null);
        const destination = errorDestination(errorCode, latestProcess?.budget?.reason);
        const historyAccessLabel = ['查看历史外发设置', 'Review history sending settings'];
        const labels = { context: ['调整输入上下文预算', 'Adjust input context budget'], output: ['调整单次输出上限', 'Adjust output limit'], time: ['查看单轮超时', 'Review run timeout'], dataBudget: ['调整资料读取预算', 'Adjust data read budget'], run: ['查看运行预算', 'Review execution budgets'], connection: ['检查模型连接', 'Check model connection'], permission: ['查看当前授权或问题', 'Review access or question'], storage: ['检查对话存储', 'Check conversation storage'], results: ['核对回执与检查点', 'Review receipts and checkpoints'] };
        errorActions.hidden = !destination || !connection.hidden || !!s.readOnly;
        errorEntry.disabled = destination === 'results' && receiptView.reviewTarget.hidden && checkpointView.reviewTarget.hidden;
        errorEntry.textContent = destination ? t(...(destination === 'historyAccess' ? historyAccessLabel : labels[destination])) : '';
        const routeIdentity = errorIdentity(s), routeRun = s.runs.at(-1)?.id;
        errorEntry.onclick = () => {
            const now = controller.snapshot();
            if (disposed || errorActions.hidden || now.readOnly || errorIdentity(now) !== routeIdentity || now.runs.at(-1)?.id !== routeRun) return;
            if (destination === 'permission') {
                if (now.interaction?.status === 'pending') { scrollFollow.locate(now.interaction.kind === 'permission' ? permissionView.operationTarget : interactionView.operationTarget); return; }
                showSettings(true, 'data', permissionView.settingsTarget); return;
            }
            if (destination === 'results') {
                const target = !receiptView.reviewTarget.hidden ? receiptView.reviewTarget : !checkpointView.reviewTarget.hidden ? checkpointView.reviewTarget : null;
                if (target) scrollFollow.locate(target);
                return;
            }
            if (destination === 'historyAccess') showSettings(true, 'limits', contextView.historyTarget);
            else if (destination === 'context') showSettings(true, 'limits', contextView.budgetTarget);
            else if (destination === 'connection') showSettings(true, 'connection', endpoint);
            else if (destination === 'storage') showSettings(true, 'storage');
            else showSettings(true, 'limits', budgetFields.find(f => f.name === ({ output: 'maxTokens', time: 'timeMs', dataBudget: 'providerBytes' })[destination])?.input || budgetSettings);
        };
        usageText.textContent = formatBudget(latestProcess?.budget, lang);
        if (s.taskUsage?.segments > 1) usageText.textContent += ` · ${t('任务累计模型/工具调用', 'Task total model/tool calls')}: ${s.taskUsage.modelCalls}/${s.taskUsage.toolCalls} · ${t('执行段', 'Segments')}: ${s.taskUsage.segments}`;
        if (latestProcess?.budget?.reason) status.textContent += ' · ' + budgetReasonLabel(latestProcess.budget.reason, lang);
        if (s.occupiedElsewhere) status.textContent += t(' · 其他会话任务占用中', ' · Another session occupies the runtime');
        else if (latestProcess) status.textContent += ' · ' + processLabel(latestProcess, lang);
        scope.hidden = s.mode !== 'draft'; followLabel.hidden = s.mode !== 'draft';
        mode.value = s.mode; setupBar.hidden = setup.hidden = s.enabled; welcome.hidden = s.enabled && s.messages.length > 0;
        if (s.readOnly) status.textContent = t('查看历史 · 只读，不读取当前聊天，也不发送给模型', 'History viewer · Read-only; no current-chat reads or model requests');
        if (s.interaction?.status === 'pending') status.textContent = s.interaction.kind === 'permission' ? t('等待资料授权 · 请选择允许或拒绝', 'Waiting for data access · Allow or deny') : t('等待你的回答 · 请在上方问题卡中补充，或取消澄清', 'Waiting for your answer · Use the question card above, or cancel clarification');
        if (s.interaction?.kind === 'permission' && s.interaction.status === 'pending') status.textContent = t('等待读取授权 · 可允许、拒绝并继续，或取消任务', 'Waiting for read permission · Allow, deny and continue, or cancel task');
        recoveryRunId = s.recovery?.runId || null;
        recoveryBar.hidden = !recoveryRunId;
        restoreInput.disabled = !recoveryRunId || !!s.input?.trim() || !!s.busy || !!s.resetting;
        const recoverId = recoveryRunId, recoverIdentity = errorIdentity(s);
        restoreInput.onclick = () => {
            const now = controller.snapshot();
            if (disposed || restoreInput.disabled || now.input?.trim() || now.busy || now.resetting || errorIdentity(now) !== recoverIdentity || now.recovery?.runId !== recoverId) return;
            return act(() => { controller.restoreFailedInput(recoverId); input.focus?.(); });
        };
        recoveryNote.textContent = s.recovery?.possibleEffects
            ? t('仅复制原问题，不自动重试。此前操作结果可能不明；重新发送前请核对实际状态。', 'Copies the question only; no automatic retry. Earlier effects may be unknown, so verify actual state before sending again.')
            : t('仅复制原问题，不自动重试或恢复旧授权。可先修改，再自行发送。', 'Copies the question only; no automatic retry or restored grants. Edit it before sending if needed.');
        input.disabled = !!s.readOnly;
        const missingHistory = s.history?.missingPermissions || [];
        historyAuthorization.hidden = s.mode !== 'assistant' || !missingHistory.length || !!s.context?.omitHistory || s.readOnly || s.interaction?.status === 'pending';
        historySources.textContent = missingHistory.map(source => source.startsWith('source:') ? permissionTitle(source.startsWith('source:providerExecution:') ? 'providerExecution' : source.startsWith('source:agentExecution:') ? 'agentExecution' : source.startsWith('source:npcExecution:') ? 'npcExecution' : source.startsWith('source:profileExecution:') ? 'profileExecution' : source.startsWith('source:memoryExecution:') ? 'memoryExecution' : source.startsWith('source:scriptExecution:') ? 'scriptExecution' : source.slice(7)) : source).join('、');
        allowHistory.disabled = omitHistory.disabled = !s.enabled || s.busy || s.resetting || s.history?.loading;
        send.disabled = s.readOnly || s.busy || s.resetting || s.history?.loading || !!s.history?.external || s.enabled && task.scope === 'chat' && !s.hasChat; stop.disabled = !s.busy || s.resetting;
        if (s.interaction?.status === 'pending') { send.disabled = true; resetAuthorization(); }
        status.setAttribute('data-important', String(!!s.notice || !!s.error || s.readOnly || s.occupiedElsewhere || s.interaction?.status === 'pending' || s.runs.at(-1)?.status === 'failed'));
        updateViewSize();
        confirm.disabled = send.disabled; stop.hidden = !!s.readOnly || !s.busy && !s.resetting;
        if (s.readOnly) { stop.disabled = true; resetAuthorization(); }
        connect.disabled = disable.disabled = s.resetting; if (input.value !== s.input) input.value = s.input;
        connectionForm.refreshOptions();
        if (previousConnection !== lastConnection) connectionFeedback.rebase();
        connectionFeedback.update(s.resetting);
        // Probe state is transient: do not cache it as the form's original disabled state.
        hostTest.disabled = !!hostProbe || !!s.resetting || connectionFeedback.busy;
        connectionTools.setLocked(s.resetting || connectionFeedback.busy);
        const historyChanged = transcriptView.update(s);
        const selected = follow.value; follow.replaceChildren(); const none = node('option', t('新任务', 'New task'), follow); none.value = '';
        for (const artifact of s.artifacts) {
            if (artifact.kind === 'config-draft') { const option = node('option', `${artifact.id} · v${artifact.revision}`, follow); option.value = artifact.id; }
        }
        if ([...follow.options].some(o => o.value === selected)) follow.value = selected;
        if (newInteraction) {
            if (!connection.hidden) {
                settingsLayout.setVisible(false);
                connection.hidden = true; workspace.hidden = chat.hidden = false;
                gear.setAttribute('aria-expanded', 'false'); historyView.setVisible(true);
                updateViewSize();
            }
        }
        scrollFollow.end(historyChanged);
    }
    const subscribe = () => { if (!unsubscribe) unsubscribe = controller.subscribe(render).unsubscribe; render(); };
    shell.addEventListener('toggle', () => { if (disposed) return; if (shell.open) subscribe(); else { unsubscribe?.(); unsubscribe = null; key.value = ''; webSearchView.clearKey(); } });
    if (standalone) subscribe();
    mode.onchange = () => act(() => controller.setMode(mode.value));
    saveBudget.onclick = () => act(() => budgetFeedback.run(async () => {
        const value = {};
        for (const f of budgetFields) { const n = Number(f.input.value); if (!f.input.value.trim() || !Number.isInteger(n)) throw Error('INVALID_RUN_CONFIG'); value[f.name] = n * f.scale; }
        await controller.saveRunConfig(value); lastRunConfig = '';
    }, () => budgetFeedback.validateNumbers()));
    resetBudget.onclick = () => act(() => budgetFeedback.run(async () => {
        await controller.saveRunConfig({ ...RUN_DEFAULTS });
        for (const f of budgetFields) f.input.value = String(RUN_DEFAULTS[f.name] / f.scale);
        lastRunConfig = '';
    }));
    input.oninput = () => { try { controller.setInput(input.value); } catch (e) { showError(e); } };
    send.onclick = () => act(() => {
        if (!input.value.trim()) throw new Error('EMPTY_INPUT');
        controller.setInput(input.value);
        const s = controller.snapshot();
        if (!s.enabled) {
            showSettings(true, 'connection', endpoint);
            const notice = t('请先配置并启用模型接口；刚才输入的消息已保留，返回聊天后可直接发送。', 'Configure and enable a model connection first. Your unsent message is preserved; return to chat to send it.');
            errors.textContent = notice;
            globalThis.toastr?.warning?.(notice);
            return;
        }
        if (s.mode === 'assistant' || s.mode === 'chat' || s.mode !== 'draft' && s.permissions?.diagnostics) { controller.send(); resetAuthorization(); }
        else { authorization.hidden = false; confirm.focus?.(); }
    });
    confirm.onclick = () => act(() => { controller.setInput(input.value); controller.send({ consent: consent.checked, fields: fields.filter(([, f]) => f.checked).map(([name]) => name), artifactId: follow.value || null }); resetAuthorization(); });
    withoutData.onclick = () => act(() => { controller.setInput(input.value); controller.send(); resetAuthorization(); });
    diagnosticPermission.onchange = () => act(() => diagnosticPermission.checked ? controller.grantPermission('diagnostics') : controller.revokePermission('diagnostics'));
    chatPermission.onchange = () => act(() => chatPermission.checked ? controller.grantPermission('chat') : controller.revokePermission('chat'));
    extendedPermission.onchange = () => act(() => extendedPermission.checked ? controller.grantPermission('extended') : controller.revokePermission('extended'));
    fullAccessToggle.onchange = () => {
        const value = fullAccessToggle.value;
        if (value === 'full') {
            fullAccessToggle.value = controller.snapshot().permissionConfig?.readAccess || 'ask'; fullAccessConfirm.hidden = false; acceptFullAccess.focus?.(); return;
        }
        fullAccessConfirm.hidden = true;
        act(() => controller.savePermissionConfig({ readAccess: value }));
    };
    acceptFullAccess.onclick = () => act(() => { controller.setFullAccess(true); fullAccessConfirm.hidden = true; });
    cancelFullAccess.onclick = () => { fullAccessConfirm.hidden = true; const s = controller.snapshot(); fullAccessToggle.value = s.fullAccess ? 'full' : s.permissionConfig?.readAccess || 'ask'; };
    forgetKey.onclick = () => act(async () => { await controller.forgetCredential(); rememberKey.checked = false; autoConnect.checked = false; key.value = ''; });
    cancelAuth.onclick = () => { resetAuthorization(); input.focus?.(); };
    stop.onclick = () => act(() => controller.stop());
    connect.onclick = () => act(() => connectionFeedback.run(async () => { hostProbe?.abort(); const apiKey = key.value; connectionTools.setLocked(true); try { await controller.configure(source.value === 'st' ? { source: 'st' } : { endpoint: endpoint.value.trim(), apiKey, model: model.value.trim(), profile: profile.value, thinking: profile.value === 'deepseek' && thinking.checked, reasoningEffort: effort.value, supportsTools: true, rememberKey: rememberKey.checked, autoConnect: autoConnect.checked && rememberKey.checked }); key.value = ''; if (!disposed) showSettings(false); } finally { connectionTools.setLocked(false); } }, () => validateConnectionDraft('test')));
    hostTest.onclick = () => act(async () => {
        hostProbe?.abort(); const probe = hostProbe = new AbortController(); hostTest.disabled = true;
        hostTestStatus.textContent = t('正在测试酒馆连接…', 'Testing ST connection…');
        try { await controller.probeConnection({ source: 'st' }, { signal: probe.signal }); if (!disposed && !probe.signal.aborted) hostTestStatus.textContent = t('连接测试成功；工具调用兼容性尚未验证。', 'Connection test passed; tool-call compatibility is not yet verified.'); }
        catch (error) { if (!disposed && !probe.signal.aborted) { hostTestStatus.textContent = t('测试未成功，请检查酒馆连接及模型支持情况。', 'Test failed. Check the ST connection and model support.'); throw error; } }
        finally { if (hostProbe === probe) { hostProbe = null; hostTest.disabled = !!controller.snapshot().resetting || connectionFeedback.busy; } }
    });
    disable.onclick = () => act(async () => { hostProbe?.abort(); await controller.disable(); autoConnect.checked = false; lastConnection = null; });
    input.onkeydown = event => { if (!event.isComposing && event.keyCode !== 229 && !event.repeat && event.ctrlKey && event.key === 'Enter' && !send.disabled) { event.preventDefault(); send.click(); } };
    render();
    const dispose = () => { if (disposed) return; disposed = true; diagnosticExportView.dispose(); hostProbe?.abort(); themeSwitcher.dispose(); instructionView.dispose(); connectionTools.dispose(); permissionView.dispose(); interactionView.dispose(); scrollFollow.dispose(); unsubscribe?.(); historyView.dispose(); transcriptView.dispose(); receiptView.dispose(); key.value = ''; webSearchView.clearKey(); webSearchView.dispose(); gear.remove(); shell.remove(); root.classList.remove?.('gd-muyu-floating'); if (root.__gdMuyuDispose === dispose) delete root.__gdMuyuDispose; };
    root.__gdMuyuDispose = dispose; return dispose;
}
