/** Pure projections. Never run card instructions or Director render/cleanup callbacks. */
export function readExtendedSource(id, selector, ctx, extensionKey, { text, bounded }) {
    const range = (value, total, max) => {
        const m = /^range:(0|[1-9]\d{0,8}):([1-9]\d?)$/.exec(value);
        if (!m || Number(m[2]) > max || Number(m[1]) >= total) throw Error('INVALID_SELECTOR');
        const start = Number(m[1]); return [start, Math.min(total, start + Number(m[2]))];
    };
    if (id === 'chatHistory') {
        const messages = Array.isArray(ctx.chat) ? ctx.chat : [];
        if (!selector) return { text: `messages=${messages.length}; zero-based range:START:COUNT, COUNT<=20. Current selected message bodies only; no alternate swipes or other chats.`, limited: true };
        const [start, end] = range(selector, messages.length, 20); let content = '';
        for (let i = start; i < end; i++) {
            const m = messages[i]; content = bounded(content + `[${i}] ${m?.is_system ? 'system' : m?.is_user ? 'user' : 'character'} ${text(m?.name)}: ${text(m?.mes)}\n`);
        }
        return { text: content, limited: start > 0 || end < messages.length };
    }
    if (id === 'characters') {
        const all = Array.isArray(ctx.characters) ? ctx.characters : [];
        const group = ctx.groupId == null ? null : ctx.groups?.find(g => String(g.id) === String(ctx.groupId));
        const members = group ? group.members : ctx.groupId == null && all[ctx.characterId] ? [all[ctx.characterId].avatar] : [];
        if (!Array.isArray(members) || members.length > 256) throw Error('SOURCE_TOO_LARGE');
        const entries = members.map(avatar => all.find(c => c.avatar === avatar)).filter(Boolean);
        const directory = entries.map(c => [c.avatar, text(c.name), group?.disabled_members?.includes(c.avatar) === true]);
        if (!selector) return { text: entries.map((c, i) => `character:${i} ${text(c.name).slice(0, 200)}${directory[i][2] ? ' [disabled]' : ''}`).join('\n'), directory, limited: false };
        if (!/^character:(0|[1-9]\d{0,2})$/.test(selector)) throw Error('INVALID_SELECTOR');
        const c = entries[Number(selector.slice(10))]; if (!c) throw Error('INVALID_SELECTOR');
        let content = '';
        for (const field of ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt', 'post_history_instructions']) {
            content = bounded(content + field + ': ' + text(c.data?.[field] ?? c[field]) + '\n');
        }
        return { text: content, directory, identity: c.avatar, limited: true }; // Not attachments/extensions/worldbook or every card field.
    }
    if (id === 'directorHistory' || id === 'directorLedger') {
        const history = ctx.chatMetadata?.[extensionKey]?.directorHistory || [];
        if (!Array.isArray(history)) throw Error('SOURCE_UNAVAILABLE');
        let start, end;
        if (id === 'directorLedger') {
            if (selector) throw Error('INVALID_SELECTOR');
            if (!history.length) return { text: '', limited: false };
            start = history.length - 1; end = history.length;
        } else {
            if (!selector) return { text: `records=${history.length}; zero-based range:START:COUNT, COUNT<=10. Editable saved plans, NOT proof that speakers/scripts actually executed.`, limited: true };
            [start, end] = range(selector, history.length, 10);
        }
        let content = 'Saved editable director plans; not execution proof.\n';
        for (let i = start; i < end; i++) {
            const entry = history[i] || {};
            content = bounded(content + `[${i}] reason: ${text(entry.reason)}\n`);
            if (Array.isArray(entry.speakers)) {
                if (entry.speakers.length > 256) throw Error('SOURCE_TOO_LARGE');
                content = bounded(content + 'speakers: ' + entry.speakers.map(text).join(', ') + '\n');
            }
            if (entry.scripts && typeof entry.scripts === 'object' && !Array.isArray(entry.scripts)) {
                const names = Object.keys(entry.scripts); if (names.length > 256) throw Error('SOURCE_TOO_LARGE');
                for (const name of names) content = bounded(content + `script[${name}]: ${text(entry.scripts[name])}\n`);
            }
            if (Number.isSafeInteger(entry._chatLength)) content += `messageCountAtSave: ${entry._chatLength}\n`;
        }
        return { text: bounded(content), limited: true }; // Explicit field projection, not arbitrary plan JSON.
    }
    throw Error('SOURCE_UNAVAILABLE');
}
