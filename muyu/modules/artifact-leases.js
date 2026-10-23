import { copyJson, jsonKey } from '../core/json-contract.js';

/** A published artifact owns its private preview resources, not its former Run. */
export function createArtifactLeases(release) {
    const owned = new Map();
    return Object.freeze({
        track(artifact) {
            if (!artifact?.id || !artifact.content || owned.has(artifact.id)) throw Error('INVALID_ARTIFACT_LEASE');
            owned.set(artifact.id, { content: copyJson(artifact.content), key: jsonKey(artifact.content) });
        },
        retain(artifacts) {
            const live = new Map(artifacts.filter(a => owned.has(a.id)).map(a => [a.id, jsonKey(a.content)]));
            for (const [id, lease] of owned) if (!live.has(id) || live.get(id) !== lease.key) {
                release(lease.content); owned.delete(id);
            }
        },
        clear() { for (const [id, lease] of owned) { release(lease.content); owned.delete(id); } },
    });
}
