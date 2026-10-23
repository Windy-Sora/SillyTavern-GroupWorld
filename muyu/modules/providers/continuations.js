import { randomUUID } from '../../runtime/crypto.js';
import { jsonKey } from '../../core/json-contract.js';

/** Run-local references to host-generated read arguments, never permissions. */
export function createReadContinuations() {
    const entries = new Map();
    return {
        issue(args, target) {
            const targetKey = jsonKey(target);
            for (const [token, entry] of entries) {
                if (entry.target === targetKey && jsonKey(entry.args) === jsonKey(args)) return { id: args.id, token };
            }
            if (entries.size >= 128) return null;
            const token = randomUUID();
            entries.set(token, { args: { ...args }, target: targetKey });
            return { id: args.id, token };
        },
        resolve(id, token, target) {
            const entry = entries.get(token);
            return entry && entry.args.id === id && entry.target === jsonKey(target) ? { ...entry.args } : null;
        },
    };
}
