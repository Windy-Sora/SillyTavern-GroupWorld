// OpenAI preset resources and live settings are distinct evidence. Never select,
// save, render macros, or return connection fields while inspecting them.
const MAX = 131072;
const MAX_PROMPTS = 512;
const obj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const fields = Object.freeze([
    ['temperature', 'temp_openai', '温度', 'number'],
    ['frequency_penalty', 'freq_pen_openai', '频率惩罚', 'number'],
    ['presence_penalty', 'pres_pen_openai', '存在惩罚', 'number'],
    ['top_p', 'top_p_openai', 'Top P', 'number'],
    ['top_k', 'top_k_openai', 'Top K', 'number'],
    ['min_p', 'min_p_openai', 'Min P', 'number'],
    ['top_a', 'top_a_openai', 'Top A', 'number'],
    ['openai_max_context', 'openai_max_context', '上下文上限', 'number'],
    ['openai_max_tokens', 'openai_max_tokens', '最大回复长度', 'number'],
    ['use_sysprompt', 'use_sysprompt', '使用系统提示词', 'boolean'],
    ['squash_system_messages', 'squash_system_messages', '合并系统消息', 'boolean'],
    ...['send_if_empty', 'impersonation_prompt', 'new_chat_prompt', 'new_group_chat_prompt', 'new_example_chat_prompt',
        'continue_nudge_prompt', 'wi_format', 'scenario_format', 'personality_format', 'group_nudge_prompt',
        'assistant_prefill', 'assistant_impersonation'].map(key => [key, key, ({
            send_if_empty: '空消息替代文本', impersonation_prompt: '用户模拟提示词', new_chat_prompt: '新聊天提示词',
            new_group_chat_prompt: '新群聊提示词', new_example_chat_prompt: '示例对话分隔提示词',
            continue_nudge_prompt: '继续生成提示词', wi_format: '世界书格式', scenario_format: '场景格式',
            personality_format: '性格格式', group_nudge_prompt: '群聊提示词', assistant_prefill: '助手预填',
            assistant_impersonation: '模拟助手预填',
        })[key], 'string']),
]);
const promptFields = Object.freeze({ identifier: 'string', name: 'string', role: 'string', content: 'string',
    system_prompt: 'boolean', marker: 'boolean', injection_position: 'number', injection_depth: 'number',
    injection_order: 'number', forbid_overrides: 'boolean' });
