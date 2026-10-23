import { createBudgetConfigStore } from './budget-config.js';
import { modelDiagnosticStage } from '../core/model-diagnostics.js';
import { jsonKey } from '../core/json-contract.js';

const DEFAULTS = Object.freeze({ enabled: false, browserErrors: false });
const CAPACITY = 200, AGE_MS = 30 * 60 * 1000;
const CODES = new Set(['MODEL_AUTH_ERROR', 'MODEL_RATE_LIMIT', 'MODEL_SERVICE_ERROR', 'MODEL_HTTP_ERROR', 'MODEL_NETWORK_ERROR',
    'MODEL_PROTOCOL_ERROR', 'MODEL_RESPONSE_TOO_LARGE', 'HOST_MODEL_REQUEST_FAILED', 'HOST_CONNECTION_CHANGED',
    'HOST_CONNECTION_UNAVAILABLE', 'HOST_CONNECTION_UNSUPPORTED', 'CONTEXT_LIMIT', 'TIMEOUT', 'CANCELLED', 'MODEL_FAILED',
    'MODEL_REQUEST_TOO_LARGE', 'MODEL_HISTORY_LIMIT', 'MODEL_HISTORY_UNAVAILABLE', 'MODEL_OUTPUT_TRUNCATED', 'MODEL_CONTENT_FILTERED', 'UNSUPPORTED_CAPABILITY']);
const EVENTS = ['GENERATION_STARTED', 'GENERATION_STOPPED', 'GENERATION_ENDED', 'MAIN_API_CHANGED',
    'CHATCOMPLETION_SOURCE_CHANGED', 'CHATCOMPLETION_MODEL_CHANGED', 'OAI_PRESET_CHANGED_AFTER'];
