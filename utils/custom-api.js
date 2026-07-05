/**
 * Protocol layer for Agent Runtime.
 *
 * createCaller(config) → { generate, test }
 *   config.useCustom = false → ST native generateRaw
 *   config.useCustom = true → openaiCompatible or anthropicCompatible
 *
 * Unified return: { text: string }
 */

/**
 * Create a model caller based on runtime config.
 * @param {object} config - Agent config (useCustom, protocol, endpoint, apiKey, model)
 * @param {Function} stGenerateRaw - ST's native ctx.generateRaw (for non-custom fallback)
 * @returns {{ generate: (prompt: string) => Promise<string>, test: () => Promise<{ok: boolean, error?: string}> }}
 */
export function createCaller(config, stGenerateRaw) {
    if (!config?.useCustom) {
        return makeNativeCaller(stGenerateRaw);
    }
    if (config.protocol === 'anthropic') {
        return makeAnthropicCaller(config);
    }
    return makeOpenAICaller(config);
}

// ─── Native ST caller ────────────────────────────────────────────────

function makeNativeCaller(stGenerateRaw) {
    return {
        async generate(prompt) {
            const response = await stGenerateRaw({ prompt });
            return (typeof response === 'string') ? response : String(response ?? '');
        },
        async test() {
            return { ok: true }; // native always "connected" — user's main model is working
        },
    };
}

// ─── OpenAI Compatible ────────────────────────────────────────────────

function makeOpenAICaller(config) {
    const base = config.endpoint.replace(/\/+$/, '');

    /** Build headers — only add CSRF token for localhost (ST native). */
    function headers() {
        const h = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
        };
        // Only send CSRF to ST's own server, not to external APIs
        try {
            const parsed = new URL(base);
            if (window.csrfToken && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
                h['X-CSRF-Token'] = window.csrfToken;
            }
        } catch (_) { /* invalid URL, skip CSRF */ }
        return h;
    }

    /** Extract text from a DeepSeek/OpenAI response. DeepSeek reasoning models
     *  may return content="" when thinking consumes all allocated tokens. */
    function extractContent(data) {
        const msg = data?.choices?.[0]?.message;
        if (!msg) return '';
        // Prefer content, fallback to reasoning_content (DeepSeek R1)
        return msg.content || msg.reasoning_content || '';
    }

    return {
        async generate(prompt) {
            const resp = await fetch(`${base}/v1/chat/completions`, {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify({
                    model: config.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7,
                    max_tokens: 4096,
                }),
            });
            if (!resp.ok) {
                const err = await resp.text().catch(() => '');
                throw new Error(`API error ${resp.status}: ${err.substring(0, 200)}`);
            }
            const data = await resp.json();
            return extractContent(data);
        },

        async test() {
            try {
                const resp = await fetch(`${base}/v1/chat/completions`, {
                    method: 'POST',
                    headers: headers(),
                    body: JSON.stringify({
                        model: config.model,
                        messages: [{ role: 'user', content: 'Hi' }],
                        temperature: 0,
                        max_tokens: 50,
                    }),
                });
                if (!resp.ok) {
                    const err = await resp.text().catch(() => '');
                    return { ok: false, error: `HTTP ${resp.status}: ${err.substring(0, 300)}` };
                }
                const data = await resp.json();
                const text = extractContent(data);
                return text.trim() ? { ok: true } : { ok: false, error: 'Empty response from API — try increasing max_tokens or disabling reasoning mode' };
            } catch (e) {
                return { ok: false, error: e.message };
            }
        },
    };
}

// ─── Anthropic Compatible ─────────────────────────────────────────────

function makeAnthropicCaller(config) {
    const base = config.endpoint.replace(/\/+$/, '');

    return {
        async generate(prompt) {
            const resp = await fetch(`${base}/v1/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': config.apiKey,
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                    model: config.model,
                    max_tokens: 4096,
                    messages: [{ role: 'user', content: prompt }],
                }),
            });
            if (!resp.ok) {
                const err = await resp.text().catch(() => '');
                throw new Error(`Anthropic API error ${resp.status}: ${err.substring(0, 200)}`);
            }
            const data = await resp.json();
            return data.content?.[0]?.text ?? '';
        },

        async test() {
            try {
                const resp = await fetch(`${base}/v1/messages`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': config.apiKey,
                        'anthropic-version': '2023-06-01',
                    },
                    body: JSON.stringify({
                        model: config.model,
                        max_tokens: 50,
                        messages: [{ role: 'user', content: 'Hi' }],
                    }),
                });
                if (!resp.ok) {
                    const err = await resp.text().catch(() => '');
                    return { ok: false, error: `HTTP ${resp.status}: ${err.substring(0, 300)}` };
                }
                const data = await resp.json();
                return data.content?.[0]?.text ? { ok: true } : { ok: false, error: 'Empty response' };
            } catch (e) {
                return { ok: false, error: e.message };
            }
        },
    };
}
