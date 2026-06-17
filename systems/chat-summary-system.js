export function createChatSummarySystem({ settings, getChatMetadata, getChat, EXT_KEY, saveChatConditional, renderPrompt, generateRaw, inject_ids, extension_prompt_types, setExtensionPrompt, log }) {
    const cm = () => getChatMetadata();
    let summarizing = false;

    const DEFAULT_PROMPT = {
        zh: '请用简洁的语言总结以下内容，保留关键情节、角色互动和重要细节。输出纯文本，不超过500字。',
        en: 'Summarize the following content concisely. Keep key plot points, character interactions, and important details. Output plain text, maximum 300 words.',
    };

    function getSummaries() {
        const meta = cm();
        if (!meta[EXT_KEY]) meta[EXT_KEY] = {};
        if (!meta[EXT_KEY].summaries) meta[EXT_KEY].summaries = [];
        return meta[EXT_KEY].summaries;
    }

    function getLatestActive() {
        const summaries = getSummaries();
        for (let i = summaries.length - 1; i >= 0; i--) {
            if (summaries[i].active) return summaries[i];
        }
        return null;
    }

    function getActiveSummaryText() {
        if (summarizing || !settings.summaryEnabled) return '';
        const active = getLatestActive();
        return active ? active.content : '';
    }

    async function generateSummary() {
        const chat = getChat();
        if (!chat.length) throw new Error('No messages to summarize');

        const summaries = getSummaries();
        const reusePrev = settings.summaryReusePrevious;
        const prevSummary = getLatestActive();

        let inputText = '';
        let startFrom = 0;

        if (reusePrev && prevSummary) {
            // Previous summary + new messages since last range end
            startFrom = prevSummary.rangeEnd;
            const newMessages = chat.slice(startFrom);
            if (!newMessages.length) throw new Error('No new messages since last summary');
            inputText = `[Previous summary]\n${prevSummary.content}\n\n[New content]\n` +
                newMessages.map(m => `${m.name || (m.is_user ? 'User' : 'System')}: ${m.mes}`).join('\n');
        } else {
            // Full chat
            inputText = chat.map(m => `${m.name || (m.is_user ? 'User' : 'System')}: ${m.mes}`).join('\n');
        }

        const prompt = (settings.summaryPrompt || (settings.lang === 'zh' ? DEFAULT_PROMPT.zh : DEFAULT_PROMPT.en)) + '\n\n' + inputText;

        summarizing = true;
        try {
            setExtensionPrompt(inject_ids.QUIET_PROMPT, '', extension_prompt_types.IN_PROMPT, 0, true);
            const response = await generateRaw({ prompt });
            setExtensionPrompt(inject_ids.QUIET_PROMPT, '', extension_prompt_types.IN_PROMPT, 0, true);

            const entry = {
                rangeEnd: chat.length,
                content: response || '',
                active: true,
                basedOn: reusePrev && prevSummary ? summaries.indexOf(prevSummary) : null,
                promptUsed: settings.summaryPrompt || '',
                timestamp: Date.now(),
            };

            // Deactivate previous active summaries
            for (const s of summaries) s.active = false;
            summaries.push(entry);
            await saveChatConditional();
            return entry;
        } finally {
            summarizing = false;
        }
    }

    async function regenerateLastSummary() {
        const summaries = getSummaries();
        if (!summaries.length) throw new Error('No summary to regenerate');

        const last = summaries[summaries.length - 1];
        const chat = getChat();

        let inputText = '';
        if (last.basedOn !== null && last.basedOn >= 0 && summaries[last.basedOn]) {
            const prev = summaries[last.basedOn];
            const newMessages = chat.slice(prev.rangeEnd, last.rangeEnd);
            inputText = `[Previous summary]\n${prev.content}\n\n[New content]\n` +
                newMessages.map(m => `${m.name || (m.is_user ? 'User' : 'System')}: ${m.mes}`).join('\n');
        } else {
            inputText = chat.slice(0, last.rangeEnd)
                .map(m => `${m.name || (m.is_user ? 'User' : 'System')}: ${m.mes}`).join('\n');
        }

        const prompt = (last.promptUsed || settings.summaryPrompt || (settings.lang === 'zh' ? DEFAULT_PROMPT.zh : DEFAULT_PROMPT.en)) + '\n\n' + inputText;

        summarizing = true;
        try {
            setExtensionPrompt(inject_ids.QUIET_PROMPT, '', extension_prompt_types.IN_PROMPT, 0, true);
            const response = await generateRaw({ prompt });
            setExtensionPrompt(inject_ids.QUIET_PROMPT, '', extension_prompt_types.IN_PROMPT, 0, true);

            last.content = response || '';
            last.promptUsed = settings.summaryPrompt || '';
            last.timestamp = Date.now();
            await saveChatConditional();
            return last;
        } finally {
            summarizing = false;
        }
    }

    async function revertLastSummary() {
        const summaries = getSummaries();
        if (!summaries.length) return false;

        const last = summaries[summaries.length - 1];
        last.active = false;

        // Activate previous summary if exists
        if (last.basedOn !== null && last.basedOn >= 0 && summaries[last.basedOn]) {
            summaries[last.basedOn].active = true;
        }

        await saveChatConditional();
        return true;
    }

    async function resetAll() {
        const summaries = getSummaries();
        for (const s of summaries) s.active = false;
        await saveChatConditional();
    }

    // Auto-prune on message deletion
    async function pruneSummaries() {
        const chat = getChat();
        const summaries = getSummaries();
        if (!summaries.length) return;

        let changed = false;
        for (const s of summaries) {
            if (s.active && s.rangeEnd > chat.length) {
                s.active = false;
                changed = true;
                // Activate previous
                if (s.basedOn !== null && s.basedOn >= 0 && summaries[s.basedOn]) {
                    summaries[s.basedOn].active = true;
                }
            }
        }
        if (changed) await saveChatConditional();
    }

    return {
        getActiveSummaryText,
        getLatestActive,
        getSummaries,
        generateSummary,
        regenerateLastSummary,
        revertLastSummary,
        resetAll,
        pruneSummaries,
    };
}
