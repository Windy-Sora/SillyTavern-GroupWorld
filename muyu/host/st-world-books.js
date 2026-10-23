// Read-only SillyTavern world-book projections. Binding labels are not proof
// that a book, much less an entry, was injected into a particular prompt.
import { visibleWorldBookState, isInternalWorldBook } from '../../systems/internal-world-books.js';
const MAX_BOOKS = 512;
const MAX_ENTRIES = 1024;
const MAX_BOOK_CONTENT = 1048576;
const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() : '';
const short = (value, length = 120) => clean(value).slice(0, length);
const validIndex = value => /^(0|[1-9]\d{0,3})$/.test(value) ? Number(value) : -1;

function snapshot(getState) {
    if (typeof getState !== 'function') throw Error('SOURCE_UNAVAILABLE');
    const state = visibleWorldBookState(getState());
    if (!state || !Array.isArray(state.names)) throw Error('SOURCE_UNAVAILABLE');
    if (state.names.length > MAX_BOOKS) throw Error('SOURCE_TOO_LARGE');
    const names = state.names;
    if (names.some(name => typeof name !== 'string' || !name.trim() || name.length > 200) || new Set(names).size !== names.length) throw Error('SOURCE_UNSUPPORTED');
    const selected = value => {
        if (!Array.isArray(value)) return [];
        const selectedNames = value.filter(name => typeof name === 'string' && names.includes(name));
        if (selectedNames.length > MAX_BOOKS) throw Error('SOURCE_TOO_LARGE');
        return selectedNames;
    };
    return {
        names: [...names],
        global: selected(state.global),
        chat: typeof state.chat === 'string' && names.includes(state.chat) ? state.chat : '',
        characterPrimary: typeof state.characterPrimary === 'string' && names.includes(state.characterPrimary) ? state.characterPrimary : '',
        characterAdditional: selected(state.characterAdditional),
        persona: typeof state.persona === 'string' && names.includes(state.persona) ? state.persona : '',
    };
}

function nameSearch(selector, names, limit) {
    if (!selector) return { indexes: names.slice(0, limit).map((_, index) => index), matches: names.length };
    if (!selector.startsWith('search:') || selector.length > 32) throw Error('INVALID_SELECTOR');
    const query = selector.slice(7).trim();
    if (!query || /[\u0000-\u001f\u007f]/.test(query)) throw Error('INVALID_SELECTOR');
    const indexes = names.flatMap((name, index) => name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ? [index] : []);
    return { indexes: indexes.slice(0, limit), matches: indexes.length };
}

export function readWorldBookOverview(selector, getState) {
    const state = snapshot(getState);
    const { indexes, matches } = nameSearch(selector, state.names, selector ? 20 : 80);
    const bindings = name => [
        state.global.includes(name) && 'global', state.chat === name && 'chat',
        state.characterPrimary === name && 'selected-character-primary',
        state.characterAdditional.includes(name) && 'selected-character-additional',
        state.persona === name && 'persona',
    ].filter(Boolean);
    const text = [
        `books=${state.names.length}; matches=${matches}; shown=${indexes.length}; promptInjection=unknown`,
        ...indexes.map(index => `book[${index}] ${JSON.stringify(state.names[index])} bindings=${bindings(state.names[index]).join(',') || 'none'}`),
    ].join('\n');
    return { text, limited: indexes.length < matches, identity: state };
}

function bookEntries(data) {
    if (!data || !data.entries || typeof data.entries !== 'object' || Array.isArray(data.entries)) throw Error('SOURCE_UNAVAILABLE');
    const keysInBook = Object.keys(data.entries);
    if (keysInBook.length > MAX_ENTRIES) throw Error('SOURCE_TOO_LARGE');
    const raw = keysInBook.map(key => data.entries[key]);
    let total = 0;
    return raw.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || typeof entry.content !== 'string') throw Error('SOURCE_UNSUPPORTED');
        const uid = entry.uid ?? null;
        if (uid !== null && !(typeof uid === 'string' || typeof uid === 'number' && Number.isFinite(uid)) || String(uid).length > 64) throw Error('SOURCE_UNSUPPORTED');
        const comment = typeof entry.comment === 'string' ? entry.comment : '';
        const keys = Array.isArray(entry.key) ? entry.key : [];
        const secondary = Array.isArray(entry.keysecondary) ? entry.keysecondary : [];
        if (comment.length > 512 || keys.length > 128 || secondary.length > 128 ||
            [...keys, ...secondary].some(key => typeof key !== 'string' || key.length > 200)) throw Error('SOURCE_TOO_LARGE');
        total += entry.content.length + comment.length + keys.join('').length + secondary.join('').length;
        if (total > MAX_BOOK_CONTENT) throw Error('SOURCE_TOO_LARGE');
        return { index, uid, comment, content: entry.content, keys, secondary,
            disabled: entry.disable === true, constant: entry.constant === true };
    });
}

