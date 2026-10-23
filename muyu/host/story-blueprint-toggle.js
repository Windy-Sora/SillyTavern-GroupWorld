import { randomUUID } from '../runtime/crypto.js';
import { copyJson, jsonKey } from '../core/json-contract.js';
import { slugifyId } from '../../systems/variable-system.js';

// One chat-local completion signal plus one global switch, never a whole-store restore.
export function createStoryBlueprintTogglePort({ getTarget, getMetadata, getSettings, extensionKey, saveChatConfirmed, changed = () => {} }) {
    const plans = new Map(), applied = new Map();
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    function inspect(target) {
        if (target?.kind !== 'chat' || jsonKey(target) !== jsonKey(getTarget())) throw Error('TARGET_UNAVAILABLE');
        const settings = getSettings(), metadata = getMetadata(), id = settings?.storyBlueprintCompletionVariable;
        // Require the same canonical spelling that runtime variableId resolves; do not reset a different raw key.
        if (!object(metadata) || typeof id !== 'string' || !/^[a-z0-9](?:[a-z0-9_]{0,62}[a-z0-9])?$/.test(id) || ['constructor', 'prototype'].includes(id)) throw Error('INVALID_COMPLETION_VARIABLE');
        const root = metadata[extensionKey], vars = root?.variables;
        if (root !== undefined && !object(root) || vars !== undefined && (!object(vars) || !Array.isArray(vars.defs) || !object(vars.values) ||
            !object(vars.values.global) || !object(vars.values.character) || vars.log !== undefined && !Array.isArray(vars.log))) throw Error('UNSUPPORTED_VARIABLE_STORE');
        const defs = vars?.defs.filter(def => slugifyId(def?.id) === id) || [], definition = defs[0];
        const hasValue = Object.hasOwn(vars?.values.global || {}, id), value = hasValue ? vars.values.global[id] : null;
        if (defs.length > 1 || definition && (definition.id !== id || definition.type !== 'boolean' || definition.scope !== 'global' || definition.locked ||
            definition.owner && definition.owner !== 'group-director-story-blueprint' || settings.storyBlueprintCompletionVariableGuard === id && definition.owner !== 'group-director-story-blueprint') ||
            hasValue && typeof value !== 'boolean' || definition?.defaultValue !== undefined && typeof definition.defaultValue !== 'boolean' ||
            !definition && (hasValue || Object.hasOwn(vars?.values.character || {}, id))) throw Error('COMPLETION_VARIABLE_CONFLICT');
        const snapshot = copyJson({ definition: definition || null, hasValue, value, guard: settings.storyBlueprintCompletionVariableGuard || '' });
        return { metadata, vars, definition, snapshot, id };
    }
    function current(plan) {
        const stored = plans.get(plan?.id);
        if (!stored || jsonKey(stored.plan) !== jsonKey(plan)) throw Error('STALE_BLUEPRINT_PREVIEW');
        const state = inspect(plan.target);
        if (state.metadata !== stored.metadata || state.vars !== stored.vars || state.id !== plan.variableId ||
            jsonKey(state.snapshot) !== jsonKey(stored.snapshot)) throw Error('STALE_BLUEPRINT_PREVIEW');
        return state;
    }
    return Object.freeze({
        plan(target, enabled) {
            if (typeof enabled !== 'boolean') throw Error('INVALID_BLUEPRINT_TOGGLE');
            const state = inspect(target);
            const plan = copyJson({ id: 'blueprint-toggle:' + randomUUID(), target, enabled, variableId: state.id,
                operation: state.definition ? 'reset' : enabled ? 'create' : 'none',
                before: { exists: !!state.definition, stored: state.snapshot.hasValue, value: state.snapshot.value },
                enableAutoUpdate: !!(enabled && state.definition && state.definition.autoUpdate === false),
                useManualInjection: !!(enabled && state.definition && state.definition.injectMode !== 'manual') });
            if (plans.size >= 64) plans.delete(plans.keys().next().value);
            plans.set(plan.id, { plan: copyJson(plan), ...state });
            return plan;
        },
        assertFresh(plan) { current(plan); },
        async apply(plan) {
            if (typeof saveChatConfirmed !== 'function') throw Error('WRITE_UNAVAILABLE');
            const state = current(plan);
            plans.delete(plan.id);
            if (applied.size >= 64) applied.delete(applied.keys().next().value);
            if (plan.operation === 'none') { applied.set(plan.id, state); return { chatSave: 'not_needed', saveError: false, changed: false }; }
            const { metadata } = state;
            if (!metadata[extensionKey]) metadata[extensionKey] = {};
            const root = metadata[extensionKey];
            if (!root.variables) root.variables = { defs: [], values: { global: {}, character: {} }, log: [] };
            const vars = root.variables;
            if (!state.definition) vars.defs.push({ id: plan.variableId, label: 'Story Chapter Done', labelZh: '故事蓝图当前块完成',
                scope: 'global', type: 'boolean', defaultValue: false, autoUpdate: true, injectMode: 'manual', updateMode: 'replace',
                rule: 'Set to true only when the current Story Blueprint step is complete.', ruleZh: '仅当当前故事蓝图推进块完成时设为 true。',
                showInDashboard: true, locked: false, owner: 'group-director-story-blueprint' });
            else if (plan.enableAutoUpdate || plan.useManualInjection) { state.definition.autoUpdate = true; state.definition.injectMode = 'manual'; }
            vars.values.global[plan.variableId] = false;
            // Same bounded history shape as the variable system, without triggering an unawaited save.
            if (!vars.log) vars.log = [];
            vars.log.push({ id: plan.variableId, scope: 'global', target: null, oldValue: state.snapshot.value ?? state.definition?.defaultValue ?? false, newValue: false,
                reason: plan.enabled ? 'enabled-reset' : 'disabled-reset', source: 'story-blueprint', ignored: false,
                messageId: -1, chatLength: 0, messageHash: '', time: new Date().toISOString() });
            if (vars.log.length > 100) vars.log.splice(0, vars.log.length - 100);
            const expected = inspect(plan.target).snapshot;
            applied.set(plan.id, { metadata, vars, snapshot: expected });
            try { changed(); } catch { /* UI observers do not control persistence. */ }
            let saveError = false;
            try { await saveChatConfirmed(metadata); } catch { saveError = true; }
            let stale = true;
            try { const after = inspect(plan.target); stale = after.metadata !== metadata || after.vars !== vars || jsonKey(after.snapshot) !== jsonKey(expected); } catch { /* Target changed or verification unavailable. */ }
            return { chatSave: saveError ? 'unknown' : 'confirmed', saveError, changed: stale };
        },
        // Recheck after the async return boundary too, including the no-save path.
        finish(plan) {
            const expected = applied.get(plan.id); applied.delete(plan.id);
            try { const state = inspect(plan.target); return !!expected && state.metadata === expected.metadata && state.vars === expected.vars && jsonKey(state.snapshot) === jsonKey(expected.snapshot); }
            catch { return false; }
        },
        forget(plan) { if (plan?.id) { plans.delete(plan.id); applied.delete(plan.id); } },
        clear() { plans.clear(); applied.clear(); },
    });
}
