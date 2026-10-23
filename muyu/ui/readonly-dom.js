const tag = element => (element.tagName || element.tag || '').toLowerCase();
const children = element => Array.from(element.children);
const identity = element => tag(element) + ':' + (tag(element) === 'details'
    ? children(element).find(child => tag(child) === 'summary')?.textContent || ''
    : tag(element) === 'button' ? element.textContent : element.className || '');

/** Only readonly bodies, disclosures and buttons; not a draft/form reconciliation API. */
export function patchReadonly(target, source, defaults) {
    target.className = source.className || ''; target.hidden = !!source.hidden; target.disabled = !!source.disabled;
    if (source.type) target.type = source.type;
    // details.open reflects its attribute; preserve manual choices until the default changes.
    const attributes = element => Array.from(element.attributes || [], attr => [attr.name, attr.value])
        .filter(([name]) => tag(element) !== 'details' || name !== 'open');
    const nextAttributes = new Map(attributes(source));
    for (const [name] of attributes(target)) if (!nextAttributes.has(name)) target.removeAttribute(name);
    for (const [name, value] of nextAttributes) if (target.getAttribute(name) !== value) target.setAttribute(name, value);
    target.onclick = source.onclick || null;
    if (tag(target) === 'details') {
        const desired = !!source.open;
        if (defaults.get(target) !== desired) target.open = desired;
        defaults.set(target, desired);
    }
    const before = children(target), after = children(source), used = new Set();
    if (!after.length) { if (before.length) target.replaceChildren(); if (target.textContent !== source.textContent) target.textContent = source.textContent; return; }
    for (const [index, next] of after.entries()) {
        const existing = before.find(child => !used.has(child) && identity(child) === identity(next));
        const result = existing || next;
        if (existing) { used.add(existing); patchReadonly(existing, next, defaults); }
        else initializeDetails(result, defaults);
        if (children(target)[index] !== result) target.insertBefore(result, children(target)[index] || null);
    }
    for (const old of before) if (!used.has(old)) old.remove();
}

export function initializeDetails(root, defaults) {
    if (tag(root) === 'details') defaults.set(root, !!root.open);
    for (const child of children(root)) initializeDetails(child, defaults);
}
