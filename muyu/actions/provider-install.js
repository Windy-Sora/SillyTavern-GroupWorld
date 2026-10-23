import { createApprovedActions } from './coordinator.js';
export function createProviderInstallActions({ getArtifact, validate, getTarget, writer, changed }) {
    return createApprovedActions({ contract: {
        idPrefix: 'provider-install:', available: () => !!writer,
        matchesArtifact: artifact => artifact.kind === 'provider-draft' && artifact.content?.module === 'provider-asset',
        validate, execute: record => writer.install(record.content),
        resultStatus: result => ['saved_unconfirmed', 'outcome_unknown'].includes(result?.status) ? result.status : 'outcome_unknown',
        notExecuted: error => ['PROVIDER_ASSET_EXISTS', 'INVALID_PROVIDER_DRAFT', 'PROVIDER_STORE_UNAVAILABLE', 'PROVIDER_PROTECTED', 'PROVIDER_ASSET_UNSUPPORTED', 'STALE_PROVIDER_ASSET', 'WRITE_UNAVAILABLE', 'ACTION_STALE'].includes(error?.message),
    }, getArtifact, getTarget, changed });
}
