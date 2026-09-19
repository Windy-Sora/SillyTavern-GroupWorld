export const CUSTOM_PROMPT_EXPORT_VERSION = 1;
export const CUSTOM_PROMPT_NAME_RE = /^\w+$/;

const SCOPES = new Set(['global', 'character', 'mixed']);

function isRecord(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function optionalBoolean(value, fallback, path) {
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') throw new Error(`${path} must be boolean`);
    return value;
}

export function generateCustomPromptId() {
    if (globalThis.crypto?.randomUUID) return `cp_${globalThis.crypto.randomUUID()}`;
    return 'cp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export function parseCustomPromptData(dataJson, path = 'prompt.dataJson') {
    if (dataJson === undefined || dataJson === '') return null;
    if (typeof dataJson !== 'string') throw new Error(`${path} must be a string`);
    if (!dataJson.trim()) return null;
    let parsed;
    try {
        parsed = JSON.parse(dataJson);
    } catch (error) {
        throw new Error(`${path} must contain valid JSON: ${error.message}`);
    }
    if (parsed === null || typeof parsed !== 'object') {
        throw new Error(`${path} must contain a JSON object or array`);
    }
    return parsed;
}

export function normalizeCustomPrompt(value, { path = 'prompt', id } = {}) {
    if (!isRecord(value)) throw new Error(`${path} must be an object`);
    if (typeof value.name !== 'string' || !value.name.trim()) {
        throw new Error(`${path}.name must be a non-empty string`);
    }
    const name = value.name.trim();
    if (!CUSTOM_PROMPT_NAME_RE.test(name)) {
        throw new Error(`${path}.name may contain only letters, numbers, and underscore`);
    }
    const content = value.content ?? '';
    const dataJson = value.dataJson ?? '';
    const scope = value.scope ?? 'global';
    if (typeof content !== 'string') throw new Error(`${path}.content must be a string`);
    parseCustomPromptData(dataJson, `${path}.dataJson`);
    if (!SCOPES.has(scope)) throw new Error(`${path}.scope is invalid`);

    const normalized = {
        name,
        content,
        dataJson,
        scope,
        enabled: optionalBoolean(value.enabled, true, `${path}.enabled`),
    };
    if (id !== undefined) normalized.id = id;
    return normalized;
}

export function normalizeCustomPromptList(value, {
    path = 'customPrompts',
    preserveIds = true,
} = {}) {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
    const prompts = value.map((entry, index) => normalizeCustomPrompt(entry, {
        path: `${path}[${index}]`,
        id: preserveIds && typeof entry?.id === 'string' && entry.id ? entry.id : undefined,
    }));
    const names = new Set();
    const ids = new Set();
    for (const prompt of prompts) {
        if (names.has(prompt.name)) throw new Error(`${path} contains duplicate name "${prompt.name}"`);
        names.add(prompt.name);
        if (prompt.id !== undefined) {
            if (ids.has(prompt.id)) throw new Error(`${path} contains duplicate id "${prompt.id}"`);
            ids.add(prompt.id);
        }
    }
    return prompts;
}

export function validateCustomPromptExport(value) {
    if (!isRecord(value)) throw new Error('root must be an object');
    if (value.type !== 'custom-prompt-export') throw new Error('Not a custom prompt export file');
    if (value.version !== CUSTOM_PROMPT_EXPORT_VERSION) {
        throw new Error(`Unsupported version: ${value.version}`);
    }
    return normalizeCustomPromptList(value.prompts, { path: 'prompts', preserveIds: false });
}
