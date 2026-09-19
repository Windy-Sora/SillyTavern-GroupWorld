export const SCRIPT_EXECUTOR_EXPORT_VERSION = 1;

const TRIGGERS = new Set(['message', 'round', 'decision', 'both', 'all']);
const RETURN_MODES = new Set(['ignore', 'shared']);
const PARAM_TYPES = new Set(['string', 'number', 'boolean']);
const UNSAFE_PARAM_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function generateScriptExecutorId() {
    if (globalThis.crypto?.randomUUID) return `se_${globalThis.crypto.randomUUID()}`;
    return 'se_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function isRecord(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function requireRecord(value, path) {
    if (!isRecord(value)) throw new Error(`${path} must be an object`);
}

function optionalBoolean(value, fallback, path) {
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') throw new Error(`${path} must be boolean`);
    return value;
}

function normalizeParam(value, index, path) {
    const itemPath = `${path}.params[${index}]`;
    requireRecord(value, itemPath);

    if (typeof value.key !== 'string' || !value.key.trim()) {
        throw new Error(`${itemPath}.key must be a non-empty string`);
    }
    const key = value.key.trim();
    if (UNSAFE_PARAM_KEYS.has(key)) throw new Error(`${itemPath}.key is not allowed`);

    const type = value.type ?? 'string';
    if (!PARAM_TYPES.has(type)) throw new Error(`${itemPath}.type is invalid`);

    const label = value.label === undefined ? key : value.label;
    if (typeof label !== 'string') throw new Error(`${itemPath}.label must be a string`);

    let defaultValue = value.default;
    if (defaultValue === undefined || (defaultValue === '' && type !== 'string')) {
        defaultValue = type === 'number' ? 0 : type === 'boolean' ? false : '';
    }
    if (type === 'string' && typeof defaultValue !== 'string') {
        throw new Error(`${itemPath}.default must be a string`);
    }
    if (type === 'number' && (typeof defaultValue !== 'number' || !Number.isFinite(defaultValue))) {
        throw new Error(`${itemPath}.default must be a finite number`);
    }
    if (type === 'boolean' && typeof defaultValue !== 'boolean') {
        throw new Error(`${itemPath}.default must be boolean`);
    }

    return { key, label, type, default: defaultValue };
}

/**
 * Validate and copy one executor. Optional fields receive the version-1
 * defaults, while fields that are present must already have the correct type.
 */
export function normalizeScriptExecutor(value, { path = 'executor', id } = {}) {
    requireRecord(value, path);

    if (typeof value.name !== 'string' || !value.name.trim()) {
        throw new Error(`${path}.name must be a non-empty string`);
    }
    const triggerOn = value.triggerOn ?? 'both';
    if (!TRIGGERS.has(triggerOn)) throw new Error(`${path}.triggerOn is invalid`);

    const priority = value.priority ?? 0;
    if (!Number.isInteger(priority) || priority < -100 || priority > 100) {
        throw new Error(`${path}.priority must be an integer from -100 to 100`);
    }

    const code = value.code ?? '';
    if (typeof code !== 'string') throw new Error(`${path}.code must be a string`);

    const returnMode = value.returnMode ?? 'ignore';
    if (!RETURN_MODES.has(returnMode)) throw new Error(`${path}.returnMode is invalid`);

    const rawParams = value.params ?? [];
    if (!Array.isArray(rawParams)) throw new Error(`${path}.params must be an array`);
    const params = rawParams.map((param, index) => normalizeParam(param, index, path));
    const seenKeys = new Set();
    for (const param of params) {
        if (seenKeys.has(param.key)) throw new Error(`${path}.params contains duplicate key "${param.key}"`);
        seenKeys.add(param.key);
    }

    const normalized = {
        name: value.name.trim(),
        triggerOn,
        priority,
        code,
        enabled: optionalBoolean(value.enabled, true, `${path}.enabled`),
        params,
        renderParams: optionalBoolean(value.renderParams, false, `${path}.renderParams`),
        returnMode,
    };
    if (id !== undefined) normalized.id = id;
    return normalized;
}

export function normalizeScriptExecutorList(value, { path = 'scriptExecutors' } = {}) {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
    return value.map((entry, index) => normalizeScriptExecutor(entry, {
        path: `${path}[${index}]`,
        id: typeof entry?.id === 'string' && entry.id ? entry.id : undefined,
    }));
}

export function validateScriptExecutorExport(value) {
    requireRecord(value, 'root');
    if (value.type !== 'script-executor-export') throw new Error('Invalid file type');
    if (value.version !== SCRIPT_EXECUTOR_EXPORT_VERSION) {
        throw new Error(`Unsupported version: ${value.version}`);
    }
    if (!Array.isArray(value.executors)) throw new Error('executors must be an array');

    const executors = value.executors.map((entry, index) => normalizeScriptExecutor(entry, {
        path: `executors[${index}]`,
    }));
    const names = new Set();
    for (const entry of executors) {
        if (names.has(entry.name)) throw new Error(`executors contains duplicate name "${entry.name}"`);
        names.add(entry.name);
    }
    if (value.migrations !== undefined && !Array.isArray(value.migrations)) {
        throw new Error('migrations must be an array');
    }
    return executors;
}
