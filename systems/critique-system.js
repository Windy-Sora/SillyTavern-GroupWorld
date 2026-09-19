import { createCritiqueExecution } from './critique-execution.js';
import { extractCritiqueJson, parseCritiqueResponse } from './critique-parser.js';
import { createCritiqueRepository } from './critique-repository.js';
import { createEmptyCritiqueData, isPlainObject } from './critique-validation.js';

const DEFAULT_PROMPT = {
    zh: `你是一个客观中立的群聊导演批判系统。回顾最近的对话，只分析 AI 角色的表现，不要批判或评价用户。

请检查导演的发言顺序、焦点分配和节奏，并检查每个角色的一致性、互动质量以及是否过于被动或强势。只输出符合指定 JSON Schema 的 JSON 对象。`,
    en: `You are an objective group-chat critique system. Review the recent conversation and critique only AI character performance, never the user.

Assess speaking order, spotlight distribution, pacing, character consistency, interaction quality, and whether a character is too passive or dominant. Output only a JSON object matching the supplied schema.`,
};

function getDefaultSchema() {
    return JSON.stringify({
        directorCritique: {
            pacing: '节奏评价',
            spotlight: '焦点分配评价',
            suggestions: ['建议1', '建议2'],
        },
        characterCritiques: {
            角色名: {
                consistency: '一致性评价',
                interaction: '互动表现评价',
                suggestions: ['建议1'],
            },
        },
    }, null, 2);
}

function formatMessages(messages) {
    return messages.map(message => (
        `${message.name || (message.is_user ? 'User' : 'System')}: ${message.mes}`
    )).join('\n');
}

