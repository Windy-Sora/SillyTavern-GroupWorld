import { createChatCompletionsAdapter } from '../model/chat-completions.js';
import { assertActive, ExecutionError } from '../core/execution.js';
import { modelError } from '../model/errors.js';
import { RUN_DEFAULTS } from '../core/budget.js';

const SOURCES = new Set(['openai', 'custom', 'openrouter', 'deepseek']);
const URLS = { openai: 'https://api.openai.com', openrouter: 'https://openrouter.ai/api', deepseek: 'https://api.deepseek.com' };

// sendRequest does not perform ST's frontend model-specific token conversion.
function mapHostPayload(payload, route) {
    const result = { ...payload, ...route, stream: false, n: 1, use_sysprompt: true };
    const openAI = route.chat_completion_source === 'openai' || route.chat_completion_source === 'openrouter';
    const reasoning = openAI && /^(?:openai\/)?(?:o1|o3|o4)/.test(route.model);
    const gpt5 = openAI && /gpt-5/.test(route.model);
    if (reasoning || gpt5) {
        result.max_completion_tokens = result.max_tokens;
        delete result.max_tokens;
        delete result.logprobs;
        delete result.top_logprobs;
        for (const key of ['frequency_penalty', 'presence_penalty', 'logit_bias', 'stop']) delete result[key];
        if (reasoning || !/gpt-5\.(1|2|3|4)/.test(route.model)) {
            delete result.temperature;
            delete result.top_p;
        }
    }
    return result;
}

/** Official ST service; only connection fields are inherited, never RP prompts/global tools. */
export function createHostModelConnection({ getContext, stDiagnostics }) {
    let credentialEpoch = 0;
    function capture() {
        const ctx = getContext(), settings = ctx.chatCompletionSettings;
        if (ctx.mainApi !== 'openai' || !settings || typeof ctx.ChatCompletionService?.sendRequest !== 'function' || typeof ctx.getChatCompletionModel !== 'function') throw modelError('HOST_CONNECTION_UNAVAILABLE');
        const source = settings.chat_completion_source, model = ctx.getChatCompletionModel(settings);
        if (!SOURCES.has(source) || typeof model !== 'string' || !model.trim() || model.length > 128) throw modelError('HOST_CONNECTION_UNSUPPORTED');
        // ST removes tools for these models; never silently downgrade the agent protocol.
        if (['openai', 'openrouter'].includes(source) && (/^(?:openai\/)?o1/.test(model) || /gpt-5-chat-latest/.test(model))) throw modelError('HOST_CONNECTION_UNSUPPORTED');
        // This ST backend does not forward the new DeepSeek thinking toggle.
        if (source === 'deepseek' && /reasoner/i.test(model)) throw modelError('HOST_CONNECTION_UNSUPPORTED');
        if (source === 'custom' && (settings.custom_include_body?.trim() || settings.custom_exclude_body?.trim())) throw modelError('HOST_CONNECTION_UNSUPPORTED');
        const rawEndpoint = source === 'custom' ? settings.custom_url : settings.reverse_proxy && source !== 'openrouter' ? settings.reverse_proxy : URLS[source];
        let endpoint;
        try { const url = new URL(rawEndpoint); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error(); endpoint = url.href; } catch { throw modelError('HOST_CONNECTION_UNAVAILABLE'); }
        const route = { chat_completion_source: source, model, ...(source === 'custom' ? { custom_url: endpoint, custom_prompt_post_processing: '', custom_include_headers: settings.custom_include_headers || '' } : {}),
            ...(source !== 'custom' && source !== 'openrouter' && settings.reverse_proxy ? { reverse_proxy: endpoint, proxy_password: settings.proxy_password || '' } : {}),
            ...(source === 'openrouter' ? { provider: structuredClone(settings.openrouter_providers || []), allow_fallbacks: false, use_fallback: false } : {}) };
        // Private comparison may include credentials; it is never returned, persisted, or logged.
        const identity = JSON.stringify([ctx.mainApi, route, credentialEpoch]);
        return { ctx, route, identity, description: { source: 'st', endpoint, model, profile: 'chat-completions', thinking: false, remembered: false, autoConnect: true, provider: source } };
    }
    function describe() { try { return { available: true, ...capture().description }; } catch (error) { return { available: false, code: error.code || 'HOST_CONNECTION_UNAVAILABLE' }; } }
    function bind() {
        const saved = capture();
        const current = () => { if (capture().identity !== saved.identity) throw modelError('HOST_CONNECTION_CHANGED'); };
        const config = { ...saved.description, supportsTools: true, maxTokens: RUN_DEFAULTS.maxTokens };
        const model = createChatCompletionsAdapter({ config,
            mapPayload(payload) { current(); return mapHostPayload(payload, saved.route); },
            async post(_config, payload, signal) {
                assertActive(signal); current();
                const diagnosticTarget = stDiagnostics?.captureTarget();
                try {
                    const data = await saved.ctx.ChatCompletionService.sendRequest(payload, false, signal);
                    assertActive(signal); current();
                    if (new TextEncoder().encode(JSON.stringify(data)).length > 262144) throw modelError('MODEL_RESPONSE_TOO_LARGE');
                    return data;
                } catch (error) { stDiagnostics?.recordHostFailure(error, signal, diagnosticTarget); assertActive(signal); if (error instanceof ExecutionError) throw error; throw modelError('HOST_MODEL_REQUEST_FAILED'); }
            },
        });
        return { model, connection: saved.description, current };
    }
    return Object.freeze({ describe, bind,
        subscribe(listener) {
            const ctx = getContext(), source = ctx.eventSource;
            const names = ['SETTINGS_UPDATED', 'OAI_PRESET_CHANGED_AFTER', 'CONNECTION_PROFILE_LOADED', 'CONNECTION_PROFILE_UPDATED', 'MAIN_API_CHANGED', 'CHATCOMPLETION_SOURCE_CHANGED', 'CHATCOMPLETION_MODEL_CHANGED'];
            const types = [...new Set(names.map(key => ctx.eventTypes?.[key]).filter(Boolean))];
            if (!source?.on || !source?.removeListener) return () => {};
            for (const type of types) source.on(type, listener);
            const secretTypes = ['SECRET_WRITTEN', 'SECRET_DELETED', 'SECRET_ROTATED', 'SECRET_EDITED'].map(key => ctx.eventTypes?.[key]).filter(Boolean);
            const secretChanged = () => { credentialEpoch++; listener(); };
            for (const type of secretTypes) source.on(type, secretChanged);
            return () => { for (const type of types) source.removeListener(type, listener); for (const type of secretTypes) source.removeListener(type, secretChanged); };
        },
    });
}
