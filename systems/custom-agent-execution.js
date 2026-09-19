import { normalizeCustomAgent } from './custom-agent-validation.js';

export function extractCustomAgentJson(text) {
    if (typeof text !== 'string') return null;
    const firstBrace = text.indexOf('{');
    if (firstBrace === -1) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let index = firstBrace; index < text.length; index++) {
        const char = text[index];
        if (escape) { escape = false; continue; }
        if (char === '\\') { escape = true; continue; }
        if (char === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (char === '{') depth++;
        else if (char === '}') {
            depth--;
            if (depth === 0) {
                let raw = text.slice(firstBrace, index + 1);
                raw = raw.replace(/,(\s*[}\]])/g, '$1');
                raw = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ');
                try { return JSON.parse(raw); } catch (_) { return null; }
            }
        }
    }
    return null;
}

function staleExecutionError() {
    const error = new Error('CustomAgent: execution became stale');
    error.name = 'StaleExecutionError';
    return error;
}

export function createCustomAgentExecution({
    getList,
    getStore,
    getChatMetadata,
    getChat,
    getRevision,
    getResultRevision,
    setResultRevision,
    getCounterRevision,
    setCounterRevision,
    renderPrompt,
    generate,
    saveChatConditional,
    EXT_KEY,
    log,
}) {
    const states = new Map();
    const inFlight = new Map();
    let queueTail = Promise.resolve();
    let epoch = 0;

    const isStale = (startEpoch, metadata, chat) => (
        startEpoch !== epoch || getChatMetadata() !== metadata || getChat() !== chat
    );

    async function run(instance, options, context) {
        states.set(instance.id, 'running');
        const { metadata, chat, startEpoch, revision, resultRevision } = context;
        const rangeEnd = chat.length;
        if (isStale(startEpoch, metadata, chat)) throw staleExecutionError();
        if (getRevision(instance.id) !== revision) throw staleExecutionError();
        const rawPrompt = instance.prompt + (instance.schema
            ? '\n\nOutput format must strictly follow this JSON schema:\n' + instance.schema
            : '');
        let prompt = rawPrompt;
        try { prompt = await renderPrompt(rawPrompt); }
        catch (_) { log?.(`[CustomAgent] "${instance.name}" prompt render failed, using raw`); }
        if (isStale(startEpoch, metadata, chat)) throw staleExecutionError();

        const response = await generate(prompt);
        if (!response) return null;
        if (isStale(startEpoch, metadata, chat)) throw staleExecutionError();
        const live = getList().find(agent => agent.id === instance.id);
        if (!live || getRevision(instance.id) !== revision) throw staleExecutionError();
        if (getResultRevision(metadata, instance.id) !== resultRevision) throw staleExecutionError();

        const result = {
            rangeEnd,
            content: response,
            data: (instance.schema ? extractCustomAgentJson(response) : null) ?? response,
            timestamp: Date.now(),
        };
        const store = getStore(metadata);
        const hadPrevious = Object.prototype.hasOwnProperty.call(store, instance.id);
        const previous = store[instance.id];
        const root = metadata[EXT_KEY];
        const hasCounter = typeof options.counterKey === 'string';
        const committedCounterKey = options.counterKey;
        const committedCounterValue = options.counterValue;
        const hadCounter = hasCounter && Object.prototype.hasOwnProperty.call(root, options.counterKey);
        const previousCounter = hasCounter ? root[options.counterKey] : undefined;
        const previousCounterRevision = hasCounter ? getCounterRevision(metadata, committedCounterKey) : 0;
        const committedCounterRevision = previousCounterRevision + 1;
        const committedResultRevision = resultRevision + 1;
        setResultRevision(metadata, instance.id, committedResultRevision);
        context.resultRevision = committedResultRevision;
        store[instance.id] = result;
        if (hasCounter) {
            setCounterRevision(metadata, committedCounterKey, committedCounterRevision);
            root[committedCounterKey] = committedCounterValue;
        }
        try {
            await saveChatConditional();
        } catch (error) {
            if (getResultRevision(metadata, instance.id) === committedResultRevision) {
                if (hadPrevious) store[instance.id] = previous;
                else delete store[instance.id];
                setResultRevision(metadata, instance.id, resultRevision);
            }
            if (hasCounter && getCounterRevision(metadata, committedCounterKey) === committedCounterRevision) {
                if (hadCounter) root[committedCounterKey] = previousCounter;
                else delete root[committedCounterKey];
                setCounterRevision(metadata, committedCounterKey, previousCounterRevision);
            }
            throw error;
        }
        if (isStale(startEpoch, metadata, chat)
            || getRevision(instance.id) !== revision
            || getResultRevision(metadata, instance.id) !== committedResultRevision) {
            throw staleExecutionError();
        }
        // A manual request can be joined by an auto trigger while the first
        // persistence call is already in progress. Preserve deduplication, then
        // checkpoint in a follow-up transaction instead of losing the trigger.
        if (typeof options.counterKey === 'string' && (
            !hasCounter
            || options.counterKey !== committedCounterKey
            || options.counterValue !== committedCounterValue
        )) {
            const lateCounterKey = options.counterKey;
            const lateCounterValue = options.counterValue;
            const lateHadCounter = Object.prototype.hasOwnProperty.call(root, lateCounterKey);
            const latePrevious = root[lateCounterKey];
            const latePreviousRevision = getCounterRevision(metadata, lateCounterKey);
            const lateCommittedRevision = latePreviousRevision + 1;
            setCounterRevision(metadata, lateCounterKey, lateCommittedRevision);
            root[lateCounterKey] = lateCounterValue;
            try { await saveChatConditional(); }
            catch (error) {
                if (getCounterRevision(metadata, lateCounterKey) === lateCommittedRevision) {
                    if (lateHadCounter) root[lateCounterKey] = latePrevious;
                    else delete root[lateCounterKey];
                    setCounterRevision(metadata, lateCounterKey, latePreviousRevision);
                }
                throw error;
            }
        }
        if (isStale(startEpoch, metadata, chat)
            || getRevision(instance.id) !== revision
            || getResultRevision(metadata, instance.id) !== committedResultRevision) {
            throw staleExecutionError();
        }
        log?.(`[CustomAgent] "${instance.name}" executed, rangeEnd=${rangeEnd}`);
        return result;
    }

    function execute(instance, options = {}) {
        if (!instance?.id) return Promise.resolve(null);
        const live = getList().find(agent => agent.id === instance.id);
        if (!live) return Promise.reject(staleExecutionError());
        if (!live.prompt) return Promise.resolve(null);
        const metadata = getChatMetadata();
        const context = {
            metadata,
            chat: getChat(),
            startEpoch: epoch,
            revision: getRevision(live.id),
            resultRevision: getResultRevision(metadata, live.id),
        };
        if (inFlight.has(live.id)) {
            const current = inFlight.get(live.id);
            const sameContext = current.context.startEpoch === context.startEpoch
                && current.context.metadata === context.metadata
                && current.context.chat === context.chat
                && current.context.revision === context.revision
                && current.context.resultRevision === context.resultRevision;
            if (sameContext && typeof options.counterKey === 'string') {
                current.options.counterKey = options.counterKey;
                current.options.counterValue = options.counterValue;
            }
            if (sameContext) return current.task;
        }
        const snapshot = normalizeCustomAgent(live, { path: 'agent', id: live.id });
        states.set(snapshot.id, 'queued');
        const mergedOptions = { ...options };
        const task = queueTail.catch(() => {}).then(() => run(snapshot, mergedOptions, context));
        queueTail = task.catch(() => {});
        inFlight.set(snapshot.id, { task, options: mergedOptions, context });
        task.finally(() => {
            if (inFlight.get(snapshot.id)?.task === task) {
                inFlight.delete(snapshot.id);
                states.delete(snapshot.id);
            }
        }).catch(() => {});
        return task;
    }

    function executeAuto(instance, currentLength) {
        return execute(instance, {
            counterKey: `_autoCAG_${instance.id}`,
            counterValue: currentLength,
        });
    }

    async function executeAll(instances) {
        const sorted = [...instances]
            .filter(instance => instance.enabled && instance.id && instance.prompt)
            .sort((a, b) => (a.order || 0) - (b.order || 0));
        const results = [];
        for (const instance of sorted) {
            try {
                results.push({ id: instance.id, name: instance.name, success: true, data: await execute(instance) });
            } catch (error) {
                log?.(`[CustomAgent] "${instance.name}" failed: ${error.message}`);
                results.push({ id: instance.id, name: instance.name, success: false, error: error.message });
            }
        }
        return results;
    }

    return {
        execute,
        executeAuto,
        executeAll,
        extractJson: extractCustomAgentJson,
        getExecutionState: id => states.get(id) || 'idle',
        invalidateExecutions: () => { epoch++; },
    };
}
