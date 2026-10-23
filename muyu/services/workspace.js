import { copyJson, jsonKey } from '../core/json-contract.js';
import { randomUUID } from '../runtime/crypto.js';
export const WORKSPACE_ERRORS = ['WORKSPACE_INVALID','WORKSPACE_CONFLICT','WORKSPACE_UNAVAILABLE','WORKSPACE_BUSY','WORKSPACE_CAPACITY','WORKSPACE_PREVIEW_EXPIRED','WORKSPACE_ABORTED'];
const revision = x => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
const id = x => typeof x === 'string' && /^[0-9a-f-]{36}$/.test(x);
const bytes = x => new TextEncoder().encode(JSON.stringify(x)).length;
export function createWorkspaceWriter({ request }) {
    const leases = new Map();
    function assertFresh(content) {
        const row = leases.get(content?.ticket);
        if (!row || jsonKey(content) !== jsonKey(row.content) || row.expiresAt <= Date.now() || !row.capture?.allows('workspaceWrite')) throw Error('ACTION_STALE');
        return row;
    }
    return {
        async preview(args, target, capture, signal) {
            for(const [ticket,row]of leases)if(row.expiresAt<=Date.now())leases.delete(ticket);
            if (!capture?.allows('workspaceWrite') || leases.size >= 64) throw Error('WRITE_UNAVAILABLE');
            const { path, text } = args, expectedRevision=args.expectedRevision===''?null:args.expectedRevision;
            const raw = await request('preview', { path, expectedRevision, text }, signal);
            if (signal?.aborted || !capture.allows('workspaceWrite')) throw Error('ACTION_STALE');
            if (!raw || Object.keys(raw).sort().join(',') !== 'beforeText,bytes,expectedRevision,expiresAt,operation,path,previewId,revision,status,version' ||
                raw.version !== 1 || raw.status !== 'preview' || !id(raw.previewId) || raw.path !== path || raw.expectedRevision !== expectedRevision ||
                !revision(raw.revision) || typeof raw.beforeText !== 'string' || raw.beforeText.length > 24000 ||
                !Number.isSafeInteger(raw.bytes) || raw.bytes !== new TextEncoder().encode(text).length ||
                !Number.isSafeInteger(raw.expiresAt) || raw.expiresAt <= Date.now() || raw.expiresAt > Date.now() + 301000 ||
                raw.operation !== (expectedRevision === null ? 'create' : 'update') || expectedRevision === null && raw.beforeText !== '' ||
                bytes({ before: raw.beforeText, after: text }) > 20000) throw Error('SERVICE_INCOMPATIBLE');
            const content = copyJson({ module: 'service-workspace', ticket: 'workspace:' + randomUUID(), target: { kind: 'global', userKey: target.userKey },
                path, operation: raw.operation, expectedRevision, proposedRevision: raw.revision, before: raw.beforeText, after: text, expiresAt: raw.expiresAt });
            leases.set(content.ticket, { content: copyJson(content), previewId: raw.previewId, expiresAt: raw.expiresAt, capture });
            return content;
        },
        assertFresh,
        release(content) { leases.delete(content?.ticket); },
        clear() { leases.clear(); },
        async apply(content) {
            const row = assertFresh(content); leases.delete(content.ticket);
            try {
                const raw = await request('apply', { previewId: row.previewId });
                if (raw?.version !== 1 || !['written','outcome_unknown'].includes(raw.status) ||
                    Object.keys(raw).some(key => !['version','status','path','revision','backupId','persistence'].includes(key)) ||
                    !['file_synced','unknown'].includes(raw.persistence)) return { status: 'outcome_unknown', persistence: 'unknown' };
                if (raw.status === 'written' && (raw.path !== content.path || raw.revision !== content.proposedRevision ||
                    raw.persistence !== 'file_synced' || !(raw.backupId === null || typeof raw.backupId === 'string' && /^[0-9]{13}-[0-9a-f-]{36}\.bak$/.test(raw.backupId)))) return { status: 'outcome_unknown', persistence: 'unknown' };
                return { status: raw.status === 'written' ? 'saved_confirmed' : 'outcome_unknown',
                    persistence: raw.status === 'written' ? 'file_synced' : 'unknown' };
            } catch (error) {
                if (['WORKSPACE_CONFLICT','WORKSPACE_PREVIEW_EXPIRED','WORKSPACE_BUSY','WORKSPACE_INVALID','WORKSPACE_CAPACITY'].includes(error.message)) throw error;
                row.capture.unavailable('workspaceWrite');
                return { status: 'outcome_unknown', persistence: 'unknown' };
            }
        },
        async validate(args, capture, signal) {
            if (!capture?.allows('jsonValidate')) throw Error('WRITE_UNAVAILABLE');
            const raw = await request('validate', args, signal);
            if (signal?.aborted || !capture.allows('jsonValidate')) throw Error('ACTION_STALE');
            if (!raw || Object.keys(raw).sort().join(',') !== 'reason,valid,version' || raw.version !== 1 || typeof raw.valid !== 'boolean' ||
                !['SYNTAX_ONLY','JSON_SYNTAX','JSON_COMPLEXITY','JSON_UNSAFE_KEY','JSON_NUMBER'].includes(raw.reason) ||
                raw.valid !== (raw.reason === 'SYNTAX_ONLY')) throw Error('SERVICE_INCOMPATIBLE');
            return raw;
        },
    };
}
