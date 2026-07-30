/**
 * Minimal SillyTavern-compatible event source.
 *
 * emit() intentionally awaits listeners one by one. This detail matters:
 * SillyTavern's stopGeneration() starts an async emit without awaiting it.
 */
export class FakeEventSource {
    #events = new Map();

    on(event, listener) {
        const listeners = this.#events.get(event) || [];
        listeners.push(listener);
        this.#events.set(event, listeners);
        return listener;
    }

    once(event, listener) {
        const wrapper = (...args) => {
            this.removeListener(event, wrapper);
            return listener(...args);
        };
        return this.on(event, wrapper);
    }

    removeListener(event, listener) {
        const listeners = this.#events.get(event);
        if (!listeners) return;
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
        if (!listeners.length) this.#events.delete(event);
    }

    listenerCount(event) {
        return this.#events.get(event)?.length || 0;
    }

    async emit(event, ...args) {
        const listeners = [...(this.#events.get(event) || [])];
        for (const listener of listeners) {
            await listener(...args);
        }
    }

    clear() {
        this.#events.clear();
    }
}
