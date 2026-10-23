import { randomUUID } from '../../runtime/crypto.js';
import { copyJson, jsonKey } from '../../core/json-contract.js';
import { createToolRegistry } from '../../tools/registry.js';
import { createDraftRuns } from '../draft-runs.js';
import { prepareLibraryPreview } from '../library-preview-result.js';
const str = maxLength => ({ type: 'string', maxLength });
export function createNpcLibraryChatModule({ port, charge }) {
    const registry = createToolRegistry(), runs = createDraftRuns(port);
    const outputSchema = { type: 'object', properties: { candidateId: str(100), text: str(24000), applyRequested: { type: 'boolean' } }, required: ['candidateId', 'text'], additionalProperties: false };
    const inputs = {
        capture_preview: { properties: { name: str(80), description: str(1000), apply: { type: 'boolean' } }, required: ['name'] },
        apply_preview: { properties: { id: str(100), revision: str(80), overwriteExisting: { type: 'boolean' }, importTemplate: { type: 'boolean' }, apply: { type: 'boolean' } }, required: ['id','revision'] },
    };
    const descriptions = {
        capture_preview: 'Preview saving current chat NPC content into a NEW named global NPC package, including effective NPC Prompt but excluding character-card import tracking. No chat write, card generation, Prompt application or model call. Requires npcLibraryAssets and npcLibraryChat. Chat/NPC/Prompt changes invalidate. Complete draft <=24000 UTF-8 bytes, never truncate. apply=true only explicit save intent in full access; otherwise exact UI approval.',
        apply_preview: 'Preview applying the exact ID/revision from npc_libraries.list to CURRENT CHAT NPC list. Match names case-insensitively. Defaults preserve same-name NPCs and do not import Prompt. overwriteExisting=true only explicit overwrite intent; preserves existing character-card tracking but DOES NOT update those cards. importTemplate=true separately replaces GLOBAL npcPrompt, affecting all chats. Chat save precedes settings save; partial outcomes possible. Unknown results never auto-retry. Other NPCs remain; no generation, enabling, message edit or card creation. All skipped => no changes, no Prompt-only write. Needs npcLibraryAssets and npcLibraryChat. Full diff <=24000 bytes. apply=true only explicit execution intent in full access, ordinary mode exact UI approval.',
    };
    for (const [name, input] of Object.entries(inputs)) registry.register({ id: 'muyu.npc_library_chat.' + name, version: 1, description: descriptions[name], inputSchema: { type: 'object', ...input, additionalProperties: false }, outputSchema, scope: 'chat', effect: 'read', dataClasses: ['npc-library-chat'], confirmation: 'policy', resourceKeys: [], timeoutMs: 1000, retryPolicy: { kind: 'none', maxAttempts: 1 } });
    registry.seal();
    function candidate(args,ctx,operation) {
        const run=runs.get(ctx.runId);
        if(!run||jsonKey(run.target)!==jsonKey(ctx.target)||!port)throw Error('RUN_NOT_BOUND');
        runs.discardCandidate(ctx.runId);
        const prepared=prepareLibraryPreview(()=>operation==='capture'?port.capture(args,ctx.target):port.prepareApply(args,ctx.target));
        if(prepared.response)return prepared.response;
        const content=prepared.content;
        const candidateId='library-chat:'+randomUUID();run.candidate={candidateId,content};
        return {candidateId,text:JSON.stringify({state:'draft_only',operation,name:content.name,count:content.count,skipped:content.skipped,importsGlobalTemplate:!!content.template,warnings:content.warnings}),...(args.apply?{applyRequested:true}:{})};
    }
    return { registry,handlers:{
        'muyu.npc_library_chat.capture_preview':(args,ctx)=>candidate(args,ctx,'capture'),
        'muyu.npc_library_chat.apply_preview':(args,ctx)=>candidate(args,ctx,'apply'),
    },
        bindRun(identity) { if (runs.size >= 128 || runs.has(identity.id)) throw Error('RUN_CAPACITY'); runs.set(identity.id, { taskId: identity.taskId, target: copyJson(identity.target), candidate: null }); },
        transferRun(from, identity) { const run = runs.get(from); if (!run) return; if (runs.has(identity.id) || run.taskId !== identity.taskId || jsonKey(run.target) !== jsonKey(identity.target)) throw Error('INVALID_RUN_TRANSFER'); runs.take(from); runs.set(identity.id, run); },
        publishDraft(app, id, candidateId) {
            const run = runs.get(id), state = app.snapshot().runs.find(row => row.id === id);
            if (!run?.candidate || run.candidate.candidateId !== candidateId || state?.status !== 'succeeded' || state.taskId !== run.taskId || jsonKey(state.target) !== jsonKey(run.target)) throw Error('INVALID_CANDIDATE_SOURCE');
            port.assertFresh(run.candidate.content);
            const artifact = app.createArtifact({ taskId: run.taskId, sourceRunId: id, kind: 'npc-library-chat-draft', content: run.candidate.content }); runs.publish(id, artifact); return artifact;
        },
        validateSaved(app, id, revision) {
            const artifact = app.getArtifact(id), state = app.snapshot().runs.find(row => row.id === artifact.sourceRunId);
            if (artifact.kind !== 'npc-library-chat-draft' || artifact.revision !== revision || state?.status !== 'succeeded' || state.taskId !== artifact.taskId) throw Error('INVALID_LIBRARY_DRAFT');
            port.assertFresh(artifact.content);
            return app.validateArtifact(id, revision, { structural: 'passed', semantic: 'format_only', intent: 'requires_user_review', writes: 'chat-npcs-and-optional-global-prompt' });
        },
        retainArtifacts: artifacts => runs.retainArtifacts(artifacts),
        forgetRun(id) { runs.delete(id); }, dispose() { runs.clear(); },
    };
}
