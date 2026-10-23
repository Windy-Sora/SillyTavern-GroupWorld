import { createArtifactLeases } from './artifact-leases.js';

/** Private tickets move from a run candidate to its published artifact. */
export function createDraftRuns(port) {
    const published = createArtifactLeases(content => port?.release?.(content));
    return new class extends Map {
        discardCandidate(id) {
            const run = this.get(id);
            if (run?.candidate) port?.release?.(run.candidate.content);
            if (run) run.candidate = null;
        }
        delete(id) { this.discardCandidate(id); return super.delete(id); }
        take(id) { const run = this.get(id); super.delete(id); return run; }
        publish(id, artifact) { published.track(artifact); this.take(id); }
        retainArtifacts(artifacts) { published.retain(artifacts); }
        clear() {
            for (const id of this.keys()) this.discardCandidate(id);
            published.clear(); super.clear();
        }
    }();
}
