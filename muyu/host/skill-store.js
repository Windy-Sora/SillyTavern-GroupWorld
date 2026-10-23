import { serializeSettings, waitSettingsWrites } from '../storage/settings-queue.js';
import { parseSkillMarkdown, skillCopy, validateSkillData, validateSkillPackage } from '../skills/contract.js';

/** Account extension settings only; not chat metadata, filesystem storage, or model tools. */
export function createSkillStore({ getSettings, saveSettings }) {
    const owner = getSettings(); let closed = false;
    const live = () => { if (closed || getSettings() !== owner) throw Error('SKILL_STORE_UNAVAILABLE'); };
    const readData = () => { live(); return validateSkillData(owner.muyuSkillData); };
    function mutate(work, expectedRevision) {
        live();
        return serializeSettings(owner, async () => {
            const data = readData();
            if (expectedRevision !== undefined && data.revision !== expectedRevision) throw Error('SKILL_STALE');
            const result = work(data);
            if (data.revision >= Number.MAX_SAFE_INTEGER) throw Error('SKILL_CAPACITY');
            data.revision++;
            const next = validateSkillData(data), previous = owner.muyuSkillData, fingerprint = JSON.stringify(next), savedResult = skillCopy(result);
            const matches = () => { try { return owner.muyuSkillData === next && JSON.stringify(next) === fingerprint; } catch { return false; } };
            owner.muyuSkillData = next;
            try {
                await saveSettings(); live();
                if (!matches()) throw Error('SKILL_CONFLICT');
                return savedResult;
            } catch {
                // A failed or unconfirmed save cannot replace unrelated concurrent data.
                if (matches()) {
                    if (previous === undefined) delete owner.muyuSkillData;
                    else owner.muyuSkillData = previous;
                }
                throw Error('SKILL_SAVE_UNKNOWN');
            }
        });
    }
    const find = (data, id, revision) => {
        const row = data.skills.find(row => row.id === id);
        if (!row || row.revision !== revision) throw Error('SKILL_STALE');
        if (row.revision >= Number.MAX_SAFE_INTEGER) throw Error('SKILL_CAPACITY');
        return row;
    };
    return Object.freeze({
        async read() { await waitSettingsWrites(owner); return readData(); },
        create(input, enabled = false, expectedRevision) {
            if (typeof enabled !== 'boolean') throw Error('SKILL_INVALID');
            const pack = validateSkillPackage(input), meta = parseSkillMarkdown(pack.files.find(file => file.path === 'SKILL.md').text);
            return mutate(data => {
                const id = `user:${meta.name}`;
                if (data.skills.some(row => row.id === id)) throw Error('SKILL_DUPLICATE');
                // The global monotonic revision prevents delete/recreate ABA matches.
                const row = { id, revision: data.revision + 1, enabled, package: pack };
                data.skills.push(row); return row;
            }, expectedRevision);
        },
        update(id, revision, input, expectedRevision) {
            const pack = validateSkillPackage(input), meta = parseSkillMarkdown(pack.files.find(file => file.path === 'SKILL.md').text);
            if (id !== `user:${meta.name}`) throw Error('SKILL_IDENTITY_CHANGE');
            return mutate(data => { const row = find(data, id, revision); row.package = pack; row.revision = data.revision + 1; return row; }, expectedRevision);
        },
        setEnabled(id, revision, enabled, expectedRevision) {
            if (typeof enabled !== 'boolean') throw Error('SKILL_INVALID');
            return mutate(data => { const row = find(data, id, revision); row.enabled = enabled; row.revision = data.revision + 1; return row; }, expectedRevision);
        },
        remove(id, revision, expectedRevision) { return mutate(data => { find(data, id, revision); data.skills = data.skills.filter(row => row.id !== id); return { id, removed: true }; }, expectedRevision); },
        setFeatureEnabled(revision, enabled) {
            if (typeof enabled !== 'boolean') throw Error('SKILL_INVALID');
            return mutate(data => {
                if (data.revision !== revision) throw Error('SKILL_STALE');
                data.enabled = enabled;
                return { enabled, revision: data.revision + 1 };
            });
        },
        setBuiltinEnabled(id, revision, enabled, expectedRevision) {
            if (typeof id !== 'string' || !/^builtin:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || typeof enabled !== 'boolean') throw Error('SKILL_INVALID');
            return mutate(data => {
                const row = data.builtinPolicies.find(row => row.id === id);
                if ((row?.revision ?? 0) !== revision) throw Error('SKILL_STALE');
                const next = { id, revision: data.revision + 1, enabled };
                if (row) Object.assign(row, next); else data.builtinPolicies.push(next);
                return next;
            }, expectedRevision);
        },
        close() { closed = true; },
    });
}
