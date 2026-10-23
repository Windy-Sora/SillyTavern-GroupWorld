import { exportSkillPackage, parseSkillMarkdown, skillCopy, validateSkillPackage } from './contract.js';
import { createSkillRegistry } from './registry.js';

/** Shared application port. Callers must establish user intent/approval before writes.
 * This service is not a model tool and does not confer authorization.
 */
export function createSkillManagement({ store, builtins = [] }) {
    const registry = createSkillRegistry({ store, builtins });
    const userOnly = id => { if (typeof id !== 'string' || !id.startsWith('user:')) throw Error('SKILL_READ_ONLY'); };
    async function baseline(id, revision, expectedRevision) {
        const data = await store.read();
        if (data.revision !== expectedRevision) throw Error('SKILL_STALE');
        const snapshot = await registry.inspect({ id, revision });
        return { data, snapshot };
    }
    return Object.freeze({
        registry,
        async list() {
            // Retry-free consistency: never hand an editor mismatched catalog/store revisions.
            const data = await store.read(), entries = await registry.list(), after = await store.read();
            if (data.revision !== after.revision) throw Error('SKILL_STALE');
            return { revision: data.revision, enabled: data.enabled, entries };
        },
        read: query => registry.inspect(query),
        async export(query) { return exportSkillPackage((await registry.inspect(query)).package); },
        create(input, { enabled = false, expectedRevision } = {}) {
            if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw Error('SKILL_INVALID');
            return store.create(input, enabled, expectedRevision);
        },
        async update(id, revision, input, expectedRevision) {
            userOnly(id);
            const pack = validateSkillPackage(input);
            await baseline(id, revision, expectedRevision);
            return store.update(id, revision, pack, expectedRevision);
        },
        async remove(id, revision, expectedRevision) {
            userOnly(id); await baseline(id, revision, expectedRevision);
            return store.remove(id, revision, expectedRevision);
        },
        async setEnabled(id, revision, enabled, expectedRevision) {
            const { data } = await baseline(id, revision, expectedRevision);
            if (id.startsWith('builtin:')) return store.setBuiltinEnabled(id, data.builtinPolicies.find(row => row.id === id)?.revision ?? 0, enabled, expectedRevision);
            userOnly(id); return store.setEnabled(id, revision, enabled, expectedRevision);
        },
        setFeatureEnabled: (revision, enabled) => store.setFeatureEnabled(revision, enabled),
        async copy(id, revision, newName, { enabled = false, expectedRevision } = {}) {
            // Copy the complete exact package, including supporting resources.
            const { snapshot } = await baseline(id, revision, expectedRevision);
            if (typeof newName !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(newName) || newName.length > 64) throw Error('SKILL_INVALID');
            const pack = skillCopy(snapshot.package), main = pack.files.find(file => file.path === 'SKILL.md');
            main.text = main.text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
            const end = main.text.indexOf('\n---\n', 4);
            main.text = main.text.slice(0, end).replace(/^name:.*$/m, `name: ${newName}`) + main.text.slice(end);
            if (parseSkillMarkdown(main.text).name !== newName) throw Error('SKILL_IDENTITY_CHANGE');
            return store.create(validateSkillPackage(pack), enabled, expectedRevision);
        },
    });
}
