import { WORLD_BOOK_HISTORY_KEY as KEY, WORLD_BOOK_HISTORY_LIMITS as LIMITS, historyBookName, historyBookHeader, decodeHistoryBook } from './worldbook-contract.js';
import { historyBytes, validHistoryId } from './contract.js';
import { randomUUID, sha256 } from '../runtime/crypto.js';

export const VOLUME_DEFAULT_MIB = 8;
export function volumeTargetMiB(value) {
    if (value == null) return VOLUME_DEFAULT_MIB;
    if (!Number.isInteger(value) || value < 1 || value > 16) throw Error('HISTORY_INVALID');
    return value;
}
export const volumeBookName = (namespace, index = 1) => {
    if (!validHistoryId(namespace)) throw Error('HISTORY_INVALID');
    if (!Number.isSafeInteger(index) || index < 1 || index > 1024) throw Error('HISTORY_CAPACITY');
    return `GD-Muyu-History-v2-${namespace.toLowerCase()}-00000000-0000-0000-0000-${String(index).padStart(12, '0')}`;
};
const notice = `【暮羽助手 · 对话历史合并存档，不是剧情世界书】
本书保存多份暮羽对话，数据条目由插件管理。无需启用或绑定，请保持所有条目禁用，不要改名、编辑或增删条目。
这是明文存储，可能包含私人对话、摘要和历史操作回执；分享前注意隐私。授权、运行任务与操作检查点不会随存档恢复。
删除整本书会丢失本卷全部对话及防复活标记；删除数据条目可能导致存档无法读取。请先导出备份，在暮羽历史侧栏管理和删除单份对话。
删除存档不会撤销已经执行的操作，也不会删除酒馆角色聊天或其他存储副本。避免多设备同时编辑，换设备后刷新历史。

[Muyu assistant · Combined conversation archive, NOT story lore]
Contains multiple Muyu conversations. Keep every entry disabled; do not activate, bind, rename or edit. Manage conversations in Muyu's history sidebar.
Plaintext may contain private messages, summaries and historical receipts. Review privacy before sharing. Grants, running tasks and checkpoints are not restored.
Deleting this book loses ALL conversations and deletion markers in this volume; editing/deleting data entries may break the archive. Export first. Deletion does not undo operations or erase ST chats or other copies. Avoid simultaneous editing across devices.`;
const fields = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === keys.split(' ').sort().join(',');
const entry = (uid, content, comment) => ({ uid, key: [], keysecondary: [], comment, content, disable: true, constant: false, excludeRecursion: true, preventRecursion: true });

export async function encodeVolume(namespace, books, legacyHashes = books.legacyHashes || new Map()) {
    const entries = { 0: entry(0, notice, '00 · 暮羽合并存档说明与删除警告 / Muyu archive — READ FIRST') }, records = [];
    let uid = 1;
    for (const [name, data] of [...books].sort(([a], [b]) => a.localeCompare(b))) {
        const { header } = await decodeHistoryBook(name, data, namespace);
        const start = uid;
        // Retain the strict v1 codec as the per-conversation envelope, including tombstones.
        for (let i = 0; i <= header.chunkCount; i++) {
            entries[uid] = { ...structuredClone(data.entries[i]), uid }; uid++;
        }
        const legacyHash = legacyHashes.get(name);
        if (legacyHash !== undefined && !/^[a-f0-9]{64}$/.test(legacyHash)) throw Error('HISTORY_INVALID');
        records.push({ header, start, ...(legacyHash ? { legacyHash } : {}) });
    }
    const data = { entries, extensions: { [KEY]: { schema: 'gd-muyu-history-worldbook', version: 2, namespace: namespace.toLowerCase(), commitId: randomUUID(), records } } };
    if (historyBytes(data) > LIMITS.bookBytes) throw Error('HISTORY_CAPACITY');
    return data;
}

