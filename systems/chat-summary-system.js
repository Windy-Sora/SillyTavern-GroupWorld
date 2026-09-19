import {
    assertExecutionSnapshot,
    captureExecutionSnapshot,
    snapshotValue,
    staleExecutionError,
} from './execution-snapshot.js';

export function createChatSummarySystem({ settings, getChatMetadata, getChat, EXT_KEY, saveChatConditional, renderPrompt, generateRaw, inject_ids, extension_prompt_types, setExtensionPrompt, log, createCaller }) {
    const cm = () => getChatMetadata();
    let summarizing = false;
    let mutationQueue = Promise.resolve();

    function getCaller() {
        const agentConfig = settings.agentConfigs?.['summary'] || {};
        const stGenerateRaw = (opts) => generateRaw(opts);
        return createCaller(agentConfig, stGenerateRaw);
    }

    const DEFAULT_PROMPT = {
        zh: '请用简洁的语言总结以下内容，保留关键情节、角色互动和重要细节。输出纯文本，不超过500字。',
        en: 'Summarize the following content concisely. Keep key plot points, character interactions, and important details. Output plain text, maximum 300 words.',
    };

    function getLiveSummaries(metadata = cm()) {
        const meta = metadata;
        if (!meta[EXT_KEY]) meta[EXT_KEY] = {};
        if (!Array.isArray(meta[EXT_KEY].summaries)) meta[EXT_KEY].summaries = [];
        return meta[EXT_KEY].summaries;
    }

    function getSummaries(metadata = cm()) {
        return structuredClone(getLiveSummaries(metadata));
    }

    function findLatestActive(metadata = cm()) {
        const summaries = getLiveSummaries(metadata);
        for (let i = summaries.length - 1; i >= 0; i--) {
            if (summaries[i].active) return summaries[i];
        }
        return null;
    }

    function getLatestActive(metadata = cm()) {
        const active = findLatestActive(metadata);
        return active ? structuredClone(active) : null;
    }

    function enqueueMutation(metadata, work) {
        const run = async () => {
            if (cm() !== metadata) throw staleExecutionError('Summary mutation became stale');
            return await work();
        };
        const task = mutationQueue.then(run, run);
        mutationQueue = task.catch(() => {});
        return task;
    }

    async function persistMutation(metadata, rollback) {
        try { await saveChatConditional(); }
        catch (error) {
            // A failed verification read cannot tell whether the host write
            // succeeded. Preserve memory rather than compensating a possibly
            // persisted mutation with an unverified rollback.
            if (error.persistenceUnknown) throw error;
            if (rollback?.()) error.rollbackIncomplete = true;
            throw error;
        }
        if (cm() !== metadata) throw staleExecutionError('Summary mutation became stale');
    }

    function restoreRemovedEntries(list, original, removed) {
        for (const entry of removed) {
            if (list.includes(entry)) continue;
            const originalIndex = original.indexOf(entry);
            let insertAt = Math.min(originalIndex, list.length);
            let anchored = false;
            for (let i = originalIndex + 1; i < original.length; i++) {
                const nextIndex = list.indexOf(original[i]);
                if (nextIndex >= 0) { insertAt = nextIndex; anchored = true; break; }
            }
            if (!anchored) {
                for (let i = originalIndex - 1; i >= 0; i--) {
                    const previousIndex = list.indexOf(original[i]);
                    if (previousIndex >= 0) { insertAt = previousIndex + 1; break; }
                }
            }
            list.splice(insertAt, 0, entry);
        }
    }

    function getActiveSummaryText() {
        if (summarizing || !settings.summaryEnabled) return '';
        const active = findLatestActive();
        return active ? active.content : '';
    }

    async function generateSummary() {
        if (summarizing) throw new Error('Summary already in progress');
        const executionSnapshot = captureExecutionSnapshot({
            getChatMetadata,
            getChat,
            getResource: (metadata, chat) => ({
                summaries: getLiveSummaries(metadata),
                chat: chat.map(message => [message.name, message.mes, message.is_user, message.is_system]),
            }),
        });
        const { metadata, chat } = executionSnapshot;
        if (!chat.length) throw new Error('No messages to summarize');

        const summaries = getLiveSummaries(metadata);
        const reusePrev = settings.summaryReusePrevious;
        const prevSummary = findLatestActive(metadata);
        const rangeEnd = chat.length;

        let inputText = '';
        let startFrom = 0;

        if (reusePrev && prevSummary && prevSummary.rangeEnd <= chat.length) {
            // Previous summary + new messages since last range end
            startFrom = prevSummary.rangeEnd;
            const newMessages = chat.slice(startFrom);
            if (!newMessages.length) throw new Error('No new messages since last summary');
            inputText = `[Previous summary]\n${prevSummary.content}\n\n[New content]\n` +
                newMessages.map(m => `${m.name || (m.is_user ? 'User' : 'System')}: ${m.mes}`).join('\n');
        } else {
            // Full chat
            inputText = chat.map(m => `${m.name || (m.is_user ? 'User' : 'System')}: ${m.mes}`).join('\n');
        }

        const promptUsed = settings.summaryPrompt || (settings.lang === 'zh' ? DEFAULT_PROMPT.zh : DEFAULT_PROMPT.en);
        const prompt = promptUsed + '\n\n' + inputText;

        summarizing = true;
        try {
            setExtensionPrompt(inject_ids.QUIET_PROMPT, '', extension_prompt_types.IN_PROMPT, 0, true);
            const response = await getCaller().generate(prompt);
            setExtensionPrompt(inject_ids.QUIET_PROMPT, '', extension_prompt_types.IN_PROMPT, 0, true);
            assertExecutionSnapshot(executionSnapshot, {
                getChatMetadata,
                getChat,
                getResource: (currentMetadata, currentChat) => ({
                    summaries: getLiveSummaries(currentMetadata),
                    chat: currentChat.map(message => [message.name, message.mes, message.is_user, message.is_system]),
                }),
                message: 'Summary generation became stale',
            });
            const expectedSummaries = snapshotValue(summaries);

            const entry = {
                rangeEnd,
                content: response || '',
                active: true,
                basedOn: reusePrev && prevSummary ? summaries.indexOf(prevSummary) : null,
                promptUsed,
                timestamp: Date.now(),
            };

            return await enqueueMutation(metadata, async () => {
                if (snapshotValue(summaries) !== expectedSummaries) {
                    throw staleExecutionError('Summary generation became stale');
                }
                const activeChanges = summaries.filter(summary => summary.active).map(summary => ({ summary, previous: true }));
                for (const change of activeChanges) change.summary.active = false;
                summaries.push(entry);
                const appliedEntryState = snapshotValue(entry);
                await persistMutation(metadata, () => {
                    let incomplete = false;
                    const index = summaries.indexOf(entry);
                    if (index >= 0) {
                        if (snapshotValue(summaries[index]) === appliedEntryState) summaries.splice(index, 1);
                        else incomplete = true;
                    }
                    for (const change of activeChanges) {
                        if (change.summary.active === false) change.summary.active = change.previous;
                        else if (change.summary.active !== change.previous) incomplete = true;
                    }
                    return incomplete;
                });
                return entry;
            });
        } finally {
            summarizing = false;
        }
    }

    async function regenerateLastSummary() {
        if (summarizing) throw new Error('Summary already in progress');
        const executionSnapshot = captureExecutionSnapshot({
            getChatMetadata,
            getChat,
            getResource: (metadata, chat) => ({
                summaries: getLiveSummaries(metadata),
                chat: chat.map(message => [message.name, message.mes, message.is_user, message.is_system]),
            }),
        });
        const { metadata, chat } = executionSnapshot;
        const summaries = getLiveSummaries(metadata);

        const last = findLatestActive(metadata);
        if (!last) throw new Error('No active summary to regenerate');

        let inputText = '';
        if (last.basedOn !== null && last.basedOn >= 0 && summaries[last.basedOn]) {
            const prev = summaries[last.basedOn];
            const newMessages = chat.slice(prev.rangeEnd, last.rangeEnd);
            inputText = `[Previous summary]\n${prev.content}\n\n[New content]\n` +
                newMessages.map(m => `${m.name || (m.is_user ? 'User' : 'System')}: ${m.mes}`).join('\n');
        } else {
            inputText = chat.slice(0, last.rangeEnd)
                .map(m => `${m.name || (m.is_user ? 'User' : 'System')}: ${m.mes}`).join('\n');
        }

        const promptUsed = last.promptUsed || settings.summaryPrompt || (settings.lang === 'zh' ? DEFAULT_PROMPT.zh : DEFAULT_PROMPT.en);
        const prompt = promptUsed + '\n\n' + inputText;

        summarizing = true;
        try {
            setExtensionPrompt(inject_ids.QUIET_PROMPT, '', extension_prompt_types.IN_PROMPT, 0, true);
            const response = await getCaller().generate(prompt);
            setExtensionPrompt(inject_ids.QUIET_PROMPT, '', extension_prompt_types.IN_PROMPT, 0, true);
            assertExecutionSnapshot(executionSnapshot, {
                getChatMetadata,
                getChat,
                getResource: (currentMetadata, currentChat) => ({
                    summaries: getLiveSummaries(currentMetadata),
                    chat: currentChat.map(message => [message.name, message.mes, message.is_user, message.is_system]),
                }),
                message: 'Summary regeneration became stale',
            });

            return await enqueueMutation(metadata, async () => {
                if (!summaries.includes(last)) throw staleExecutionError('Summary regeneration became stale');
                const previous = { content: last.content, promptUsed: last.promptUsed, timestamp: last.timestamp };
                const applied = { content: response || '', promptUsed, timestamp: Date.now() };
                Object.assign(last, applied);
                await persistMutation(metadata, () => {
                    let incomplete = false;
                    for (const key of Object.keys(applied)) {
                        if (Object.is(last[key], applied[key])) last[key] = previous[key];
                        else incomplete = true;
                    }
                    return incomplete;
                });
                return last;
            });
        } finally {
            summarizing = false;
        }
    }

    async function revertLastSummary() {
        const metadata = cm();
        return enqueueMutation(metadata, async () => {
            const summaries = getLiveSummaries(metadata);
            const foundIndex = summaries.findLastIndex(summary => summary.active);
            if (foundIndex < 0) return false;
            const target = summaries[foundIndex];
            const previous = target.basedOn !== null && target.basedOn >= 0 && target.basedOn < foundIndex
                ? summaries[target.basedOn] : null;
            const changes = [{ summary: target, before: target.active, applied: false }];
            target.active = false;
            if (previous) {
                changes.push({ summary: previous, before: previous.active, applied: true });
                previous.active = true;
            }
            await persistMutation(metadata, () => {
                let incomplete = false;
                for (const change of changes) {
                    if (change.summary.active === change.applied) change.summary.active = change.before;
                    else if (change.summary.active !== change.before) incomplete = true;
                }
                return incomplete;
            });
            return true;
        });
    }

    async function resetAll() {
        const metadata = cm();
        return enqueueMutation(metadata, async () => {
            const summaries = getLiveSummaries(metadata);
            const changes = summaries.filter(summary => summary.active).map(summary => ({ summary, before: true, applied: false }));
            if (!changes.length) return false;
            for (const change of changes) change.summary.active = false;
            await persistMutation(metadata, () => {
                let incomplete = false;
                for (const change of changes) {
                    if (change.summary.active === change.applied) change.summary.active = change.before;
                    else if (change.summary.active !== change.before) incomplete = true;
                }
                return incomplete;
            });
            return true;
        });
    }

    async function updateSummaryContents(updates = []) {
        const metadata = cm();
        if (!Array.isArray(updates)) throw new TypeError('Summary updates must be an array');
        const captured = getLiveSummaries(metadata);
        const requested = [];
        const seen = new Set();
        for (const update of updates) {
            const index = Number(update?.index);
            if (!Number.isInteger(index) || index < 0 || index >= captured.length || typeof update.content !== 'string') continue;
            const summary = captured[index];
            if (seen.has(summary)) continue;
            seen.add(summary);
            requested.push({ summary, applied: update.content });
        }
        return enqueueMutation(metadata, async () => {
            const summaries = getLiveSummaries(metadata);
            if (requested.some(change => !summaries.includes(change.summary))) {
                throw staleExecutionError('Summary update target became stale');
            }
            const changes = requested.map(change => ({ ...change, before: change.summary.content }));
            if (!changes.length) return 0;
            for (const change of changes) change.summary.content = change.applied;
            await persistMutation(metadata, () => {
                let incomplete = false;
                for (const change of changes) {
                    if (change.summary.content === change.applied) change.summary.content = change.before;
                    else if (change.summary.content !== change.before) incomplete = true;
                }
                return incomplete;
            });
            return changes.length;
        });
    }

    async function pruneDisabledSummaries() {
        const metadata = cm();
        return enqueueMutation(metadata, async () => {
            const summaries = getLiveSummaries(metadata);
            const original = [...summaries];
            const removed = summaries.filter(summary => !summary.active);
            if (!removed.length) return 0;
            summaries.splice(0, summaries.length, ...summaries.filter(summary => summary.active));
            await persistMutation(metadata, () => {
                restoreRemovedEntries(summaries, original, removed);
                return false;
            });
            return removed.length;
        });
    }

    async function clearSummaries() {
        const metadata = cm();
        return enqueueMutation(metadata, async () => {
            const summaries = getLiveSummaries(metadata);
            if (!summaries.length) return 0;
            const original = [...summaries];
            summaries.length = 0;
            await persistMutation(metadata, () => {
                restoreRemovedEntries(summaries, original, original);
                return false;
            });
            return original.length;
        });
    }

    // Auto-prune on message deletion
    async function pruneSummaries() {
        const metadata = cm();
        return enqueueMutation(metadata, async () => {
            const chatLength = getChat().length;
            const summaries = getLiveSummaries(metadata);
            const changes = new Map();
            const setActive = (summary, active) => {
                if (!changes.has(summary)) changes.set(summary, { summary, before: summary.active, applied: active });
                else changes.get(summary).applied = active;
                summary.active = active;
            };
            for (const summary of summaries) {
                if (summary.active && summary.rangeEnd > chatLength) {
                    setActive(summary, false);
                    if (summary.basedOn !== null && summary.basedOn >= 0 && summaries[summary.basedOn]) {
                        setActive(summaries[summary.basedOn], true);
                    }
                }
            }
            if (!changes.size) return false;
            await persistMutation(metadata, () => {
                let incomplete = false;
                for (const change of changes.values()) {
                    if (change.summary.active === change.applied) change.summary.active = change.before;
                    else if (change.summary.active !== change.before) incomplete = true;
                }
                return incomplete;
            });
            return true;
        });
    }

    return {
        getActiveSummaryText,
        getLatestActive,
        getSummaries,
        generateSummary,
        regenerateLastSummary,
        revertLastSummary,
        resetAll,
        updateSummaryContents,
        pruneDisabledSummaries,
        clearSummaries,
        pruneSummaries,
    };
}
