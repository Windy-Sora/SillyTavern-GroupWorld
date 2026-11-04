import { validateConnection } from './connection.js';
import { createHttpTransport } from './http-transport.js';
import { modelError } from './errors.js';
import { createResponsesModel } from './responses.js';

/** Explicit user-triggered requests only. No conversation, tools, grants or settings writes. */
export async function probeConnection(config, { kind = 'test', fetchImpl = globalThis.fetch, signal } = {}) {
    if (!['test', 'models'].includes(kind)) throw new TypeError('Invalid connection probe');
    const connection = validateConnection({ ...config, model: kind === 'models' ? 'model-list' : config.model });
    const abort = new AbortController(), cancel = () => abort.abort();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort.abort(); }, 15000);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    try {
        if (kind === 'models') {
            const endpoint = new URL(connection.endpoint); endpoint.pathname = endpoint.pathname.replace(/\/(?:chat\/completions|responses)$/, '/models');
            const get = createHttpTransport({ fetchImpl, method: 'GET' });
            const result = await get({ ...connection, endpoint: endpoint.href }, null, abort.signal);
            if (!Array.isArray(result?.data) || result.data.length > 1000) throw modelError('MODEL_PROTOCOL_ERROR');
            return [...new Set(result.data.map(item => item?.id).filter(id => typeof id === 'string' && id.trim() === id && id.length > 0 && id.length <= 128 && !/[\r\n]/.test(id)))].sort();
        }
        if (connection.profile === 'responses') {
            const model = createResponsesModel({ connection: { ...connection, reasoningEffort: 'low', supportsTools: false }, fetchImpl }), context = {};
            let text = '', done = false;
            try {
                for await (const event of model.run({ messages: [{ role: 'user', content: 'Reply with OK.' }], tools: [], maxTokens: 512 }, { signal: abort.signal, context })) {
                    if (event.type === 'text_delta') text += event.text;
                    if (event.type === 'done') done = true;
                }
                if (!done || !text.trim()) throw modelError('MODEL_PROTOCOL_ERROR');
                return { ok: true };
            } finally { model.releaseContext(context); }
        }
        const post = createHttpTransport({ fetchImpl });
        const result = await post(connection, { model: connection.model, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 32, stream: false,
            ...(connection.profile === 'deepseek' ? { thinking: { type: 'disabled' } } : {}) }, abort.signal);
        if (!result?.choices?.some(choice => typeof choice?.message?.content === 'string' && choice.message.content.trim())) throw modelError('MODEL_PROTOCOL_ERROR');
        return { ok: true };
    } catch (error) {
        if (timedOut) throw modelError('CONNECTION_TEST_TIMEOUT');
        throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
