import { copyJson } from '../core/json-contract.js';

/** Session-memory artifact versions. No model handler, filesystem, or business writes. */
export function createWorkspace({ maxArtifacts = 32, maxVersions = 16, maxBytes = 262144 } = {}) {
    for (const n of [maxArtifacts, maxVersions, maxBytes]) if (!Number.isSafeInteger(n) || n < 1) throw new TypeError('Invalid workspace limit');
    const records = new Map();
    let bytes = 0;
    const size = value => new TextEncoder().encode(JSON.stringify(value)).length;
    function save(id, versions) {
        const nextBytes = bytes - (records.has(id) ? size(records.get(id)) : 0) + size(versions);
        if (nextBytes > maxBytes || versions.length > maxVersions) throw new Error('WORKSPACE_FULL');
        records.set(id, versions); bytes = nextBytes;
        return copyJson(versions.at(-1));
    }
    return Object.freeze({
        create({ id, sessionId, taskId, sourceRunId = null, kind, content }) {
            if (![id, sessionId, taskId].every(x => typeof x === 'string' && x.length > 0) || !['workspace-draft', 'report', 'config-draft', 'task-plan', 'variable-draft', 'variable-editor-draft', 'memory-edit-draft', 'profile-edit-draft', 'npc-edit-draft', 'selection-draft', 'worldbook-edit-draft', 'character-card-draft', 'st-preset-draft', 'ledger-edit-draft', 'blueprint-node-edit-draft', 'task-bundle', 'profile-draft', 'provider-draft', 'script-draft', 'custom-agent-draft', 'custom-prompt-draft', 'skill-draft', 'profile-library-draft', 'profile-library-chat-draft', 'npc-library-draft', 'npc-library-chat-draft', 'blueprint-library-chat-draft', 'blueprint-library-draft'].includes(kind) || (sourceRunId !== null && typeof sourceRunId !== 'string')) throw new TypeError('Invalid artifact');
            if (records.has(id)) throw new Error('DUPLICATE_ARTIFACT');
            if (records.size >= maxArtifacts) throw new Error('WORKSPACE_FULL');
            return save(id, [copyJson({ id, sessionId, taskId, sourceRunId, kind, revision: 1, content, validation: null })]);
        },
        get(id, revision) {
            const versions = records.get(id); if (!versions) throw new Error('ARTIFACT_NOT_FOUND');
            const value = revision === undefined ? versions.at(-1) : versions.find(v => v.revision === revision);
            if (!value) throw new Error('REVISION_NOT_FOUND'); return copyJson(value);
        },
        update(id, expectedRevision, content) {
            const old = this.get(id); if (old.revision !== expectedRevision) throw new Error('STALE_ARTIFACT');
            return save(id, [...records.get(id), copyJson({ ...old, revision: old.revision + 1, content, validation: null })]);
        },
        validate(id, expectedRevision, validation) {
            const old = this.get(id); if (old.revision !== expectedRevision) throw new Error('STALE_ARTIFACT');
            const versions = records.get(id).slice(); versions[versions.length - 1] = copyJson({ ...old, validation });
            return save(id, versions);
        },
        delete(id) { const old = records.get(id); if (old) { bytes -= size(old); records.delete(id); } },
        list() { return [...records.values()].map(v => copyJson(v.at(-1))); },
        clear() { records.clear(); bytes = 0; },
    });
}
