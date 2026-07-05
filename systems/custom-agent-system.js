/**
 * Custom Agent System — user-defined LLM agents that run on auto/manual trigger.
 *
 * Each instance is a user-defined prompt + optional JSON schema that gets
 * rendered, sent to LLM, and stored. Results exposed as {{providerName}}
 * Provider for DSL consumption.
 *
 * Storage:
 *   settings.customAgents[]   — instance definitions
 *   chat_metadata._caData[id] — per-instance result cache
 *   chat_metadata._autoCAG_{id} — per-instance auto-trigger counter
 *
 * Trigger: GROUP_WRAPPER_FINISHED (critique-style), sorted by order.
 * API config: agentConfigs['custom-agent'] (shared by all instances).
 */

import { registerProvider, unregisterProvider } from '../provider-registry.js';

export function createCustomAgentSystem({
    settings,
    getChatMetadata,
    getChat,
    EXT_KEY,
    saveChatConditional,
    renderPrompt,
    generateRaw,
    createCaller,
    log,
}) {
    const cm = () => getChatMetadata();
    let running = false;

    // ─── Caller ────────────────────────────────────────────────────────

    function getCaller() {
        const agentConfig = settings.agentConfigs?.['custom-agent'] || {};
        const stGenerateRaw = (opts) => generateRaw(opts);
        return createCaller(agentConfig, stGenerateRaw);
    }

    // ─── Data Access ──────────────────────────────────────────────────

    function getStore() {
        const meta = cm();
        if (!meta[EXT_KEY]) meta[EXT_KEY] = {};
        if (!meta[EXT_KEY]._caData) meta[EXT_KEY]._caData = {};
        return meta[EXT_KEY]._caData;
    }

    /** Get stored result for a specific instance. Returns null if not found. */
    function getData(id) {
        const store = getStore();
        return store[id] || null;
    }

    // ─── Execution ────────────────────────────────────────────────────

    /**
     * Execute a single custom agent instance.
     * Renders prompt → calls LLM → parses JSON → stores result.
     */
    async function execute(instance) {
        if (!instance || !instance.id || !instance.prompt) return null;
        if (running) throw new Error('CustomAgent: already executing');
        running = true;

        // User's prompt + optional schema constraint
        const rawPrompt = instance.prompt + (instance.schema
            ? '\n\n输出格式必须严格遵循此JSON schema:\n' + instance.schema
            : '');

        // Resolve {{providers}} and DSL in user's prompt
        let promptText = rawPrompt;
        try {
            promptText = await renderPrompt(rawPrompt);
        } catch (_) {
            log(`[CustomAgent] "${instance.name}" prompt render failed, using raw`);
        }
        try {
            const chat = getChat();
            const response = await getCaller().generate(promptText);
            if (!response) return null;

            // Try parse JSON if schema was provided
            let data = null;
            if (instance.schema) {
                try {
                    const extracted = extractJson(response);
                    if (extracted) data = extracted;
                } catch (_) {}
            }

            // Store result
            const store = getStore();
            store[instance.id] = {
                rangeEnd: chat.length,
                content: response,
                data: data || response,
                timestamp: Date.now(),
            };
            await saveChatConditional();

            log(`[CustomAgent] "${instance.name}" executed, rangeEnd=${chat.length}`);
            return store[instance.id];
        } finally {
            running = false;
        }
    }

    /**
     * Execute multiple instances in order, sorted by their `order` field.
     * Each execution is sequential so later instances can reference earlier ones' Providers.
     */
    async function executeAll(instances) {
        const sorted = [...instances]
            .filter(i => i.enabled && i.id && i.prompt)
            .sort((a, b) => (a.order || 0) - (b.order || 0));

        const results = [];
        for (const inst of sorted) {
            try {
                const r = await execute(inst);
                results.push({ id: inst.id, name: inst.name, success: true, data: r });
            } catch (e) {
                log(`[CustomAgent] "${inst.name}" failed: ${e.message}`);
                results.push({ id: inst.id, name: inst.name, success: false, error: e.message });
            }
        }
        return results;
    }

    // ─── Provider Management ──────────────────────────────────────────

    /** Track previously registered provider names for cleanup. */
    let _prevProviderNames = new Set();

    /**
     * Register or re-register providers for all enabled instances.
     * Stale providers from deleted/renamed instances are unregistered.
     */
    function refreshProviders() {
        const instances = settings.customAgents || [];

        // Collect current provider names from instances
        const currentIds = new Set();
        for (const inst of instances) {
            const pn = inst.providerName;
            if (!pn) continue;
            currentIds.add(pn);

            const capturedId = inst.id;

            registerProvider({
                id: pn,
                placeholder: `{{${pn}}}`,
                render: () => {
                    const live = (settings.customAgents || []).find(a => a.id === capturedId);
                    if (!live || !live.enabled) return { content: '', data: null };
                    const store = getStore();
                    const entry = store[capturedId];
                    if (!entry) return { content: '', data: null };
                    return {
                        content: typeof entry.data === 'object'
                            ? JSON.stringify(entry.data, null, 2)
                            : String(entry.data),
                        data: entry.data,
                    };
                },
            });
        }

        // Unregister stale providers (deleted/renamed instances)
        for (const oldName of _prevProviderNames) {
            if (!currentIds.has(oldName)) {
                unregisterProvider(oldName);
                log(`[CustomAgent] unregistered stale provider "${oldName}"`);
            }
        }
        _prevProviderNames = new Set(currentIds);

        log(`[CustomAgent] refreshProviders: ${currentIds.size} providers registered`);
        return currentIds;
    }

    // ─── JSON Extraction (borrowed from critique-system) ───────────────

    function extractJson(text) {
        if (typeof text !== 'string') return null;
        const firstBrace = text.indexOf('{');
        if (firstBrace === -1) return null;

        let depth = 0;
        let inString = false;
        let escape = false;

        for (let i = firstBrace; i < text.length; i++) {
            const ch = text[i];
            if (escape) { escape = false; continue; }
            if (ch === '\\') { escape = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (inString) continue;

            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) {
                    const raw = text.slice(firstBrace, i + 1);
                    let s = raw;
                    s = s.replace(/,(\s*[}\]])/g, '$1');
                    s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ');
                    try { return JSON.parse(s); } catch (_) { return null; }
                }
            }
        }
        return null;
    }

    return {
        getData,
        execute,
        executeAll,
        refreshProviders,
    };
}
