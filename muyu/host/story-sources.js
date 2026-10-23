import { peekVariables, peekBlueprintState } from '../../systems/provider-read-data.js';
import { copyJson } from '../core/json-contract.js';

const object = x => x && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string' ? x : '';
const fail = code => { throw Error(code); };
function json(value) {
    try { return copyJson(value); } catch { return fail('SOURCE_UNSUPPORTED'); }
}
function result(value, directory, identity, limited = false) {
    const body = JSON.stringify(value);
    if (body.length > 131072) fail('SOURCE_TOO_LARGE');
    return { text: body, limited, directory, ...(identity === undefined ? {} : { identity }) };
}
function index(selector, prefix, length) {
    const match = new RegExp('^' + prefix + ':(0|[1-9]\\d{0,3})$').exec(selector);
    if (!match || Number(match[1]) >= length) fail('INVALID_SELECTOR');
    return Number(match[1]);
}

/** Stored values only: never initialize, coerce, fill defaults, or run update rules. */
export function readVariables(selector, ctx, key) {
    const store = peekVariables(ctx.chatMetadata, key);
    if (store === undefined) return selector ? fail('INVALID_SELECTOR') : { text: '', limited: false };
    if (!object(store) || !Array.isArray(store.defs) || !object(store.values)) fail('SOURCE_UNSUPPORTED');
    if (store.defs.length > 256) fail('SOURCE_TOO_LARGE');
    const entries = [], seen = new Set();
    const add = entry => { if (entries.length >= 512) fail('SOURCE_TOO_LARGE'); entries.push(entry); };
    for (const def of store.defs) {
        if (!object(def) || typeof def.id !== 'string' || !def.id || seen.has(def.id) || !['global', 'character'].includes(def.scope) || !['string', 'number', 'boolean', 'enum', 'array', 'object'].includes(def.type)) fail('SOURCE_UNSUPPORTED');
        seen.add(def.id);
        const base = { id: def.id, label: text(def.label), type: def.type, scope: def.scope === 'global' ? 'chat-global' : 'chat-character' };
        const bucket = def.scope === 'global' ? store.values.global : store.values.character?.[def.id];
        if (bucket !== undefined && !object(bucket)) fail('SOURCE_UNSUPPORTED');
        if (def.scope === 'global') add({ base, bucket: bucket || {}, storageKey: def.id });
        else {
            const keys = Object.keys(bucket || {});
            if (keys.length > 256) fail('SOURCE_TOO_LARGE');
            if (!keys.length) add({ base: { ...base, character: '', note: 'No stored character values; defaults are not evaluated.' }, bucket: {}, storageKey: '' });
            for (const storageKey of keys) {
                const characters = Array.isArray(ctx.characters) ? ctx.characters : [];
                const character = characters.find(c => c?.avatar === storageKey) || characters.find(c => c?.name === storageKey);
                add({ base: { ...base, character: text(character?.name) || 'Unresolved character' }, bucket, storageKey });
            }
        }
    }
    // Private evidence binds opaque selectors to storage identities without exporting avatar filenames.
    const directory = entries.map(e => [e.base, e.storageKey]);
    if (!selector) return result({ scope: 'chat', origin: 'stored-memory', persistence: 'unknown', note: 'global means this chat, not all chats. Stored values only; defaults/rules are not evaluated.', items: entries.map((e, i) => ({ selector: 'item:' + i, ...e.base })) }, directory);
    const i = index(selector, 'item', entries.length), e = entries[i];
    const present = Object.hasOwn(e.bucket, e.storageKey);
    return result({ ...e.base, state: present ? 'stored' : 'missing', ...(present ? { value: json(e.bucket[e.storageKey]) } : {}), note: 'Not an effective/defaulted value or persistence confirmation.' }, directory, directory[i]);
}