export function createCritiqueSystem({
    settings,
    getChatMetadata,
    getChat,
    EXT_KEY,
    saveChatConditional,
    generateRaw,
    inject_ids,
    extension_prompt_types,
    setExtensionPrompt,
    log,
    createCaller,
}) {
    function getCaller() {
        const agentConfig = settings.agentConfigs?.critique || {};
        return createCaller(agentConfig, options => generateRaw(options));
    }

    const repository = createCritiqueRepository({ getChatMetadata, EXT_KEY, saveChatConditional });
    const execution = createCritiqueExecution({
        createCaller: getCaller,
        setExtensionPrompt,
        quietPromptId: inject_ids.QUIET_PROMPT,
        inPromptType: extension_prompt_types.IN_PROMPT,
    });

    function getCritiques() {
        return repository.getCritiques();
    }

    function getLatestActive() {
        return repository.getLatestActive();
    }

    function getActiveDirectorCritiqueText() {
        if (execution.isRunning() || !settings.critiqueEnabled) return '';
        const director = getLatestActive()?.data?.directorCritique;
        if (!isPlainObject(director)) return '';
        const lines = [];
        for (const [key, value] of Object.entries(director)) {
            if (Array.isArray(value)) {
                if (value.length) lines.push(`[${key}] ${value.join('; ')}`);
            } else if (value !== null && value !== undefined && value !== '') {
                lines.push(`[${key}] ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
            }
        }
        return lines.join('\n');
    }

    function getActiveCharacterCritiqueData() {
        if (execution.isRunning() || !settings.critiqueEnabled) return null;
        const characters = getLatestActive()?.data?.characterCritiques;
        return isPlainObject(characters) ? characters : null;
    }

    function buildPrompt(inputText, preferredPrompt = '') {
        const base = preferredPrompt || settings.critiquePrompt
            || (settings.lang === 'zh' ? DEFAULT_PROMPT.zh : DEFAULT_PROMPT.en);
        const schema = settings.critiqueSchema || getDefaultSchema();
        return `${base}\n\nOutput format must strictly follow this JSON schema:\n${schema}\n\n${inputText}`;
    }

    function parseResponseData(response) {
        if (!response) return createEmptyCritiqueData();
        try {
            const parsed = parseCritiqueResponse(response);
            if (parsed) return parsed;
        } catch (error) {
            log?.('Critique JSON validation failed, using raw text:', error.message);
        }
        return {
            directorCritique: { pacing: response, spotlight: '', suggestions: [] },
            characterCritiques: {},
        };
    }

    function assertCurrentContext(metadata, chat) {
        if (getChatMetadata() === metadata && getChat() === chat) return;
        const error = new Error('Critique execution became stale after the chat changed');
        error.name = 'StaleExecutionError';
        throw error;
    }

    function assertCurrentCoverage(chat, rangeEnd, snapshot) {
        if (chat.length >= rangeEnd && formatMessages(chat.slice(0, rangeEnd)) === snapshot) return;
        const error = new Error('Critique execution became stale after covered messages changed');
        error.name = 'StaleExecutionError';
        throw error;
    }

    function assertCurrentCritique(metadata, entry, revision) {
        if (repository.getLatestActive(metadata) === entry && repository.getRevision(entry) === revision) return;
        const error = new Error('Critique execution became stale after the active critique changed');
        error.name = 'StaleExecutionError';
        throw error;
    }

    async function generateCritique() {
        const metadata = getChatMetadata();
        const chat = getChat();
        if (!chat.length) throw new Error('No messages to critique');
        const rangeEnd = chat.length;
        const coverageSnapshot = formatMessages(chat.slice(0, rangeEnd));

        const latestActive = repository.getLatestActive(metadata);
        const activeRevision = repository.getRevision(latestActive);
        if (latestActive && latestActive.rangeEnd === chat.length) {
            throw new Error('Latest critique already covers current chat — no new messages');
        }

        const critiques = repository.getCritiques(metadata);
        const reusePrevious = settings.critiqueReusePrevious;
        let inputText;
        if (reusePrevious && latestActive) {
            const newMessages = chat.slice(latestActive.rangeEnd);
            if (!newMessages.length) throw new Error('No new messages since last critique');
            inputText = `[Previous critique]\n${JSON.stringify(latestActive.data, null, 2)}\n\n[New content]\n${formatMessages(newMessages)}`;
        } else {
            inputText = formatMessages(chat);
        }

        const promptUsed = settings.critiquePrompt
            || (settings.lang === 'zh' ? DEFAULT_PROMPT.zh : DEFAULT_PROMPT.en);
        const prompt = buildPrompt(inputText, promptUsed);
        log?.(`[critique] generate: prompt length=${prompt.length}`);
        const response = await execution.execute(prompt);
        assertCurrentContext(metadata, chat);
        assertCurrentCoverage(chat, rangeEnd, coverageSnapshot);
        assertCurrentCritique(metadata, latestActive, activeRevision);
        const entry = {
            rangeEnd,
            content: response || '',
            data: parseResponseData(response),
            active: true,
            basedOn: reusePrevious && latestActive ? critiques.indexOf(latestActive) : null,
            promptUsed,
            timestamp: Date.now(),
        };
        assertCurrentContext(metadata, chat);
        assertCurrentCoverage(chat, rangeEnd, coverageSnapshot);
        assertCurrentCritique(metadata, latestActive, activeRevision);
        const saved = await repository.add(entry, metadata);
        assertCurrentContext(metadata, chat);
        assertCurrentCoverage(chat, rangeEnd, coverageSnapshot);
        return saved;
    }

    async function regenerateLastCritique() {
        const metadata = getChatMetadata();
        const critiques = repository.getCritiques(metadata);
        const last = repository.getLatestActive(metadata);
        if (!last) throw new Error('No active critique to regenerate');
        const chat = getChat();
        const revision = repository.getRevision(last);
        const rangeEnd = last.rangeEnd;
        const coverageSnapshot = formatMessages(chat.slice(0, rangeEnd));
        const promptUsed = last.promptUsed || settings.critiquePrompt || '';
        let inputText;
        if (Number.isInteger(last.basedOn) && last.basedOn >= 0 && critiques[last.basedOn]) {
            const previous = critiques[last.basedOn];
            inputText = `[Previous critique]\n${JSON.stringify(previous.data, null, 2)}\n\n[New content]\n${formatMessages(chat.slice(previous.rangeEnd, last.rangeEnd))}`;
        } else {
            inputText = formatMessages(chat.slice(0, last.rangeEnd));
        }

        const response = await execution.execute(buildPrompt(inputText, promptUsed));
        assertCurrentContext(metadata, chat);
        assertCurrentCoverage(chat, rangeEnd, coverageSnapshot);
        assertCurrentCritique(metadata, last, revision);
        const saved = await repository.update(last, {
            content: response || '',
            data: parseResponseData(response),
            promptUsed,
            timestamp: Date.now(),
        });
        assertCurrentContext(metadata, chat);
        assertCurrentCoverage(chat, rangeEnd, coverageSnapshot);
        return saved;
    }

    async function updateActiveContent(content) {
        if (typeof content !== 'string') throw new TypeError('Critique content must be a string');
        const active = repository.getLatestActive();
        if (!active) return null;
        let data = active.data;
        if (extractCritiqueJson(content) !== null) {
            try { data = parseCritiqueResponse(content); }
            catch (error) { throw new TypeError(`Invalid critique content: ${error.message}`); }
        }
        return await repository.update(active, { content, data });
    }

    return {
        getActiveDirectorCritiqueText,
        getActiveCharacterCritiqueData,
        getLatestActive,
        getCritiques,
        generateCritique,
        regenerateLastCritique,
        updateActiveContent,
        revertLastCritique: () => repository.revert(),
        resetAll: () => repository.reset(),
        pruneCritiques: () => repository.prune(getChat().length),
    };
}
