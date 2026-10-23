import { DISPLAY_DEFAULTS, PROCESS_DETAILS, DISPLAY_THEMES } from '../preferences/contract.js';
import { createFormFeedback } from './form-feedback.js';
import { bindAutoSave } from './auto-save.js';
export function createDisplayPreferencesView({ doc, settings, controller, act, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const section = doc.createElement('section'); section.className = 'gd-muyu-settings-card'; settings.append(section);
    const themeLabel = doc.createElement('label'); themeLabel.textContent = t('暮羽界面主题', 'Muyu appearance'); section.append(themeLabel);
    const theme = doc.createElement('select'); theme.className = 'text_pole'; themeLabel.append(theme);
    const themeLabels = [['跟随酒馆（默认）', 'Follow Tavern (default)'], ['暮夜 · 深色', 'Dusk · Dark'], ['晨光 · 浅色', 'Morning · Light']];
    DISPLAY_THEMES.forEach((value, index) => { const option = doc.createElement('option'); option.value = value; option.textContent = t(...themeLabels[index]); theme.append(option); });
    const themeHint = doc.createElement('small'); themeHint.textContent = t('仅改变暮羽悬浮窗口的外观，自动保存；不改变酒馆主题、资料权限或任务。', 'Auto-saved appearance for the Muyu floating window only. Tavern theme, permissions and tasks are unchanged.'); section.append(themeHint);
    const label = doc.createElement('label'); label.textContent = t('执行过程显示', 'Execution detail'); section.append(label);
    const select = doc.createElement('select'); select.className = 'text_pole'; label.append(select);
    const labels = [['紧凑（默认）', 'Compact (default)'], ['标准', 'Standard'], ['详细', 'Detailed'], ['完整', 'Full']];
    PROCESS_DETAILS.forEach((value, index) => { const option = doc.createElement('option'); option.value = value; option.textContent = t(...labels[index]); select.append(option); });
    const hint = doc.createElement('p'); hint.textContent = t('仅改变界面显示，保存后立即生效，包括已有过程记录；不减少模型资料、不删除记录，不隐藏授权、错误与操作回执。', 'Presentation only; saved changes immediately affect existing process records. No model data or stored records are removed, and approvals, errors and receipts remain visible.'); section.append(hint);
    const modes = doc.createElement('small'); modes.textContent = t('紧凑：当前阶段与异常；标准：完成阶段；详细：全部阶段与耗时；完整：另含资料计数和技能版本。记录仍可展开查看。', 'Compact: current stage and exceptions. Standard: completed stages. Detailed: all stages and timing. Full: also includes read counts and Skill versions. Records remain expandable.'); section.append(modes);
    const actions = doc.createElement('div'); actions.className = 'gd-muyu-settings-actions'; section.append(actions);
    const save = doc.createElement('button'); save.type = 'button'; save.className = 'menu_button'; save.textContent = t('保存显示设置', 'Save display settings'); actions.append(save);
    const discard = doc.createElement('button'); discard.type = 'button'; discard.className = 'menu_button'; discard.textContent = t('放弃显示修改', 'Discard display changes'); actions.append(discard);
    let current = DISPLAY_DEFAULTS;
    const feedback = createFormFeedback({ doc, parent: actions, fields: [select, theme], buttons: [save, discard], retryButton: save, lang, savedText: t('显示设置已更新，立即生效。', 'Display settings updated; effective immediately.') });
    save.onclick = () => act(() => feedback.run(() => controller.saveDisplayConfig({ processDetail: select.value, theme: theme.value })));
    discard.onclick = () => { select.value = current.processDetail; theme.value = current.theme || 'host'; feedback.edited(); feedback.rebase(); };
    discard.hidden = true;
    bindAutoSave([select, theme], save, lang, () => feedback.dirty);
    return { render(state) { current = state.displayConfig || DISPLAY_DEFAULTS; if (!feedback.dirty && !feedback.busy) { select.value = current.processDetail; theme.value = current.theme || 'host'; feedback.rebase(); } feedback.update(state.savingDisplayConfig || state.resetting); } };
}