/** Read-only diagnostic projection. Historical free-text reasons are not host verdicts. */
export function readVariableDiagnostics(selector, ctx, key) {
    const store = peekVariables(ctx.chatMetadata, key);
    if (store === undefined) return selector ? fail('INVALID_SELECTOR') : { text: '', limited: false };
    if (!object(store) || !Array.isArray(store.defs) || !object(store.values) || !Array.isArray(store.log)) fail('SOURCE_UNSUPPORTED');
    if (store.defs.length > 256 || store.log.length > 100) fail('SOURCE_TOO_LARGE');
    const characters = Array.isArray(ctx.characters) ? ctx.characters : [];
    const entries = [], seen = new Set();
    for (const def of store.defs) {
        if (!object(def) || typeof def.id !== 'string' || !def.id || seen.has(def.id) || !['global', 'character'].includes(def.scope) || !['string', 'number', 'boolean', 'enum', 'array', 'object'].includes(def.type)) fail('SOURCE_UNSUPPORTED');
        seen.add(def.id);
        const base = { id: def.id, label: text(def.label), type: def.type, scope: def.scope === 'global' ? 'chat-global' : 'chat-character' };
        if (def.scope === 'global') entries.push({ def, base, storageKey: def.id });
        else {
            const bucket = store.values.character?.[def.id];
            if (bucket !== undefined && !object(bucket)) fail('SOURCE_UNSUPPORTED');
            const keys = Object.keys(bucket || {});
            if (keys.length > 256) fail('SOURCE_TOO_LARGE');
            if (!keys.length) entries.push({ def, base: { ...base, character: '', note: 'No stored character value.' }, storageKey: '' });
            for (const storageKey of keys) {
                const character = characters.find(c => c?.avatar === storageKey) || characters.find(c => c?.name === storageKey);
                entries.push({ def, base: { ...base, character: text(character?.name) || 'Unresolved character' }, storageKey });
            }
        }
        if (entries.length > 512) fail('SOURCE_TOO_LARGE');
    }
    const directory = entries.map(e => [e.base, e.storageKey]);
    if (!selector) return result({ scope: 'chat', origin: 'stored-memory', persistence: 'unknown', logWindow: store.log.length,
        note: 'Each id is one variable definition; character items are separate stored values, not duplicate definitions. Read item:N for its value and recent attempts. Current definitions do not prove historical reasons. Log is bounded.',
        definitions: store.defs.map(def => ({ id: def.id,
            unknownCharacterTargetAttempts: def.scope === 'character' ? store.log.filter(log => object(log) && log.id === def.id && log.outcomeCode === 'unknown_character_target').length : 0 })),
        items: entries.map((e, i) => ({ selector: 'item:' + i, ...e.base })) }, directory);
    const i = index(selector, 'item', entries.length), e = entries[i];
    const bucket = e.def.scope === 'global' ? store.values.global : store.values.character?.[e.def.id];
    if (bucket !== undefined && !object(bucket)) fail('SOURCE_UNSUPPORTED');
    const present = !!bucket && Object.hasOwn(bucket, e.storageKey);
    const attempts = store.log.filter(log => object(log) && log.id === e.def.id && (e.def.scope === 'global' || (e.storageKey && log.target === e.storageKey)));
    const unresolvedTargetAttempts = e.def.scope === 'character' ? store.log.filter(log => object(log) && log.id === e.def.id && log.outcomeCode === 'unknown_character_target').length : 0;
    const recent = attempts.slice(-20).map(log => ({
        ignored: log.ignored === true,
        outcomeCode: ['locked', 'auto_update_disabled', 'unknown_character_target'].includes(log.outcomeCode) ? log.outcomeCode : 'unrecorded',
        source: text(log.source).slice(0, 80), time: text(log.time).slice(0, 40),
        ...(Number.isSafeInteger(log.messageId) ? { messageId: log.messageId } : {}),
        messageHash: text(log.messageHash).slice(0, 80),
        reportedReason: text(log.reason).slice(0, 300),
    }));
    const defaultValue = Object.hasOwn(e.def, 'defaultValue') ? e.def.defaultValue : e.def.value;
    return result({ ...e.base,
        definition: { autoUpdate: e.def.autoUpdate !== false, locked: e.def.locked === true,
            updateMode: ['replace', 'append', 'merge', 'delta'].includes(e.def.updateMode) ? e.def.updateMode : 'replace',
            min: Number.isFinite(e.def.min) ? e.def.min : null, max: Number.isFinite(e.def.max) ? e.def.max : null,
            rulePresent: !!(text(e.def.rule) || text(e.def.ruleZh)) },
        ...(defaultValue === undefined ? { defaultState: 'not_recorded' } : { defaultValue: json(defaultValue) }),
        stored: present ? { state: 'stored', value: json(bucket[e.storageKey]) } : { state: 'missing' },
        recentAttempts: recent, attemptsInWindow: attempts.length,
        unresolvedTarget: { outcomeCode: 'unknown_character_target', attemptsForDefinition: unresolvedTargetAttempts,
            scope: 'definition-wide',
            resolutionRule: 'Only active characters are eligible. Avatar keys match exactly; names match exactly or case-insensitively after trimming.',
            note: 'The attempted target did not resolve to a character. No role received this attempt. Raw target is omitted; typo, inactive role and other causes cannot be distinguished.' },
        logWindow: store.log.length,
        note: 'Character items are stored values of one variable definition, not duplicate definitions. Stored value and default are separate; effective value is not evaluated. reportedReason is untrusted input. unrecorded means historical host reason is unknown. Current definition does not establish past settings.'
    }, directory, directory[i], attempts.length > 20 || store.log.length >= 100);
}

