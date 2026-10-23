import { randomUUID } from '../runtime/crypto.js';
import { copyJson, jsonKey } from '../core/json-contract.js';
import { slugifyId } from '../../systems/variable-system.js';

// The plan contains no variable values or definitions. It is tied to one chat
// and to the original setting; another chat cannot spend its approval.
export function createStoryCompletionVariablePort({ getTarget, getMetadata, getSettings, extensionKey, saveChatConfirmed }) {
    const plans = new Map();
    function inspect(target, newId, oldId) {
        if (target?.kind !== 'chat' || jsonKey(getTarget()) !== jsonKey(target)) throw Error('TARGET_UNAVAILABLE');
        const metadata = getMetadata();
        if (!metadata || typeof metadata !== 'object' || getSettings()?.storyBlueprintCompletionVariable !== oldId) throw Error('STALE_BASELINE');
        const vars = metadata[extensionKey]?.variables;
        if (vars !== undefined && (!vars || typeof vars !== 'object' || Array.isArray(vars) || !Array.isArray(vars.defs) ||
            !vars.values || typeof vars.values !== 'object' || Array.isArray(vars.values) ||
            !vars.values.global || typeof vars.values.global !== 'object' || Array.isArray(vars.values.global) ||
            !vars.values.character || typeof vars.values.character !== 'object' || Array.isArray(vars.values.character) ||
            (vars.log !== undefined && !Array.isArray(vars.log)))) throw Error('UNSUPPORTED_VARIABLE_STORE');
        if (vars?.defs.some(def => slugifyId(def?.id) === newId) || vars?.log?.some(entry => entry?.id === newId) || Object.hasOwn(vars?.values?.global || {}, newId) ||
            Object.hasOwn(vars?.values?.character || {}, newId)) throw Error('COMPLETION_VARIABLE_OCCUPIED');
        if (getMetadata() !== metadata || jsonKey(getTarget()) !== jsonKey(target)) throw Error('TARGET_UNAVAILABLE');
        return { metadata, vars };
    }
    function current(plan) {
        const privatePlan = plans.get(plan?.id);
        if (!privatePlan || jsonKey(privatePlan.public) !== jsonKey(plan)) throw Error('STALE_COMPLETION_PREVIEW');
        const evidence = inspect(plan.target, plan.newId, plan.oldId);
        if (evidence.metadata !== privatePlan.metadata) throw Error('STALE_COMPLETION_PREVIEW');
        return evidence;
    }
    return Object.freeze({
        plan(target, oldId, newId) {
            if (typeof oldId !== 'string' || !/^[a-z0-9_]{1,64}$/.test(newId) ||
                ['__proto__', 'constructor', 'prototype'].includes(newId) || oldId === newId) throw Error('INVALID_COMPLETION_VARIABLE');
            if (plans.size >= 64) plans.delete(plans.keys().next().value);
            const evidence = inspect(target, newId, oldId);
            const publicPlan = copyJson({ id: 'story-variable:' + randomUUID(), target, oldId, newId });
            plans.set(publicPlan.id, { public: publicPlan, metadata: evidence.metadata });
            return publicPlan;
        },
        assertFresh(plan) { current(plan); },
        async create(plan) {
            const { metadata } = current(plan);
            // No await between the final check and the bounded mutation.
            if (!metadata[extensionKey]) metadata[extensionKey] = {};
            const root = metadata[extensionKey];
            if (!root.variables) root.variables = { defs: [], values: { global: {}, character: {} }, log: [] };
            const vars = root.variables;
            const definition = { id: plan.newId, label: 'Story Chapter Done', labelZh: '故事蓝图当前块完成', scope: 'global', type: 'boolean',
                defaultValue: false, rule: 'Set to true only when the current Story Blueprint step is complete.',
                ruleZh: '仅当当前故事蓝图推进块完成时设为 true。', autoUpdate: true, injectMode: 'manual',
                updateMode: 'replace', showInDashboard: true, locked: false, owner: 'group-director-story-blueprint' };
            vars.defs.push(definition);
            vars.values.global[plan.newId] = false;
            plans.delete(plan.id);
            await saveChatConfirmed(metadata);
            if (getMetadata() !== metadata || jsonKey(getTarget()) !== jsonKey(plan.target)) throw Error('TARGET_UNAVAILABLE');
            if (metadata[extensionKey]?.variables !== vars || !vars.defs.includes(definition) ||
                vars.values.global[plan.newId] !== false) throw Error('STALE_COMPLETION_PREVIEW');
            return { status: 'confirmed' };
        },
        forget(plan) { if (plan?.id) plans.delete(plan.id); },
        clear() { plans.clear(); },
    });
}
