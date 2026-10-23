import { createApprovedActions } from './coordinator.js';
export function createLedgerEditActions({ getArtifact, validate, getTarget, writer, changed }) {
    return createApprovedActions({ getArtifact, getTarget, changed, contract: {
        idPrefix: 'ledger-edit:', available: () => !!writer,
        matchesArtifact: a => a.kind === 'ledger-edit-draft' && a.content?.module === 'ledger-editor',
        validate, execute: record => writer.apply(record.content),
        resultStatus: result => ['applied_confirmed', 'partial', 'outcome_unknown'].includes(result?.status) ? result.status : 'outcome_unknown',
        notExecuted: error => ['TARGET_UNAVAILABLE','STALE_LEDGER_EDIT','LEDGER_BUSY','LEDGER_NOT_FOUND','UNSUPPORTED_LEDGER_STORE','WRITE_UNAVAILABLE','ACTION_STALE'].includes(error?.message),
    } });
}
