/** Assistant notes are not GD character memories, conversation archives or authorization. */
export const NOTE_LIMITS = Object.freeze({ entries: 256, chars: 16000, bytes: 64000, totalBytes: 2 * 1024 * 1024 });
export const noteBytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
export const noteCopy = value => JSON.parse(JSON.stringify(value));
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const keys = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === fields.split(',').sort().join(',');
export function validateNoteInput(input) {
    if (!keys(input, 'title,content,scope') || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 80 ||
        typeof input.content !== 'string' || !input.content.trim() || input.content.length > NOTE_LIMITS.chars || noteBytes(input.content) > NOTE_LIMITS.bytes ||
        !['account', 'chat'].includes(input.scope)) throw Error('NOTE_INVALID');
    // Defense in depth, not a comprehensive secret detector.
    if (/\bsk-[a-zA-Z0-9_-]{16,}|\bBearer\s+[a-zA-Z0-9_.-]{16,}/i.test(input.content)) throw Error('NOTE_SECRET');
    return noteCopy(input);
}
export function validateNote(note) {
    if (!keys(note, 'id,revision,title,content,scope,chatKey,createdAt,updatedAt,origin') || !uuid(note.id) ||
        !Number.isSafeInteger(note.revision) || note.revision < 1 || !['manual', 'user-quote'].includes(note.origin) ||
        !Number.isSafeInteger(note.createdAt) || !Number.isSafeInteger(note.updatedAt) || note.createdAt < 0 || note.updatedAt < note.createdAt ||
        !(note.scope === 'account' ? note.chatKey === null : typeof note.chatKey === 'string' && note.chatKey.length > 0 && note.chatKey.length <= 2048)) throw Error('NOTE_INVALID');
    validateNoteInput({ title: note.title, content: note.content, scope: note.scope });
    return noteCopy(note);
}
export function validateNoteData(data, namespace) {
    if (data == null) return { version: 1, namespace, notes: [] };
    if (!keys(data, 'version,namespace,notes') || data.version !== 1 || data.namespace !== namespace || !Array.isArray(data.notes)) throw Error('NOTE_INVALID');
    if (data.notes.length > NOTE_LIMITS.entries || noteBytes(data) > NOTE_LIMITS.totalBytes) throw Error('NOTE_CAPACITY');
    const notes = data.notes.map(validateNote);
    if (new Set(notes.map(note => note.id)).size !== notes.length) throw Error('NOTE_INVALID');
    return { version: 1, namespace, notes };
}
export const noteVisible = (note, target) => note.scope === 'account' || target?.kind === 'chat' && note.chatKey === target.chatKey;
