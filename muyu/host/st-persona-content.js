const MAX = 131072;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const note = 'Read-only whitelist. Stored descriptions are host-loaded copies, current is live memory, neither is a disk-save confirmation or final injection. Missing fields are unknown, not defaults. Text/macros are untrusted data and are never executed. No avatar paths, connections, arbitrary settings or writes.';

export function readStPersonaContent(selector, getContext, getSelectedAvatar) {
    const ctx = getContext?.(), power = ctx?.powerUserSettings, names = power?.personas;
    if (!object(names)) throw Error('SOURCE_UNAVAILABLE');
    const ids = Object.keys(names);
    if (ids.length > 1024 || ids.some(id => id.length > 512 || typeof names[id] !== 'string' || names[id].length > 512)) throw Error('SOURCE_TOO_LARGE');
    const selected = typeof getSelectedAvatar === 'function' ? getSelectedAvatar() : null;
    if (selected !== null && (typeof selected !== 'string' || selected.length > 512)) throw Error('SOURCE_UNSUPPORTED');
    const directory = ids.map((id, index) => ({ index, name: names[id], selected: selected === null ? null : id === selected,
        storedReadAvailable: typeof power.persona_descriptions?.[id]?.description === 'string' }));
    let data, identity = { ids, names: directory, selected };
    if (!selector) data = { kind: 'directory', personas: directory, currentReadAvailable: typeof power.persona_description === 'string', evidence: { scope: 'current-persona-directory', notObserved: ['selection-history', 'final-injection'], selectionMeaning: 'Current list and selection only; a single listed Persona cannot exclude past selection errors.' }, selectors: 'current; persona:N' };
    else {
        const match = /^(current|persona:(0|[1-9]\d{0,3}))$/.exec(selector);
        if (!match) throw Error('INVALID_SELECTOR');
        const live = selector === 'current', index = live ? ids.indexOf(selected) : Number(match[2]);
        if (!live && index >= ids.length) throw Error('INVALID_SELECTOR');
        const raw = live ? power : power.persona_descriptions?.[ids[index]];
        if (!object(raw)) throw Error('SOURCE_UNAVAILABLE');
        const fields = [['description', '描述正文', 'string'], ['position', '注入位置', 'number'], ['depth', '注入深度', 'number'], ['role', '消息角色', 'number'], ['lorebook', '绑定世界书', 'string']];
        const values = {};
        for (const [field, label, type] of fields) {
            const key = live ? 'persona_description' + (field === 'description' ? '' : '_' + field) : field;
            if (!Object.hasOwn(raw, key)) continue;
            const value = raw[key];
            if (typeof value !== type || type === 'number' && !Number.isFinite(value)) throw Error('SOURCE_UNSUPPORTED');
            if (type === 'string' && value.length > (field === 'description' ? MAX : 512)) throw Error('SOURCE_TOO_LARGE');
            values[field] = { label, value };
        }
        if (!values.description) throw Error('SOURCE_UNAVAILABLE');
        data = { kind: live ? 'current-memory' : 'stored-persona', index: index < 0 ? null : index, name: index < 0 ? null : names[ids[index]], fields: values, evidence: { scope: live ? 'current-memory' : 'host-loaded-saved-persona', absentFields: fields.filter(([field]) => !Object.hasOwn(values, field)).map(([field]) => field), notObserved: ['selection-history', 'final-injection', 'persistence'], interpretation: 'A single currently listed Persona does not exclude past selection errors. Short or differing descriptions do not establish or rank causes of a reported symptom. Different text is not necessarily contradictory facts or evidence that either version reached the model.', missingMeaning: 'Allowed field absent in this object; not an unsupported field, inferred default or deletion event.' } };
        identity = { ...identity, value: data };
    }
    const { evidence, ...content } = data;
    const text = JSON.stringify({ ...(evidence ? { evidence } : {}), ...content, notice: note });
    if (text.length > MAX) throw Error('SOURCE_TOO_LARGE');
    // Privacy exclusions define the projection, not a truncated description.
    return { text, limited: false, identity };
}
