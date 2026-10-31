import { jsonKey } from '../core/json-contract.js';

/** Read-only management views. Never call business getters that initialize metadata. */
export function createStorageInspectionPort({ getContext, getSettings, getTarget, extensionKey, agentMemory }) {
    function check(target, owner, metadata) {
        if (getSettings() !== owner) throw Error('STALE_STORAGE');
        if (target?.kind === 'chat' && jsonKey(getTarget()) !== jsonKey(target)) throw Error('STALE_STORAGE');
        if (metadata && getContext().chatMetadata !== metadata) throw Error('STALE_STORAGE');
    }
    return Object.freeze({
        async snapshot(resource, target) {
            const owner = getSettings(); check(target, owner);
            if (resource === 'notes') {
                if (typeof agentMemory?.list !== 'function') throw Error('STORAGE_UNAVAILABLE');
                const notes = await agentMemory.list(target); check(target, owner);
                if (!Array.isArray(notes) || notes.length > 256) throw Error('STORAGE_UNSUPPORTED');
                const items = notes.map(note => {
                    if (typeof note.id !== 'string' || note.id.length > 80 || typeof note.title !== 'string' || note.title.length > 80 || typeof note.content !== 'string' || note.content.length > 16000 || !['account', 'chat'].includes(note.scope) || !Number.isSafeInteger(note.revision) || note.revision < 1) throw Error('STORAGE_UNSUPPORTED');
                    return { id: note.id, title: note.title, text: note.content, scope: note.scope, noteRevision: note.revision };
                });
                return { owner, enabled: typeof agentMemory.enabled === 'function' ? agentMemory.enabled() === true : null,
                    source: 'account-settings', scope: 'account-and-current-chat', items };
            }
            if (resource !== 'summaries') throw Error('STORAGE_UNSUPPORTED');
            if (target?.kind !== 'chat') throw Error('STORAGE_CONTEXT_REQUIRED');
            const metadata = getContext().chatMetadata;
            if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw Error('STORAGE_UNAVAILABLE');
            const root = metadata[extensionKey];
            if (root !== undefined && (!root || typeof root !== 'object' || Array.isArray(root))) throw Error('STORAGE_UNSUPPORTED');
            const summaries = root?.summaries;
            if (summaries !== undefined && (!Array.isArray(summaries) || summaries.length > 4096)) throw Error('STORAGE_UNSUPPORTED');
            let totalChars = 0;
            const items = (summaries || []).map((entry, index) => {
                if (!entry || typeof entry.content !== 'string' || entry.content.length > 131072 || typeof entry.active !== 'boolean') throw Error('STORAGE_UNSUPPORTED');
                totalChars += entry.content.length;
                if (totalChars > 4194304) throw Error('STORAGE_UNSUPPORTED');
                return { id: 'summary:' + index, title: 'Summary ' + (index + 1), text: entry.content, scope: 'current-chat', active: entry.active };
            });
            check(target, owner, metadata);
            return { owner, resourceOwner: metadata, enabled: typeof owner.summaryEnabled === 'boolean' ? owner.summaryEnabled : null,
                source: 'chat-metadata', scope: 'current-chat', items };
        },
    });
}