function entrySearch(selector, entries) {
    const match = /^search:(0|[1-9]\d{0,3}):(.+)$/.exec(selector);
    if (!match || selector.length > 32) throw Error('INVALID_SELECTOR');
    const query = match[2].trim();
    if (!query || /[\u0000-\u001f\u007f]/.test(query)) throw Error('INVALID_SELECTOR');
    const needle = query.toLocaleLowerCase();
    const matches = entries.filter(entry => [entry.comment, ...entry.keys, ...entry.secondary, entry.content]
        .some(value => value.toLocaleLowerCase().includes(needle)));
    const shown = matches.slice(0, 20);
    const book = Number(match[1]);
    const text = [`matches=${matches.length}; shown=${shown.length}`, ...shown.map(entry => {
        const where = entry.content.toLocaleLowerCase().indexOf(needle);
        const snippet = where < 0 ? short(entry.content, 100) : short(entry.content.slice(Math.max(0, where - 35), where + query.length + 65), 120);
        return `entry[${book}:${entry.index}] ${JSON.stringify(short(entry.comment))} snippet=${JSON.stringify(snippet)}`;
    })].join('\n');
    return { text, limited: shown.length < matches.length || shown.some(entry => entry.comment.length > 120) };
}

export function readWorldBookEntries(selector, getState, load) {
    const state = snapshot(getState);
    if (!selector || /^books:(0|[1-9]\d{0,3})$/.test(selector)) {
        const start = selector ? Number(selector.slice(6)) : 0;
        if (start > 0 && start >= state.names.length) throw Error('INVALID_SELECTOR');
        const names = state.names.slice(start, start + 80), next = start + names.length < state.names.length ? start + names.length : -1;
        return { text: [`books=${state.names.length}; shown=${names.length}; nextBooks=${next < 0 ? 'none' : 'books:' + next}`, ...names.map((name, index) => `book[${start + index}] ${JSON.stringify(name)}`)].join('\n'),
            limited: next >= 0, identity: state.names };
    }
    const match = /^(?:book:(0|[1-9]\d{0,3})|(?:search|entry|entries):(0|[1-9]\d{0,3}):.+)$/.exec(selector);
    if (!match || selector.length > 32) throw Error('INVALID_SELECTOR');
    const bookIndex = validIndex(match[1] ?? match[2]);
    if (bookIndex < 0 || bookIndex >= state.names.length || typeof load !== 'function') throw Error('INVALID_SELECTOR');
    const name = state.names[bookIndex];
    return Promise.resolve().then(() => load(name)).then(data => {
        // A delayed load must not silently become a result for a different book.
        if (snapshot(getState).names[bookIndex] !== name) throw Error('STALE_SOURCE');
        if (isInternalWorldBook(name, data)) throw Error('SOURCE_UNAVAILABLE');
        const entries = bookEntries(data);
        const identity = entries.map(entry => [entry.uid, entry.comment, entry.keys, entry.secondary, entry.content, entry.disabled, entry.constant]);
        if (selector.startsWith('book:') || selector.startsWith('entries:')) {
            const page = /^entries:(?:0|[1-9]\d{0,3}):(0|[1-9]\d{0,3})$/.exec(selector);
            if (selector.startsWith('entries:') && !page) throw Error('INVALID_SELECTOR');
            const start = page ? Number(page[1]) : 0; if (start > 0 && start >= entries.length) throw Error('INVALID_SELECTOR');
            const shown = entries.slice(start, start + 80), next = start + shown.length < entries.length ? start + shown.length : -1;
            return { text: [`book[${bookIndex}] ${JSON.stringify(name)}; entries=${entries.length}; shown=${shown.length}; nextEntries=${next < 0 ? 'none' : `entries:${bookIndex}:${next}`}`, ...shown.map(entry =>
                `entry[${bookIndex}:${entry.index}] ${JSON.stringify(short(entry.comment))} keys=${entry.keys.length}/${entry.secondary.length} disabled=${entry.disabled} constant=${entry.constant}`)].join('\n'),
                limited: next >= 0 || shown.some(entry => entry.comment.length > 120), identity };
        }
        if (selector.startsWith('search:')) return { ...entrySearch(selector, entries), identity };
        const detail = /^entry:(?:0|[1-9]\d{0,3}):(0|[1-9]\d{0,3})$/.exec(selector);
        if (!detail || Number(detail[1]) >= entries.length) throw Error('INVALID_SELECTOR');
        const entry = entries[Number(detail[1])];
        return { text: JSON.stringify({ book: name, index: entry.index, comment: entry.comment, content: entry.content,
            keys: entry.keys, secondaryKeys: entry.secondary, disabled: entry.disabled, constant: entry.constant }), limited: false, identity };
    });
}