function scalar(value, type, max = MAX) {
    if (typeof value !== type || type === 'number' && !Number.isFinite(value)) throw Error('SOURCE_UNSUPPORTED');
    if (type === 'string' && value.length > max) throw Error('SOURCE_TOO_LARGE');
    return value;
}
export function projectStPreset(raw, live = false) {
    if (!obj(raw)) throw Error('SOURCE_UNAVAILABLE');
    if (typeof raw.then === 'function') throw Error('SOURCE_UNSUPPORTED');
    const parameters = fields.flatMap(([key, liveKey, label, type]) => {
        const source = live ? liveKey : key;
        return own(raw, source) ? [{ field: key, label, value: scalar(raw[source], type) }] : [];
    });
    if (raw.prompts !== undefined && (!Array.isArray(raw.prompts) || raw.prompts.length > MAX_PROMPTS)) throw Error('SOURCE_TOO_LARGE');
    const prompts = (raw.prompts || []).map(p => {
        if (!obj(p)) throw Error('SOURCE_UNSUPPORTED');
        const projected = Object.fromEntries(Object.entries(promptFields).filter(([key]) => own(p, key))
            .map(([key, type]) => [key, scalar(p[key], type, key === 'content' ? MAX : 512)]));
        if (!projected.identifier) throw Error('SOURCE_UNSUPPORTED');
        return projected;
    });
    if (new Set(prompts.map(p => p.identifier)).size !== prompts.length) throw Error('SOURCE_UNSUPPORTED');
    if (raw.prompt_order !== undefined && (!Array.isArray(raw.prompt_order) || raw.prompt_order.length > MAX_PROMPTS)) throw Error('SOURCE_TOO_LARGE');
    const order = (raw.prompt_order || []).map(group => {
        if (!obj(group) || !['string', 'number'].includes(typeof group.character_id) || !Array.isArray(group.order) || group.order.length > MAX_PROMPTS) throw Error('SOURCE_UNSUPPORTED');
        const id = scalar(group.character_id, typeof group.character_id, 80);
        return { character_id: id, order: group.order.map(entry => {
            if (!obj(entry)) throw Error('SOURCE_UNSUPPORTED');
            return { identifier: scalar(entry.identifier, 'string', 512), enabled: scalar(entry.enabled, 'boolean') };
        }) };
    });
    const value = { parameters, prompts, order, promptsPresent: own(raw, 'prompts'), orderPresent: own(raw, 'prompt_order') };
    // Bound private revision evidence as well as public output.
    if (JSON.stringify(value).length > MAX) throw Error('SOURCE_TOO_LARGE');
    return value;
}
const note = '这是白名单字段投影，不是完整原始JSON。保存资源是宿主已加载的副本，不证明磁盘当前值；运行配置是内存快照，不含未提交的DOM草稿。排序列出所有配置轨道，不判定实际使用轨道／最终注入。未读取字段、缺失字段或未渲染占位符不推断为默认值／空内容。';
const project = projectStPreset;
function overview(value) {
    return { parameters: value.parameters, promptsPresent: value.promptsPresent, orderPresent: value.orderPresent,
        prompts: value.prompts.map(({ content, ...p }, index) => ({ index, ...p, contentChars: content?.length ?? null })),
        order: value.order };
}
export function readStPresetContent(selector, getContext) {
    const ctx = getContext?.(), manager = ctx?.getPresetManager?.('openai');
    if (!manager || typeof manager.getAllPresets !== 'function' || typeof manager.getSelectedPresetName !== 'function') throw Error('SOURCE_UNAVAILABLE');
    const names = manager.getAllPresets(), selected = manager.getSelectedPresetName();
    if (!Array.isArray(names) || names.length > 512) throw Error('SOURCE_TOO_LARGE');
    if (names.some(n => typeof n !== 'string' || n.length > 512) || new Set(names).size !== names.length || typeof selected !== 'string' || selected.length > 512) throw Error('SOURCE_UNSUPPORTED');
    const mainApi = typeof ctx.mainApi === 'string' ? scalar(ctx.mainApi, 'string', 80) : 'unknown';
    const directory = { api: 'openai', selected, mainApi,
        presets: names.map((name, index) => ({ index, name })),
        selectors: 'current; saved:N; compare:N; current:prompt:M; saved:N:prompt:M',
        notice: note, savedReadAvailable: typeof manager.getCompletionPresetByName === 'function',
        currentReadAvailable: obj(ctx.chatCompletionSettings) };
    if (!selector) return { text: JSON.stringify(directory), limited: false, identity: { names, selected, mainApi: directory.mainApi } };
    const match = /^(current|(?:saved|compare):(0|[1-9]\d{0,2}))(?::prompt:(0|[1-9]\d{0,2}))?$/.exec(selector);
    if (!match || match[1].startsWith('compare:') && match[3] !== undefined) throw Error('INVALID_SELECTOR');
    const index = match[2] === undefined ? null : Number(match[2]);
    if (index !== null && index >= names.length) throw Error('INVALID_SELECTOR');
    const live = match[1] === 'current', compare = match[1].startsWith('compare:');
    const readSaved = () => {
        if (typeof manager.getCompletionPresetByName !== 'function') throw Error('SOURCE_UNAVAILABLE');
        return project(manager.getCompletionPresetByName(names[index]), false);
    };
    const value = live ? project(ctx.chatCompletionSettings, true) : readSaved();
    const name = live ? selected : names[index];
    let data, identity = { names, selected, mainApi, value };
    if (compare) {
        const current = project(ctx.chatCompletionSettings, true);
        const parameterKeys = new Set([...value.parameters, ...current.parameters].map(p => p.field));
        const parameters = [...parameterKeys].flatMap(field => {
            const saved = value.parameters.find(p => p.field === field), now = current.parameters.find(p => p.field === field);
            return JSON.stringify(saved) === JSON.stringify(now) ? [] : [{ field, label: (saved || now).label,
                savedPresent: !!saved, currentPresent: !!now, ...(saved ? { saved: saved.value } : {}), ...(now ? { current: now.value } : {}) }];
        });
        const identifiers = new Set([...value.prompts, ...current.prompts].map(p => p.identifier));
        const prompts = [...identifiers].flatMap(identifier => {
            const savedIndex = value.prompts.findIndex(p => p.identifier === identifier), currentIndex = current.prompts.findIndex(p => p.identifier === identifier);
            const saved = value.prompts[savedIndex], now = current.prompts[currentIndex];
            const changedFields = Object.keys(promptFields).filter(key => JSON.stringify(saved?.[key]) !== JSON.stringify(now?.[key]));
            return !changedFields.length && savedIndex === currentIndex ? [] : [{ identifier, name: now?.name || saved?.name || identifier,
                savedIndex, currentIndex, changedFields, bodyIncluded: false }];
        });
        data = { kind: 'comparison', savedName: name, currentSelectedName: selected, parameters, prompts,
            orderChanged: JSON.stringify(value.order) !== JSON.stringify(current.order),
            promptsPresenceChanged: value.promptsPresent !== current.promptsPresent, orderPresenceChanged: value.orderPresent !== current.orderPresent,
            equalWithinProjection: !parameters.length && !prompts.length && JSON.stringify(value.order) === JSON.stringify(current.order) && value.promptsPresent === current.promptsPresent && value.orderPresent === current.orderPresent };
        identity = { ...identity, current };
    } else if (match[3] !== undefined) {
        const prompt = value.prompts[Number(match[3])];
        if (!prompt) throw Error('INVALID_SELECTOR');
        data = { kind: live ? 'current-prompt' : 'saved-prompt', name, index: Number(match[3]), prompt };
    } else data = { kind: live ? 'current-settings' : 'saved-resource', name, ...overview(value) };
    const result = JSON.stringify({ ...data, mainApi, chatCompletionSelected: mainApi === 'openai', notice: note });
    if (result.length > MAX || JSON.stringify(identity).length > MAX * 2 + 4096) throw Error('SOURCE_TOO_LARGE');
    return { text: result, limited: true, identity };
}
