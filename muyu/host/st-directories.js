// Narrow ST directory projections. Names are data, never executable commands.
const MAX_ITEMS = 1024;
const ROOT_SIZE = 80;
const SEARCH_SIZE = 20;
const PRESET_KINDS = Object.freeze(['kobold', 'novel', 'textgenerationwebui', 'openai', 'context', 'instruct', 'sysprompt', 'reasoning']);
const clean = value => value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
const label = value => clean(value).slice(0, 120);

function validNames(values, limit = MAX_ITEMS) {
    if (!Array.isArray(values)) throw Error('SOURCE_UNAVAILABLE');
    if (values.length > limit) throw Error('SOURCE_TOO_LARGE');
    if (values.some(value => typeof value !== 'string' || value.length > 512)) throw Error('SOURCE_UNSUPPORTED');
    return values;
}

function selectNames(selector, names, rootSize = ROOT_SIZE) {
    if (!selector) return { indexes: names.slice(0, rootSize).map((_, index) => index), matches: names.length };
    if (!selector.startsWith('search:') || selector.length > 32) throw Error('INVALID_SELECTOR');
    const query = selector.slice(7).trim();
    if (!query || /[\u0000-\u001f\u007f]/.test(query)) throw Error('INVALID_SELECTOR');
    const indexes = names.flatMap((name, index) => name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ? [index] : []);
    return { indexes: indexes.slice(0, SEARCH_SIZE), matches: indexes.length };
}

function getPresetState(getContext) {
    const ctx = getContext?.();
    if (!ctx || typeof ctx.getPresetManager !== 'function') throw Error('SOURCE_UNAVAILABLE');
    const modes = PRESET_KINDS.map(id => {
        try {
            const manager = ctx.getPresetManager(id);
            if (!manager || typeof manager.getAllPresets !== 'function' || typeof manager.getSelectedPresetName !== 'function') return { id, status: 'unavailable' };
            const names = validNames(manager.getAllPresets(), 512);
            const selected = manager.getSelectedPresetName();
            if (typeof selected !== 'string' || selected.length > 512) throw Error('SOURCE_UNSUPPORTED');
            return { id, status: 'available', names: [...names], selected };
        } catch (error) {
            return { id, status: ['SOURCE_TOO_LARGE', 'SOURCE_UNSUPPORTED'].includes(error?.message) ? error.message : 'unavailable' };
        }
    });
    const mainApi = PRESET_KINDS.includes(ctx.mainApi) ? ctx.mainApi : ctx.mainApi === 'koboldhorde' ? 'kobold' : 'unknown';
    return { mainApi, modes };
}

export function readStPresets(selector, getContext) {
    const state = getPresetState(getContext);
    if (!selector) return {
        text: [`currentApi=${state.mainApi}; selectedNamesAreUIState=true`, ...state.modes.map((mode, index) =>
            `mode[${index}] ${mode.id} status=${mode.status} count=${mode.status === 'available' ? mode.names.length : 'unknown'} selected=${mode.status === 'available' ? JSON.stringify(label(mode.selected)) : 'unknown'}`)].join('\n'),
        limited: state.modes.some(mode => mode.status !== 'available' || mode.status === 'available' && mode.selected.length > 120), identity: state,
    };
    const mode = /^(?:mode:(0|[1-7])|search:(0|[1-7]):.+)$/.exec(selector);
    if (!mode || selector.length > 32) throw Error('INVALID_SELECTOR');
    const index = Number(mode[1] ?? mode[2]), selectedMode = state.modes[index];
    if (selectedMode.status !== 'available') throw Error(selectedMode.status === 'SOURCE_TOO_LARGE' ? 'SOURCE_TOO_LARGE' : 'SOURCE_UNAVAILABLE');
    const names = selectedMode.names;
    const search = selector.startsWith('search:');
    const result = selectNames(search ? `search:${selector.slice(`search:${index}:`.length)}` : '', names);
    return {
        text: [`mode=${selectedMode.id}; presets=${names.length}; matches=${result.matches}; shown=${result.indexes.length}; selected=${JSON.stringify(label(selectedMode.selected))}`,
            ...result.indexes.map(itemIndex => `preset[${index}:${itemIndex}] ${JSON.stringify(label(names[itemIndex]))}`)].join('\n'),
        limited: result.indexes.length < result.matches || result.indexes.some(itemIndex => label(names[itemIndex]) !== names[itemIndex]) || selectedMode.selected.length > 120,
        identity: state,
    };
}

