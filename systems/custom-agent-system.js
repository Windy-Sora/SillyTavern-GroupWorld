/** Custom Agent configuration, storage, and provider lifecycle. */
import {
    getProviders as getRegisteredProviders,
    registerProvider as registerGlobalProvider,
    unregisterProvider as unregisterGlobalProvider,
} from '../provider-registry.js';
import { createCustomAgentExecution } from './custom-agent-execution.js';
import {
    CUSTOM_AGENT_EXPORT_VERSION,
    generateCustomAgentId,
    normalizeCustomAgent,
    normalizeCustomAgentList,
    validateCustomAgentExport,
} from './custom-agent-validation.js';

const PROVIDER_OWNER = 'group-director/custom-agent';

export function createCustomAgentSystem({
    settings,
    getChatMetadata,
    getChat,
    EXT_KEY,
    saveChatConditional,
    saveSettings = () => {},
    renderPrompt,
    generateRaw,
    createCaller,
    registerProvider = registerGlobalProvider,
    unregisterProvider = unregisterGlobalProvider,
    getProviders = getRegisteredProviders,
    log,
}) {
    const revisions = new Map();
    const resultRevisions = new WeakMap();
    const counterRevisions = new WeakMap();
    let mutationQueue = Promise.resolve();
    let knownEntries = Array.isArray(settings.customAgents)
        ? structuredClone(settings.customAgents)
        : [];

    function getList() {
        if (settings.customAgents === undefined) settings.customAgents = [];
        if (!Array.isArray(settings.customAgents)) throw new Error('customAgents must be an array');
        return settings.customAgents;
    }

    function getStore(metadata = getChatMetadata()) {
        if (!metadata[EXT_KEY]) metadata[EXT_KEY] = {};
        if (!metadata[EXT_KEY]._caData) metadata[EXT_KEY]._caData = {};
        return metadata[EXT_KEY]._caData;
    }

    function getData(id) {
        return getStore()[id] || null;
    }

    function getResultRevision(metadata, id) {
        return resultRevisions.get(metadata)?.get(id) || 0;
    }

    function setResultRevision(metadata, id, revision) {
        let revisionsForMetadata = resultRevisions.get(metadata);
        if (!revisionsForMetadata) {
            revisionsForMetadata = new Map();
            resultRevisions.set(metadata, revisionsForMetadata);
        }
        revisionsForMetadata.set(id, revision);
    }

    function getCounterRevision(metadata, key) {
        return counterRevisions.get(metadata)?.get(key) || 0;
    }

    function setCounterRevision(metadata, key, revision) {
        let revisionsForMetadata = counterRevisions.get(metadata);
        if (!revisionsForMetadata) {
            revisionsForMetadata = new Map();
            counterRevisions.set(metadata, revisionsForMetadata);
        }
        revisionsForMetadata.set(key, revision);
    }

    function normalizeProviderEntries(list, { strict }) {
        const normalized = [];
        const names = new Set();
        for (let index = 0; index < list.length; index++) {
            let entry;
            try {
                entry = normalizeCustomAgent(list[index], {
                    path: `customAgents[${index}]`,
                    id: list[index]?.id,
                });
            } catch (error) {
                if (strict) throw error;
                log?.(`[CustomAgent] skipped invalid entry: ${error.message}`);
                continue;
            }
            if (names.has(entry.providerName)) {
                const error = new Error(`customAgents contains duplicate providerName "${entry.providerName}"`);
                if (strict) throw error;
                log?.(`[CustomAgent] ${error.message}`);
                continue;
            }
            names.add(entry.providerName);
            normalized.push(entry);
        }
        return normalized;
    }

    function assertProviderAvailability(entries) {
        const registered = getProviders();
        for (const entry of entries) {
            if (!entry.enabled) continue;
            const conflict = registered.find(provider => provider.id === entry.providerName);
            if (conflict && conflict._gdOwner !== PROVIDER_OWNER) {
                throw new Error(`Provider "${entry.providerName}" is already registered`);
            }
        }
    }

    function syncProviders(list = getList(), { strict = false } = {}) {
        const entries = normalizeProviderEntries(list, { strict });
        assertProviderAvailability(entries);
        for (const provider of getProviders()) {
            if (provider._gdOwner === PROVIDER_OWNER) unregisterProvider(provider.id);
        }
        for (const entry of entries) {
            if (!entry.enabled) continue;
            const capturedId = entry.id;
            registerProvider({
                id: entry.providerName,
                placeholder: `{{${entry.providerName}}}`,
                _gdOwner: PROVIDER_OWNER,
                _gdOwnerId: capturedId,
                render: () => {
                    const live = getList().find(agent => agent.id === capturedId);
                    const stored = live?.enabled ? getStore()[capturedId] : null;
                    if (!stored) return { content: '', data: null };
                    return {
                        content: typeof stored.data === 'object'
                            ? JSON.stringify(stored.data, null, 2)
                            : String(stored.data),
                        data: stored.data,
                    };
                },
            });
        }
        log?.(`[CustomAgent] refreshProviders: ${entries.filter(entry => entry.enabled).length} providers registered`);
        return new Set(entries.filter(entry => entry.enabled).map(entry => entry.providerName));
    }

    function assertManagedIds(entries) {
        for (const [index, entry] of entries.entries()) {
            if (typeof entry.id !== 'string' || !entry.id) {
                throw new Error(`customAgents[${index}].id must be a non-empty string`);
            }
        }
    }

    function validateList(candidate) {
        const normalized = normalizeCustomAgentList(candidate, { path: 'customAgents' });
        assertManagedIds(normalized);
        assertProviderAvailability(normalized);
        return normalized;
    }

    function suggestProviderName(base = 'custom_agent') {
        const used = new Set([
            ...getList().map(agent => agent.providerName),
            ...getProviders().map(provider => provider.id),
        ]);
        let candidate = base;
        let suffix = 2;
        while (used.has(candidate)) candidate = `${base}${suffix++}`;
        return candidate;
    }

    function recordChangedRevisions(next) {
        const before = new Map(knownEntries.map(entry => [entry.id, JSON.stringify(entry)]));
        const after = new Map(next.map(entry => [entry.id, JSON.stringify(entry)]));
        for (const id of new Set([...before.keys(), ...after.keys()])) {
            if (before.get(id) !== after.get(id)) revisions.set(id, (revisions.get(id) || 0) + 1);
        }
        knownEntries = structuredClone(next);
    }

    function enqueueMutation(work) {
        const task = mutationQueue.then(work, work);
        mutationQueue = task.catch(() => {});
        return task;
    }

    function rollbackList(previous, applied) {
        const current = getList();
        const before = new Map(previous.map(entry => [entry.id, entry]));
        const after = new Map(applied.map(entry => [entry.id, entry]));
        const restored = [];
        for (const entry of current) {
            const old = before.get(entry.id);
            const attempted = after.get(entry.id);
            if (!old && attempted && JSON.stringify(entry) === JSON.stringify(attempted)) continue;
            if (old && attempted) {
                for (const key of Object.keys(attempted)) {
                    if (JSON.stringify(old[key]) !== JSON.stringify(attempted[key])
                        && JSON.stringify(entry[key]) === JSON.stringify(attempted[key])) {
                        entry[key] = old[key];
                    }
                }
            }
            restored.push(entry);
        }
        for (const [index, old] of previous.entries()) {
            if (!after.has(old.id) && !restored.some(entry => entry.id === old.id)) {
                restored.splice(Math.min(index, restored.length), 0, old);
            }
        }
        settings.customAgents = restored;
        return restored;
    }

    async function commitList(candidate) {
        const normalized = validateList(candidate);
        const previous = structuredClone(getList());
        const applied = structuredClone(normalized);
        settings.customAgents = normalized;
        try {
            syncProviders(normalized, { strict: true });
            recordChangedRevisions(normalized);
            await saveSettings();
        } catch (error) {
            const restored = rollbackList(previous, applied);
            try { syncProviders(restored); } catch (_) { /* best-effort restoration */ }
            recordChangedRevisions(restored);
            throw error;
        }
        return normalized;
    }

    async function add(partial) {
        const entry = normalizeCustomAgent(partial, { path: 'agent', id: generateCustomAgentId() });
        await commitList([...getList(), entry]);
        return entry;
    }

    async function update(id, updates) {
        if (updates === null || typeof updates !== 'object' || Array.isArray(updates)) {
            throw new Error('updates must be an object');
        }
        const list = getList();
        const index = list.findIndex(entry => entry.id === id);
        if (index === -1) return undefined;
        const allowed = ['name', 'providerName', 'prompt', 'schema', 'enabled', 'autoEnabled', 'autoInterval', 'order'];
        const candidate = { ...list[index] };
        for (const key of allowed) {
            if (Object.prototype.hasOwnProperty.call(updates, key)) candidate[key] = updates[key];
        }
        const entry = normalizeCustomAgent(candidate, { path: 'agent', id });
        const next = [...list];
        next[index] = entry;
        await commitList(next);
        return entry;
    }

    async function toggle(id) {
        const entry = getList().find(agent => agent.id === id);
        if (!entry) return undefined;
        return await update(id, {
            enabled: !entry.enabled,
            autoEnabled: entry.enabled ? false : entry.autoEnabled,
        });
    }

    async function remove(id) {
        const list = getList();
        const entry = list.find(agent => agent.id === id);
        if (!entry) return undefined;
        await commitList(list.filter(agent => agent.id !== id));
        return entry;
    }

    function createExportData() {
        return {
            version: CUSTOM_AGENT_EXPORT_VERSION,
            type: 'custom-agent-export',
            exportedAt: new Date().toISOString(),
            agents: normalizeCustomAgentList(getList()).map(({ id, ...entry }) => entry),
        };
    }

    async function importAgents(data, { resolveConflict } = {}) {
        const incoming = validateCustomAgentExport(data);
        const candidate = [...getList()];
        let imported = 0;
        let skipped = 0;
        for (const agent of incoming) {
            const index = candidate.findIndex(entry => entry.providerName === agent.providerName);
            if (index !== -1) {
                const resolution = resolveConflict
                    ? await resolveConflict({ incoming: structuredClone(agent), existing: structuredClone(candidate[index]) })
                    : 'skip';
                if (resolution === 'cancel') return { imported: 0, skipped: 0, cancelled: true };
                if (resolution === 'skip') { skipped++; continue; }
                if (resolution !== 'overwrite') throw new Error('Invalid conflict resolution');
                candidate[index] = { ...agent, id: candidate[index].id };
            } else {
                candidate.push({ ...agent, id: generateCustomAgentId() });
            }
            imported++;
        }
        if (imported > 0) await commitList(candidate);
        return { imported, skipped, cancelled: false };
    }

    async function updateResult(id, content) {
        const metadata = getChatMetadata();
        const store = getStore(metadata);
        const previous = store[id];
        if (!previous) return undefined;
        const previousRevision = getResultRevision(metadata, id);
        const committedRevision = previousRevision + 1;
        const nextContent = String(content ?? '');
        let data;
        try { data = JSON.parse(nextContent); } catch (_) { data = nextContent; }
        setResultRevision(metadata, id, committedRevision);
        store[id] = { ...previous, content: nextContent, data };
        try { await saveChatConditional(); }
        catch (error) {
            if (getResultRevision(metadata, id) === committedRevision) {
                store[id] = previous;
                setResultRevision(metadata, id, previousRevision);
            }
            throw error;
        }
        return store[id];
    }

    async function setAutoCounter(id, value) {
        const metadata = getChatMetadata();
        getStore(metadata);
        const root = metadata[EXT_KEY];
        const key = `_autoCAG_${id}`;
        const hadPrevious = Object.prototype.hasOwnProperty.call(root, key);
        const previous = root[key];
        const previousRevision = getCounterRevision(metadata, key);
        const committedRevision = previousRevision + 1;
        setCounterRevision(metadata, key, committedRevision);
        root[key] = value;
        try { await saveChatConditional(); }
        catch (error) {
            if (getCounterRevision(metadata, key) === committedRevision) {
                if (hadPrevious) root[key] = previous;
                else delete root[key];
                setCounterRevision(metadata, key, previousRevision);
            }
            throw error;
        }
        return value;
    }

    const execution = createCustomAgentExecution({
        getList,
        getStore,
        getChatMetadata,
        getChat,
        getRevision: id => revisions.get(id) || 0,
        getResultRevision,
        setResultRevision,
        getCounterRevision,
        setCounterRevision,
        renderPrompt,
        generate: prompt => createCaller(
            settings.agentConfigs?.['custom-agent'] || {},
            opts => generateRaw(opts),
        ).generate(prompt),
        saveChatConditional,
        EXT_KEY,
        log,
    });

    return {
        getList,
        getData,
        validateList,
        suggestProviderName,
        add: (...args) => enqueueMutation(() => add(...args)),
        update: (...args) => enqueueMutation(() => update(...args)),
        toggle: (...args) => enqueueMutation(() => toggle(...args)),
        remove: (...args) => enqueueMutation(() => remove(...args)),
        createExportData,
        importAgents: (...args) => enqueueMutation(() => importAgents(...args)),
        updateResult,
        setAutoCounter,
        refreshProviders: () => {
            const result = syncProviders(getList());
            recordChangedRevisions(getList());
            return result;
        },
        ...execution,
    };
}