function validate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !Object.hasOwn(DEFAULTS, k))
        || typeof value.enabled !== 'boolean' || typeof value.browserErrors !== 'boolean') throw Error('DIAGNOSTICS_CONFIG_INVALID');
    return { enabled: value.enabled, browserErrors: value.browserErrors };
}
/** Page-local bounded telemetry, not a console/fetch interceptor or server log reader. */
export function createStDiagnostics({ getContext, getTarget, getSettings, saveSettings, browser = globalThis.window, now = () => Date.now() }) {
    const configStore = createBudgetConfigStore({ getSettings, saveSettings, key: 'muyuDiagnosticsConfig', versionKey: 'muyuDiagnosticsConfigVersion',
        defaults: DEFAULTS, validate, legacy: () => false, errorCode: 'DIAGNOSTICS_CONFIG_SAVE_FAILED' });
    let config = configStore.read(), rows = [], sequence = 0, epoch = 0, dropped = 0, closed = false, saving = false, detach = [], browserDetach = [];
    const targetKey = () => { try { return jsonKey(getTarget?.() || null); } catch { return 'unavailable'; } };
    const prune = () => { rows = rows.filter(row => now() - row.time < AGE_MS); };
    function record(kind, { code, stage, attempt, target } = {}) {
        if (closed || !config.enabled) return;
        prune();
        const row = { id: ++sequence, time: now(), kind, target: target === undefined ? targetKey() : target,
            ...(code ? { code: CODES.has(code) ? code : 'MODEL_FAILED' } : {}),
            ...(modelDiagnosticStage(stage) ? { stage } : {}),
            ...(Number.isSafeInteger(attempt) && attempt > 0 && attempt <= 64 ? { attempt } : {}) };
        rows.push(row); if (rows.length > CAPACITY) { rows.shift(); dropped++; }
    }
    function subscribeBrowser() {
        for (const off of browserDetach) off(); browserDetach = [];
        if (!config.enabled || !config.browserErrors || !browser?.addEventListener || !browser?.removeEventListener) return;
        for (const event of ['error', 'unhandledrejection']) {
            const listener = () => record(event === 'error' ? 'browser_error' : 'unhandled_rejection', { target: 'null' });
            browser.addEventListener(event, listener); browserDetach.push(() => browser.removeEventListener(event, listener));
        }
    }
    function subscribeHost() {
        const ctx = getContext?.(), source = ctx?.eventSource;
        if (!source?.on || !source?.removeListener) return;
        for (const name of EVENTS) {
            const type = ctx.eventTypes?.[name]; if (!type) continue;
            // Never inspect event payload: it may include prompts, names or credentials.
            const listener = () => record(name.toLowerCase());
            source.on(type, listener); detach.push(() => source.removeListener(type, listener));
        }
    }
    subscribeHost(); subscribeBrowser();
    const notice = '仅启用后的本页有界记录，不是完整酒馆／Console／服务器CMD日志。事件目标是观察时当前聊天，不证明请求起源；生成结束不证明成功。未采集正文、堆栈、URL、密钥或响应体；网络／鉴权分类不证明具体根因。';
    function snapshot() {
        prune(); const target = targetKey();
        return { config: { ...config }, capacity: CAPACITY, retentionMinutes: AGE_MS / 60000, dropped,
            records: rows.filter(row => row.target === target || row.target === 'null').map(({ target: owner, ...row }) => ({ ...row, scope: owner === 'null' ? 'page-unattributed' : 'observed-current-chat' })), notice };
    }
    return Object.freeze({
        snapshot,
        async save(value) {
            if (closed || saving) throw Error('NOT_READY'); saving = true;
            try { const next = await configStore.save(value); if (closed) throw Error('NOT_READY'); config = next;
                if (!config.enabled) { rows = []; dropped = 0; epoch++; } subscribeBrowser(); return snapshot();
            } finally { saving = false; }
        },
        clear() { rows = []; dropped = 0; epoch++; },
        captureTarget: targetKey,
        recordModelFailure(value, target) { record('muyu_model_failed', { code: value?.error, stage: value?.diagnosticStage, attempt: value?.attemptId, target }); },
        recordHostFailure(error, signal, target) {
            // Only status numbers and our closed error codes, never message/cause/body.
            let status, code = 'HOST_MODEL_REQUEST_FAILED';
            try { status = error?.status; if (CODES.has(error?.code)) code = error.code; } catch { /* Unknown metadata. */ }
            if (signal?.aborted) code = signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED';
            else if (Number.isInteger(status) && status >= 400 && status <= 599) code = status === 401 || status === 403 ? 'MODEL_AUTH_ERROR' : status === 429 ? 'MODEL_RATE_LIMIT' : status >= 500 ? 'MODEL_SERVICE_ERROR' : 'MODEL_HTTP_ERROR';
            record('host_model_failed', { code, target });
        },
        read(selector) {
            if (closed || !config.enabled) throw Error('SOURCE_DISABLED');
            const state = snapshot();
            let data;
            if (!selector) data = { ...state, records: state.records.map(({ id, time, kind, scope }) => ({ id, time, kind, scope })), selectors: 'event:ID; range:START:COUNT (1-20)' };
            else if (/^event:[1-9]\d{0,14}$/.test(selector)) {
                const row = state.records.find(r => r.id === Number(selector.slice(6))); if (!row) throw Error('INVALID_SELECTOR'); data = { record: row, notice };
            } else {
                const match = /^range:(0|[1-9]\d{0,2}):([1-9]|1\d|20)$/.exec(selector);
                if (!match || Number(match[1]) >= state.records.length) throw Error('INVALID_SELECTOR');
                const start = Number(match[1]), count = Number(match[2]); data = { records: state.records.slice(start, start + count), notice };
            }
            return { text: JSON.stringify(data), limited: false, identity: { epoch, state } };
        },
        dispose() { if (closed) return; closed = true; for (const off of [...detach, ...browserDetach]) off(); detach = []; browserDetach = []; rows = []; epoch++; },
    });
}
