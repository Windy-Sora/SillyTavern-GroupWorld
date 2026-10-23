import { randomUUID } from '../runtime/crypto.js';
import { copyJson, jsonKey } from '../core/json-contract.js';
import { normalizeDefinition, slugifyId } from '../../systems/variable-system.js';
import { BUNDLE_VARIABLE_SCOPE } from '../config/bundle-policy.js';

const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const editable = ['label', 'rule', 'autoUpdate', 'injectMode', 'updateMode', 'min', 'max', 'showInDashboard'];

/** Read-only, chat-bound preview. This port never invokes the legacy fire-and-forget save methods. */
export function createVariableDraftPort({ getTarget, getMetadata, extensionKey, isBusy = () => false }) {
    const drafts = new Map();
    function inspect(target, id) {
        if (isBusy()) throw Error('VARIABLE_BUSY');
        if (target?.kind !== 'chat' || jsonKey(getTarget()) !== jsonKey(target)) throw Error('TARGET_UNAVAILABLE');
        const metadata = getMetadata();
        if (!metadata || typeof metadata !== 'object') throw Error('TARGET_UNAVAILABLE');
        const vars = metadata[extensionKey]?.variables;
        if (vars !== undefined && (!vars || typeof vars !== 'object' || Array.isArray(vars) || !Array.isArray(vars.defs) ||
            !vars.values || typeof vars.values !== 'object' || Array.isArray(vars.values) ||
            !vars.values.global || typeof vars.values.global !== 'object' || Array.isArray(vars.values.global) ||
            !vars.values.character || typeof vars.values.character !== 'object' || Array.isArray(vars.values.character) ||
            (vars.log !== undefined && !Array.isArray(vars.log)))) throw Error('UNSUPPORTED_VARIABLE_STORE');
        const matching = vars?.defs.filter(def => slugifyId(def?.id) === id) || [];
        if (matching.length > 1) throw Error('VARIABLE_ID_COLLISION');
        const occupied = matching.length || Object.hasOwn(vars?.values?.global || {}, id) ||
            Object.hasOwn(vars?.values?.character || {}, id) || vars?.log?.some(row => row?.id === id);
        const baseline = { definition: matching[0] || null,
            value: Object.hasOwn(vars?.values?.global || {}, id) ? vars.values.global[id] : null, occupied: !!occupied };
        if (getMetadata() !== metadata || jsonKey(getTarget()) !== jsonKey(target)) throw Error('TARGET_UNAVAILABLE');
        return copyJson(baseline);
    }
    function build(target, input) {
        if (!input || !['create', 'update'].includes(input.action)) throw Error('INVALID_VARIABLE_CHANGE');
        const id = input.id;
        if (slugifyId(id) !== id || forbidden.has(id) || !/^[a-z0-9_]{1,64}$/.test(id)) throw Error('INVALID_VARIABLE_ID');
        const baseline = inspect(target, id);
        if (input.action === 'create' ? baseline.occupied : !baseline.definition) throw Error(input.action === 'create' ? 'VARIABLE_ID_COLLISION' : 'VARIABLE_NOT_FOUND');
        if (input.action === 'update' && (baseline.definition.scope !== BUNDLE_VARIABLE_SCOPE || baseline.definition.type !== 'number')) throw Error('UNSUPPORTED_VARIABLE_DEFINITION');
        const patch = Object.fromEntries(editable.filter(key => Object.hasOwn(input, key)).map(key => [key, input[key]]));
        if (input.action === 'create') {
            if (typeof input.label !== 'string' || !input.label.trim() || typeof input.rule !== 'string' || !input.rule.trim() ||
                typeof input.initialValue !== 'number' || !Number.isFinite(input.initialValue) ||
                typeof input.autoUpdate !== 'boolean' || !input.injectMode || !input.updateMode) throw Error('INCOMPLETE_VARIABLE_DRAFT');
        } else if (Object.hasOwn(input, 'initialValue') || !Object.keys(patch).length) throw Error('INVALID_VARIABLE_CHANGE');
        const before = input.action === 'create' ? null : normalizeDefinition(baseline.definition);
        const definition = input.action === 'create' ? {
            id, label: input.label.trim(), labelZh: '', scope: BUNDLE_VARIABLE_SCOPE, type: 'number', defaultValue: input.initialValue,
            rule: input.rule.trim(), ruleZh: '', autoUpdate: input.autoUpdate, injectMode: input.injectMode,
            updateMode: input.updateMode, min: input.min ?? null, max: input.max ?? null,
            enumValues: [], showInDashboard: input.showInDashboard !== false, locked: false, dashboardOrder: 100,
        } : { ...before, ...patch };
        if (!definition.label?.trim() || !definition.rule?.trim() || !['manual', 'always'].includes(definition.injectMode) ||
            !['replace', 'delta'].includes(definition.updateMode) || typeof definition.autoUpdate !== 'boolean' ||
            (definition.min !== null && (!Number.isFinite(definition.min) || definition.min < -1e9 || definition.min > 1e9)) ||
            (definition.max !== null && (!Number.isFinite(definition.max) || definition.max < -1e9 || definition.max > 1e9)) ||
            (definition.min !== null && definition.max !== null && definition.min > definition.max)) throw Error('INVALID_VARIABLE_DEFINITION');
        const value = input.action === 'create' ? input.initialValue : baseline.value ?? baseline.definition.defaultValue;
        if (!Number.isFinite(value) || definition.min !== null && value < definition.min || definition.max !== null && value > definition.max) throw Error('VARIABLE_VALUE_OUT_OF_RANGE');
        const diff = Object.keys(definition).filter(key => key === 'id' || key === 'scope' || key === 'type' || key === 'defaultValue' || editable.includes(key))
            .filter(key => jsonKey(before?.[key] ?? null) !== jsonKey(definition[key]))
            .map(key => ({ field: key, before: before?.[key] ?? null, after: definition[key] }));
        if (!diff.length) throw Error('EMPTY_CHANGES');
        return copyJson({ module: 'variable-draft', version: 1, target, request: input, baseline, definition,
            preview: { action: input.action, id, scope: 'current-chat', value, diff,
                notice: 'Only a preview. No chat variable was changed or saved. Applying this draft requires a separate approval in the UI.' } });
    }
    return Object.freeze({
        inspect: (target, id) => inspect(target, id),
        prepare(target, input) {
            const content = build(target, input), token = 'variable-preview:' + randomUUID();
            if (drafts.size >= 128) drafts.delete(drafts.keys().next().value);
            const result = copyJson({ ...content, token });
            drafts.set(token, { content: result, metadata: getMetadata() });
            return result;
        },
        assertFresh(content) {
            const saved = drafts.get(content?.token);
            if (!saved || saved.metadata !== getMetadata() || jsonKey(saved.content) !== jsonKey(content)) throw Error('STALE_VARIABLE_DRAFT');
            const latest = build(content.target, content.request);
            if (jsonKey(latest) !== jsonKey((({ token, ...rest }) => rest)(content))) throw Error('STALE_VARIABLE_DRAFT');
            return copyJson(content);
        },
        forget(content) { if (content?.token) drafts.delete(content.token); },
        clear() { drafts.clear(); },
    });
}
