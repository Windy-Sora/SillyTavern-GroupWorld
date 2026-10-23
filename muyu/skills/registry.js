import { parseSkillMarkdown, skillCopy, skillPath, validateSkillData, validateSkillPackage, validateSkillRecord } from './contract.js';

const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function entry(record, source) {
    const meta = parseSkillMarkdown(record.package.files.find(file => file.path === 'SKILL.md').text);
    return { id: record.id, revision: record.revision, source, enabled: record.enabled, name: meta.name, displayName: meta.displayName, description: meta.description,
        contentVersion: meta.contentVersion, modelInvocable: record.enabled && meta.modelInvocable, userInvocable: record.enabled && meta.userInvocable };
}
/** Builtins and user packages never shadow each other. No global side effects or execution. */
export function createSkillRegistry({ builtins = [], store }) {
    if (!Array.isArray(builtins) || builtins.length > 128 || !store || typeof store.read !== 'function') throw Error('SKILL_INVALID');
    const fixed = builtins.map(value => {
        const pack = validateSkillPackage(value.package ?? value), meta = parseSkillMarkdown(pack.files.find(file => file.path === 'SKILL.md').text);
        const contentRevision = value.package ? value.revision : 1;
        if (!Number.isSafeInteger(contentRevision) || contentRevision < 1) throw Error('SKILL_VERSION');
        return freeze({ id: `builtin:${meta.name}`, revision: contentRevision, enabled: true, package: pack });
    });
    if (new Set(fixed.map(row => row.id)).size !== fixed.length) throw Error('SKILL_DUPLICATE');
    const rows = async () => {
        const data = validateSkillData(await store.read());
        return [...fixed.map(record => {
            const policy = data.builtinPolicies.find(row => row.id === record.id);
            return { record: { ...record, revision: `${record.revision}:${policy?.revision ?? 0}`, enabled: data.enabled && (policy?.enabled ?? true) }, source: 'builtin' };
        }), ...data.skills.map(row => ({ record: { ...validateSkillRecord(row), enabled: data.enabled && row.enabled }, source: 'user' }))];
    };
    return Object.freeze({
        async list() { return (await rows()).map(({ record, source }) => entry(record, source)); },
        async inspect({ id, revision }) {
            const row = (await rows()).find(row => row.record.id === id);
            if (!row) throw Error('SKILL_NOT_FOUND');
            if (row.record.revision !== revision) throw Error('SKILL_STALE');
            return freeze({ ...entry(row.record, row.source), package: skillCopy(row.record.package) });
        },
        async snapshot({ id, revision, invocation }) {
            if (!['model', 'user'].includes(invocation)) throw Error('SKILL_INVALID_INVOCATION');
            const row = (await rows()).find(row => row.record.id === id);
            if (!row) throw Error('SKILL_NOT_FOUND');
            if (row.record.revision !== revision) throw Error('SKILL_STALE');
            const summary = entry(row.record, row.source);
            if (!(invocation === 'model' ? summary.modelInvocable : summary.userInvocable)) throw Error('SKILL_DISABLED');
            return freeze({ ...summary, package: skillCopy(row.record.package) });
        },
        resource(snapshot, path = 'SKILL.md') {
            skillPath(path);
            // Snapshots contain document data only and confer no authorization.
            const pack = validateSkillPackage(snapshot.package);
            const resource = pack.files.find(file => file.path === path);
            if (!resource) throw Error('SKILL_RESOURCE_NOT_FOUND');
            return resource.text;
        },
    });
}
