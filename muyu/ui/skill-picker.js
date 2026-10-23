import { skillDisplay } from './catalog-labels.js';

/** A real GUI selection, never inferred from transcript or model output. */
export function createSkillPicker({ doc, parent, controller, act, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const root = doc.createElement('details'); root.className = 'gd-muyu-skill-picker'; parent.append(root);
    const summary = doc.createElement('summary'); root.append(summary);
    const label = doc.createElement('label'); label.textContent = t('仅为下一条新任务指定技能', 'Select a Skill for the next new task only'); root.append(label);
    const select = doc.createElement('select'); select.className = 'text_pole'; label.append(select);
    const refresh = doc.createElement('button'); refresh.type = 'button'; refresh.className = 'menu_button'; refresh.textContent = t('刷新可选技能', 'Refresh available Skills'); root.append(refresh);
    refresh.onclick = () => act(() => controller.loadSkills());
    const note = doc.createElement('small'); note.textContent = t('说明会发送给当前模型；不授予读取、写入或代码权限。发送后清除选择，续接保持本任务固定版本。', 'Documents go to the current model; no read, write or code permissions granted. Selection clears after send; continuations keep fixed task versions.'); root.append(note);
    let choices = [], signature = '';
    select.onchange = () => act(() => { const row = choices.find(row => row.id === select.value); controller.selectSkill(row?.id || '', row?.revision ?? null); });
    return { render(state) {
        root.hidden = !state.skills?.available || state.mode !== 'assistant'; if (root.hidden) return;
        choices = state.skills.rows.filter(row => row.userInvocable);
        const selectedDisplay = state.selectedSkill ? skillDisplay(choices.find(row => row.id === state.selectedSkill.id) || { ...state.selectedSkill, source: state.selectedSkill.id.startsWith('builtin:') ? 'builtin' : 'user' }, lang).displayName : '';
        const next = JSON.stringify([choices.map(row => [row.id, row.revision, row.displayName]), state.selectedSkill]);
        if (next !== signature) {
            signature = next; select.replaceChildren();
            const option = (id, text) => { const el = doc.createElement('option'); el.value = id; el.textContent = text; select.append(el); };
            option('', t('自动按需选用', 'Automatic, when relevant'));
            for (const row of choices) option(row.id, skillDisplay(row, lang).displayName + ' · ' + (row.source === 'builtin' ? t('内置', 'Builtin') : t('用户', 'User')));
            if (state.selectedSkill && !choices.some(row => row.id === state.selectedSkill.id && String(row.revision) === state.selectedSkill.revision)) option(state.selectedSkill.id, selectedDisplay + t('（版本已变化，请重选）', ' (version changed; select again)'));
            select.value = state.selectedSkill?.id || '';
        }
        summary.textContent = state.selectedSkill ? t('技能：', 'Skill: ') + selectedDisplay : t('技能 · 自动按需', 'Skills · automatic');
        select.disabled = refresh.disabled = state.busy || state.resetting || state.readOnly;
    } };
}
