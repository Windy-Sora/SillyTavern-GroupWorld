import { validateRecord, validateSummary, summarizeRecord, validHistoryId, historyBytes } from './contract.js';
import { randomUUID, sha256 } from '../runtime/crypto.js';
import { MUYU_HISTORY_BOOK_PREFIX, isInternalWorldBookName } from '../../systems/internal-world-books.js';

export const WORLD_BOOK_HISTORY_PREFIX = MUYU_HISTORY_BOOK_PREFIX;
export const WORLD_BOOK_HISTORY_KEY = 'gdMuyuHistory';
export const WORLD_BOOK_HISTORY_LIMITS = Object.freeze({ recordBytes: 8 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, bookBytes: 20 * 1024 * 1024, chunkChars: 65536, chunks: 128 });
const schema = 'gd-muyu-history-worldbook';
// Keep exact legacy text readable: changing explanatory copy must not invalidate old archives.
const legacyNotice = '暮羽对话存档，由插件自动维护，无需启用或绑定。删除会丢失相应历史。 / Muyu conversation archive. Do not enable or bind; managed by the extension. Deleting it loses this history.';
const notice = `【暮羽助手 · 一份对话历史存档，不是剧情世界书】
这是 Group Director 的暮羽助手自动维护的对话存档。每本对应一份暮羽会话，后面的数据条目是分块存档，不是供角色阅读的设定；无需操作它。

注意事项
• 保持所有条目禁用，不要绑定角色、聊天或全局启用；误启用可能把私人对话带入模型提示词。
• 不要改名、编辑、增删条目或修改格式；这会使存档无法识别或校验失败。请在暮羽的历史侧栏管理对话。
• 内容为明文，可能包含私人对话、摘要与历史操作回执；不是加密保险箱。分享、导出或备份这本书前请注意隐私。
• 同一酒馆账户可跨设备接续，但请勿同时编辑同一会话；另一设备需刷新历史。授权、正在运行的任务和配置操作检查点不会随之恢复。

删除后果
删除整本世界书会移除这一份会话在世界书存储中的副本；删除任何数据条目也可能使整份会话无法读取。不会因此撤销已经执行的配置修改，也不会删除原来的酒馆角色聊天。
删除不能当作撤回外发资料或清除所有备份：旧存储、导出文件、其他设备或当前页面可能仍有副本。没有可用备份时无法承诺找回。请先在暮羽中导出，再用历史侧栏的“删除”；不要直接在世界书管理器删书。

[Muyu assistant · One conversation archive, NOT story lore]
Maintained automatically by Group Director. Each book stores one Muyu conversation; subsequent entries are archive chunks, not character lore. No action is needed.
Keep every entry disabled. Do not activate or bind this book: doing so may expose private conversations to model prompts. Do not rename the book or edit/add/delete entries; this can make the archive unreadable. Manage conversations in Muyu's history sidebar.
Plaintext may contain private messages, summaries and historical operation receipts. Review privacy before sharing/exporting/backing up. Continue across devices on the same ST account, but do not edit the same conversation simultaneously; refresh history on the other device. Grants, running tasks and configuration checkpoints are not restored.
Deleting the book removes this conversation's world-book copy; deleting a data entry may break the entire archive. It does not undo applied settings or delete the original ST roleplay chat, retract previously sent data, or erase other copies/backups. Recovery is not guaranteed without a backup. Export from Muyu first, then use Delete in its history sidebar instead of deleting this book directly.`;
const deletedNotice = `【暮羽助手 · 已删除会话的保护标记，不含会话正文】
这不是剧情世界书，也不是可恢复的对话。暮羽删除会话后保留这个空标记，防止旧页面把已删除的记录重新写回。
请保持条目禁用，无需绑定或启用；不要改名或编辑。正常情况下无需清理。
直接删除本书会移除防复活保护，尚未刷新或持有旧副本的页面可能再次创建同 ID 的存档；它不会帮你恢复已删除的正文，也不会撤销配置操作或清除其他存储和备份。请先关闭旧页面并备份、核对记录，不要把删书当作正常删除对话的方法。

[Muyu assistant · Deleted-conversation protection marker, NO conversation body]
This is not story lore or a recoverable conversation. Muyu keeps this empty marker after deletion to prevent stale pages from writing the deleted record back.
Keep it disabled; do not bind, activate, rename or edit it. No cleanup is normally needed.
Deleting this book removes resurrection protection: pages holding old copies may create the same archive ID again. It will not restore deleted text, undo operations or erase other storage/backups. Close stale pages and review backups first. Use Muyu's history sidebar for normal conversation deletion.`;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value, names) => object(value) && Object.keys(value).sort().join(',') === names.split(' ').sort().join(',');
const id = value => { if (!validHistoryId(value)) throw Error('HISTORY_INVALID'); return value.toLowerCase(); };

export function historyBookName(namespace, recordId) {
    return WORLD_BOOK_HISTORY_PREFIX + id(namespace) + '-' + id(recordId);
}

/** Classification only; a reserved name is never proof that a resource belongs to Muyu. */
export function isHistoryBookName(name) {
    return isInternalWorldBookName(name);
}

