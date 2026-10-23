import { INSTRUCTION_DEFAULTS, validateInstructionConfig } from '../instructions/contract.js';
import { REPLY_LANGUAGE_DEFAULTS, REPLY_LANGUAGES } from '../instructions/reply-language.js';
import { bindAutoSave } from './auto-save.js';

/** Draft belongs to controller, not DOM; rebuilding/closing the window does not lose it. */
export function createInstructionView({ doc, settings, controller, act, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text, owner) => { const el = doc.createElement(tag); el.textContent = text; owner.append(el); return el; };
    const button = text => { const el = node('button', text, actions); el.type = 'button'; el.className = 'menu_button'; return el; };
    const section = node('details', '', settings); section.className = 'gd-muyu-instruction-settings';
    section.open = true;
    node('summary', t('行为偏好', 'Behavior preferences'), section);
    node('p', t('影响暮羽所有任务，保存后从下一次发送生效。只补充语气、长度、表达习惯，不覆盖内置规则、工具授权和预算。不用于历史摘要生成。', 'Applies to all Muyu tasks from the next send after saving. Adds tone, length and presentation preferences; cannot override built-in rules, tool permissions or budgets. Not used for history summarization.'), section);
    node('h4', t('回复语言', 'Reply language'), section);
    const languageToggleLabel = node('label', t('固定回复语言（默认关闭）', 'Use a fixed reply language (off by default)'), section);
    const languageEnabled = node('input', '', languageToggleLabel); languageEnabled.type = 'checkbox';
    const languageLabel = node('label', t('语种', 'Language'), section), language = node('select', '', languageLabel); language.className = 'text_pole';
    for (const [value, zh] of REPLY_LANGUAGES) { const option = node('option', t(zh, value), language); option.value = value; }
    const customOption = node('option', t('其他语种…', 'Other language…'), language); customOption.value = '__custom__';
    const customLabel = node('label', t('自定义语种名称', 'Custom language name'), section), customLanguage = node('input', '', customLabel);
    customLanguage.type = 'text'; customLanguage.className = 'text_pole'; customLanguage.maxLength = 80;
    customLanguage.placeholder = t('例如：ไทย、Brazilian Portuguese', 'For example: ไทย, Brazilian Portuguese');
    node('small', t('关闭时跟随用户语言；开启后按所选语种解释，独立于下方补充指令。代码、原文引用与实际按钮名不翻译。不改变界面语言；保存后下一次发送生效，已开始任务及授权续接保持原语种。', 'When off, follow the user’s language. When on, explain in the selected language, independently of additional instructions. Keep code, quotes and actual button names unchanged. UI language is separate. Save to affect the next send; started tasks and approval continuations keep their original language.'), section);
    const toggleLabel = node('label', t('启用补充指令（默认关闭）', 'Enable additional instructions (off by default)'), section), enabled = node('input', '', toggleLabel); enabled.type = 'checkbox';
    const label = node('label', t('补充指令', 'Additional instructions'), section), text = node('textarea', '', label); text.className = 'text_pole'; text.rows = 5;
    text.placeholder = t('例如：先给结论；通常用三条以内说明；不重复无关历史。', 'Example: lead with the conclusion; usually use at most three points; avoid unrelated history.');
    node('small', t('最多4000字符、16000 UTF-8字节；不静默截断。内容明文保存在插件设置，启用后外发给当前模型，不要填写密钥或敏感信息。草稿仅在本页保留，刷新页面会丢失。', 'Maximum 4000 characters and 16000 UTF-8 bytes; no silent truncation. Stored unencrypted in extension settings and sent to the active model when enabled. Do not enter credentials or sensitive data. Unsaved drafts survive view changes, not page reloads.'), section);
    const status = node('p', '', section); status.className = 'gd-muyu-form-status'; status.setAttribute('role', 'status');
    const actions = node('div', '', section); actions.className = 'gd-muyu-settings-actions';
    const save = button(t('保存行为偏好', 'Save behavior preferences')), discard = button(t('放弃修改', 'Discard changes')), reset = button(t('恢复默认并保存', 'Restore and save defaults'));
    let saveFailed = false, customMode = null;
    const edit = () => act(() => { saveFailed = false; controller.setInstructionDraft({ enabled: enabled.checked, text: text.value,
        replyLanguage: { enabled: languageEnabled.checked, language: language.value === '__custom__' ? customLanguage.value : language.value } }); });
    enabled.onchange = edit; text.oninput = edit;
    languageEnabled.onchange = edit;
    language.onchange = () => { customMode = language.value === '__custom__'; return edit(); };
    customLanguage.oninput = edit;
    save.onclick = () => act(async () => { saveFailed = false; try { validateInstructionConfig(controller.snapshot().instructionSettings.draft); await controller.saveInstructions(); } catch { saveFailed = true; } });
    discard.onclick = () => act(() => { autoSave.cancel(); saveFailed = false; customMode = null; controller.discardInstructionDraft(); });
    reset.onclick = () => act(async () => { autoSave.cancel(); saveFailed = false; customMode = null; controller.resetInstructionDraft(); try { await controller.saveInstructions(); } catch { saveFailed = true; } });
    text.onchange = customLanguage.onchange = edit;
    const autoSave = bindAutoSave([enabled, text, languageEnabled, language, customLanguage], save, lang, () => controller.snapshot().instructionSettings?.dirty);
    node('small', t('自动保存：开关与选择立即保存，文字停止输入600毫秒后保存。失败时保留草稿并提供重试。', 'Auto-save: switches and selections save immediately; text saves after 600 ms of inactivity. Failed drafts are retained for retry.'), section);
    return { dispose: autoSave.dispose, render(s) {
        const state = s.instructionSettings || { draft: INSTRUCTION_DEFAULTS, saved: INSTRUCTION_DEFAULTS, dirty: false, saving: false }, draft = state.draft;
        if (text.value !== draft.text) text.value = draft.text; enabled.checked = draft.enabled;
        const reply = draft.replyLanguage || { ...REPLY_LANGUAGE_DEFAULTS, language: lang === 'en' ? 'English' : 'Simplified Chinese' };
        languageEnabled.checked = reply.enabled;
        if (customMode === null) customMode = !REPLY_LANGUAGES.some(([value]) => value === reply.language);
        const preset = !customMode;
        language.value = preset ? reply.language : '__custom__'; customLabel.hidden = preset;
        if (!preset && customLanguage.value !== reply.language) customLanguage.value = reply.language;
        let valid = true; try { validateInstructionConfig(draft); } catch { valid = false; }
        const bytes = new TextEncoder().encode(draft.text).length;
        status.textContent = `${draft.text.length}/4000 · ${bytes}/16000 B · ` + (valid ? state.saving ? t('保存中…', 'Saving…') : state.dirty ? t('有未保存修改', 'Unsaved changes') : t('已保存', 'Saved') : t('超出限制，未保存；请缩短内容', 'Over limit; not saved. Shorten the text.')) + ' · ' + (state.saved.enabled ? t('当前已启用', 'Currently enabled') : t('当前未启用', 'Currently disabled'));
        save.disabled = !valid || !state.dirty || state.saving || s.resetting;
        enabled.disabled = text.disabled = !!state.saving || !!s.resetting;
        languageEnabled.disabled = !!state.saving || !!s.resetting;
        language.disabled = customLanguage.disabled = !reply.enabled || !!state.saving || !!s.resetting;
        text.setAttribute('aria-invalid', String(!valid));
        const fixed = state.saved.replyLanguage;
        status.textContent += ' · ' + (fixed?.enabled ? t('当前固定语种：', 'Current fixed language: ') + fixed.language : t('当前自动跟随语言', 'Currently follows the user’s language'));
        if (!valid) status.textContent = t('偏好或语种无效：补充指令需在限制内，启用的语种名称不能为空（最多80字符，仅名称，不填指令）。草稿已保留。', 'Invalid preferences or language: keep instructions within limits and provide a nonempty language name when enabled (up to 80 characters; names only, not instructions). Draft retained.');
        if (saveFailed) status.textContent = t('保存未完成，草稿已保留，请重试。', 'Save did not complete. Draft retained; retry.');
        save.hidden = !saveFailed;
        status.setAttribute('data-state', saveFailed || !valid ? 'error' : state.saving ? 'saving' : state.dirty ? 'dirty' : 'ready');
        discard.disabled = !state.dirty || state.saving; reset.disabled = state.saving;
    } };
}
