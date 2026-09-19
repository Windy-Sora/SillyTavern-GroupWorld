/** Pure formula-mode speaker selection; deliberately independent of SillyTavern. */
function countMentions(name, recentMessages) {
    const text = recentMessages.map(message => message.mes || '').join(' ');
    if (!name) return 0;
    if (/[\u3040-\u30FF\u3400-\u9FFF]/u.test(name)) {
        let count = 0;
        let index = 0;
        while ((index = text.indexOf(name, index)) !== -1) {
            count += 1;
            index += name.length;
        }
        return count;
    }
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (text.match(new RegExp(`\\b${escaped}\\b`, 'gi')) || []).length;
}

export function findLastSpokenIndex(character, recentMessages) {
    for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
        const message = recentMessages[index];
        if (message.is_user || message.is_system) continue;
        if (message.avatar === character.avatar || message.name === character.name) {
            return recentMessages.length - 1 - index;
        }
    }
    return -1;
}

export function countConsecutiveMessages(character, chat) {
    let count = 0;
    for (let index = chat.length - 1; index >= 0; index -= 1) {
        const message = chat[index];
        if (message.is_user || message.is_system) break;
        if (message.avatar === character.avatar || message.name === character.name) count += 1;
        else break;
    }
    return count;
}

export function scoreFormulaCharacter({ character, recentMessages, chat, scoreWeights, triggerScore, consecutivePenalty, triggered = false, initiative = 0 }) {
    if (!character) return { score: -Infinity, breakdown: null };
    const mentionCount = countMentions(character.name, recentMessages);
    const lastSpokenIndex = findLastSpokenIndex(character, recentMessages);
    const consecutiveCount = countConsecutiveMessages(character, chat);
    const talkativeness = character.talkativeness === '' || Number.isNaN(Number(character.talkativeness)) ? 0.5 : Number(character.talkativeness);
    const recency = lastSpokenIndex === -1 ? scoreWeights.recency : scoreWeights.recency * (lastSpokenIndex / Math.max(recentMessages.length, 1));
    const score = (mentionCount * scoreWeights.mention) + (triggered ? triggerScore : 0) + recency - (consecutiveCount * consecutivePenalty) + (talkativeness * scoreWeights.talkativeness) + initiative;
    return { score, breakdown: { mentionCount, lastSpokenIndex, consecutiveCount, talkativeness, triggered, initiative } };
}

export function selectTopCandidates(scores, topN) {
    const ranked = Object.entries(scores).sort((left, right) => right[1] - left[1]).map(([avatar]) => avatar);
    return ranked.slice(0, Math.max(0, Math.min(Number(topN) || 0, ranked.length)));
}
