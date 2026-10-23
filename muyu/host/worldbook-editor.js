import { randomUUID } from '../runtime/crypto.js';
import { copyJson, jsonKey } from '../core/json-contract.js';
import { visibleWorldBookState, isInternalWorldBook, isInternalWorldBookName } from '../../systems/internal-world-books.js';
const editable = ['comment', 'content', 'key', 'keysecondary', 'disable', 'constant'];
const object = v => v && typeof v === 'object' && !Array.isArray(v);
export function createWorldBookEditorPort({ getTarget, getState, load, save, createEntry, refresh, controls, isBusy = () => false }) {
    const versions = new Map(), plans = new Map(); let applying = false, directory = null, epoch = 0;
    function context(target) {
        const actual = getTarget();
        if (!actual || target?.userKey !== actual.userKey || !['chat', 'global'].includes(target.kind)) throw Error('TARGET_UNAVAILABLE');
        if (isBusy() || applying) throw Error('WORLD_BOOK_BUSY');
        const names = visibleWorldBookState(getState())?.names;
        if (!Array.isArray(names) || names.length > 512 || new Set(names).size !== names.length || names.some(n => typeof n !== 'string' || !n.trim() || n.length > 200)) throw Error('UNSUPPORTED_WORLD_BOOK');
        return { names: [...names], target: copyJson(actual) };
    }
    function projection(entry) {
        if (!object(entry)) throw Error('UNSUPPORTED_WORLD_BOOK');
        return copyJson(Object.fromEntries(editable.filter(k => Object.hasOwn(entry, k)).map(k => [k, entry[k]])));
    }
    async function capture(target, book) {
        const before = context(target), index = Number(book.slice(5)), expectedEpoch = epoch;
        if (!/^book:(0|[1-9]\d{0,2})$/.test(book) || index >= before.names.length || typeof load !== 'function') throw Error('INVALID_WORLD_BOOK_EDIT');
        const name = before.names[index], raw = await load(name), after = context(target);
        if (expectedEpoch !== epoch || jsonKey(before) !== jsonKey(after)) throw Error('STALE_WORLD_BOOK_EDIT');
        if (isInternalWorldBook(name, raw)) throw Error('INVALID_WORLD_BOOK_EDIT');
        const serialized = JSON.stringify(raw);
        if (typeof serialized !== 'string' || serialized.length > 1048576) throw Error('WORLD_BOOK_TOO_LARGE');
        const data = JSON.parse(serialized);
        if (!object(data) || !object(data.entries)) throw Error('UNSUPPORTED_WORLD_BOOK');
        const keys = Object.keys(data.entries);
        if (keys.length > 1024 || keys.some(k => !/^(0|[1-9]\d{0,9})$/.test(k) || !object(data.entries[k]) || data.entries[k].uid !== Number(k))) throw Error('UNSUPPORTED_WORLD_BOOK');
        const old = versions.get(book), fingerprint = JSON.stringify([before, serialized]);
        const revision = old?.fingerprint === fingerprint ? old.revision : randomUUID();
        if (!versions.has(book) && versions.size >= 512) versions.delete(versions.keys().next().value);
        const captured = { ...before, name, data, keys, fingerprint, revision }; versions.set(book, captured); return captured;
    }
    function entry(captured, selector) {
        const match = /^entry:(0|[1-9]\d{0,2}):(0|[1-9]\d{0,3})$/.exec(selector);
        if (!match || Number(match[2]) >= captured.keys.length) throw Error('INVALID_WORLD_BOOK_EDIT');
        const key = captured.keys[Number(match[2])]; return { key, value: captured.data.entries[key] };
    }
    const bookFor = selector => { const m = /^entry:(0|[1-9]\d{0,2}):(0|[1-9]\d{0,3})$/.exec(selector); if (!m) throw Error('INVALID_WORLD_BOOK_EDIT'); return 'book:' + m[1]; };
    function directoryVersion(state) { const fingerprint = jsonKey(state); if (directory?.fingerprint !== fingerprint) directory = { fingerprint, revision: randomUUID() }; return directory.revision; }
    const normalizedName = name => name.normalize('NFKC').toLocaleLowerCase();
    function newName(name, state) {
        if (isInternalWorldBookName(name)) throw Error('INVALID_WORLD_BOOK_EDIT');
        if (typeof name !== 'string' || name !== name.trim() || !/^[\p{L}\p{N} _-]{1,120}$/u.test(name) || new TextEncoder().encode(name).length > 180 || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name)) throw Error('INVALID_WORLD_BOOK_EDIT');
        if (state.names.length >= 512 || state.names.some(n => normalizedName(n) === normalizedName(name))) throw Error('WORLD_BOOK_NAME_CONFLICT');
        return name;
    }
    return Object.freeze({
        bindingRead(target) { if(!controls)throw Error('WRITE_UNAVAILABLE');return controls.read(target); },
        list(target, offset = 0) { const state = context(target); if (!Number.isInteger(offset) || offset < 0 || offset > 512) throw Error('INVALID_WORLD_BOOK_EDIT');
            return { books: state.names.slice(offset, offset + 16).map((name, i) => ({ name, selector: 'book:' + (offset + i) })), revision: directoryVersion(state), nextOffset: offset + 16 < state.names.length ? offset + 16 : -1, scope: 'shared-world-book-resource' }; },
        async read(target, selector, revision, offset = 0) {
            const book = selector.startsWith('book:') ? selector : bookFor(selector), rootRevision = directoryVersion(context(target));
            const captured = await capture(target, book);
            if (revision !== captured.revision && !(offset === 0 && selector.startsWith('book:') && revision === rootRevision && rootRevision === directoryVersion(context(target)))) throw Error('STALE_WORLD_BOOK_EDIT');
            const value = selector.startsWith('book:') ? { name: captured.name, revision: captured.revision, entries: captured.keys.map((k, i) => ({ selector: `entry:${book.slice(5)}:${i}`, uid: typeof captured.data.entries[k].uid === 'number' ? captured.data.entries[k].uid : null, comment: typeof captured.data.entries[k].comment === 'string' ? captured.data.entries[k].comment.slice(0, 120) : '' })) }
                : { name: captured.name, selector, entry: projection(entry(captured, selector).value), persistence: 'unknown', untrusted: true };
            const text = JSON.stringify(value);
            if (!Number.isInteger(offset) || offset < 0 || offset > text.length || offset > 0 && !revision) throw Error('INVALID_WORLD_BOOK_EDIT');
            let end = Math.min(text.length, offset + 6000); if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
            if (offset && /[\uDC00-\uDFFF]/.test(text[offset])) throw Error('INVALID_WORLD_BOOK_EDIT');
            return { text: text.slice(offset, end), revision: captured.revision, nextOffset: end < text.length ? end : -1 };
        },
        async preview(target, args) {
            if(['set_global_binding','set_chat_binding','delete_book'].includes(args.operation)) {
                if(!controls)throw Error('WRITE_UNAVAILABLE');
                if(args.operation==='delete_book') {const captured=await capture(target,args.selector);if(captured.revision!==args.revision)throw Error('STALE_WORLD_BOOK_EDIT');return controls.preview(target,{...args,bookBaseline:JSON.stringify(captured.data)});}
                return controls.preview(target,args);
            }
            if (!['update','create_entry','delete_entry','create_book','copy_book'].includes(args.operation)) throw Error('INVALID_WORLD_BOOK_EDIT');
            const creatingBook = ['create_book','copy_book'].includes(args.operation), state = context(target);
            const book = args.operation === 'create_book' ? null : ['create_entry','copy_book'].includes(args.operation) ? args.selector : bookFor(args.selector);
            if (args.operation === 'create_book' && args.selector !== '') throw Error('INVALID_WORLD_BOOK_EDIT');
            const captured = book ? await capture(target, book) : null;
            if (args.revision !== (captured ? captured.revision : directoryVersion(state))) throw Error('STALE_WORLD_BOOK_EDIT');
            const changes = copyJson(args.changes);
            if (!object(changes) || Object.keys(changes).some(k => !editable.includes(k)) || ['update','create_entry'].includes(args.operation) && !Object.keys(changes).length || !['update','create_entry'].includes(args.operation) && Object.keys(changes).length) throw Error('INVALID_WORLD_BOOK_EDIT');
            if (!creatingBook && args.name !== undefined) throw Error('INVALID_WORLD_BOOK_EDIT');
            for (const [k, v] of Object.entries(changes)) {
                if (['comment', 'content'].includes(k) && (typeof v !== 'string' || v.length > (k === 'comment' ? 512 : 12000)) || ['disable', 'constant'].includes(k) && typeof v !== 'boolean'
                    || ['key', 'keysecondary'].includes(k) && (!Array.isArray(v) || v.length > 128 || v.some(s => typeof s !== 'string' || s.length > 200))) throw Error('INVALID_WORLD_BOOK_EDIT');
            }
            const data = captured ? JSON.parse(JSON.stringify(captured.data)) : { entries: {} };
            let before, after, key = null;
            if (creatingBook) { newName(args.name, context(target)); if (typeof refresh !== 'function') throw Error('WRITE_UNAVAILABLE'); before = null; after = copyJson(data); }
            else if (args.operation === 'create_entry') {
                if (typeof createEntry !== 'function') throw Error('WRITE_UNAVAILABLE');
                if (captured.keys.length >= 1024) throw Error('WORLD_BOOK_TOO_LARGE');
                const created = createEntry(captured.name, data);
                if (!object(created) || !Number.isSafeInteger(created.uid) || created.uid < 0 || captured.keys.includes(String(created.uid)) || data.entries[created.uid] !== created) throw Error('UNSUPPORTED_WORLD_BOOK');
                key = String(created.uid); before = null; after = copyJson(Object.assign(created, changes));
            } else {
                const selected = entry(captured, args.selector); key = selected.key;
                before = args.operation === 'delete_entry' ? copyJson(selected.value) : projection(selected.value);
                after = args.operation === 'delete_entry' ? null : { ...before, ...changes };
                if (args.operation === 'delete_entry') delete data.entries[key]; else Object.assign(data.entries[key], copyJson(after));
                if (jsonKey(before) === jsonKey(after)) throw Error('EMPTY_CHANGES');
            }
            if (JSON.stringify(data).length > 1048576) throw Error('WORLD_BOOK_TOO_LARGE');
            const content = copyJson({ module: 'worldbook-editor', ticket: 'worldbook-edit:' + randomUUID(), target: captured?.target || state.target, name: creatingBook ? args.name : captured.name,
                ...(args.operation === 'copy_book' ? { sourceName: captured.name } : {}),
                selector: args.selector, operation: args.operation, before, after, warnings: ['修改共享世界书资源，可影响所有绑定此书的聊天；不是仅当前聊天。 / Shared resource; affects all chats using this book.',
                    '仅更新点名字段；关键词数组整项替换，其他条目和未知字段保留。不修改绑定、不生成、不执行宏。 / Specified fields only; arrays replace whole fields. Other entries/unknown fields preserved. No binding changes, generation or macro execution.',
                    '酒馆保存接口不证明持久化；结果未知不自动重试或整书回滚。 / Host saving does not prove persistence. Never retry unknown outcomes or roll back the whole book.'] });
            if (args.operation === 'delete_entry') content.warnings.push('删除完整条目，含未向模型投影的其他字段。不会删除整书。 / Deletes the complete entry including additional fields, not the whole book.');
            if (creatingBook) content.warnings.push('创建独立资源，不覆盖同名书，不自动绑定或激活；复制保留源书未知元数据。 / Creates a separate resource; no overwrite, binding or activation. Copy preserves source metadata.');
            if (new TextEncoder().encode(JSON.stringify(content)).length > 24000) throw Error('WORLD_BOOK_DRAFT_TOO_LARGE');
            if (plans.size >= 64) throw Error('WORLD_BOOK_PLAN_CAPACITY');
            plans.set(content.ticket, { content: copyJson(content), captured, book, key, data, state, creatingBook }); return content;
        },
        assertFresh(content) { if(content?.ticket?.startsWith('worldbook-control:')){if(!controls)throw Error('WRITE_UNAVAILABLE');return controls.assertFresh(content);} const plan = plans.get(content?.ticket); context(content?.target);
            if (!plan || jsonKey(content) !== jsonKey(plan.content) || plan.captured && versions.get(plan.book)?.fingerprint !== plan.captured.fingerprint || jsonKey(context(content.target).names) !== jsonKey(plan.state.names)) throw Error('STALE_WORLD_BOOK_EDIT');
            if (plan.creatingBook) newName(content.name, context(content.target)); return plan; },
        release: content => content?.ticket?.startsWith('worldbook-control:') ? controls?.release(content) : plans.delete(content?.ticket), clear() { plans.clear(); versions.clear(); directory = null; epoch++;controls?.clear(); },
        async apply(content) {
            if(content?.ticket?.startsWith('worldbook-control:')){if(!controls)throw Error('WRITE_UNAVAILABLE');return controls.apply(content);}
            const plan = this.assertFresh(content);
            if (typeof save !== 'function') throw Error('WRITE_UNAVAILABLE');
            if (plan.creatingBook) { await refresh(); this.assertFresh(content); }
            const fresh = plan.book ? await capture(content.target, plan.book) : null;
            if (fresh && fresh.fingerprint !== plan.captured.fingerprint) throw Error('STALE_WORLD_BOOK_EDIT');
            this.assertFresh(content); applying = true;
            const data = JSON.parse(JSON.stringify(plan.data));
            const expected = JSON.stringify(data);
            try { await save(content.name, data, true);
                if (plan.creatingBook) await refresh();
                const observed = await load(content.name), names = getState()?.names;
                if (jsonKey(getTarget()) !== jsonKey(content.target) || (plan.creatingBook ? !names?.includes(content.name) : names?.[Number(plan.book.slice(5))] !== content.name) || JSON.stringify(observed) !== expected) return { status: 'outcome_unknown', resourceSave: 'unconfirmed' };
                return { status: 'applied_unconfirmed', resourceSave: 'unconfirmed' }; }
            catch { return { status: 'outcome_unknown', resourceSave: 'unknown' }; }
            finally { applying = false; plans.delete(content.ticket); versions.delete(plan.book); }
        },
    });
}
