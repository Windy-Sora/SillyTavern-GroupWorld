/** Pure views shared by business getters and Muyu; never initialize metadata. */
export const peekProfiles = (metadata, key) => metadata?.[key]?.characterProfiles || {};
export const peekMemories = (metadata, key) => metadata?.[key]?.charMemories || {};
export const peekVariables = (metadata, key) => metadata?.[key]?.variables;
export const peekBlueprintState = (metadata, key) => metadata?.[key]?.storyBlueprint;
export function latestActiveSummary(summaries) {
    if (!Array.isArray(summaries)) return null;
    for (let i = summaries.length - 1; i >= 0; i--) if (summaries[i]?.active) return summaries[i];
    return null;
}
