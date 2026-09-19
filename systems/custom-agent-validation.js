export const CUSTOM_AGENT_EXPORT_VERSION = 1;

const PROVIDER_NAME_RE = /^\w+$/;

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

function boundedInteger(value, fallback, min, max, path) {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new Error(`${path} must be an integer from ${min} to ${max}`);
    }
    return value;
}

export function generateCustomAgentId() {
    if (globalThis.crypto?.randomUUID) return `ca_${globalThis.crypto.randomUUID()}`;
    return 'ca_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export function validateCustomAgentSchema(schema, path = 'agent.schema') {
    if (typeof schema !== 'string') throw new Error(`${path} must be a string`);
    if (!schema.trim()) return null;
    let parsed;
    try {
        parsed = JSON.parse(schema);
    } catch (error) {
        throw new Error(`${path} must contain valid JSON: ${error.message}`);
    }
    if (!isRecord(parsed)) throw new Error(`${path} must contain a JSON object`);
    return parsed;
}

export function normalizeCustomAgent(value, {
    path = 'agent',
    id,
    forceDisabled = false,
} = {}) {
    requireRecord(value, path);
    if (typeof value.name !== 'string' || !value.name.trim()) {
        throw new Error(`${path}.name must be a non-empty string`);
    }
    if (typeof value.providerName !== 'string' || !value.providerName.trim()) {
        throw new Error(`${path}.providerName must be a non-empty string`);
    }
    const providerName = value.providerName.trim();
    if (!PROVIDER_NAME_RE.test(providerName)) {
        throw new Error(`${path}.providerName may contain only letters, numbers, and underscore`);
    }

    const prompt = value.prompt ?? '';
    const schema = value.schema ?? '';
    if (typeof prompt !== 'string') throw new Error(`${path}.prompt must be a string`);
    validateCustomAgentSchema(schema, `${path}.schema`);

    const enabled = forceDisabled
        ? false
        : optionalBoolean(value.enabled, false, `${path}.enabled`);
    const requestedAuto = forceDisabled
        ? false
        : optionalBoolean(value.autoEnabled, false, `${path}.autoEnabled`);

    const normalized = {
        name: value.name.trim(),
        providerName,
        prompt,
        schema,
        enabled,
        autoEnabled: enabled && requestedAuto,
        autoInterval: boundedInteger(value.autoInterval, 10, 1, 200, `${path}.autoInterval`),
        order: boundedInteger(value.order, 0, 0, 999, `${path}.order`),
    };
    if (id !== undefined) normalized.id = id;
    return normalized;
}

export function normalizeCustomAgentList(value, {
    path = 'customAgents',
    forceDisabled = false,
    preserveIds = true,
} = {}) {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
    const agents = value.map((entry, index) => normalizeCustomAgent(entry, {
        path: `${path}[${index}]`,
        id: preserveIds && typeof entry?.id === 'string' && entry.id ? entry.id : undefined,
        forceDisabled,
    }));
    const names = new Set();
    const ids = new Set();
    for (const agent of agents) {
        if (names.has(agent.providerName)) {
            throw new Error(`${path} contains duplicate providerName "${agent.providerName}"`);
        }
        names.add(agent.providerName);
        if (agent.id !== undefined) {
            if (ids.has(agent.id)) throw new Error(`${path} contains duplicate id "${agent.id}"`);
            ids.add(agent.id);
        }
    }
    return agents;
}

export function validateCustomAgentExport(value) {
    requireRecord(value, 'root');
    if (value.type !== 'custom-agent-export') throw new Error('Invalid file type');
    if (value.version !== CUSTOM_AGENT_EXPORT_VERSION) {
        throw new Error(`Unsupported version: ${value.version}`);
    }
    return normalizeCustomAgentList(value.agents, {
        path: 'agents',
        forceDisabled: true,
        preserveIds: false,
    });
}
