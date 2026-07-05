/**
 * Capability Registry — multimodal capability registration system.
 *
 * Separate from AgentRegistry. Each capability describes WHAT it can do,
 * not HOW. The Execution Engine maps intents → capabilities → executors.
 *
 * Capability = { id, displayName, description, schema, executor, constraints, scope }
 *
 * Provider integration:
 *   registerCapabilityProviders({ registerProvider }) creates two providers:
 *   - {{capabilityListMessage}} — scope 'message' or 'both'
 *   - {{capabilityListRound}}   — scope 'round' or 'both'
 */

const capabilities = new Map();

export const CapabilityRegistry = {
    register(cap) {
        if (!cap || !cap.id) throw new Error('Capability must have an id');
        if (!cap.executor || typeof cap.executor !== 'function') {
            throw new Error(`Capability "${cap.id}" must have an executor function`);
        }
        capabilities.set(cap.id, {
            id: cap.id,
            displayName: cap.displayName || cap.id,
            description: cap.description || '',
            // Guidance for the LLM: when to trigger this capability and how to decide params
            promptHint: cap.promptHint || '',
            // JSON Schema describing what params this capability accepts
            schema: cap.schema || {},
            // Async executor: (params) => { ... } — abstract, not ST-specific
            executor: cap.executor,
            // Constraints: { maxPerMessage, requires, cooldown }
            constraints: Object.assign({ maxPerMessage: 1, cooldown: 0 }, cap.constraints),
            enabled: cap.enabled !== false,
            scope: cap.scope || 'both',  // 'message' | 'round' | 'both' | 'off'
        });
    },

    get(id) {
        return capabilities.get(id);
    },

    list() {
        return [...capabilities.values()];
    },

    /**
     * List capabilities that are active for a given mode.
     * @param {'message'|'round'} mode — which PostSpeech mode is running
     */
    listForMode(mode) {
        return [...capabilities.values()]
            .filter(c => c.enabled && (c.scope === 'both' || c.scope === mode))
            .map(c => ({ id: c.id, displayName: c.displayName, description: c.description, promptHint: c.promptHint, schema: c.schema }));
    },

    /** Deprecated — use listForMode() instead. */
    listEnabled() {
        return this.listForMode('message');
    },

    /** Set scope for a capability. */
    setScope(id, scope) {
        const c = capabilities.get(id);
        if (c) c.scope = scope;
    },

    /** Enable/disable a capability at runtime. */
    setEnabled(id, enabled) {
        const c = capabilities.get(id);
        if (c) c.enabled = !!enabled;
    },

    /** Last-used timestamps for cooldown tracking. */
    _cooldowns: {},
};

// ─── Provider Integration ────────────────────────────────────────────

/**
 * Register two capability-list providers for PostSpeech templates.
 *
 *   {{capabilityListMessage}} → capabilities active in per-message mode
 *   {{capabilityListRound}}   → capabilities active in per-round mode
 *
 * Call this once at startup, passing the plugin's registerProvider function.
 */
export function registerCapabilityProviders({ registerProvider }) {
    const buildList = (mode) => {
        const caps = CapabilityRegistry.listForMode(mode);
        if (!caps.length) return { content: '(none available)', data: { length: 0, all: [] } };

        const parts = [];
        for (const cap of caps) {
            let text = `- ${cap.id}: ${cap.description || cap.displayName}\n`;
            if (cap.schema?.params) {
                const paramDescs = [];
                for (const [k, def] of Object.entries(cap.schema.params)) {
                    let pd = `  ${k}`;
                    if (def.values) pd += `(${def.values.join('/')})`;
                    if (def.required) pd += '*';
                    if (def.description) pd += `: ${def.description}`;
                    paramDescs.push(pd);
                }
                if (paramDescs.length) text += `  Params: ${paramDescs.join(', ')}\n`;
            }
            if (cap.promptHint) text += `  When: ${cap.promptHint}\n`;
            parts.push(text);
        }

        return {
            content: parts.join('\n'),
            data: { length: caps.length, all: caps.map(c => ({ id: c.id, displayName: c.displayName, description: c.description })) },
        };
    };

    registerProvider({
        id: 'capabilityListMessage',
        placeholder: '{{capabilityListMessage}}',
        render: () => buildList('message'),
    });

    registerProvider({
        id: 'capabilityListRound',
        placeholder: '{{capabilityListRound}}',
        render: () => buildList('round'),
    });

    // Backward-compat: {{capabilityList}} shows all enabled capabilities
    registerProvider({
        id: 'capabilityList',
        placeholder: '{{capabilityList}}',
        render: () => {
            const caps = CapabilityRegistry.list().filter(c => c.enabled && c.scope !== 'off');
            if (!caps.length) return { content: '(none available)', data: { length: 0, all: [] } };
            const parts = [];
            for (const cap of caps) {
                let text = `${cap.id}: ${cap.description || cap.displayName}\n`;
                if (cap.promptHint) text += `  When: ${cap.promptHint}\n`;
                parts.push(text);
            }
            return {
                content: parts.join('\n'),
                data: { length: caps.length, all: caps.map(c => ({ id: c.id, displayName: c.displayName })) },
            };
        },
    });
}

