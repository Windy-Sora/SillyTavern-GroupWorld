/** Resolve enabled speakers without silently picking the first homonymous card. */
export function matchEnabledCharacter(reference, enabledMembers, characters) {
    if (typeof reference !== 'string' || !reference.trim()) return null;
    const trimmed = reference.trim();
    const enabled = characters.filter(character => enabledMembers.includes(character.avatar));
    const avatarMatch = enabled.find(character => character.avatar === trimmed);
    if (avatarMatch) return avatarMatch;
    const exact = enabled.filter(character => character.name === trimmed);
    if (exact.length) return exact.length === 1 ? exact[0] : null;
    const lower = trimmed.toLowerCase();
    const insensitive = enabled.filter(character => character.name?.toLowerCase() === lower);
    if (insensitive.length) return insensitive.length === 1 ? insensitive[0] : null;
    const partial = enabled.filter(character => {
        const name = character.name?.toLowerCase();
        return name && (name.includes(lower) || lower.includes(name));
    });
    const length = Math.max(0, ...partial.map(character => character.name.length));
    const best = partial.filter(character => character.name.length === length);
    return best.length === 1 ? best[0] : null;
}

/** Explicit ST group-message identity takes precedence over a mutable display name. */
export function messageMatchesCharacter(message, character, nameAmbiguous = false) {
    const avatar = message.original_avatar || message.avatar;
    return avatar ? avatar === character.avatar : !nameAmbiguous && message.name === character.name;
}

export function directorScriptKey(character, characters) {
    return characters.filter(candidate => candidate.name === character.name).length === 1
        ? character.name : character.avatar;
}
