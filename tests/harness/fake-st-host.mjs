import { FakeEventSource } from './fake-event-source.mjs';

export const TEST_EVENT_TYPES = Object.freeze({
    GENERATION_STOPPED: 'generation_stopped',
    GROUP_WRAPPER_STARTED: 'group_wrapper_started',
    GROUP_WRAPPER_FINISHED: 'group_wrapper_finished',
    CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
    MESSAGE_DELETED: 'message_deleted',
    CHAT_CHANGED: 'chat_id_changed',
});

function abortError(message) {
    return new DOMException(message, 'AbortError');
}

export class FakeSillyTavernHost {
    constructor({
        requestScopedAbort = false,
        chat = [],
        characters = [],
        groups = [],
        metadata = {},
    } = {}) {
        this.event_types = TEST_EVENT_TYPES;
        this.eventSource = new FakeEventSource();
        this.requestScopedAbort = requestScopedAbort;
        this.chat = chat;
        this.characters = characters;
        this.groups = groups;
        this.chat_metadata = metadata;
        this.requests = [];
        this.stopCalls = 0;
        this.saveCalls = 0;
        this.#plans = [];
        this.#active = new Map();
        this.#nextRequestId = 1;
    }

    #plans;
    #active;
    #nextRequestId;

    queueResponse(plan) {
        this.#plans.push(typeof plan === 'object' ? { ...plan } : { type: 'resolve', value: plan });
        return this;
    }

    get activeRequestCount() {
        return this.#active.size;
    }

    isActive(requestOrId) {
        const id = typeof requestOrId === 'object' ? requestOrId.id : requestOrId;
        return this.#active.has(id);
    }

    generateRaw({ prompt = '', signal } = {}) {
        const id = this.#nextRequestId++;
        const plan = this.#plans.shift() || { type: 'resolve', value: 'ok', delayMs: 0 };
        const record = {
            id,
            prompt,
            status: 'active',
            startedAt: Date.now(),
            settledAt: null,
            reason: null,
        };
        this.requests.push(record);
        this.#active.set(id, record);

        let timer = null;
        let onSignalAbort = null;
        let resolveRequest;
        let rejectRequest;
        const cleanup = () => {
            if (timer) clearTimeout(timer);
            this.eventSource.removeListener(TEST_EVENT_TYPES.GENERATION_STOPPED, onGlobalStop);
            if (onSignalAbort) signal?.removeEventListener('abort', onSignalAbort);
            this.#active.delete(id);
            record.settledAt = Date.now();
        };
        const settle = (status, reason, callback) => {
            if (record.status !== 'active') return;
            record.status = status;
            record.reason = reason || null;
            cleanup();
            callback();
        };
        const onGlobalStop = () => {
            settle('aborted', 'global-stop', () => rejectRequest(abortError('Cancelled by stop event')));
        };

        const promise = new Promise((resolve, reject) => {
            resolveRequest = resolve;
            rejectRequest = reject;
        });
        record.promise = promise;
        this.eventSource.on(TEST_EVENT_TYPES.GENERATION_STOPPED, onGlobalStop);

        if (this.requestScopedAbort && signal) {
            onSignalAbort = () => {
                settle('aborted', 'request-signal', () => rejectRequest(abortError('Cancelled by request signal')));
            };
            signal.addEventListener('abort', onSignalAbort, { once: true });
            if (signal.aborted) onSignalAbort();
        }

        const delay = Math.max(0, plan.delayMs || 0);
        if (plan.type === 'resolve') {
            timer = setTimeout(() => {
                settle('resolved', null, () => resolveRequest(plan.value ?? 'ok'));
            }, delay);
        } else if (plan.type === 'reject') {
            timer = setTimeout(() => {
                const error = plan.error || new Error(plan.message || 'Fake request failed');
                settle('rejected', error.message, () => rejectRequest(error));
            }, delay);
        } else if (plan.type !== 'pending') {
            timer = setTimeout(() => {
                const error = new Error(`Unknown fake response type: ${plan.type}`);
                settle('rejected', error.message, () => rejectRequest(error));
            }, delay);
        }

        return promise;
    }

    stopGeneration() {
        this.stopCalls++;
        const stopped = this.#active.size > 0;
        // Match SillyTavern: fire the async event without awaiting it.
        void this.eventSource.emit(TEST_EVENT_TYPES.GENERATION_STOPPED);
        return stopped;
    }

    async saveChatConditional() {
        this.saveCalls++;
    }

    getContext() {
        return {
            chat: this.chat,
            characters: this.characters,
            groups: this.groups,
            chat_metadata: this.chat_metadata,
            eventSource: this.eventSource,
            event_types: this.event_types,
            generateRaw: options => this.generateRaw(options),
            stopGeneration: () => this.stopGeneration(),
            saveChatConditional: () => this.saveChatConditional(),
        };
    }

    async emit(event, ...args) {
        await this.eventSource.emit(event, ...args);
    }

    async waitFor(predicate, { timeoutMs = 1000, intervalMs = 2 } = {}) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() <= deadline) {
            const result = predicate(this);
            if (result) return result;
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
        throw new Error(`Condition was not met within ${timeoutMs}ms`);
    }

    dispose() {
        this.eventSource.clear();
        this.#active.clear();
    }
}
