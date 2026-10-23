let nextErrorId = 0;
/** Local form feedback. Never owns persisted settings or sends requests. */
export function createFormFeedback({ doc, parent, fields, buttons = [], lang, savedText, errorText, dirtyText, busyText, disabledWhen, retryButton }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const status = doc.createElement('p'); status.className = 'gd-muyu-form-status'; status.setAttribute('role', 'status'); parent.append(status);
    const notes = new Map(), disabled = new Map();
    let baseline = null, busy = false, blocked = false, message = '', failed = false;
    const signature = () => JSON.stringify(fields.map(f => f.type === 'checkbox' ? f.checked : f.value));
    const dirty = () => baseline !== null && baseline !== signature();
    function refresh() {
        if (retryButton) retryButton.hidden = !failed;
        status.textContent = busy ? busyText || t('保存中…', 'Saving…') : message || (dirty() ? dirtyText || t('有未保存修改', 'Unsaved changes') : t('未修改', 'Unchanged'));
        status.setAttribute('data-state', failed ? 'error' : busy ? 'saving' : dirty() ? 'dirty' : 'ready');
    }
    function lock() {
        for (const field of [...fields, ...buttons]) {
            if (disabledWhen) field.disabled = busy || blocked || !!disabledWhen(field);
            else if (busy || blocked) { if (!disabled.has(field)) disabled.set(field, !!field.disabled); field.disabled = true; }
            else if (disabled.has(field)) { field.disabled = disabled.get(field); disabled.delete(field); }
        }
    }
    function clear() {
        for (const [field, note] of notes) { note.hidden = true; field.setAttribute('aria-invalid', 'false'); }
        message = ''; failed = false;
    }
    function invalid(field, text) {
        let note = notes.get(field);
        if (!note) { note = doc.createElement('small'); note.className = 'gd-muyu-field-error'; note.id = `gd-muyu-field-error-${++nextErrorId}`; field.setAttribute('aria-describedby', [field.getAttribute('aria-describedby'), note.id].filter(Boolean).join(' ')); (field.parentElement || field.parent).append(note); notes.set(field, note); }
        note.textContent = text; note.hidden = false; field.setAttribute('aria-invalid', 'true');
        for (let owner = field.parentElement || field.parent; owner; owner = owner.parentElement || owner.parent) {
            if ((owner.tagName || owner.tag || '').toLowerCase() === 'details') owner.open = true;
        }
        field.focus?.(); field.scrollIntoView?.({ block: 'nearest' });
        message = text; failed = true; refresh();
    }
    for (const field of fields) for (const event of ['input', 'change']) field.addEventListener(event, () => { clear(); refresh(); });
    return {
        get dirty() { return dirty(); }, get busy() { return busy; },
        rebase() { baseline = signature(); refresh(); },
        refresh,
        edited() { clear(); refresh(); },
        update(locked = false) { blocked = !!locked; lock(); refresh(); },
        invalid,
        validateNumbers() {
            for (const field of fields) {
                if (field.type !== 'number' || field.disabled) continue;
                const value = Number(field.value), min = Number(field.min), max = Number(field.max);
                if (!String(field.value).trim() || !Number.isSafeInteger(value) || value < min || value > max) {
                    invalid(field, t(`请输入 ${min}–${max} 范围内的整数。`, `Enter an integer from ${min} to ${max}.`)); return false;
                }
            }
            return true;
        },
        async run(operation, validate = () => true) {
            if (busy || blocked) return false;
            clear(); if (!validate()) return false;
            busy = true; lock(); refresh();
            try { await operation(); baseline = signature(); message = savedText || t('设置已更新', 'Settings updated'); return true; }
            catch (error) { message = errorText?.(error) || t('保存未完成，输入已保留，请重试。', 'Save did not complete. Your input is retained; retry.'); failed = true; return false; }
            finally { busy = false; lock(); refresh(); }
        },
    };
}