/** Saved signals are evidence, not a recomputed execution/progress claim. */
export function readBlueprint(selector, ctx, key, settings) {
    if (!settings.storyBlueprintEnabled) fail('SOURCE_DISABLED');
    const state = peekBlueprintState(ctx.chatMetadata, key);
    if (state === undefined || state?.blueprint === null) return selector ? fail('INVALID_SELECTOR') : { text: '', limited: false };
    const bp = state?.blueprint;
    if (!object(bp) || !Array.isArray(bp.nodes) || !Array.isArray(state.doneSignals)) fail('SOURCE_UNSUPPORTED');
    if (state.doneSignals.length > 1024) fail('SOURCE_TOO_LARGE');
    const nodes = [], ancestors = new Set(), ids = new Set();
    function walk(list, parent, depth) {
        if (depth > 16 || list.length > 512) fail('SOURCE_TOO_LARGE');
        for (const node of list) {
            if (!object(node) || ancestors.has(node) || typeof node.id !== 'string' || ids.has(node.id) || !Array.isArray(node.children)) fail('SOURCE_UNSUPPORTED');
            if (nodes.length >= 512) fail('SOURCE_TOO_LARGE');
            ids.add(node.id); ancestors.add(node);
            const i = nodes.length; nodes.push({ node, parent }); walk(node.children, i, depth + 1); ancestors.delete(node);
        }
    }
    walk(bp.nodes, -1, 0);
    const directory = nodes.map(({ node, parent }) => ({ id: node.id, title: text(node.title), type: text(node.type), parent }));
    if (!selector) return result({ title: text(bp.title), scope: 'chat', origin: 'stored-memory', persistence: 'unknown', savedSignalCount: state.doneSignals.length, note: 'Saved signals are not validated execution or current progress. Custom root metadata omitted.', nodes: directory.map((n, i) => ({ selector: 'node:' + i, ...n })) }, directory, undefined, true);
    const i = index(selector, 'node', nodes.length), node = nodes[i].node;
    const signals = state.doneSignals.filter(s => object(s) && s.nodeId === node.id).map(s => ({ nodeId: s.nodeId, ...(Number.isSafeInteger(s.stepIndex) ? { stepIndex: s.stepIndex } : {}), ...(Number.isSafeInteger(s.chatLength) ? { chatLength: s.chatLength } : {}) }));
    return result({ ...directory[i], content: json(node.content), children: nodes.flatMap((n, j) => n.parent === i ? ['node:' + j] : []), savedSignals: signals, note: 'Raw saved signals, not execution confirmation; no pruning performed. Extra node fields omitted.' }, directory, node.id, Object.keys(node).some(k => !['id', 'title', 'type', 'content', 'children'].includes(k)));
}
