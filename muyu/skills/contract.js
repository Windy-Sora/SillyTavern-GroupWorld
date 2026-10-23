/** Document-only skills. Importing a package never grants permissions or executes code. */
export const SKILL_LIMITS = Object.freeze({ entries: 128, files: 32, fileBytes: 256 * 1024, packageBytes: 512 * 1024, totalBytes: 4 * 1024 * 1024 });
export const skillBytes = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
export const skillCopy = value => JSON.parse(JSON.stringify(value));
const ownRecord = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export function skillKeys(value, expected) {
    if (!ownRecord(value)) throw Error('SKILL_INVALID');
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string' || !expected.includes(key) || !Object.getOwnPropertyDescriptor(value, key).enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) || keys.length !== expected.length) throw Error('SKILL_INVALID');
}
export function skillArray(value, max) {
    if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) throw Error('SKILL_CAPACITY');
    for (let i = 0; i < value.length; i++) {
        const d = Object.getOwnPropertyDescriptor(value, String(i));
        if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) throw Error('SKILL_INVALID');
    }
}
export function skillPath(path) {
    if (typeof path !== 'string' || path.length > 180 || !path.split('/').every(part => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) && !part.endsWith('.') && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) throw Error('SKILL_INVALID_PATH');
    if (path === 'SKILL.md') return path;
    if (!/^(references|assets)\/.+\.(md|txt|json)$/i.test(path)) throw Error('SKILL_UNSUPPORTED_RESOURCE');
    return path;
}

