/** Normalize an LLM Director response into an executable, ordered plan. */
export function normalizeDirectorPlan(parsed, { enabledMembers, maxSpeakers = 3, matchCharacterByName, log = () => {} }) {
    if (!parsed || !Array.isArray(parsed.speakers) || parsed.speakers.length === 0) return null;
    const avatars = [];
    const names = [];
    const seen = new Set();
    for (const rawName of parsed.speakers) {
        const character = matchCharacterByName(rawName, enabledMembers);
        if (character && !seen.has(character.avatar)) {
            seen.add(character.avatar);
            avatars.push(character.avatar);
            names.push(character.name);
        } else if (!character) log(`LLM returned unrecognized name: "${rawName}" — skipped`);
    }
    const limit = Math.max(0, Number(maxSpeakers) || 0);
    const { speakers: _speakers, reason: _reason, scripts: _scripts, loreAssignments: _loreAssignments, ...extra } = parsed;
    return { ...extra, speakers: avatars.slice(0, limit), names: names.slice(0, limit), reason: parsed.reason ?? '', scripts: parsed.scripts ?? null, loreAssignments: parsed.loreAssignments ?? null };
}

export function normalizeDirectorScripts(scripts, { enabledMembers, matchCharacterByName }) {
    const normalized = {};
    if (!scripts || typeof scripts !== 'object') return normalized;
    for (const [name, script] of Object.entries(scripts)) {
        if (!script || typeof script !== 'string') continue;
        const character = matchCharacterByName(name, enabledMembers);
        if (character) normalized[character.name] = script;
    }
    return normalized;
}

export function recoverDirectorPlan(plan, options) {
    const normalized = normalizeDirectorPlan(plan, options);
    if (!normalized?.speakers?.length) return null;
    return { avatars: normalized.speakers, names: normalized.names, reason: normalized.reason, scripts: normalizeDirectorScripts(plan.scripts, options) };
}
