const text = value => typeof value === 'string' ? value : '';
const message = m => ({ name: text(m?.name).slice(0, 200), mes: text(m?.mes).slice(0, 32768), is_user: !!m?.is_user });
export const EXTRA_CONTEXT = Object.freeze(['chatMessages', 'characterCard']);

export function contextRequirements(provider) {
    const fields = provider.muyuContext ?? [];
    if (!Array.isArray(fields) || fields.length > EXTRA_CONTEXT.length || new Set(fields).size !== fields.length || fields.some(field => !EXTRA_CONTEXT.includes(field))) return null;
    return [...fields];
}
export function missingContext(fields, chat) {
    return fields.filter(field => field === 'characterCard' && (chat.groupId != null || !chat.characters?.[chat.characterId]));
}
export function providerContext(chat, fields) {
    const all = Array.isArray(chat.chat) ? chat.chat : [];
    const members = chat.groups?.find(g => String(g.id) === String(chat.groupId))?.members;
    const character = chat.groupId == null ? chat.characters?.[chat.characterId] : null;
    const result = {
        recentMessages: all.slice(-50).map(message),
        enabledMembers: Array.isArray(members) ? members.slice(0, 256).filter(member => typeof member === 'string') : [],
        character: text(character?.name).slice(0, 200),
        avatar: character?.avatar && typeof character.avatar === 'string' ? character.avatar : null,
    };
    if (fields.includes('chatMessages')) {
        result.chatMessages = all.slice(-200).map(message);
        result.chatMessagesLimited = all.length > 200;
    }
    if (fields.includes('characterCard') && character) {
        result.characterCard = Object.fromEntries(['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt', 'post_history_instructions'].map(key => [key, text(character[key]).slice(0, 4096)]));
    }
    return result;
}
