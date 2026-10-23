// Narrow, synchronous projections of the live SillyTavern context. Never pass
// character cards, group member identifiers, or raw host objects to the model.
const MAX_ENTITIES = 2048;
const DIRECTORY_SIZE = 40;
const SEARCH_SIZE = 20;

const label = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 120) : '';

function entriesFor(id, ctx) {
    const items = id === 'stCharacters' ? ctx?.characters : ctx?.groups;
    if (!Array.isArray(items)) throw Error('SOURCE_UNAVAILABLE');
    if (items.length > MAX_ENTITIES) throw Error('SOURCE_TOO_LARGE');
    return items.flatMap((item, index) => {
        if (!item || typeof item !== 'object') return [];
        const rawName = item.name;
        if (typeof rawName !== 'string') return [];
        if (rawName.length > 512) throw Error('SOURCE_TOO_LARGE');
        const name = label(rawName);
        if (!name) return [];
        const identity = id === 'stCharacters' ? item.avatar : item.id;
        if (identity != null && String(identity).length > 512) throw Error('SOURCE_TOO_LARGE');
        return [{ index, name, rawName, identity: identity == null ? null : String(identity) }];
    });
}

function readDirectory(id, selector, ctx) {
    const entries = entriesFor(id, ctx);
    let selected, heading, matchCount;
    if (!selector) {
        selected = entries.slice(0, DIRECTORY_SIZE);
        matchCount = entries.length;
        heading = `total=${entries.length}; shown=${selected.length}; use search:NAME for a bounded name search`;
    } else {
        if (!selector.startsWith('search:') || selector.length > 32) throw Error('INVALID_SELECTOR');
        const query = selector.slice(7).trim();
        if (!query || /[\u0000-\u001f\u007f]/.test(query)) throw Error('INVALID_SELECTOR');
        const matches = entries.filter(entry => entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
        matchCount = matches.length;
        selected = matches.slice(0, SEARCH_SIZE);
        heading = `matches=${matches.length}; shown=${selected.length}`;
    }
    const kind = id === 'stCharacters' ? 'character' : 'group';
    return {
        text: [heading, ...selected.map(entry => `${kind}[${entry.index}] ${JSON.stringify(entry.name)}`)].join('\n'),
        limited: selected.length < matchCount || selected.some(entry => entry.name !== entry.rawName),
        // Private revision evidence: a reordered or renamed directory invalidates
        // a selector even when its visible first page happens to be unchanged.
        identity: entries.map(entry => [entry.index, entry.identity, entry.rawName]),
    };
}

export function readStSource(id, selector, ctx) {
    if (id === 'stCharacters' || id === 'stGroups') return readDirectory(id, selector, ctx);
    if (id !== 'stChat') throw Error('SOURCE_UNAVAILABLE');
    if (selector) throw Error('INVALID_SELECTOR');
    if (!ctx || typeof ctx !== 'object') throw Error('SOURCE_UNAVAILABLE');
    const isGroup = ctx.groupId != null;
    const owner = isGroup
        ? ctx.groups?.find(group => String(group?.id) === String(ctx.groupId))
        : ctx.characters?.[ctx.characterId];
    const rawName = owner?.name;
    if (typeof rawName === 'string' && rawName.length > 512) throw Error('SOURCE_TOO_LARGE');
    const name = label(rawName) || 'Unnamed';
    const messages = Array.isArray(ctx.chat) ? ctx.chat.length : 0;
    const lines = [`type=${isGroup ? 'group' : 'character'}`, `name=${JSON.stringify(name)}`, `messages=${messages}`];
    if (isGroup) lines.push(`members=${Array.isArray(owner?.members) ? owner.members.length : 'unknown'}`);
    return { text: lines.join('\n'), limited: typeof rawName === 'string' && name !== rawName, identity: typeof rawName === 'string' ? rawName : null };
}
