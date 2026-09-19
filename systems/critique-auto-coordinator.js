function toInterval(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(1, Math.trunc(number)) : 10;
}

export function planCritiqueAutoRun({ currentLength, counter, hasCounter, latestRangeEnd, legacyLength, interval }) {
    const current = Math.max(0, Number(currentLength) || 0);
    const covered = hasCounter ? Math.max(0, Number(counter) || 0) : Math.max(0, Number(latestRangeEnd) || 0);
    const threshold = toInterval(interval);
    if (current < covered) return { type: 'reset', currentLength: current, covered, newMessages: 0 };
    const firstEnable = !hasCounter && legacyLength === undefined && covered === 0;
    const newMessages = current - covered;
    if (firstEnable && current < threshold) {
        return { type: 'checkpoint', currentLength: current, covered, newMessages };
    }
    if (newMessages >= threshold) {
        return { type: 'execute', currentLength: current, covered, newMessages, firstEnable };
    }
    return { type: 'none', currentLength: current, covered, newMessages };
}

export function createCritiqueAutoCoordinator({
    getChatMetadata,
    getChat,
    getLatestActive,
    generateCritique,
    saveChatConditional,
    EXT_KEY,
}) {
    const counterKey = '_autoCritiqueLen';
    const counterRevisions = new WeakMap();

    function assertCurrentContext(metadata, chat) {
        if (getChatMetadata() === metadata && getChat() === chat) return;
        const error = new Error('Auto critique became stale after the chat changed');
        error.name = 'StaleExecutionError';
        throw error;
    }

    async function persistCounter(metadata, value) {
        const root = metadata[EXT_KEY] || (metadata[EXT_KEY] = {});
        const hadPrevious = Object.prototype.hasOwnProperty.call(root, counterKey);
        const previous = root[counterKey];
        const revision = (counterRevisions.get(root) || 0) + 1;
        counterRevisions.set(root, revision);
        root[counterKey] = value;
        try { await saveChatConditional(); }
        catch (error) {
            if (counterRevisions.get(root) === revision && Object.is(root[counterKey], value)) {
                if (hadPrevious) root[counterKey] = previous;
                else delete root[counterKey];
                counterRevisions.set(root, revision + 1);
            }
            throw error;
        }
    }

    async function run({ interval, legacyLength, beforeExecute } = {}) {
        const metadata = getChatMetadata();
        const chat = getChat();
        const root = metadata[EXT_KEY] || (metadata[EXT_KEY] = {});
        const action = planCritiqueAutoRun({
            currentLength: chat.length,
            counter: root[counterKey],
            hasCounter: Object.prototype.hasOwnProperty.call(root, counterKey),
            latestRangeEnd: getLatestActive()?.rangeEnd ?? 0,
            legacyLength,
            interval,
        });
        if (action.type === 'none') return action;
        if (action.type === 'execute') {
            await beforeExecute?.(action);
            assertCurrentContext(metadata, chat);
            await generateCritique();
            assertCurrentContext(metadata, chat);
        }
        assertCurrentContext(metadata, chat);
        await persistCounter(metadata, action.currentLength);
        assertCurrentContext(metadata, chat);
        return action;
    }

    return { run };
}