export async function decodeVolume(namespace, data) {
    if (!fields(data, 'entries extensions') || !fields(data.extensions, KEY)) throw Error('HISTORY_INVALID');
    const h = data.extensions[KEY];
    if (!fields(h, 'schema version namespace commitId records') || h.schema !== 'gd-muyu-history-worldbook' || h.version !== 2 ||
        h.namespace !== namespace.toLowerCase() || !validHistoryId(h.commitId) || !Array.isArray(h.records) ||
        !data.entries || typeof data.entries !== 'object' || Array.isArray(data.entries)) throw Error('HISTORY_INVALID');
    if (historyBytes(data) > LIMITS.bookBytes) throw Error('HISTORY_CAPACITY');
    if (JSON.stringify(data.entries[0]) !== JSON.stringify(entry(0, notice, '00 · 暮羽合并存档说明与删除警告 / Muyu archive — READ FIRST'))) throw Error('HISTORY_INVALID');
    const books = new Map(); books.legacyHashes = new Map(); let uid = 1;
    for (const row of h.records) {
        if (!(fields(row, 'header start') || fields(row, 'header start legacyHash') && typeof row.legacyHash === 'string' && /^[a-f0-9]{64}$/.test(row.legacyHash)) || row.start !== uid) throw Error('HISTORY_INVALID');
        const name = historyBookName(namespace, row.header?.id), header = historyBookHeader(name, row.header, namespace);
        if (books.has(name)) throw Error('HISTORY_CONFLICT');
        const entries = {};
        for (let i = 0; i <= header.chunkCount; i++) {
            const stored = data.entries[uid];
            if (!stored || stored.uid !== uid) throw Error('HISTORY_INVALID');
            entries[i] = { ...stored, uid: i }; uid++;
        }
        const book = { entries, extensions: { [KEY]: header } };
        await decodeHistoryBook(name, book, namespace);
        books.set(name, book);
        if (row.legacyHash) books.legacyHashes.set(name, row.legacyHash);
    }
    if (Object.keys(data.entries).length !== uid) throw Error('HISTORY_INVALID');
    return books;
}

