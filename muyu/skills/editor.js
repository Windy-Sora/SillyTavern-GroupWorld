import { parseSkillMarkdown, skillArray, skillKeys, validateSkillPackage } from './contract.js';

/** Form / model DTO to document package. Metadata is JSON-quoted, never YAML-interpolated. */
export function skillEditorPackage(fields, previous = null) {
    const allowed = ['name', 'displayName', 'description', 'body', 'contentVersion', 'modelInvocable', 'userInvocable', 'resources'];
    if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).some(key => !allowed.includes(key))) throw Error('SKILL_INVALID');
    skillKeys(fields, Object.keys(fields));
    const meta = previous ? parseSkillMarkdown(previous.files.find(file => file.path === 'SKILL.md').text) : {};
    const value = { displayName: fields.name ?? meta.name, contentVersion: '', modelInvocable: true, userInvocable: true, ...meta, ...fields };
    if (typeof value.modelInvocable !== 'boolean' || typeof value.userInvocable !== 'boolean' || typeof value.body !== 'string') throw Error('SKILL_INVALID');
    const pairs = [['name', value.name], ['display-name', value.displayName], ['description', value.description], ['version', value.contentVersion], ['disable-model-invocation', String(!value.modelInvocable)], ['user-invocable', String(value.userInvocable)]];
    if (pairs.some(([, text]) => typeof text !== 'string')) throw Error('SKILL_INVALID');
    const text = '---\n' + pairs.map(([key, val]) => `${key}: ${JSON.stringify(val)}`).join('\n') + '\n---\n' + value.body;
    const resources = fields.resources ?? previous?.files.filter(file => file.path !== 'SKILL.md') ?? [];
    skillArray(resources, 31);
    for (const resource of resources) skillKeys(resource, ['path', 'text']);
    return validateSkillPackage({ format: 'muyu-skill-package', version: 1, files: [{ path: 'SKILL.md', text }, ...resources] });
}
