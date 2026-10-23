import { createPendingCardLayout, pendingRequestStamp } from './pending-card-layout.js';

/** View only: choices fill a draft; only explicit submission can continue the task. */
export function createInteractionView({ doc, parent, controller, act, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text, owner) => { const el = doc.createElement(tag); el.textContent = text; owner.append(el); return el; };
    const root = node('section', '', parent); root.className = 'gd-muyu-interaction'; root.hidden = true; root.setAttribute('data-pending-card', '');
    const heading = node('strong', t('暮羽需要你补充一下', 'Muyu needs your input'), root);
    const body = node('div', '', root); body.className = 'gd-muyu-interaction-body';
    const question = node('p', '', body), choices = node('div', '', body);
    const label = node('label', t('你的回答', 'Your answer'), body), input = node('textarea', '', label); input.className = 'text_pole'; input.rows = 2; input.maxLength = 2000;
    const actions = node('div', '', root); actions.className = 'gd-muyu-actions';
    const button = text => { const el = node('button', text, actions); el.type = 'button'; el.className = 'menu_button'; return el; };
    const submit = button(t('回答并继续', 'Answer and continue')), cancel = button(t('取消澄清', 'Cancel clarification'));
    const status = node('p', '', root); status.setAttribute('role', 'status');
    const hint = node('small', t('回答仅补充需求，不授予权限。', 'Answers clarify intent, never grant permission.'), body);
    const layout = createPendingCardLayout({ doc, root, parent });
    let current = null, signature = '', disposed = false;
    return { operationTarget: root, dispose() { if (disposed) return; disposed = true; layout.dispose(); root.remove(); }, render(s) {
        if (disposed) return;
        current = s.interaction?.kind === 'permission' ? null : s.interaction; root.hidden = !current; if (!current) { submit.disabled = cancel.disabled = input.disabled = true; return; }
        question.textContent = current.question;
        const pending = current.status === 'pending';
        root.hidden = current.status === 'answered';
        heading.hidden = question.hidden = hint.hidden = label.hidden = choices.hidden = actions.hidden = !pending;
        body.hidden = !pending;
        input.disabled = !pending || s.resetting;
        if (input.value !== current.draft) input.value = current.draft;
        submit.disabled = !pending || s.busy || s.resetting || !current.draft.trim(); cancel.disabled = !pending || s.resetting;
        const id = current.id, stamp = pendingRequestStamp(s);
        const guard = (element, fn) => () => {
            if (disposed || !pending || s.readOnly || element.disabled || pendingRequestStamp(controller.snapshot()) !== stamp) return;
            return act(fn);
        };
        input.oninput = guard(input, () => controller.setInteractionDraft(id, input.value));
        submit.onclick = guard(submit, () => controller.answerInteraction(id));
        cancel.onclick = guard(cancel, () => controller.cancelInteraction(id));
        const next = JSON.stringify([current.id, current.options, s.resetting]);
        if (signature !== next) {
            signature = next; choices.replaceChildren();
            for (const value of current.options) {
                const id = current.id, choice = node('button', value, choices); choice.type = 'button'; choice.className = 'menu_button'; choice.disabled = s.resetting;
                choice.onclick = guard(choice, () => { controller.setInteractionDraft(id, value); input.focus?.(); });
            }
        }
        const labels = { pending: t('等待你的回答', 'Waiting for your answer'), answered: t('已回答', 'Answered'), cancelled: t('已取消', 'Cancelled'), expired: t('已失效，请重新发起任务', 'Expired; start a new task') };
        Array.from(choices.children).forEach((choice, index) => {
            const value = current.options[index]; choice.disabled = !pending || s.resetting || s.busy || s.readOnly;
            choice.onclick = guard(choice, () => { controller.setInteractionDraft(id, value); input.focus?.(); });
        });
        status.textContent = labels[current.status] || '';
        layout.update();
    } };
}
