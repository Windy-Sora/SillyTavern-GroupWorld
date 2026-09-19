import {
    generateScriptExecutorId,
    normalizeScriptExecutor,
    normalizeScriptExecutorList,
} from './script-executor-validation.js';
import {
    generateCustomAgentId,
    normalizeCustomAgent,
    normalizeCustomAgentList,
} from './custom-agent-validation.js';
import {
    generateCustomPromptId,
    normalizeCustomPrompt,
    normalizeCustomPromptList,
} from './custom-prompt-validation.js';

const CONFIG_PROFILE_VERSION = 1;

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value, field) {
    if (!isRecord(value)) throw new Error(`Invalid manifest: ${field} must be an object`);
}

function validateNamedEntries(settings, key) {
    const entries = settings[key];
    if (entries === undefined) return;
    if (!Array.isArray(entries)) throw new Error(`Invalid manifest: ${key} must be an array`);
    entries.forEach((entry, index) => {
        if (!isRecord(entry)) throw new Error(`Invalid manifest: ${key}[${index}] must be an object`);
        if (typeof entry.name !== 'string' || !entry.name.trim()) {
            throw new Error(`Invalid manifest: ${key}[${index}].name must be a non-empty string`);
        }
    });
}

function validateVariables(variables) {
    requireRecord(variables, 'variables');
    if (!Array.isArray(variables.defs)) throw new Error('Invalid manifest: variables.defs must be an array');
    variables.defs.forEach((entry, index) => {
        if (!isRecord(entry)) throw new Error(`Invalid manifest: variables.defs[${index}] must be an object`);
    });
    requireRecord(variables.values, 'variables.values');
    if (variables.values.global !== undefined) requireRecord(variables.values.global, 'variables.values.global');
    if (variables.values.character !== undefined) requireRecord(variables.values.character, 'variables.values.character');
    if (variables.log !== undefined && !Array.isArray(variables.log)) {
        throw new Error('Invalid manifest: variables.log must be an array');
    }
}

export function validateConfigProfileManifest(manifest, { source = 'json' } = {}) {
    requireRecord(manifest, 'root');
    const validTypes = source === 'zip'
        ? ['config-profile']
        : ['config-profile', 'config-profile-manifest'];
    if (!validTypes.includes(manifest.type)) throw new Error('Not a valid config profile manifest');
    if (!Number.isInteger(manifest.version) || manifest.version !== CONFIG_PROFILE_VERSION) {
        throw new Error(`Unsupported version: ${manifest.version}`);
    }
    requireRecord(manifest.settings, 'settings');
    if (manifest.drawers !== undefined) {
        requireRecord(manifest.drawers, 'drawers');
        for (const [key, enabled] of Object.entries(manifest.drawers)) {
            if (typeof enabled !== 'boolean') throw new Error(`Invalid manifest: drawers.${key} must be boolean`);
        }
    }
    if (manifest.variables !== undefined && manifest.variables !== null) {
        validateVariables(manifest.variables);
    }
    for (const key of [
        'userProviders',
        'userCapabilities',
    ]) {
        validateNamedEntries(manifest.settings, key);
    }
    if (manifest.settings.customPrompts !== undefined) {
        normalizeCustomPromptList(manifest.settings.customPrompts, { path: 'customPrompts' });
    }
    if (manifest.settings.scriptExecutors !== undefined) {
        normalizeScriptExecutorList(manifest.settings.scriptExecutors, { path: 'scriptExecutors' });
    }
    if (manifest.settings.customAgents !== undefined) {
        normalizeCustomAgentList(manifest.settings.customAgents, { path: 'customAgents' });
    }
    return manifest;
}

export function sanitizeImportedSettings(settings, { source = 'json' } = {}) {
    const sanitized = structuredClone(settings);
    delete sanitized.agentConfigs;
    if (source === 'json') {
        delete sanitized.userProviders;
        delete sanitized.userCapabilities;
    }
    if (Array.isArray(sanitized.scriptExecutors)) {
        sanitized.scriptExecutors = sanitized.scriptExecutors.map((entry, index) => normalizeScriptExecutor(entry, {
            path: `scriptExecutors[${index}]`,
            id: generateScriptExecutorId(),
        }));
    }
    if (Array.isArray(sanitized.customAgents)) {
        sanitized.customAgents = sanitized.customAgents.map((entry, index) => normalizeCustomAgent(entry, {
            path: `customAgents[${index}]`,
            id: generateCustomAgentId(),
            forceDisabled: true,
        }));
    }
    if (Array.isArray(sanitized.customPrompts)) {
        sanitized.customPrompts = sanitized.customPrompts.map((entry, index) => normalizeCustomPrompt(entry, {
            path: `customPrompts[${index}]`,
            id: generateCustomPromptId(),
        }));
    }
    return sanitized;
}
