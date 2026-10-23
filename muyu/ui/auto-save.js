/** Reuse each form's validated save path; never saves credentials or starts model calls.
 * Numbers commit on blur/change; text also saves after 600 ms of inactivity.
 * Existing form validation prevents incomplete/invalid values from applying.
 * Forms lock controls while persisting. Failed inputs remain available for retry.
 */
export function bindAutoSave(fields, save, lang, shouldSave = () => true) {
    let timer = null, disposed = false;
    const cancel = () => { clearTimeout(timer); timer = null; };
    const commit = async field => { cancel(); if (!disposed && !field.disabled && shouldSave()) await save.onclick?.(); };
    save.hidden = true;
    for (const field of fields) {
        const previous = field.onchange;
        field.onchange = async (...args) => {
            await previous?.(...args);
            await commit(field);
        };
        if (field.type !== 'checkbox' && field.tagName?.toLowerCase() !== 'select' && field.tag !== 'select') {
            const blur = field.onblur;
            field.onblur = async (...args) => { await blur?.(...args); await commit(field); };
        }
        if (field.type === 'text' || (field.tagName || field.tag || '').toLowerCase() === 'textarea') {
            const input = field.oninput;
            field.oninput = async (...args) => {
                await input?.(...args); cancel();
                if (!disposed && !field.disabled) timer = setTimeout(() => { void commit(field).catch(() => {}); }, 600);
            };
        }
    }
    return { cancel, dispose() { disposed = true; cancel(); } };
}
