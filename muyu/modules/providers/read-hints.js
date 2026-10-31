import { sourceReadNavigationSchema } from '../../tools/read-navigation.js';
const str = maxLength => ({ type: 'string', maxLength });
export const readHintSchema = { type: 'object', properties: {
    kind: { type: 'string', enum: ['directory', 'content', 'structured', 'unavailable'] },
    selectorFormat: str(64), exampleSelector: str(32),
    recovery: { type: 'string', enum: ['none', 'correct_selector', 'read_directory', 'stop'] },
    pageState: { type: 'string', enum: ['more', 'last'] },
    readingAdvice: str(800),
    continuation: { type: 'object', properties: { id: str(64), token: str(40) }, required: ['id', 'token'], additionalProperties: false },
    error: { type: 'object', properties: { field: str(32), expected: str(320), retryable: { type: 'boolean' } }, required: ['field', 'expected', 'retryable'], additionalProperties: false },
    nextRead: { type: 'object', properties: { id: str(64), selector: str(32), revision: str(40), offset: { type: 'integer', minimum: 0, maximum: 131072 } }, required: ['id', 'selector', 'revision', 'offset'], additionalProperties: false },
    parentRead: { type: 'object', properties: { id: str(64), selector: str(32), revision: str(40), offset: { type: 'integer', minimum: 0, maximum: 131072 } }, required: ['id', 'selector', 'revision', 'offset'], additionalProperties: false },
    relatedReads: { type: 'array', maxItems: 1, items: sourceReadNavigationSchema },
    alternativeReads: { type: 'array', maxItems: 1, items: { type: 'object', properties: { id: str(64), selector: str(32), revision: str(40), offset: { type: 'integer', minimum: 0, maximum: 131072 } }, required: ['id', 'selector', 'revision', 'offset'], additionalProperties: false } },
}, required: ['kind', 'selectorFormat', 'exampleSelector', 'recovery'], additionalProperties: false };

const directories = new Set(['chatHistory', 'directorHistory', 'characters', 'charMemory', 'character_profiles', 'variables', 'variableDiagnostics', 'storyBlueprint', 'stWorldBookEntries', 'stPresets', 'stPresetContent', 'stPersonas', 'stPersonaContent', 'stPresetFamilies', 'stCharacterComponents', 'stPromptOverview', 'stPromptText', 'stDiagnostics']);
const examples = { chatHistory: 'range:0:20', directorHistory: 'range:0:10', characters: 'character:0', charMemory: 'character:0', character_profiles: 'character:0', variables: 'item:0', variableDiagnostics: 'item:0', storyBlueprint: 'node:0', stWorldBookEntries: 'book:0', stPresets: 'mode:0', stPresetContent: 'current', stPromptOverview: '', stPromptText: 'message:0', stDiagnostics: 'range:0:20' };

