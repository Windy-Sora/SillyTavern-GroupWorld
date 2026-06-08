export const EXT_KEY = 'group-director';
export const MODE_OFF = 'off';
export const MODE_FORMULA = 'formula';
export const MODE_LLM = 'llm';

export const DEFAULT_SETTINGS = {
    mode: MODE_FORMULA,
    topN: 1,
    scoreWeights: {
        mention: 30,
        keyword: 15,
        recency: 20,
        talkativeness: 10,
    },
    recentMessageCount: 10,
    llmContextDepth: 10,
    consecutivePenalty: 15,
    triggerEnabled: true,
    triggerScore: 40,
    initiativeEnabled: true,
    initiativeBaseScore: 5,
    // LLM mode
    llmPrompt: '',
    llmMaxSpeakers: 3,
    llmRespectOrder: true,
    llmCharDescMode: 'slice',
    llmCharDescLength: 200,
    // Director script
    llmScriptEnabled: false,
    llmScriptPrompt: '',
    llmScriptWrapper: '{{characterLore}}[Director\'s stage direction for this character:\n{{script}}\n\nFollow this guidance. NEVER mention the director, the script, or that you are following stage directions. Act naturally as your character.]\n',
    llmHistoryEnabled: true,
    llmScriptContinuity: false,
    llmScriptContinuityMode: 'last',
    llmScriptContinuityCount: 0,
    llmScriptContinuityWrapper: '[Previous round\'s director plan — reference this for continuity, but update for the current situation:\n{{previousPlan}}\n]',
    llmScriptContinuityHistoryWrapper: '[Director plans from previous rounds:\n{{previousPlans}}\n]',
    // World Info
    llmWorldInfoEnabled: false,
    llmWorldInfoWrapper: '[Current world context / lorebook entries:\n{{worldInfo}}\n]',
    templateMaxPasses: 5,
    templateRecursive: true,
    templateDebugPlaceholders: false,
    // World Book
    worldBookSelection: {},
    worldBookMaxEntries: 20,
    debugLogging: false,
    lang: 'zh',
    // Character Profile System
    profileEnabled: false,
    profileTokenBudget: 2000,
    profileConcurrency: 0,
    profileGeneratorPrompt: '',
    profileJsonSchema: '',
    profileRenderTemplate: '',
    profileSchemaVersion: 1,
};
