import { randomUUID } from '../runtime/crypto.js';
import { copyJson, jsonKey } from '../core/json-contract.js';
import { applyApprovedMemoryCreation } from '../../systems/memory-editor.js';
const record = v => v && typeof v === 'object' && !Array.isArray(v);
const moods = ['happy', 'sad', 'angry', 'fearful', 'excited', 'neutral', 'mixed'];
/** Manual append only. Reading a target never initializes its memory store. */
export function createMemoryCreationPort({ getTarget, getMetadata, getCharacters, getSettings, getChatLength, extensionKey, saveChatConfirmed, isBusy = () => false, changed }) {
    const versions = new Map(), plans = new Map();
    function context(target, selector) {
        if (target?.kind !== 'chat' || jsonKey(target) !== jsonKey(getTarget())) throw Error('TARGET_UNAVAILABLE');
        if (isBusy()) throw Error('MEMORY_BUSY');
        const metadata = getMetadata(), root = metadata?.[extensionKey], store = root?.charMemories;
        if (!record(metadata) || root !== undefined && !record(root) || store !== undefined && !record(store)) throw Error('UNSUPPORTED_MEMORY_STORE');
        const characters = copyJson((getCharacters() || []).map(c => ({ avatar: c.avatar, name: c.name })));
        if (characters.length > 512 || characters.some(c => typeof c.avatar !== 'string' || !c.avatar || ['__proto__','constructor','prototype'].includes(c.avatar) || typeof c.name !== 'string') || new Set(characters.map(c => c.avatar)).size !== characters.length) throw Error('MEMORY_CHARACTERS_UNAVAILABLE');
        const limit = getSettings?.()?.memoryMaxEntries ?? 200, round = getChatLength?.();
        if (!Number.isInteger(limit) || limit < 1 || limit > 2000 || !Number.isSafeInteger(round) || round < 0) throw Error('MEMORY_CREATION_UNAVAILABLE');
        let avatar, name, entries;
        if (selector !== undefined) {
            if (typeof selector !== 'string' || !/^memory-character:(0|[1-9]\d*)$/.test(selector)) throw Error('INVALID_MEMORY_EDIT');
            const c = characters[Number(selector.slice(17))];
            if (!c) throw Error('MEMORY_NOT_FOUND');
            ({ avatar, name } = c);
            if (store && Object.hasOwn(store, avatar) && !Array.isArray(store[avatar])) throw Error('UNSUPPORTED_MEMORY_STORE');
            entries = copyJson(store && Object.hasOwn(store, avatar) ? store[avatar] : []);
            if (entries.some(e => !record(e) || typeof e.event !== 'string')) throw Error('UNSUPPORTED_MEMORY_STORE');
        }
        if (metadata !== getMetadata() || jsonKey(target) !== jsonKey(getTarget())) throw Error('TARGET_UNAVAILABLE');
        return { metadata, root, store, characters, limit, round, avatar, name, entries };
    }
    const fingerprint = live => jsonKey({ characters: live.characters, limit: live.limit, round: live.round, avatar: live.avatar, entries: live.entries });
    function version(live, target, selector) {
        const key = jsonKey({ target, selector }), fp = fingerprint(live), old = versions.get(key);
        if (!old || old.metadata !== live.metadata || old.root !== live.root || old.store !== live.store || old.fp !== fp) versions.set(key, { ...live, fp, revision: randomUUID() });
        if (versions.size > 512) versions.delete(versions.keys().next().value);
        return versions.get(key).revision;
    }
    function createTargets(target, offset = 0) {
        if (!Number.isInteger(offset) || offset < 0 || offset > 512) throw Error('INVALID_MEMORY_EDIT');
        const live = context(target);
        return { items: live.characters.slice(offset, offset + 16).map((c, i) => {
            const character = 'memory-character:' + (offset + i), selected = context(target, character);
            return { character, name: c.name, count: selected.entries.length, limit: live.limit, revision: version(selected, target, character), canAppend: selected.entries.length < Math.min(live.limit, 1024) };
        }), nextOffset: offset + 16 < live.characters.length ? offset + 16 : -1 };
    }
    function createPreview(target, args) {
        const live = context(target, args.character);
        if (version(live, target, args.character) !== args.revision) throw Error('STALE_MEMORY_EDIT');
        if (live.entries.length >= Math.min(live.limit, 1024)) throw Error('MEMORY_CAPACITY');
        const changes = copyJson(args.changes);
        if (!record(changes) || Object.keys(changes).some(k => !['event','mood'].includes(k)) || typeof changes.event !== 'string' || !changes.event.trim() || changes.event.length > 12000 || 'mood' in changes && !moods.includes(changes.mood)) throw Error('INVALID_MEMORY_EDIT');
        const content = copyJson({ module: 'memory-editor', ticket: 'memory-create:' + randomUUID(), target, operation: 'create', character: args.character, index: live.entries.length, name: live.name, before: null,
            after: { event: changes.event.trim(), mood: changes.mood || 'neutral', round: live.round, timestamp: Date.now() },
            warnings: ['仅向当前聊天的指定角色追加一条记忆；不覆盖、裁剪旧条目或开启功能。 / Append one memory in this chat; no overwrite, pruning or enabling.', '不会额外调用生成模型。时间与消息数由宿主记录，不证明事件实际发生于该时刻。 / No extra generation call; host timestamp/message count do not date the event.', '保存未知不自动重试或回滚；新增也不证明持久化或当前剧情事实。 / Unknown saving never auto-retries or rolls back; memory text is not verified fact.'] });
        // Do not create a list that this bounded editor cannot subsequently verify/read.
        copyJson([...live.entries, content.after]);
        if (new TextEncoder().encode(JSON.stringify(content)).length > 24000) throw Error('MEMORY_DRAFT_TOO_LARGE');
        if (plans.size >= 64) throw Error('MEMORY_PLAN_CAPACITY');
        plans.set(content.ticket, { content: copyJson(content), live, fp: fingerprint(live) });
        return content;
    }
    function assertFresh(content) {
        const plan = plans.get(content?.ticket);
        if (!plan || jsonKey(plan.content) !== jsonKey(content)) throw Error('STALE_MEMORY_EDIT');
        const live = context(content.target, content.character);
        if (live.metadata !== plan.live.metadata || live.root !== plan.live.root || live.store !== plan.live.store || fingerprint(live) !== plan.fp) throw Error('STALE_MEMORY_EDIT');
        return plan;
    }
    return { createTargets, createPreview, assertFresh, release: content => plans.delete(content?.ticket), clear() { versions.clear(); plans.clear(); }, async apply(content) {
        const plan = assertFresh(content);
        try { return await applyApprovedMemoryCreation({ metadata: plan.live.metadata, extensionKey, avatar: plan.live.avatar, after: content.after, validate: () => assertFresh(content), saveChatConfirmed, changed,
            isCurrent(next, root, store) {
                const live = context(content.target, content.character);
                return live.metadata === plan.live.metadata && live.root === root && live.store === store && store[plan.live.avatar] === next && jsonKey(live.characters) === jsonKey(plan.live.characters) && live.limit === plan.live.limit && live.round === plan.live.round && jsonKey(live.entries) === jsonKey([...plan.live.entries, content.after]);
            } });
        } finally { plans.delete(content.ticket); }
    } };
}