/** Protocol hints only: never expose private directory evidence or authorize a read. */
Object.assign(examples, { stPersonaContent: 'current', stPresetFamilies: 'mode:2', stCharacterComponents: 'card:0' });
export function readHint(source, args, response, fresh = null) {
    const ok = ['ok', 'empty'].includes(response.status);
    const directory = source.format === 'text' && directories.has(source.id) && (!args.selector || source.id === 'stPersonas' || source.id === 'stCharacterComponents' && /^(?:cards|card):\d+$/.test(args.selector) || source.id === 'stWorldBookEntries' && /^(?:books:\d+|book:\d+|entries:\d+:\d+)$/.test(args.selector) || source.id === 'stPresets' && /^mode:\d+$/.test(args.selector) || source.id === 'stPresetContent' && /^(current|saved:\d+)$/.test(args.selector) || source.id === 'stPresetFamilies' && /^mode:[0-7](?::(?:current|saved:\d+))?$/.test(args.selector));
    const hint = { kind: !ok ? 'unavailable' : source.format === 'structured' ? 'structured' : directory ? 'directory' : 'content',
        selectorFormat: source.selector, exampleSelector: examples[source.id] || '',
        recovery: response.status === 'INVALID_SELECTOR' || response.status === 'INVALID_READ_ARGUMENTS' ? 'correct_selector' : response.status === 'STALE_SOURCE' || response.status === 'INVALID_CONTINUATION' ? 'read_directory' : ok ? 'none' : 'stop' };
    if (ok && source.format === 'text') {
        if (directory && source.id === 'stPersonas') hint.readingAdvice = 'Names and selection flags only, not Persona descriptions. For content, start the separate stPersonaContent directory with {id}, get its own source permission and revision. Do not pass this directory revision to another source. Selection does not prove final injection; honor any denial.';
        if (directory && source.id === 'stCharacterComponents') hint.readingAdvice = 'Metadata only. Follow card:N, then its regex/script/book selectors for saved bodies. Load relevant Skills when actual evidence identifies a processing chain. External binding and embedded book differ. Enabled flags do not prove execution. No execution or migration.';
        hint.pageState = response.nextOffset >= 0 ? 'more' : 'last';
        if (hint.pageState === 'more') hint.readingAdvice = 'More text remains in this projection. A page boundary is not budget exhaustion or task completion. Continue with the issued continuation while relevant to the user request and permitted by the actual run budget. Do not parse a partial JSON page as a complete object. Report budget exhaustion only with an explicit budget error; without that evidence the stopping cause is unknown.';
        if (directory && source.id === 'stPresetContent' && /^(current|saved:\d+)$/.test(args.selector)) {
            hint.readingAdvice = (hint.readingAdvice ? hint.readingAdvice + ' ' : '') + 'This overview contains Prompt metadata, NOT Prompt bodies. For content analysis, finish the relevant directory and read relevant indexed Prompt bodies using its revision; do not require the user to pick a name when their goal is clear. Same-source permission is checked by the host; body reads do not inherently require another approval. Never bypass denial or claim final injection.';
        }
        if (directory && source.id === 'stPresetFamilies') hint.readingAdvice = (hint.readingAdvice || '') + ' This is preset-family/field metadata, not field bodies. Read the chosen mode directory, then current or saved:M overview, then indexed :field:K bodies. getPresetSettings is current export, not a saved preset. OpenAI stays in stPresetContent under its own permission. Do not infer final injection.';
        if (directory && source.id === 'stPersonaContent') hint.readingAdvice = (hint.readingAdvice || '') + ' Persona metadata is not description text. Read current for live memory or persona:N for a stored descriptor under this source permission. They may differ; no writes, macro evaluation or final-injection proof.';
    }
    if (response.status === 'INVALID_SELECTOR') hint.error = { field: 'selector', expected: source.format === 'structured' ? 'Use empty selector/revision and offset=0 for this structured source.' : `Use ${source.selector}; example ${examples[source.id] || '(see directory)'}. Read the directory first; examples do not prove an item exists.`, retryable: true };
    if (response.status === 'INVALID_READ_ARGUMENTS') hint.error = { field: 'arguments', expected: 'Use {id} for the directory, {id,continuationToken} for a host-issued continuation, or all of {id,selector,revision,offset}. Do not mix these forms.', retryable: true };
    if (response.status === 'INVALID_CONTINUATION') hint.error = { field: 'continuationToken', expected: 'Use an issued token from this run and source, or reread the directory with {id}. Tokens do not survive new tasks or reconnects.', retryable: true };
    if (response.status === 'STALE_SOURCE') hint.error = { field: 'revision', expected: 'Source or directory changed: reread its directory, then use the newly returned revision or continuation.', retryable: true };
    if (response.status === 'SOURCE_CACHE_FULL') hint.error = { field: 'cache', expected: 'Task read cache is full (256 references or 8 MiB of evidence). Stop opening new selectors; rereading directories will not free capacity. Existing pages still require their original version, target, permission and byte budget. Continue remaining reads in a new task.', retryable: false };
    if (response.status === 'BUDGET_EXCEEDED') hint.error = { field: 'budget', expected: 'Stop reading this run: the next page cannot fit the remaining byte budget. Report the unread gap; do not guess or request later offsets.', retryable: false };
    const next = (selector, revision, offset = 0) => ({ id: source.id, selector, revision, offset });
    if (source.id === 'stPersonaContent' && args.selector === 'current' && response.status === 'SOURCE_UNAVAILABLE') {
        hint.recovery = 'read_directory'; hint.nextRead = next('', '');
        hint.error = { field: 'selector', expected: 'Only the current-memory read failed; stored descriptions have not been ruled out. Inspect this same source directory once. Read an available stored descriptor only if relevant and allowed, and never present it as the missing current value. If the directory is unavailable, stop.', retryable: true };
    }
    if (ok && directory && response.nextOffset === -1 && source.id === 'stPersonaContent') {
        let data; try { data = JSON.parse(fresh?.text || ''); } catch { /* no guessed selectors */ }
        const selected = data?.personas?.find(row => row.selected === true && row.storedReadAvailable === true);
        const stored = selected ? next('persona:' + selected.index, response.revision) : null;
        if (data?.currentReadAvailable === true) {
            hint.nextRead = next('current', response.revision);
            if (stored) hint.alternativeReads = [stored];
        } else if (stored) hint.nextRead = stored;
        hint.exampleSelector = hint.nextRead?.selector || '';
        hint.readingAdvice = 'Description directory only. currentReadAvailable=false does not make stored descriptions unavailable; use storedReadAvailable for the relevant persona. nextRead and alternativeReads are choices, not automatic actions: read only the variants requested or needed, under this source permission. Current and stored may differ; never substitute one for the other or infer final injection. No selected stored persona is guessed from the number of entries.';
    }
    // Only inspect the fixed first-party directory projection, never body text.
    if (ok && directory && response.nextOffset === -1 && ['stPromptOverview', 'stPromptText'].includes(source.id)) {
        let metadata; try { metadata = JSON.parse(fresh?.text || ''); } catch { /* no inferred availability */ }
        if (metadata?.available === false) {
            hint.recovery = 'stop'; hint.exampleSelector = '';
            hint.error = { field: 'source', expected: 'No captured prompt exists. Stop body reads; do not guess selectors or substitute other sources. Enabling capture only observes future builds, not old requests. Do not trigger generation.', retryable: false };
            return hint;
        }
    }
    if (response.status === 'STALE_SOURCE') hint.nextRead = next('', '');
    else if (ok && response.nextOffset >= 0) hint.nextRead = next(args.selector, response.revision, response.nextOffset);
    else if (ok && directory && ['chatHistory', 'directorHistory'].includes(source.id)) {
        // Count comes from the fixed first-party directory projection, not raw metadata.
        const match = /^(?:messages|records)=(\d+);/.exec(fresh?.text || '');
        const count = match && Number(match[1]);
        if (Number.isSafeInteger(count) && count > 0) hint.nextRead = next(`range:0:${Math.min(count, source.id === 'chatHistory' ? 20 : 10)}`, response.revision);
    }
    return hint;
}
