const record = v => v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const closed = (v, keys) => record(v) && Object.keys(v).every(k => keys.includes(k));
const text = (v, max) => typeof v === 'string' && v.length <= max;
/** Pure supported subset of npc-export v1; never reads current chat or renders Prompt. */
export function validateNpcLibraryDefinition(value) {
    if (!closed(value, ['name','description','exportData']) || !text(value.name,80) || !value.name.trim() || !text(value.description,1000)) throw Error('INVALID_LIBRARY_DRAFT');
    const data = value.exportData;
    if (!closed(data,['version','type','exportedAt','source','template','libraryMeta','npcs']) || data.type !== 'npc-export' || data.version !== 1
        || !Array.isArray(data.npcs) || !data.npcs.length || data.npcs.length > 64) throw Error('INVALID_LIBRARY_DRAFT');
    if (data.exportedAt !== undefined && !text(data.exportedAt,100)) throw Error('INVALID_LIBRARY_DRAFT');
    if (data.source !== undefined && (!closed(data.source,['groupName','groupNote']) || Object.values(data.source).some(v=>!text(v,1000)))) throw Error('INVALID_LIBRARY_DRAFT');
    if (!closed(data.template,['npcPrompt']) || !text(data.template.npcPrompt,12000)) throw Error('INVALID_LIBRARY_DRAFT');
    if (data.libraryMeta !== undefined && (!closed(data.libraryMeta,['name','description','createdAt','updatedAt'])
        || ['name','description'].some(k=>data.libraryMeta[k] !== undefined && !text(data.libraryMeta[k],1000))
        || ['createdAt','updatedAt'].some(k=>data.libraryMeta[k] !== undefined && (!Number.isSafeInteger(data.libraryMeta[k]) || data.libraryMeta[k]<0)))) throw Error('INVALID_LIBRARY_DRAFT');
    const names = new Set();
    for (const npc of data.npcs) {
        if (!closed(npc,['name','description','personality','scenario','first_mes']) || !text(npc.name,256) || !npc.name.trim() || npc.name !== npc.name.trim()
            || names.has(npc.name.toLowerCase()) || ['description','personality','scenario','first_mes'].some(k=>npc[k] !== undefined && !text(npc[k],12000))) throw Error('INVALID_LIBRARY_DRAFT');
        names.add(npc.name.toLowerCase());
    }
    return value;
}