export function readStPersonas(selector, getContext, getSelectedAvatar) {
    const ctx = getContext?.();
    const personas = ctx?.powerUserSettings?.personas;
    if (!personas || typeof personas !== 'object' || Array.isArray(personas)) throw Error('SOURCE_UNAVAILABLE');
    const ids = Object.keys(personas);
    if (ids.length > MAX_ITEMS) throw Error('SOURCE_TOO_LARGE');
    if (ids.some(id => id.length > 512)) throw Error('SOURCE_TOO_LARGE');
    const names = ids.map(id => personas[id]);
    if (names.some(name => typeof name !== 'string' || name.length > 512)) throw Error('SOURCE_UNSUPPORTED');
    const selected = typeof getSelectedAvatar === 'function' ? getSelectedAvatar() : null;
    const current = typeof selected === 'string' && selected.length <= 512 ? selected : null;
    const rawDefault = ctx.powerUserSettings.default_persona, rawLock = ctx.chatMetadata?.persona;
    const defaultId = typeof rawDefault === 'string' && rawDefault.length <= 512 ? rawDefault : null;
    const chatLocked = typeof rawLock === 'string' && rawLock.length <= 512 ? rawLock : null;
    const result = selectNames(selector, names);
    const row = index => {
        const flags = [ids[index] === current && 'selected', ids[index] === defaultId && 'default', ids[index] === chatLocked && 'chat-locked'].filter(Boolean);
        return `persona[${index}] ${JSON.stringify(label(names[index]))} flags=${flags.join(',') || 'none'}`;
    };
    return {
        text: [`personas=${names.length}; matches=${result.matches}; shown=${result.indexes.length}; selected=${current === null ? 'unknown' : current === '' ? 'none' : ids.includes(current) ? 'listed' : 'unmapped'}`,
            ...result.indexes.map(row)].join('\n'),
        limited: result.indexes.length < result.matches || result.indexes.some(index => label(names[index]) !== names[index]) ||
            typeof selected === 'string' && current === null || typeof rawDefault === 'string' && defaultId === null || typeof rawLock === 'string' && chatLocked === null,
        identity: { ids, names, selected: current, defaultId, chatLocked },
    };
}

export function readStExtensions(selector, getDirectory) {
    const state = getDirectory?.();
    if (!state || !Array.isArray(state.names)) throw Error('SOURCE_UNAVAILABLE');
    const names = validNames(state.names);
    const types = state.types && typeof state.types === 'object' ? state.types : {};
    const disabled = Array.isArray(state.disabled) && state.disabled.length <= MAX_ITEMS ? state.disabled : null;
    const result = selectNames(selector, names);
    const typeOf = name => ['local', 'global', 'system'].includes(types[name]) ? types[name] : 'unknown';
    const enabledOf = name => disabled === null ? 'unknown' : disabled.includes(name) ? 'false' : 'true';
    return {
        text: [`extensions=${names.length}; matches=${result.matches}; shown=${result.indexes.length}; runtimeActive=unknown`,
            ...result.indexes.map(index => `extension[${index}] ${JSON.stringify(label(names[index]))} type=${typeOf(names[index])} enabledConfigured=${enabledOf(names[index])}`)].join('\n'),
        limited: result.indexes.length < result.matches || result.indexes.some(index => label(names[index]) !== names[index]) || disabled === null,
        identity: { names, types: names.map(typeOf), disabled: names.map(enabledOf) },
    };
}
