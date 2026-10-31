// Pure saved-card projection. Never call helper getters (some migrate on read).
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const MAX = 131072, COUNT = 512;
const notice = 'Saved-card whitelist, untrusted data only. Not editor drafts, current variables, runtime activation, final injection or confirmed persistence. No regex/macro/script execution, imports, migration or writes. Excludes script data, variable values, IDs, avatar paths and arbitrary extensions. Embedded book is distinct from external book bindings; card components do not cover global/preset regex or global helper scripts.';
function project(raw, fields) {
    if (!object(raw)) throw Error('SOURCE_UNSUPPORTED');
    const result = {};
    for (const [key, type] of Object.entries(fields)) {
        if (!Object.hasOwn(raw, key)) continue;
        const value = raw[key];
        if (value === null) { result[key] = null; continue; } // Inherited/unknown, never invent defaults.
        if (type === 'number-or-boolean') {
            if (typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value))) throw Error('SOURCE_UNSUPPORTED');
        } else if (type === 'strings' || type === 'numbers') {
            if (!Array.isArray(value) || value.length > COUNT || value.some(v => type === 'strings' ? typeof v !== 'string' || v.length > MAX : typeof v !== 'number' || !Number.isFinite(v))) throw Error('SOURCE_UNSUPPORTED');
        } else {
            if (typeof value !== type || type === 'number' && !Number.isFinite(value) || type === 'string' && value.length > MAX) throw Error('SOURCE_UNSUPPORTED');
        }
        result[key] = value;
    }
    return result;
}
const regexFields = { scriptName: 'string', findRegex: 'string', replaceString: 'string', trimStrings: 'strings', placement: 'numbers', disabled: 'boolean', markdownOnly: 'boolean', promptOnly: 'boolean', runOnEdit: 'boolean', substituteRegex: 'number', minDepth: 'number', maxDepth: 'number' };
const bookFields = { keys: 'strings', secondary_keys: 'strings', comment: 'string', content: 'string', enabled: 'boolean', constant: 'boolean', selective: 'boolean', case_sensitive: 'boolean', insertion_order: 'number', priority: 'number', position: 'string' };
const bookExtensions = { position: 'number', depth: 'number', role: 'number', probability: 'number', useProbability: 'boolean', selectiveLogic: 'number', scan_depth: 'number', match_whole_words: 'boolean', case_sensitive: 'boolean', prevent_recursion: 'boolean', exclude_recursion: 'boolean', delay_until_recursion: 'number-or-boolean', sticky: 'number', cooldown: 'number', delay: 'number' };
const short = value => typeof value === 'string' ? value.slice(0, 120) : '';
function section(value, build) {
    if (value === undefined || value === null) return { status: 'absent', items: [], values: [] };
    try {
        const result = build(value);
        return { ...result, status: 'available' };
    } catch (error) { return { status: error.message === 'SOURCE_TOO_LARGE' ? 'too-large' : 'unsupported', items: [], values: [] }; }
}
function array(value) { if (!Array.isArray(value)) throw Error('SOURCE_UNSUPPORTED'); if (value.length > COUNT) throw Error('SOURCE_TOO_LARGE'); return value; }
function helperValue(value) {
    if (!Array.isArray(value)) return value;
    if (value.length > 32 || value.some(pair => !Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string') || new Set(value.map(pair => pair[0])).size !== value.length) throw Error('SOURCE_UNSUPPORTED');
    return Object.fromEntries(value);
}
export function projectCardComponents(persisted, selector, identity) {
    const match = /^(card:(?:0|[1-9]\d{0,3}))(?::(regex|script|book):(0|[1-9]\d{0,3}))?$/.exec(selector);
    if (!match) throw Error('INVALID_SELECTOR');
    const card = match[1], data = object(persisted.data) ? persisted.data : persisted;
    const ext = data.extensions === undefined ? {} : data.extensions;
    if (!object(ext)) throw Error('SOURCE_UNSUPPORTED');
    const regex = section(ext.regex_scripts, rows => {
        const values = array(rows).map(row => project(row, regexFields));
        return { values, items: values.map((v, index) => ({ selector: `${card}:regex:${index}`, name: short(v.scriptName), disabled: v.disabled ?? null, findChars: v.findRegex?.length ?? null, replaceChars: v.replaceString?.length ?? null })) };
    });
    let helper, helperError = false;
    try { helper = helperValue(ext.tavern_helper); if (helper !== undefined && !object(helper)) throw Error(); } catch { helperError = true; }
    const legacy = helper === undefined && !helperError;
    const scriptsRaw = helperError ? false : legacy ? ext.TavernHelper_scripts : helper.scripts;
    const scripts = section(scriptsRaw, rows => {
        const items = [], values = []; let count = 0;
        function visit(row, path, ancestors, depth) {
            if (++count > COUNT || depth > 8) throw Error('SOURCE_TOO_LARGE');
            if (!object(row)) throw Error('SOURCE_UNSUPPORTED');
            if (row.type === 'folder') {
                const fields = project(row, { name: 'string', enabled: 'boolean' });
                items.push({ kind: 'folder', path, name: short(fields.name), enabled: fields.enabled ?? null });
                const children = row.scripts === undefined ? row.value : row.scripts;
                array(children).forEach((child, index) => visit(child, [...path, index], [...ancestors, fields.enabled ?? null], depth + 1));
                return;
            }
            if (row.type !== undefined && row.type !== 'script') throw Error('SOURCE_UNSUPPORTED');
            const wrapped = row.type === 'script' && row.content === undefined && Object.hasOwn(row, 'value');
            if (wrapped && !object(row.value)) throw Error('SOURCE_UNSUPPORTED');
            const raw = wrapped ? row.value : row;
            const value = project(raw, { name: 'string', enabled: 'boolean', content: 'string', info: 'string' });
            const button = raw.button === undefined && Array.isArray(raw.buttons) ? { buttons: raw.buttons } : raw.button;
            if (button !== undefined) {
                value.button = project(button, { enabled: 'boolean' });
                if (button.buttons !== undefined) value.button.buttons = array(button.buttons).map(b => project(b, { name: 'string', visible: 'boolean' }));
            }
            const index = values.length; values.push(value);
            items.push({ kind: 'script', selector: `${card}:script:${index}`, path, name: short(value.name), enabled: value.enabled ?? null, ancestorEnabled: ancestors, contentChars: value.content?.length ?? null, infoChars: value.info?.length ?? null });
        }
        array(rows).forEach((row, index) => visit(row, [index], [], 0));
        return { values, items };
    });
    const book = section(data.character_book, raw => {
        const fields = project(raw, { name: 'string', description: 'string', scan_depth: 'number', token_budget: 'number', recursive_scanning: 'boolean' });
        const values = array(raw.entries).map(row => {
            const value = project(row, bookFields);
            if (row.extensions !== undefined) value.extensions = project(row.extensions, bookExtensions);
            return value;
        });
        return { fields, values, items: values.map((v, index) => ({ selector: `${card}:book:${index}`, name: short(v.comment), enabled: v.enabled ?? null, contentChars: v.content?.length ?? null, keyCount: v.keys?.length ?? null })) };
    });
    let result;
    if (match[2]) {
        const selected = { regex, script: scripts, book }[match[2]];
        if (selected.status !== 'available') throw Error(selected.status === 'too-large' ? 'SOURCE_TOO_LARGE' : 'SOURCE_UNSUPPORTED');
        const value = selected.values[Number(match[3])]; if (!value) throw Error('INVALID_SELECTOR');
        result = { kind: match[2] + '-content', selector, value };
    } else {
        const vars = legacy ? ext.TavernHelper_characterScriptVariables : helper?.variables;
        result = { kind: 'component-directory', selector: card,
            regex: { status: regex.status, items: regex.items },
            helper: { format: helperError ? 'unsupported' : legacy ? 'legacy' : 'tavern_helper', status: scripts.status, items: scripts.items,
                variables: { status: vars === undefined ? 'absent' : object(vars) ? 'present' : 'unsupported', count: object(vars) ? Object.keys(vars).length : null, valuesIncluded: false },
                legacyShadowed: !legacy && (Object.hasOwn(ext, 'TavernHelper_scripts') || Object.hasOwn(ext, 'TavernHelper_characterScriptVariables')) },
            embeddedBook: { status: book.status, ...(book.fields ? { fields: Object.fromEntries(Object.entries(book.fields).filter(([k]) => k !== 'description')), descriptionChars: book.fields.description?.length ?? null } : {}), items: book.items },
        };
    }
    const text = JSON.stringify({ evidence: { scope: 'saved-card', bodyCoverage: match[2] ? 'selected-component-only' : 'component-metadata-only', notObserved: ['global-or-preset-regex', 'global-helper-scripts', 'runtime-activation', 'current-variable-values', 'final-injection'], absenceMeaning: 'Absent here describes this saved card only, not the whole processing chain.' }, ...result, notice });
    if (text.length > MAX) throw Error('SOURCE_TOO_LARGE');
    return { text, limited: false, identity };
}
