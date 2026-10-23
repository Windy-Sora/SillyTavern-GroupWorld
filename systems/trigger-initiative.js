/** Pure Trigger and Initiative helpers for formula-mode speaker selection. */
const ENGLISH_STOP_WORDS = new Set(['the', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'from',
    'with', 'is', 'are', 'was', 'were', 'be', 'been', 'he', 'she', 'it', 'they', 'we', 'you', 'his', 'her', 'its', 'their']);
export function extractTriggerKeywords(character = {}) {
    const text = [character.description, character.personality, character.scenario]
        .filter(Boolean)
        .join(' ');
    return [...new Set(text
        .split(/[\s,.;!?，。；！？、]+/u)
        .map(word => word.trim().toLowerCase())
        .filter(word => word.length >= 2 && word.length <= 10 && !ENGLISH_STOP_WORDS.has(word)))];
}

export function matchesTrigger(character, recentMessages, { enabled = true } = {}) {
    if (!enabled) return false;
    const text = recentMessages.map(message => message.mes || '').join(' ').toLowerCase();
    return extractTriggerKeywords(character).some(keyword => {
        if (!/^[\p{Script=Latin}\p{N}_'’\-]+$/u.test(keyword)) return text.includes(keyword);
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(?<![\\p{Script=Latin}\\p{M}\\p{N}_])${escaped}(?![\\p{Script=Latin}\\p{M}\\p{N}_])`, 'u').test(text);
    });
}

export function rollInitiative({ enabled = true, baseScore = 0, random = Math.random } = {}) {
    if (!enabled) return 0;
    const base = Number(baseScore);
    if (!Number.isFinite(base) || base <= 0) return 0;
    return random() * base;
}