// A deliberately bounded frontmatter subset, not a general YAML interpreter.
function scalar(raw) {
    const text = raw.trim();
    if (text.startsWith('"')) { try { const value = JSON.parse(text); if (typeof value === 'string') return value; } catch { /* Fail closed. */ } throw Error('SKILL_INVALID_FRONTMATTER'); }
    if (text.startsWith("'")) { if (!/^'(?:[^']|'')*'$/.test(text)) throw Error('SKILL_INVALID_FRONTMATTER'); return text.slice(1, -1).replaceAll("''", "'"); }
    if (!text || /^[!&*[{]/.test(text) || /\s#/.test(text)) throw Error('SKILL_INVALID_FRONTMATTER');
    return text;
}
export function parseSkillMarkdown(text) {
    if (typeof text !== 'string' || text.length > SKILL_LIMITS.fileBytes || skillBytes(text) > SKILL_LIMITS.fileBytes || text.includes('\0')) throw Error('SKILL_INVALID');
    const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    if (!normalized.startsWith('---\n')) throw Error('SKILL_INVALID_FRONTMATTER');
    const end = normalized.indexOf('\n---\n', 4);
    if (end < 0 || end > 8192) throw Error('SKILL_INVALID_FRONTMATTER');
    const lines = normalized.slice(4, end).split('\n'), values = Object.create(null);
    const allowed = ['name', 'description', 'display-name', 'version', 'disable-model-invocation', 'user-invocable'];
    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].trim() || lines[i].trimStart().startsWith('#')) continue;
        const match = /^([a-z][a-z-]*):\s*(.*)$/.exec(lines[i]);
        if (!match) throw Error('SKILL_INVALID_FRONTMATTER');
        const [, key, raw] = match;
        if (!allowed.includes(key)) throw Error('SKILL_UNSUPPORTED_FRONTMATTER');
        if (Object.hasOwn(values, key)) throw Error('SKILL_INVALID_FRONTMATTER');
        if (['|', '>', '|-', '>-'].includes(raw)) {
            const block = [];
            while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i].trim());
            values[key] = block.join(raw.startsWith('>') ? ' ' : '\n').trim();
        } else values[key] = scalar(raw);
    }
    const name = values.name, description = values.description, body = normalized.slice(end + 5);
    if (typeof name !== 'string' || name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || typeof description !== 'string' || !description.trim() || description.length > 2000 || !body.trim()) throw Error('SKILL_INVALID_FRONTMATTER');
    for (const key of ['disable-model-invocation', 'user-invocable']) if (values[key] !== undefined && !['true', 'false'].includes(values[key])) throw Error('SKILL_INVALID_FRONTMATTER');
    const displayName = values['display-name'] ?? name, contentVersion = values.version ?? '';
    if (!displayName.trim() || displayName.length > 100 || contentVersion.length > 80) throw Error('SKILL_INVALID_FRONTMATTER');
    return { name, displayName, description, contentVersion, modelInvocable: values['disable-model-invocation'] !== 'true', userInvocable: values['user-invocable'] !== 'false', body };
}
export function validateSkillPackage(input) {
    skillKeys(input, ['format', 'version', 'files']);
    if (input.format !== 'muyu-skill-package' || input.version !== 1) throw Error('SKILL_VERSION');
    skillArray(input.files, SKILL_LIMITS.files);
    const paths = new Set(), files = input.files.map(file => {
        skillKeys(file, ['path', 'text']);
        const path = skillPath(file.path);
        if (paths.has(path.toLowerCase())) throw Error('SKILL_DUPLICATE_RESOURCE');
        paths.add(path.toLowerCase());
        if (typeof file.text !== 'string' || file.text.length > SKILL_LIMITS.fileBytes || file.text.includes('\0') || skillBytes(file.text) > SKILL_LIMITS.fileBytes) throw Error('SKILL_CAPACITY');
        return { path, text: file.text };
    });
    const main = files.find(file => file.path === 'SKILL.md');
    if (!main) throw Error('SKILL_MISSING_MAIN');
    parseSkillMarkdown(main.text);
    const result = { format: input.format, version: 1, files };
    if (skillBytes(result) > SKILL_LIMITS.packageBytes) throw Error('SKILL_CAPACITY');
    return result;
}
export function importSkillPackage(text) {
    if (typeof text !== 'string' || text.length > SKILL_LIMITS.packageBytes || skillBytes(text) > SKILL_LIMITS.packageBytes) throw Error('SKILL_CAPACITY');
    const source = text.replace(/^\uFEFF/, '');
    return validateSkillPackage(source.trimStart().startsWith('{') ? JSON.parse(source) : { format: 'muyu-skill-package', version: 1, files: [{ path: 'SKILL.md', text: source }] });
}
export const exportSkillPackage = value => JSON.stringify(validateSkillPackage(value));
export function validateSkillRecord(value) {
    skillKeys(value, ['id', 'revision', 'enabled', 'package']);
    const pack = validateSkillPackage(value.package), meta = parseSkillMarkdown(pack.files.find(file => file.path === 'SKILL.md').text);
    if (value.id !== `user:${meta.name}` || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.enabled !== 'boolean') throw Error('SKILL_INVALID');
    return { id: value.id, revision: value.revision, enabled: value.enabled, package: pack };
}
export function validateSkillData(value) {
    if (value === undefined) return { version: 2, revision: 0, skills: [], enabled: true, builtinPolicies: [] };
    if (value === null || !ownRecord(value) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, 'version') ?? {}, 'value')) throw Error('SKILL_VERSION');
    const legacy = value.version === 1;
    if (!legacy && value.version !== 2) throw Error('SKILL_VERSION');
    skillKeys(value, legacy ? ['version', 'revision', 'skills'] : ['version', 'revision', 'skills', 'enabled', 'builtinPolicies']);
    if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw Error('SKILL_VERSION');
    skillArray(value.skills, SKILL_LIMITS.entries);
    const skills = value.skills.map(validateSkillRecord);
    if (skills.some(row => row.revision > value.revision)) throw Error('SKILL_INVALID');
    if (new Set(skills.map(row => row.id)).size !== skills.length) throw Error('SKILL_DUPLICATE');
    const enabled = legacy ? true : value.enabled;
    if (typeof enabled !== 'boolean') throw Error('SKILL_INVALID');
    const policies = legacy ? [] : value.builtinPolicies;
    skillArray(policies, SKILL_LIMITS.entries);
    const builtinPolicies = policies.map(policy => {
        skillKeys(policy, ['id', 'revision', 'enabled']);
        if (typeof policy.id !== 'string' || !/^builtin:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(policy.id) || policy.id.length > 72 || typeof policy.enabled !== 'boolean' || !Number.isSafeInteger(policy.revision) || policy.revision < 1 || policy.revision > value.revision) throw Error('SKILL_INVALID');
        return { id: policy.id, revision: policy.revision, enabled: policy.enabled };
    });
    if (new Set(builtinPolicies.map(row => row.id)).size !== builtinPolicies.length) throw Error('SKILL_DUPLICATE');
    const result = { version: 2, revision: value.revision, skills, enabled, builtinPolicies };
    if (skillBytes(result) > SKILL_LIMITS.totalBytes) throw Error('SKILL_CAPACITY');
    return result;
}
