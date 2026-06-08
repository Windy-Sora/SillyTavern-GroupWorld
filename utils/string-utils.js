export function djb2Hash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash = hash & 0xFFFFFFFF;
    }
    return hash.toString(16);
}

export function hashChar(description, personality, scenario) {
    const combined = (description || '') + '\x00' + (personality || '') + '\x00' + (scenario || '');
    return djb2Hash(combined);
}