/** Present a combined book as independent v1 envelopes to the existing revision-safe store. */
export function volumeRepository(namespace, repository, { getTargetMiB = () => VOLUME_DEFAULT_MIB } = {}) {
    const name = volumeBookName(namespace), snapshots = new Map();
    const empty = data => fields(data, 'entries') && fields(data.entries, '');
    const fingerprint = data => JSON.stringify(data);
    const hash = async data => [...new Uint8Array(await sha256(fingerprint(data)))].map(n => n.toString(16).padStart(2, '0')).join('');
    async function loadVolume(file = name) {
        const data = await repository.load(file);
        if (empty(data)) return { data, books: new Map() };
        return { data, books: await decodeVolume(namespace, data) };
    }
    async function inventory() {
        const list = await repository.list();
        if (!Array.isArray(list)) throw Error('HISTORY_INVALID');
        const prefix = `GD-Muyu-History-v2-${namespace.toLowerCase()}-`, names = new Set([name]), listed = new Set();
        for (const row of list) {
            const file = row?.file_id;
            if (typeof file !== 'string' || !file.startsWith(prefix)) continue;
            const tail = file.slice(prefix.length), match = /^00000000-0000-0000-0000-(\d{12})$/.exec(tail);
            const index = match ? Number(match[1]) : 0;
            if (index < 1 || index > 1024 || volumeBookName(namespace, index) !== file) throw Error('HISTORY_VERSION');
            if (listed.has(file)) throw Error('HISTORY_INVALID');
            listed.add(file);
            names.add(file);
        }
        const volumes = new Map(), owners = new Map();
        for (const file of [...names].sort()) {
            const volume = await loadVolume(file);
            if (list.some(row => row.file_id === file) && empty(volume.data)) throw Error('HISTORY_CONFLICT');
            volumes.set(file, volume);
            for (const key of volume.books.keys()) {
                if (owners.has(key)) throw Error('HISTORY_CONFLICT');
                if (list.some(row => row.file_id === key)) {
                    const source = await repository.load(key);
                    await decodeHistoryBook(key, source, namespace);
                    if (volume.books.legacyHashes?.get(key) !== await hash(source)) throw Error('HISTORY_CONFLICT');
                }
                owners.set(key, file);
            }
        }
        return { list, volumes, owners };
    }
    async function place(file, data, state, legacyHash = null) {
        const { volumes, owners } = state;
        let target = owners.get(file), next;
        const targetBytes = volumeTargetMiB(getTargetMiB()) * 1024 * 1024;
        const encode = (volume, proposed) => {
            const hashes = new Map(volume.books.legacyHashes);
            if (legacyHash) hashes.set(file, legacyHash);
            return encodeVolume(namespace, proposed, hashes);
        };
        if (!target) {
            for (const [candidate, volume] of volumes) {
                const proposed = new Map(volume.books); proposed.set(file, data);
                let encoded;
                try { encoded = await encode(volume, proposed); }
                catch (error) { if (error.message === 'HISTORY_CAPACITY') continue; throw error; }
                if (historyBytes(encoded) <= targetBytes || volume.books.size === 0) { target = candidate; next = encoded; break; }
            }
            if (!target) {
                const index = Math.max(...[...volumes.keys()].map(key => Number(key.slice(-12)))) + 1;
                target = volumeBookName(namespace, index);
                const vacant = await loadVolume(target);
                if (!empty(vacant.data)) throw Error('HISTORY_CONFLICT');
                volumes.set(target, vacant);
            }
        }
        const volume = volumes.get(target);
        if (!next) { const proposed = new Map(volume.books); proposed.set(file, data); next = await encode(volume, proposed); }
        if (fingerprint((await loadVolume(target)).data) !== fingerprint(volume.data)) throw Error('HISTORY_CONFLICT');
        if (legacyHash && await hash(await repository.load(file)) !== legacyHash) throw Error('HISTORY_CONFLICT');
        await repository.save(target, next);
        if (fingerprint((await loadVolume(target)).data) !== fingerprint(next)) throw Error('HISTORY_CONFLICT');
        if (legacyHash && await hash(await repository.load(file)) !== legacyHash) throw Error('HISTORY_CONFLICT');
    }
    return {
        async list() {
            const { list, volumes, owners } = await inventory();
            const result = list.filter(item => !volumes.has(item.file_id) && !owners.has(item.file_id));
            for (const volume of volumes.values()) for (const [file_id, data] of volume.books) {
                result.push({ file_id, extensions: data.extensions });
            }
            return result;
        },
        async load(file) {
            const { owners, volumes } = await inventory();
            const books = volumes.get(owners.get(file))?.books || new Map();
            const legacy = await repository.load(file);
            if (books.has(file) && !empty(legacy) && books.legacyHashes?.get(file) !== await hash(legacy)) throw Error('HISTORY_CONFLICT');
            const value = books.get(file) || legacy;
            snapshots.set(file, fingerprint(value));
            return structuredClone(value);
        },
        async save(file, data) {
            const state = await inventory();
            const legacy = await repository.load(file);
            if (!state.owners.has(file) && !empty(legacy)) {
                // Unmigrated v1 archives remain in place until explicit migration.
                if (fingerprint(legacy) !== snapshots.get(file)) throw Error('HISTORY_CONFLICT');
                return repository.save(file, data);
            }
            const current = state.volumes.get(state.owners.get(file))?.books.get(file);
            if (fingerprint(current || { entries: {} }) !== snapshots.get(file)) throw Error('HISTORY_CONFLICT');
            const baseline = state.volumes.get(state.owners.get(file))?.books.legacyHashes?.get(file);
            if (!empty(legacy) && baseline !== await hash(legacy)) throw Error('HISTORY_CONFLICT');
            await place(file, data, state, !empty(legacy) ? baseline : null);
        },
        async mergeLegacyHistory({ cleanup = false, check = () => {} } = {}) {
            if (typeof cleanup !== 'boolean') throw Error('HISTORY_INVALID');
            const report = { total: null, copied: 0, identical: 0, conflicts: 0, cleaned: 0, remaining: null, error: null, cleanup };
            try {
                check();
                const initial = await inventory(); check();
                const files = initial.list.map(row => row.file_id).filter(file => typeof file === 'string' && file.startsWith(`GD-Muyu-History-v1-${namespace.toLowerCase()}-`));
                if (new Set(files).size !== files.length) throw Error('HISTORY_INVALID');
                report.total = report.remaining = files.length;
                for (const file of files) {
                    check();
                    const state = await inventory(), source = await repository.load(file); check();
                    const decoded = await decodeHistoryBook(file, source, namespace), sourceHash = await hash(source);
                    const listed = state.list.find(row => row.file_id === file);
                    if (!listed || listed.extensions?.[KEY]?.commitId !== decoded.header.commitId) throw Error('HISTORY_CONFLICT');
                    const owner = state.owners.get(file), volume = state.volumes.get(owner);
                    if (cleanup) {
                        if (!owner || volume.books.legacyHashes?.get(file) !== sourceHash) { report.conflicts++; report.remaining--; continue; }
                        if (typeof repository.remove !== 'function') throw Error('HISTORY_UNAVAILABLE');
                        // Both copies must be freshly validated before physical removal; no fallback deletion.
                        if (fingerprint((await loadVolume(owner)).data) !== fingerprint(volume.data) || await hash(await repository.load(file)) !== sourceHash) throw Error('HISTORY_CONFLICT');
                        check(); await repository.remove(file); check();
                        if (!empty(await repository.load(file))) throw Error('HISTORY_CONFLICT');
                        const verified = await loadVolume(owner);
                        if (fingerprint(verified.data) !== fingerprint(volume.data) || !verified.books.has(file) || verified.books.legacyHashes?.get(file) !== sourceHash) throw Error('HISTORY_CONFLICT');
                        report.cleaned++;
                    } else if (owner) report.identical++;
                    else { await place(file, source, state, sourceHash); check(); report.copied++; }
                    report.remaining--;
                }
            } catch (error) {
                report.error = ['HISTORY_CAPACITY', 'HISTORY_CONFLICT', 'HISTORY_DELETED', 'HISTORY_VERSION', 'HISTORY_INVALID', 'HISTORY_UNAVAILABLE', 'HISTORY_IDENTITY_UNAVAILABLE', 'HISTORY_SAVE_FAILED'].includes(error.message) ? error.message : 'HISTORY_SAVE_FAILED';
            }
            return report;
        },
    };
}
