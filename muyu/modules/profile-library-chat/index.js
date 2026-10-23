import { randomUUID } from '../../runtime/crypto.js';
import { copyJson, jsonKey } from '../../core/json-contract.js';
import { createToolRegistry } from '../../tools/registry.js';
import { createDraftRuns } from '../draft-runs.js';
import { prepareLibraryPreview } from '../library-preview-result.js';
const str = maxLength => ({ type: 'string', maxLength });
export function createProfileLibraryChatModule({ port, charge }) {
    const registry = createToolRegistry(), runs = createDraftRuns(port);
    const outputSchema = { type: 'object', properties: { candidateId: str(100), text: str(24000), applyRequested: { type: 'boolean' } }, required: ['candidateId', 'text'], additionalProperties: false };
    const inputs = {
        capture_preview: { properties: { name: str(80), description: str(1000), apply: { type: 'boolean' } }, required: ['name'] },
        apply_preview: { properties: { id: str(100), revision: str(80), overwriteExisting: { type: 'boolean' }, importTemplate: { type: 'boolean' }, matchNameOnly: { type: 'boolean' }, apply: { type: 'boolean' } }, required: ['id','revision'] },
    };
    const descriptions = {
        capture_preview: 'Preview saving current group chat ready profiles for enabled members into a NEW named global character profile library. Includes current effective generation Prompt/Schema/render template. Requires library and chat profile sources. No chat write/template application/model call. Refuses duplicate name; captures exact source snapshot; chat/profile changes invalidate. No archive or disabled member profiles. <=24000 UTF-8 bytes complete draft; never truncate. apply=true only explicit save intent in full-access, otherwise exact UI approval.',
        apply_preview: 'Preview applying an exact library ID/revision from libraries.list into CURRENT GROUP CHAT. Match content hash, then avatar+name. Defaults preserve ALL existing records, no template import, no name-only match. overwriteExisting=true or matchNameOnly=true only when explicitly requested; review matched names and full differences. importTemplate=true separately replaces GLOBAL profile generation Prompt, Schema and render template, affecting all chats. Save chat first then global templates; partial outcomes possible, unknown saves must not be retried. No model call, message edit or unrelated profile clearing. No matches/only skipped => no changes, no template-only write. Chat/member/profile/library/template changes invalidate preview. apply=true only explicit apply intent in full-access; ordinary mode exact UI approval.',
    };
    for (const [name, input] of Object.entries(inputs)) registry.register({ id: 'muyu.library_chat.' + name, version: 1, description: descriptions[name], inputSchema: { type: 'object', ...input, additionalProperties: false }, outputSchema, scope: 'chat', effect: 'read', dataClasses: ['profile-library-chat'], confirmation: 'policy', resourceKeys: [], timeoutMs: 1000, retryPolicy: { kind: 'none', maxAttempts: 1 } });
    registry.seal();
    function candidate(args,ctx,operation) {
        const run=runs.get(ctx.runId);
        if(!run||jsonKey(run.target)!==jsonKey(ctx.target)||!port)throw Error('RUN_NOT_BOUND');
        runs.discardCandidate(ctx.runId);
        const prepared=prepareLibraryPreview(()=>operation==='capture'?port.capture(args,ctx.target):port.prepareApply(args,ctx.target));
        if(prepared.response)return prepared.response;
        const content=prepared.content;
        const candidateId='library-chat:'+randomUUID();run.candidate={candidateId,content};
        return {candidateId,text:JSON.stringify({state:'draft_only',operation,name:content.name,count:content.count,skipped:content.skipped,unmatched:content.unmatched,importsGlobalTemplate:!!content.template,warnings:content.warnings}),...(args.apply?{applyRequested:true}:{})};
    }
    return { registry,handlers:{
        'muyu.library_chat.capture_preview':(args,ctx)=>candidate(args,ctx,'capture'),
        'muyu.library_chat.apply_preview':(args,ctx)=>candidate(args,ctx,'apply'),
    },
        bindRun(identity) { if (runs.size >= 128 || runs.has(identity.id)) throw Error('RUN_CAPACITY'); runs.set(identity.id, { taskId: identity.taskId, target: copyJson(identity.target), candidate: null }); },
        transferRun(from, identity) { const run = runs.get(from); if (!run) return; if (runs.has(identity.id) || run.taskId !== identity.taskId || jsonKey(run.target) !== jsonKey(identity.target)) throw Error('INVALID_RUN_TRANSFER'); runs.take(from); runs.set(identity.id, run); },
        publishDraft(app, id, candidateId) {
            const run = runs.get(id), state = app.snapshot().runs.find(row => row.id === id);
            if (!run?.candidate || run.candidate.candidateId !== candidateId || state?.status !== 'succeeded' || state.taskId !== run.taskId || jsonKey(state.target) !== jsonKey(run.target)) throw Error('INVALID_CANDIDATE_SOURCE');
            port.assertFresh(run.candidate.content);
            const artifact = app.createArtifact({ taskId: run.taskId, sourceRunId: id, kind: 'profile-library-chat-draft', content: run.candidate.content }); runs.publish(id, artifact); return artifact;
        },
        validateSaved(app, id, revision) {
            const artifact = app.getArtifact(id), state = app.snapshot().runs.find(row => row.id === artifact.sourceRunId);
            if (artifact.kind !== 'profile-library-chat-draft' || artifact.revision !== revision || state?.status !== 'succeeded' || state.taskId !== artifact.taskId) throw Error('INVALID_LIBRARY_DRAFT');
            port.assertFresh(artifact.content);
            return app.validateArtifact(id, revision, { structural: 'passed', semantic: 'format_only', intent: 'requires_user_review', writes: 'chat-profiles-and-optional-global-templates' });
        },
        retainArtifacts: artifacts => runs.retainArtifacts(artifacts),
        forgetRun(id) { runs.delete(id); }, dispose() { runs.clear(); },
    };
}
