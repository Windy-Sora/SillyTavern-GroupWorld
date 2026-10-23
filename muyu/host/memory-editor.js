import { randomUUID } from '../runtime/crypto.js';
import { copyJson, jsonKey } from '../core/json-contract.js';
import { applyApprovedMemoryEdit } from '../../systems/memory-editor.js';
import { createMemoryCreationPort } from './memory-creation.js';
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const moods = ['happy', 'sad', 'angry', 'fearful', 'excited', 'neutral', 'mixed'];
/** Private immutable plans; selectors never resolve by a model-supplied avatar or name. */
export function createMemoryEditorPort({ getTarget, getMetadata, getCharacters, getSettings, getChatLength, extensionKey, saveChatConfirmed, isBusy = () => false, changed }) {
    const creation = createMemoryCreationPort({ getTarget, getMetadata, getCharacters, getSettings, getChatLength, extensionKey, saveChatConfirmed, isBusy, changed });
    const versions = new Map(), plans = new Map();
    function context(target) {
        if (target?.kind !== 'chat' || jsonKey(target) !== jsonKey(getTarget())) throw Error('TARGET_UNAVAILABLE');
        if (isBusy()) throw Error('MEMORY_BUSY');
        const metadata = getMetadata(), root = metadata?.[extensionKey], store = root?.charMemories;
        if (!record(metadata) || root !== undefined && !record(root) || store !== undefined && !record(store)) throw Error('UNSUPPORTED_MEMORY_STORE');
        const characters = copyJson((getCharacters() || []).map(c => ({ avatar: c.avatar, name: c.name })));
        if (characters.length > 512 || characters.some(c => !c.avatar || typeof c.avatar !== 'string' || typeof c.name !== 'string') || new Set(characters.map(c => c.avatar)).size !== characters.length) throw Error('MEMORY_CHARACTERS_UNAVAILABLE');
        const avatars = Object.keys(store || {});
        if (avatars.length > 512 || avatars.some(a => ['__proto__', 'constructor', 'prototype'].includes(a) || !Array.isArray(store[a]))) throw Error('UNSUPPORTED_MEMORY_STORE');
        if (metadata !== getMetadata() || jsonKey(target) !== jsonKey(getTarget())) throw Error('TARGET_UNAVAILABLE');
        return { metadata, root, store, characters, avatars };
    }
    function role(live, selector) {
        if (typeof selector !== 'string' || !/^memory-role:(0|[1-9]\d*)$/.test(selector)) throw Error('INVALID_MEMORY_EDIT');
        const avatar = live.avatars[Number(selector.slice(12))];
        if (!avatar) throw Error('MEMORY_NOT_FOUND');
        const entries = copyJson(live.store[avatar]);
        if (entries.some(e => !record(e) || typeof e.event !== 'string')) throw Error('UNSUPPORTED_MEMORY_STORE');
        return { avatar, entries, name: live.characters.find(c => c.avatar === avatar)?.name || '（已移除的角色 / Removed character）' };
    }
    function version(live, selector) {
        const r = role(live, selector), fingerprint = jsonKey({ avatar: r.avatar, entries: r.entries, characters: live.characters }), key = jsonKey({ target: getTarget(), selector });
        const old = versions.get(key);
        if (!old || old.metadata !== live.metadata || old.store !== live.store || old.fingerprint !== fingerprint) versions.set(key, { metadata: live.metadata, store: live.store, fingerprint, revision: randomUUID() });
        if (versions.size > 512) versions.delete(versions.keys().next().value);
        return versions.get(key).revision;
    }
    function list(target, offset = 0) {
        if (!Number.isInteger(offset) || offset < 0 || offset > 512) throw Error('INVALID_MEMORY_EDIT');
        const live = context(target);
        return { items: live.avatars.slice(offset, offset + 16).map((avatar, i) => { const character = 'memory-role:' + (offset + i), r = role(live, character); return { character, name: r.name, count: r.entries.length, revision: version(live, character) }; }), nextOffset: offset + 16 < live.avatars.length ? offset + 16 : -1 };
    }
    function read(target, character, revision, offset = 0) {
        const live = context(target);
        if (version(live, character) !== revision) throw Error('STALE_MEMORY_EDIT');
        const r = role(live, character), text = JSON.stringify({ character, name: r.name, entries: r.entries.map((entry, index) => ({ index, entry })), persistence: 'unknown', untrusted: true });
        if (!Number.isInteger(offset) || offset < 0 || offset > text.length) throw Error('INVALID_MEMORY_EDIT');
        return { character, revision, text: text.slice(offset, offset + 6000), nextOffset: offset + 6000 < text.length ? offset + 6000 : -1, untrusted: true };
    }
    function preview(target, args) {
        if (!['update', 'delete'].includes(args.operation) || !Number.isInteger(args.index) || args.index < 0) throw Error('INVALID_MEMORY_EDIT');
        const live = context(target);
        if (version(live, args.character) !== args.revision) throw Error('STALE_MEMORY_EDIT');
        const r = role(live, args.character), before = r.entries[args.index], changes = copyJson(args.changes);
        if (!before) throw Error('MEMORY_NOT_FOUND');
        if (!record(changes) || Object.keys(changes).some(k => !['event', 'mood'].includes(k))) throw Error('INVALID_MEMORY_EDIT');
        if (args.operation === 'delete' && Object.keys(changes).length) throw Error('INVALID_MEMORY_EDIT');
        if ('event' in changes && (typeof changes.event !== 'string' || !changes.event.trim() || changes.event.length > 12000)) throw Error('INVALID_MEMORY_EDIT');
        if ('mood' in changes && !moods.includes(changes.mood)) throw Error('INVALID_MEMORY_EDIT');
        const after = args.operation === 'delete' ? null : { ...before, ...changes, ...('event' in changes ? { event: changes.event.trim() } : {}) };
        if (jsonKey(before) === jsonKey(after)) throw Error('EMPTY_CHANGES');
        const candidate = { module: 'memory-editor', ticket: 'memory-edit:' + randomUUID(), target, operation: args.operation, character: args.character, index: args.index, name: r.name, before, after,
            warnings: ['仅编辑当前聊天的这一条记忆；其他条目和来源信息保持不变。 / Only this entry in this chat changes.', '删除不能直接撤销；保存未知不自动重试或整仓回滚。 / Deletion cannot be undone directly; unknown saves never auto-retry or roll back the store.'] };
        if (new TextEncoder().encode(JSON.stringify(candidate)).length > 24000) throw Error('MEMORY_DRAFT_TOO_LARGE');
        const content = copyJson(candidate);
        if (plans.size >= 64) throw Error('MEMORY_PLAN_CAPACITY');
        plans.set(content.ticket, { content: copyJson(content), live, avatar: r.avatar, entries: r.entries });
        return content;
    }
    function assertFresh(content) {
        if (content?.operation === 'create') return creation.assertFresh(content);
        const plan = plans.get(content?.ticket);
        if (!plan || jsonKey(plan.content) !== jsonKey(content)) throw Error('STALE_MEMORY_EDIT');
        const live = context(content.target), r = role(live, content.character);
        if (live.metadata !== plan.live.metadata || live.root !== plan.live.root || live.store !== plan.live.store || r.avatar !== plan.avatar || jsonKey(r.entries) !== jsonKey(plan.entries) || jsonKey(live.characters) !== jsonKey(plan.live.characters)) throw Error('STALE_MEMORY_EDIT');
        return plan;
    }
    return Object.freeze({ list, read, preview, assertFresh, createTargets: creation.createTargets, createPreview: creation.createPreview, release: content => { plans.delete(content?.ticket); creation.release(content); }, clear: () => { versions.clear(); plans.clear(); creation.clear(); },
        async apply(content) {
            if (content?.operation === 'create') return creation.apply(content);
            const plan = assertFresh(content);
            try { return await applyApprovedMemoryEdit({ metadata: plan.live.metadata, extensionKey, avatar: plan.avatar, index: content.index, after: content.after, saveChatConfirmed, changed,
                validate: () => assertFresh(content), isCurrent: next => {
                    const live = context(content.target);
                    const expected = plan.entries.slice();
                    if (content.after === null) expected.splice(content.index, 1); else expected[content.index] = content.after;
                    return live.metadata === plan.live.metadata && live.root === plan.live.root && live.store === plan.live.store && live.store[plan.avatar] === next && jsonKey(next) === jsonKey(expected) && jsonKey(live.characters) === jsonKey(plan.live.characters);
                } });
            } finally { plans.delete(content.ticket); }
        },
    });
}
