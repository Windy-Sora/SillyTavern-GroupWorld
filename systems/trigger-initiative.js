/** Pure Trigger and Initiative helpers for formula-mode speaker selection. */
export function extractTriggerKeywords(character = {}) {
    const text = [character.description, character.personality, character.scenario]
        .filter(Boolean)
        .join(' ');
    return [...new Set(text
        .split(/[\s,.;!?，。；！？、]+/u)
        .map(word => word.trim().toLowerCase())
        .filter(word => word.length >= 2 && word.length <= 10))];
}

export function matchesTrigger(character, recentMessages, { enabled = true } = {}) {
    if (!enabled) return false;
    const text = recentMessages.map(message => message.mes || '').join(' ').toLowerCase();
    return extractTriggerKeywords(character).some(keyword => text.includes(keyword));
}

export function rollInitiative({ enabled = true, baseScore = 0, random = Math.random } = {}) {
    if (!enabled) return 0;
    const base = Number(baseScore);
    if (!Number.isFinite(base) || base <= 0) return 0;
    return random() * base;
}
