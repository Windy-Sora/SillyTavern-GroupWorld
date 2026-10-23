import { copyJson, validateJson } from '../core/json-contract.js';
import { validateReceipt } from '../actions/receipts.js';
import { validateRecoveryIntent } from './intent.js';

const text = maxLength => ({ type: 'string', maxLength });
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const statuses = ['applying', 'not_started', 'not_executed', 'applied_confirmed', 'applied_unconfirmed', 'saved_confirmed', 'saved_unconfirmed', 'partial', 'outcome_unknown'];
const schema = object({ version: { type: 'integer', enum: [1] }, id: text(100), conversationId: text(100),
    kind: { type: 'string', enum: ['config', 'bundle'] }, scope: text(2048),
    revision: { type: 'integer', minimum: 0 }, updatedAt: { type: 'integer', minimum: 0 },
    status: { type: 'string', enum: statuses }, recordingFailed: { type: 'boolean' },
    steps: { type: 'array', maxItems: 10, items: object({ kind: { type: 'string', enum: ['variable', 'settings', 'script'] }, id: text(100), status: { type: 'string', enum: statuses } }) },
});

/** Historical evidence only; no executable drafts, grants or replay instructions. */
export function validateCheckpoint(value) {
    const { proposal, receipt, intent, continuedBy, parentId, ...metadata } = copyJson(value);
    const v2 = metadata.version === 2;
    if (!v2 && (intent !== undefined || continuedBy !== undefined || parentId !== undefined)) throw Error('RECOVERY_INVALID');
    const record = { ...validateJson(v2 ? { ...schema, properties: { ...schema.properties, version: { type: 'integer', enum: [2] } } } : schema, metadata),
        proposal: validateReceipt(proposal), receipt: receipt === null ? null : validateReceipt(receipt),
        ...(v2 ? { intent: intent === null ? null : validateRecoveryIntent(intent), continuedBy: validateJson({ type: 'string', maxLength: 100 }, continuedBy), parentId: validateJson({ type: 'string', maxLength: 100 }, parentId) } : {}) };
    if (v2 && record.kind === 'config' && record.intent?.variables.length) throw Error('RECOVERY_INVALID');
    const receipts = [record.proposal, ...(record.receipt ? [record.receipt] : [])];
    if (receipts.some(r => r.operationId !== record.id || !(record.kind === 'config' ? [1, 2] : [4, 9]).includes(r.version || 1)) ||
        record.proposal.status !== 'not_executed' ||
        (record.receipt ? record.receipt.status !== record.status : record.status !== 'applying') ||
        !record.id || new TextEncoder().encode(JSON.stringify(record)).length > 524288) throw Error('RECOVERY_INVALID');
    return record;
}
