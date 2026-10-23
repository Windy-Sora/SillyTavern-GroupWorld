import { validateExportFormat } from './profile-export-system.js';
const record = v => v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const closed = (v, keys) => record(v) && Object.keys(v).every(k => keys.includes(k));
const text = (v, max) => typeof v === 'string' && v.length <= max;
/** Strict asset editing subset; never reads chat profiles or evaluates templates. */
export function validateProfileLibraryDefinition(value) {
    if (!closed(value, ['name','description','exportData']) || !text(value.name,80) || !value.name.trim() || !text(value.description,1000)) throw Error('INVALID_LIBRARY_DRAFT');
    const data = value.exportData;
    if (!validateExportFormat(data).ok || data.version !== 1 || !closed(data,['version','type','exportedAt','source','template','libraryMeta','profiles'])
        || !data.profiles.length || data.profiles.length > 64) throw Error('INVALID_LIBRARY_DRAFT');
    if (data.exportedAt !== undefined && !text(data.exportedAt,100)) throw Error('INVALID_LIBRARY_DRAFT');
    if (data.source !== undefined && (!closed(data.source,['groupName','groupNote']) || Object.values(data.source).some(v=>!text(v,1000)))) throw Error('INVALID_LIBRARY_DRAFT');
    if (!closed(data.template,['generatorPrompt','jsonSchema','renderTemplate']) || ['generatorPrompt','jsonSchema','renderTemplate'].some(k=>!text(data.template[k],12000))) throw Error('INVALID_LIBRARY_DRAFT');
    if (data.libraryMeta !== undefined && (!closed(data.libraryMeta,['version','name','description','createdAt','updatedAt'])
        || data.libraryMeta.version !== undefined && data.libraryMeta.version !== 1
        || ['name','description'].some(k=>data.libraryMeta[k] !== undefined && !text(data.libraryMeta[k],1000))
        || ['createdAt','updatedAt'].some(k=>data.libraryMeta[k] !== undefined && (!Number.isSafeInteger(data.libraryMeta[k]) || data.libraryMeta[k]<0)))) throw Error('INVALID_LIBRARY_DRAFT');
    const avatars = new Set();
    for (const p of data.profiles) {
        if (!closed(p,['avatar','name','hash','profile']) || !text(p.avatar,256) || !p.avatar || avatars.has(p.avatar)
            || !text(p.name,256) || !p.name || (p.hash !== undefined && !text(p.hash,256)) || !record(p.profile)) throw Error('INVALID_LIBRARY_DRAFT');
        avatars.add(p.avatar);
    }
    return value;
}