export function historyBookHeader(name, value, namespace) {
    if (!fields(value, 'schema version namespace id revision commitId deleted payloadBytes payloadHash chunkCount summary') || value.schema !== schema) throw Error('HISTORY_INVALID');
    if (value.version !== 1) throw Error('HISTORY_VERSION');
    if (value.namespace !== id(namespace) || historyBookName(namespace, value.id) !== name ||
        !Number.isSafeInteger(value.revision) || value.revision < 1 || !validHistoryId(value.commitId) || typeof value.deleted !== 'boolean' ||
        !Number.isSafeInteger(value.payloadBytes) || value.payloadBytes < 0 || value.payloadBytes > WORLD_BOOK_HISTORY_LIMITS.recordBytes ||
        !Number.isInteger(value.chunkCount) || value.chunkCount < 0 || value.chunkCount > WORLD_BOOK_HISTORY_LIMITS.chunks ||
        typeof value.payloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.payloadHash)) throw Error('HISTORY_INVALID');
    if (value.deleted) {
        if (value.summary !== null || value.payloadBytes !== 0 || value.chunkCount !== 0) throw Error('HISTORY_INVALID');
    } else {
        const summary = validateSummary(value.summary);
        if (summary.id !== value.id || summary.revision !== value.revision || summary.bytes !== value.payloadBytes || value.chunkCount < 1) throw Error('HISTORY_INVALID');
    }
    return structuredClone(value);
}

async function hash(text) {
    return [...new Uint8Array(await sha256(text))].map(n => n.toString(16).padStart(2, '0')).join('');
}

function entry(uid, content) {
    return { uid, key: [], keysecondary: [], comment: uid ? `暮羽存档数据 ${uid} · 请勿编辑 / Muyu archive data` : '00 · 暮羽对话存档说明与删除警告 / Muyu archive — READ FIRST',
        content, disable: true, constant: false, excludeRecursion: true, preventRecursion: true };
}

export async function encodeHistoryBook({ namespace, record, recordId, revision, deleted = false }) {
    namespace = id(namespace);
    const value = deleted ? null : validateRecord(record);
    recordId = value?.id ?? recordId;
    const text = value ? JSON.stringify(value) : '', chunks = [];
    if (new TextEncoder().encode(text).length > WORLD_BOOK_HISTORY_LIMITS.recordBytes) throw Error('HISTORY_CAPACITY');
    for (let offset = 0; offset < text.length;) {
        let end = Math.min(text.length, offset + WORLD_BOOK_HISTORY_LIMITS.chunkChars);
        if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
        chunks.push(text.slice(offset, end)); offset = end;
    }
    if (chunks.length > WORLD_BOOK_HISTORY_LIMITS.chunks) throw Error('HISTORY_CAPACITY');
    const name = historyBookName(namespace, recordId);
    const header = historyBookHeader(name, { schema, version: 1, namespace, id: recordId, revision,
        commitId: randomUUID(), deleted, payloadBytes: value ? historyBytes(value) : 0, payloadHash: await hash(text),
        chunkCount: chunks.length, summary: value ? summarizeRecord(value) : null }, namespace);
    const data = { entries: Object.fromEntries([entry(0, deleted ? deletedNotice : notice), ...chunks.map((chunk, i) => entry(i + 1, chunk))].map(row => [String(row.uid), row])),
        extensions: { [WORLD_BOOK_HISTORY_KEY]: header } };
    if (historyBytes(data) > WORLD_BOOK_HISTORY_LIMITS.bookBytes) throw Error('HISTORY_CAPACITY');
    return { name, data };
}

/** Validate complete ownership and disabled entries before a caller may replace the book. */
export async function decodeHistoryBook(name, data, namespace) {
    if (!fields(data, 'entries extensions') || !fields(data.extensions, WORLD_BOOK_HISTORY_KEY) || !object(data.entries)) throw Error('HISTORY_INVALID');
    const header = historyBookHeader(name, data.extensions[WORLD_BOOK_HISTORY_KEY], namespace);
    if (Object.keys(data.entries).length !== header.chunkCount + 1) throw Error('HISTORY_INVALID');
    const parts = [];
    for (let i = 0; i <= header.chunkCount; i++) {
        const row = data.entries[String(i)];
        if (!fields(row, 'uid key keysecondary comment content disable constant excludeRecursion preventRecursion') || row.uid !== i ||
            row.disable !== true || row.constant !== false || row.excludeRecursion !== true || row.preventRecursion !== true ||
            !Array.isArray(row.key) || row.key.length || !Array.isArray(row.keysecondary) || row.keysecondary.length ||
            typeof row.content !== 'string' || typeof row.comment !== 'string' || ![entry(i, '').comment, i ? `Muyu archive data ${i}` : 'Muyu archive — disabled / 暮羽存档，请勿启用'].includes(row.comment) ||
            (i ? !row.content.length || row.content.length > WORLD_BOOK_HISTORY_LIMITS.chunkChars : ![header.deleted ? deletedNotice : notice, legacyNotice].includes(row.content))) throw Error('HISTORY_INVALID');
        if (i) parts.push(row.content);
    }
    const text = parts.join('');
    if (new TextEncoder().encode(text).length !== header.payloadBytes || await hash(text) !== header.payloadHash) throw Error('HISTORY_INVALID');
    if (header.deleted) return { header, record: null };
    let parsed; try { parsed = JSON.parse(text); } catch { throw Error('HISTORY_INVALID'); }
    const record = validateRecord(parsed);
    if (record.id !== header.id || record.revision !== header.revision || JSON.stringify(summarizeRecord(record)) !== JSON.stringify(header.summary)) throw Error('HISTORY_INVALID');
    return { header, record };
}
