/** Candidate IDs are opaque. Their producing tool and saved content type choose the owner. */
export function createArtifactOwners(entries) {
    const byTool = new Map(), byModule = new Map(), groups = new Map(), firstTool = new Map();
    for (const { toolId, moduleId, owner } of entries) {
        if (typeof toolId !== 'string' || typeof moduleId !== 'string' || !owner || typeof owner.publishDraft !== 'function' || typeof owner.validateSaved !== 'function' || byTool.has(toolId) || byModule.has(moduleId) && byModule.get(moduleId) !== owner) throw Error('INVALID_ARTIFACT_OWNER');
        byTool.set(toolId, owner); byModule.set(moduleId, owner);
        if (!firstTool.has(moduleId)) firstTool.set(moduleId, toolId);
        groups.set(toolId, firstTool.get(moduleId));
    }
    return Object.freeze({
        produces: toolId => byTool.has(toolId),
        group: toolId => groups.get(toolId),
        publish(app, runId, candidate) {
            const owner = byTool.get(candidate?.toolId);
            if (!owner || typeof candidate.candidateId !== 'string' || !candidate.candidateId) throw Error('INVALID_CANDIDATE_SOURCE');
            const artifact = owner.publishDraft(app, runId, candidate.candidateId);
            owner.validateSaved(app, artifact.id, artifact.revision);
            return artifact;
        },
        revalidate(app, id, revision) {
            const artifact = app.getArtifact(id);
            const owner = byModule.get(artifact.content?.module);
            if (!owner) throw Error('UNSUPPORTED_ARTIFACT');
            return owner.validateSaved(app, id, revision);
        },
    });
}
