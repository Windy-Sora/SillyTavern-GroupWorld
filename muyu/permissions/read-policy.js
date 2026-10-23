/** Explicit data-only source allowlist. New sources require classification here. */
const readable = new Set(('variableDiagnostics recentMessages chatSummary character_profiles charMemory chatHistory characters directorLedger directorHistory memoryConfig variables storyBlueprint stChat stCharacters stGroups stWorldBooks stWorldBookEntries stPresets stPresetContent stPromptOverview stPromptText stDiagnostics serviceDiagnostics stPersonas stExtensions stCharacterCardState stCharacterCardReferences npcLibraryChat profileLibraryChat blueprintStructureState selectionState ledgerEditState blueprintNodeEditState npcEditState profileEditState profileCreateState npcCreateState memoryEditState memoryCreateState variableEditState blueprintLibraryChat blueprintLibraryAssets npcLibraryAssets profileLibraryAssets customPromptAssets skillAssets customAgentAssets npcGenerationState profileGenerationTargets memoryGenerationTargets scriptAssets providerAssets configSettings memoryDiagnostics directorDiagnostics').split(' '));
export const readSourceAllowed = source => typeof source === 'string' && source.startsWith('source:') && readable.has(source.slice(7));
readable.add('serviceDocuments');
export const PERMISSION_DEFAULTS = Object.freeze({ readAccess: 'ask' });
export function validatePermissionConfig(value) {
    if (!value || Object.keys(value).join(',') !== 'readAccess' || !['ask', 'all'].includes(value.readAccess)) throw Error('INVALID_PERMISSION_CONFIG');
    return { readAccess: value.readAccess };
}
