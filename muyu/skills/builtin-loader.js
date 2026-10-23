import { BUILTIN_SKILL_MANIFEST } from './builtin-manifest.js';
import { SKILL_LIMITS, parseSkillMarkdown, skillBytes, validateSkillPackage } from './contract.js';

const base = new URL('../../assets/muyu-skills/', import.meta.url);
async function readStaticText(path, { signal } = {}) {
    const response = await fetch(new URL(path, base), { signal, redirect: 'error' });
    if (!response.ok || !response.body) throw Error('SKILL_RESOURCE_UNAVAILABLE');
    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0, text = '';
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > SKILL_LIMITS.fileBytes) throw Error('SKILL_CAPACITY');
            text += decoder.decode(value, { stream: true });
        }
        return text + decoder.decode();
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Only the shipped manifest can choose paths. No user URL, directory scan or execution.
 * Injectable reader is a trusted host/testing port, not a model capability.
 */
export async function loadBuiltinSkills({ readText = readStaticText, signal } = {}) {
    const result = [];
    for (const item of BUILTIN_SKILL_MANIFEST) {
        const files = [];
        for (const path of item.files) {
            signal?.throwIfAborted();
            const text = await readText(`${item.name}/${path}`, { signal });
            signal?.throwIfAborted();
            if (typeof text !== 'string' || skillBytes(text) > SKILL_LIMITS.fileBytes) throw Error('SKILL_CAPACITY');
            files.push({ path, text });
        }
        const pack = validateSkillPackage({ format: 'muyu-skill-package', version: 1, files });
        if (parseSkillMarkdown(files.find(file => file.path === 'SKILL.md').text).name !== item.name) throw Error('SKILL_IDENTITY_CHANGE');
        result.push({ revision: item.revision, package: pack });
    }
    return result;
}
