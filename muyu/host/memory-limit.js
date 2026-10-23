import { randomUUID } from '../runtime/crypto.js';
import { copyJson, jsonKey } from '../core/json-contract.js';

/** Private, page-local evidence. Raw memories never enter model tools or artifacts. */
export function createMemoryLimitPort({ getTarget, getMetadata, extensionKey, memorySystem, changed = () => {} }) {
    const plans = new Map();
    function inspect(target, max) {
        if (target?.kind !== 'chat' || jsonKey(getTarget()) !== jsonKey(target)) throw Error('TARGET_UNAVAILABLE');
        const metadata = getMetadata();
        if (!metadata || typeof metadata !== 'object') throw Error('TARGET_UNAVAILABLE');
        const store = metadata[extensionKey]?.charMemories;
        if (store !== undefined && (!store || typeof store !== 'object' || Array.isArray(store))) throw Error('UNSUPPORTED_MEMORY_STORE');
        const entries = Object.entries(store || {});
        if (entries.length > 128 || entries.some(([, value]) => !Array.isArray(value))) throw Error('MEMORY_PREVIEW_LIMIT');
        const counts = entries.map(([, memories], index) => ({ slot: index + 1, before: memories.length, remove: Math.max(0, memories.length - max) }));
        const serialized = JSON.stringify(store || {});
        if (serialized === undefined || serialized.length > 2_000_000) throw Error('MEMORY_PREVIEW_LIMIT');
        if (jsonKey(getTarget()) !== jsonKey(target) || getMetadata() !== metadata || JSON.stringify(store || {}) !== serialized) throw Error('STALE_MEMORY_PREVIEW');
        const expectedAfter = JSON.stringify(Object.fromEntries(entries.map(([avatar, memories]) => [avatar, memories.slice(-max)])));
        return { metadata, serialized, expectedAfter, counts, total: counts.reduce((sum, row) => sum + row.remove, 0) };
    }
    function current(plan) {
        const privatePlan = plans.get(plan?.id);
        if (!privatePlan || jsonKey(privatePlan.public) !== jsonKey(plan)) throw Error('STALE_MEMORY_PREVIEW');
        const evidence = inspect(plan.target, plan.max);
        if (evidence.metadata !== privatePlan.metadata || evidence.serialized !== privatePlan.serialized) throw Error('STALE_MEMORY_PREVIEW');
        return evidence;
    }
    return Object.freeze({
        plan(target, max) {
            if (!Number.isSafeInteger(max) || max < 10 || max > 2000) throw Error('INVALID_MEMORY_LIMIT');
            // Old unpublished drafts become stale rather than exhausting the port.
            if (plans.size >= 64) plans.delete(plans.keys().next().value);
            const evidence = inspect(target, max);
            const publicPlan = copyJson({ id: 'memory-limit:' + randomUUID(), target, max, counts: evidence.counts.filter(row => row.remove > 0), total: evidence.total });
            plans.set(publicPlan.id, { public: publicPlan, metadata: evidence.metadata, serialized: evidence.serialized, expectedAfter: evidence.expectedAfter });
            return publicPlan;
        },
        assertFresh(plan) { current(plan); },
        async prune(plan) {
            current(plan);
            if (!plan.total) { plans.delete(plan.id); return { status: 'not_needed', removed: 0 }; }
            if (memorySystem.isPruning?.()) return { status: 'skipped', removed: 0 };
            try {
                await memorySystem.pruneAfter();
                const privatePlan = plans.get(plan.id);
                const actual = JSON.stringify(privatePlan?.metadata?.[extensionKey]?.charMemories || {});
                const status = jsonKey(getTarget()) === jsonKey(plan.target) && getMetadata() === privatePlan?.metadata && actual === privatePlan?.expectedAfter ? 'pruned' : 'outcome_unknown';
                if (status === 'pruned') { try { changed(); } catch { /* The view cannot alter the result. */ } }
                return { status, removed: status === 'pruned' ? plan.total : 0 };
            } catch {
                return { status: 'outcome_unknown', removed: 0 };
            } finally { plans.delete(plan.id); }
        },
        forget(plan) { if (plan?.id) plans.delete(plan.id); },
        clear() { plans.clear(); },
    });
}
