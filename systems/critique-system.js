export function createCritiqueSystem({ settings, getChatMetadata, getChat, EXT_KEY, saveChatConditional, renderPrompt, generateRaw, inject_ids, extension_prompt_types, setExtensionPrompt, log, createCaller }) {
    const cm = () => getChatMetadata();
    let critiquing = false;

    function getCaller() {
        const agentConfig = settings.agentConfigs?.['critique'] || {};
        const stGenerateRaw = (opts) => generateRaw(opts);
        return createCaller(agentConfig, stGenerateRaw);
    }

    const DEFAULT_PROMPT = {
        zh: `你是一个客观中立的群聊导演批判系统。回顾最近的对话内容，从以下角度进行分析。
重要：只批判AI角色的表现，绝对不要批判或评价User/用户的行为和发言。

1. 导演决策批判：
   - 是否合理安排了发言顺序？有没有角色被忽略或过度聚焦？
   - 节奏是否恰当？是否过快或过慢？
   - 有没有错过的关键话题或冲突点？

2. 角色表现批判（仅限AI角色，不含User）：
   - 角色言行是否一致？有没有出现OOC（角色偏差）？
   - 角色之间的互动是否自然、有推进剧情？
   - 有没有角色表现得过于被动或过于强势？

请以JSON格式输出，不要包含其他文字：
{
  "directorCritique": {
    "pacing": "节奏评价",
    "spotlight": "焦点分配评价",
    "suggestions": ["建议1", "建议2"]
  },
  "characterCritiques": {
    "角色名": {
      "consistency": "一致性评价",
      "interaction": "互动表现评价",
      "suggestions": ["建议1"]
    }
  }
}`,
        en: `You are an objective, neutral group chat critique system. Review the recent conversation and analyze.
IMPORTANT: Only critique AI character performance. Do NOT critique or judge the User's actions or messages.

1. Director Decision Critique:
   - Was the speaking order reasonable? Any characters ignored or over-focused?
   - Was the pacing appropriate? Too fast or too slow?
   - Any missed key topics or conflicts?

2. Character Performance Critique (AI characters only, NOT the User):
   - Are characters consistent in their words and actions? Any OOC (out-of-character) issues?
   - Are character interactions natural and plot-advancing?
   - Any characters too passive or too dominant?

Output ONLY a JSON object, no other text:
{
  "directorCritique": {
    "pacing": "pacing assessment",
    "spotlight": "spotlight distribution assessment",
    "suggestions": ["suggestion 1", "suggestion 2"]
  },
  "characterCritiques": {
    "CharacterName": {
      "consistency": "consistency assessment",
      "interaction": "interaction assessment",
      "suggestions": ["suggestion 1"]
    }
  }
}`,
    };

    const DEFAULT_DATA = {
        directorCritique: { },
        characterCritiques: {},
    };

    function getDefaultSchema() {
        return JSON.stringify({
            directorCritique: {
                pacing: '节奏评价',
                spotlight: '焦点分配评价',
                suggestions: ['建议1', '建议2'],
            },
            characterCritiques: {
                '角色名': {
                    consistency: '一致性评价',
                    interaction: '互动表现评价',
                    suggestions: ['建议1'],
                },
            },
        }, null, 2);
    }

    function getCritiques() {
        const meta = cm();
        if (!meta[EXT_KEY]) meta[EXT_KEY] = {};
        if (!meta[EXT_KEY].critiques) meta[EXT_KEY].critiques = [];
        return meta[EXT_KEY].critiques;
    }

    function getLatestActive() {
        const critiques = getCritiques();
        log(`[critique] getLatestActive: ${critiques.length} critiques, looking for active...`);
        for (let i = critiques.length - 1; i >= 0; i--) {
            if (critiques[i].active) {
                log(`[critique] getLatestActive: found active at index ${i}, has data keys:`, Object.keys(critiques[i].data || {}));
                return critiques[i];
            }
        }
        log('[critique] getLatestActive: no active critique found');
        return null;
    }

    function getActiveDirectorCritiqueText() {
        if (critiquing) { log('[critique] getActiveDirectorCritiqueText: critiquing in progress, returning empty'); return ''; }
        if (!settings.critiqueEnabled) { log('[critique] getActiveDirectorCritiqueText: critiqueEnabled=false, returning empty'); return ''; }
        const active = getLatestActive();
        if (!active?.data?.directorCritique) { log('[critique] getActiveDirectorCritiqueText: no directorCritique in active data'); return ''; }
        const dc = active.data.directorCritique;
        log('[critique] getActiveDirectorCritiqueText: directorCritique keys:', Object.keys(dc));
        const lines = [];
        for (const [k, v] of Object.entries(dc)) {
            if (Array.isArray(v)) {
                if (v.length) lines.push('[' + k + '] ' + v.join('; '));
            } else if (v !== null && v !== undefined && v !== '') {
                lines.push('[' + k + '] ' + (typeof v === 'object' ? JSON.stringify(v) : String(v)));
            }
        }
        return lines.join('\n');
    }

    function getActiveCharacterCritiqueData() {
        if (critiquing) { log('[critique] getActiveCharacterCritiqueData: critiquing in progress, returning null'); return null; }
        if (!settings.critiqueEnabled) { log('[critique] getActiveCharacterCritiqueData: critiqueEnabled=false, returning null'); return null; }
        const active = getLatestActive();
        if (!active?.data?.characterCritiques) { log('[critique] getActiveCharacterCritiqueData: no characterCritiques in active data, keys:', Object.keys(active?.data || {})); return null; }
        log('[critique] getActiveCharacterCritiqueData: returning characterCritiques with', Object.keys(active.data.characterCritiques).length, 'characters');
        return active.data.characterCritiques;
    }

    async function generateCritique() {
        if (critiquing) throw new Error('Critique already in progress');
        const chat = getChat();
        if (!chat.length) throw new Error('No messages to critique');

        // Skip if latest active critique already covers the full chat
        const latestActive = getLatestActive();
        if (latestActive && latestActive.rangeEnd === chat.length) {
            throw new Error('Latest critique already covers current chat — no new messages');
        }

        const critiques = getCritiques();
        const reusePrev = settings.critiqueReusePrevious;
        const prevCritique = latestActive;

        let inputText = '';
        let startFrom = 0;

        if (reusePrev && prevCritique) {
            startFrom = prevCritique.rangeEnd;
            const newMessages = chat.slice(startFrom);
            if (!newMessages.length) throw new Error('No new messages since last critique');
            inputText = `[Previous critique]\n${JSON.stringify(prevCritique.data, null, 2)}\n\n[New content]\n` +
                newMessages.map(m => `${m.name || (m.is_user ? 'User' : 'System')}: ${m.mes}`).join('\n');
        } else {
            inputText = chat.map(m => `${m.name || (m.is_user ? 'User' : 'System')}: ${m.mes}`).join('\n');
        }

        const schema = settings.critiqueSchema || getDefaultSchema();
        const prompt = (settings.critiquePrompt || (settings.lang === 'zh' ? DEFAULT_PROMPT.zh : DEFAULT_PROMPT.en)) + '\n\n输出格式必须严格遵循此JSON schema:\n' + schema + '\n\n' + inputText;
        log(`[critique] generateCritique: using prompt length=${prompt.length}, hasCustomPrompt=${!!settings.critiquePrompt}, hasCustomSchema=${!!settings.critiqueSchema}`);

        critiquing = true;
        try {
            setExtensionPrompt(inject_ids.QUIET_PROMPT, '', extension_prompt_types.IN_PROMPT, 0, true);
            const response = await getCaller().generate(prompt);
            setExtensionPrompt(inject_ids.QUIET_PROMPT, '', extension_prompt_types.IN_PROMPT, 0, true);
            log(`[critique] generateCritique: LLM response length=${response?.length || 0}, first 200 chars:`, response?.substring(0, 200));

            // Parse JSON from response
            let data = DEFAULT_DATA;
            if (response) {
                try {
                    // Try extracting JSON object
                    const extracted = extractJson(response);
                    if (extracted) { data = extracted; log('[critique] generateCritique: JSON extracted, keys:', Object.keys(data)); }
                    else { log('[critique] generateCritique: extractJson returned null'); }
                } catch (e) {
                    log('Critique JSON parse failed, using raw text:', e.message);
                    // Store raw text as director critique
                    data = {
                        directorCritique: { pacing: response, spotlight: '', suggestions: [] },
                        characterCritiques: {},
                    };
                }
            }

            const entry = {
                rangeEnd: chat.length,
                content: response || '',
                data,
                active: true,
                basedOn: reusePrev && prevCritique ? critiques.indexOf(prevCritique) : null,
                promptUsed: settings.critiquePrompt || '',
                timestamp: Date.now(),
            };

            for (const s of critiques) s.active = false;
            critiques.push(entry);
            await saveChatConditional();
            return entry;
        } finally {
            critiquing = false;
        }
    }

    async function regenerateLastCritique() {
        const critiques = getCritiques();
        if (!critiques.length) throw new Error('No critique to regenerate');

        const last = critiques[critiques.length - 1];
        const chat = getChat();

        let inputText = '';
        if (last.basedOn !== null && last.basedOn >= 0 && critiques[last.basedOn]) {
            const prev = critiques[last.basedOn];
            const newMessages = chat.slice(prev.rangeEnd, last.rangeEnd);
            inputText = `[Previous critique]\n${JSON.stringify(prev.data, null, 2)}\n\n[New content]\n` +
                newMessages.map(m => `${m.name || (m.is_user ? 'User' : 'System')}: ${m.mes}`).join('\n');
        } else {
            inputText = chat.slice(0, last.rangeEnd)
                .map(m => `${m.name || (m.is_user ? 'User' : 'System')}: ${m.mes}`).join('\n');
        }

        const schema = settings.critiqueSchema || getDefaultSchema();
        const prompt = (last.promptUsed || settings.critiquePrompt || (settings.lang === 'zh' ? DEFAULT_PROMPT.zh : DEFAULT_PROMPT.en)) + '\n\n输出格式必须严格遵循此JSON schema:\n' + schema + '\n\n' + inputText;

        critiquing = true;
        try {
            setExtensionPrompt(inject_ids.QUIET_PROMPT, '', extension_prompt_types.IN_PROMPT, 0, true);
            const response = await getCaller().generate(prompt);
            setExtensionPrompt(inject_ids.QUIET_PROMPT, '', extension_prompt_types.IN_PROMPT, 0, true);

            let data = DEFAULT_DATA;
            if (response) {
                try {
                    const extracted = extractJson(response);
                    if (extracted) data = extracted;
                } catch (e) {
                    log('Critique JSON parse failed on regenerate:', e.message);
                    data = {
                        directorCritique: { pacing: response, spotlight: '', suggestions: [] },
                        characterCritiques: {},
                    };
                }
            }

            last.content = response || '';
            last.data = data;
            last.promptUsed = settings.critiquePrompt || '';
            last.timestamp = Date.now();
            await saveChatConditional();
            return last;
        } finally {
            critiquing = false;
        }
    }

    async function revertLastCritique() {
        const critiques = getCritiques();
        if (!critiques.length) return false;

        // Find the most recently active critique, not just the last in array
        let target = null;
        let foundIndex = -1;
        for (let i = critiques.length - 1; i >= 0; i--) {
            if (critiques[i].active) { target = critiques[i]; foundIndex = i; break; }
        }
        if (!target) return false;

        target.active = false;

        if (target.basedOn !== null && target.basedOn >= 0 && target.basedOn < foundIndex && critiques[target.basedOn]) {
            critiques[target.basedOn].active = true;
        }

        await saveChatConditional();
        return true;
    }

    async function resetAll() {
        const critiques = getCritiques();
        for (const s of critiques) s.active = false;
        await saveChatConditional();
    }

    async function pruneCritiques() {
        const chat = getChat();
        const critiques = getCritiques();
        if (!critiques.length) return;

        let changed = false;
        // Iterate in reverse so reactivated basedOn entries are themselves validated
        for (let i = critiques.length - 1; i >= 0; i--) {
            const s = critiques[i];
            if (s.active && s.rangeEnd > chat.length) {
                s.active = false;
                changed = true;
                if (s.basedOn !== null && s.basedOn >= 0 && s.basedOn < i && critiques[s.basedOn]) {
                    // Only reactivate if basedOn precedes this entry (chronological order)
                    critiques[s.basedOn].active = true;
                }
            }
        }
        if (changed) await saveChatConditional();
    }

    // ── JSON Extraction ──
    function extractJson(text) {
        if (typeof text !== 'string') return null;
        const firstBrace = text.indexOf('{');
        if (firstBrace === -1) return null;

        let depth = 0;
        let inString = false;
        let escape = false;

        for (let i = firstBrace; i < text.length; i++) {
            const ch = text[i];
            if (escape) { escape = false; continue; }
            if (ch === '\\') { escape = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (inString) continue;

            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) {
                    const raw = text.slice(firstBrace, i + 1);
                    // Sanitize
                    let s = raw;
                    s = s.replace(/,(\s*[}\]])/g, '$1');
                    s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ');
                    try { return JSON.parse(s); } catch (_) { return null; }
                }
            }
        }
        return null;
    }

    return {
        getActiveDirectorCritiqueText,
        getActiveCharacterCritiqueData,
        getLatestActive,
        getCritiques,
        generateCritique,
        regenerateLastCritique,
        revertLastCritique,
        resetAll,
        pruneCritiques,
    };
}
