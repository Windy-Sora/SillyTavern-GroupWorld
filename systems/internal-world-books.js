// Classification for normal data/UI paths, never authorization to modify an archive.
export const MUYU_HISTORY_BOOK_PREFIX = 'GD-Muyu-History-v1-';
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const archiveName = new RegExp('^GD-Muyu-History-v[12]-' + uuid + '-' + uuid + '$', 'i');
export const isInternalWorldBookName = name => typeof name === 'string' && archiveName.test(name);
export const isInternalWorldBook = (name, data) => isInternalWorldBookName(name) || data?.extensions?.gdMuyuHistory?.schema === 'gd-muyu-history-worldbook';
export const visibleWorldBookNames = names => Array.isArray(names) ? names.filter(name => !isInternalWorldBookName(name)) : names;
export function visibleWorldBookState(state) {
    if (!state || typeof state !== 'object') return state;
    return { ...state, names: visibleWorldBookNames(state.names), global: visibleWorldBookNames(state.global),
        characterAdditional: visibleWorldBookNames(state.characterAdditional),
        ...Object.fromEntries(['chat', 'characterPrimary', 'persona'].map(key => [key, isInternalWorldBookName(state[key]) ? '' : state[key]])) };
}
