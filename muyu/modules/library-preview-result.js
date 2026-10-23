/** A fully skipped apply is a read-only no-op, never an executable candidate. */
export function prepareLibraryPreview(prepare) {
    try { return { content: prepare() }; }
    catch (error) {
        if (error?.message !== 'LIBRARY_NO_CHANGES') throw error;
        return { response: { candidateId: '', text: JSON.stringify({
            state: 'no_changes', code: 'LIBRARY_NO_CHANGES', candidateCreated: false,
            writesStarted: false, retryRecommended: false,
            notice: 'No applicable changes under the requested matching and preserve-existing policy. No draft or save started, including global template writes. This is not a damaged-library diagnosis. Do not retry unchanged arguments or enable overwrite without a new explicit user request.',
        }) } };
    }
}
