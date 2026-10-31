const MAX = 131072;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const kinds = ['kobold', 'novel', 'textgenerationwebui', 'openai', 'context', 'instruct', 'sysprompt', 'reasoning'];
const labels = ['Kobold 采样预设', 'NovelAI 采样预设', '文本补全采样预设', '聊天补全预设（独立来源）', '上下文模板', '指令模板', '系统提示词模板', '思考格式模板'];
const spec = (numbers = '', booleans = '', texts = '', arrays = '') => [
    ...numbers.split(' ').filter(Boolean).map(key => [key, 'number']), ...booleans.split(' ').filter(Boolean).map(key => [key, 'boolean']),
    ...texts.split(' ').filter(Boolean).map(key => [key, 'text']), ...arrays.split(' ').filter(Boolean).map(key => [key, 'array']),
];
const specs = [
    spec('temperature temp rep_pen rep_pen_range rep_pen_slope top_p min_p top_a top_k typical tfs mirostat mirostat_tau mirostat_eta genamt max_length', 'use_default_badwordsids', 'grammar', 'sampler_order'),
    spec('temperature repetition_penalty repetition_penalty_range repetition_penalty_slope repetition_penalty_frequency repetition_penalty_presence tail_free_sampling top_k top_p top_a typical_p min_p min_length genamt max_length', '', 'preamble prefix banned_tokens', 'order'),
    spec('temp temperature top_p top_k top_a tfs epsilon_cutoff eta_cutoff typical_p min_p rep_pen rep_pen_range rep_pen_decay rep_pen_slope no_repeat_ngram_size penalty_alpha num_beams length_penalty min_length encoder_rep_pen freq_pen presence_pen skew min_temp max_temp dynatemp_exponent smoothing_factor smoothing_curve dry_allowed_length dry_multiplier dry_base dry_penalty_last_n genamt max_length', 'do_sample early_stopping dynatemp temperature_last', 'grammar dry_sequence_breakers', 'sampler_order'),
    null,
    spec('story_string_position story_string_depth story_string_role', 'use_stop_strings names_as_stop_strings', 'story_string example_separator chat_start'),
    spec('names_behavior', 'enabled wrap macro bind_to_context skip_examples system_same_as_user sequences_as_stop_strings', 'story_string_prefix story_string_suffix input_sequence input_suffix output_sequence output_suffix system_sequence system_suffix last_system_sequence user_alignment_message stop_sequence first_output_sequence last_output_sequence first_input_sequence last_input_sequence activation_regex'),
    spec('', 'enabled', 'content post_history'),
    spec('max_additions', 'auto_parse add_to_prompts auto_expand show_hidden', 'prefix suffix separator'),
];
const fieldLabels = { temperature: '温度', temp: '温度', top_p: 'Top P', top_k: 'Top K', max_length: '上下文上限', genamt: '最大回复长度', rep_pen: '重复惩罚', story_string: '故事字符串', example_separator: '示例分隔符', chat_start: '聊天开始标记', input_sequence: '用户消息前缀', output_sequence: '助手消息前缀', system_sequence: '系统消息前缀', content: '系统提示词正文', post_history: '历史后指令', prefix: '前缀', suffix: '后缀', separator: '分隔符', enabled: '启用', grammar: '语法约束', preamble: '前置提示词' };
Object.assign(fieldLabels, {
    rep_pen_range: '重复惩罚范围', rep_pen_slope: '重复惩罚斜率', rep_pen_decay: '重复惩罚衰减', min_p: 'Min P', top_a: 'Top A', typical: 'Typical P', typical_p: 'Typical P', tfs: 'Tail Free Sampling', tail_free_sampling: 'Tail Free Sampling',
    mirostat: 'Mirostat 模式', mirostat_tau: 'Mirostat Tau', mirostat_eta: 'Mirostat Eta', use_default_badwordsids: '默认禁用词', sampler_order: '采样器顺序', order: '采样器顺序',
    repetition_penalty: '重复惩罚', repetition_penalty_range: '重复惩罚范围', repetition_penalty_slope: '重复惩罚斜率', repetition_penalty_frequency: '频率惩罚', repetition_penalty_presence: '存在惩罚', min_length: '最小回复长度', banned_tokens: '禁用 Token',
    epsilon_cutoff: 'Epsilon 截断', eta_cutoff: 'Eta 截断', no_repeat_ngram_size: '禁止重复 N-gram 长度', penalty_alpha: '对比搜索 Alpha', num_beams: '束搜索数量', length_penalty: '长度惩罚', encoder_rep_pen: '编码器重复惩罚', freq_pen: '频率惩罚', presence_pen: '存在惩罚', skew: '概率偏斜',
    min_temp: '最低温度', max_temp: '最高温度', dynatemp_exponent: '动态温度指数', smoothing_factor: '平滑系数', smoothing_curve: '平滑曲线', dry_allowed_length: 'DRY 允许长度', dry_multiplier: 'DRY 倍数', dry_base: 'DRY 基数', dry_penalty_last_n: 'DRY 最近范围', dry_sequence_breakers: 'DRY 序列分隔符', do_sample: '启用采样', early_stopping: '提前停止', dynatemp: '动态温度', temperature_last: '最后应用温度',
    story_string_position: '故事字符串位置', story_string_depth: '故事字符串深度', story_string_role: '故事字符串角色', use_stop_strings: '使用停止字符串', names_as_stop_strings: '角色名作为停止字符串',
    names_behavior: '角色名称行为', wrap: '包装序列', macro: '展开宏', bind_to_context: '绑定上下文模板', skip_examples: '跳过示例', system_same_as_user: '系统消息使用用户序列', sequences_as_stop_strings: '序列作为停止字符串',
    story_string_prefix: '故事字符串前缀', story_string_suffix: '故事字符串后缀', input_suffix: '用户消息后缀', output_suffix: '助手消息后缀', system_suffix: '系统消息后缀', last_system_sequence: '末条系统消息前缀', user_alignment_message: '用户对齐消息', stop_sequence: '停止序列', first_output_sequence: '首条助手消息前缀', last_output_sequence: '末条助手消息前缀', first_input_sequence: '首条用户消息前缀', last_input_sequence: '末条用户消息前缀', activation_regex: '激活正则表达式',
    max_additions: '思考追加次数上限', auto_parse: '自动解析思考', add_to_prompts: '思考加入提示词', auto_expand: '自动展开思考', show_hidden: '显示隐藏思考',
});
const note = 'Read-only whitelist, not raw JSON. Saved is a host-loaded resource, not current export or confirmed disk data. Current is memory/export, not unsaved DOM or final request. Selected names and enabled flags do not prove actual use, injection or past execution. Unknown/missing fields have no inferred defaults. No connections, secrets, arbitrary extensions, macro evaluation, regex execution, switching or saving. OpenAI content uses its existing distinct source.';
function pack(data, limited, identity) {
    const text = JSON.stringify(data);
    if (text.length > MAX || JSON.stringify(identity).length > MAX * 4 + 8192) throw Error('SOURCE_TOO_LARGE');
    return { text, limited, identity };
}

function state(ctx, index) {
    if (index === 3) return { index, family: kinds[index], label: labels[index], status: 'separate-source', source: 'stPresetContent' };
    const manager = ctx?.getPresetManager?.(kinds[index]);
    if (!manager || typeof manager.getAllPresets !== 'function' || typeof manager.getSelectedPresetName !== 'function') throw Error('SOURCE_UNAVAILABLE');
    const names = manager.getAllPresets(), selected = manager.getSelectedPresetName();
    if (!Array.isArray(names) || names.length > 512) throw Error('SOURCE_TOO_LARGE');
    if (names.some(name => typeof name !== 'string' || name.length > 512) || new Set(names).size !== names.length || typeof selected !== 'string' || selected.length > 512) throw Error('SOURCE_UNSUPPORTED');
    const power = ctx?.powerUserSettings;
    const live = index >= 4 && object(power?.[kinds[index]]) || typeof manager.getPresetSettings === 'function' || index === 2 && object(ctx?.textCompletionSettings);
    return { index, family: kinds[index], label: labels[index], status: 'available', names: [...names], selected,
        savedReadAvailable: typeof manager.getCompletionPresetByName === 'function', currentReadAvailable: !!live };
}
function project(raw, index) {
    if (!object(raw)) throw Error('SOURCE_UNAVAILABLE');
    if (typeof raw.then === 'function') throw Error('SOURCE_UNSUPPORTED');
    const parameters = [], bodies = [];
    for (const [field, type] of specs[index]) {
        if (!Object.hasOwn(raw, field)) continue;
        const value = raw[field], label = fieldLabels[field] || field;
        if (type === 'text') {
            if (typeof value !== 'string') throw Error('SOURCE_UNSUPPORTED');
            if (value.length > MAX) throw Error('SOURCE_TOO_LARGE');
            bodies.push({ field, label, text: value });
        } else {
            if (type === 'array' ? !Array.isArray(value) || value.length > 128 || value.some(item => !(typeof item === 'number' && Number.isFinite(item) || typeof item === 'string' && item.length <= 512))
                : typeof value !== type || type === 'number' && !Number.isFinite(value)) throw Error('SOURCE_UNSUPPORTED');
            parameters.push({ field, label, value: type === 'array' ? [...value] : value });
        }
    }
    const value = { parameters, bodies };
    if (JSON.stringify(value).length > MAX) throw Error('SOURCE_TOO_LARGE');
    return value;
}
export function readStPresetFamilies(selector, getContext) {
    const ctx = getContext?.();
    if (!ctx || typeof ctx.getPresetManager !== 'function') throw Error('SOURCE_UNAVAILABLE');
    const mainApi = typeof ctx.mainApi === 'string' && ctx.mainApi.length <= 80 ? ctx.mainApi : 'unknown';
    if (!selector) {
        const families = kinds.map((family, index) => { try { const { names, ...row } = state(ctx, index); return { ...row, ...(names ? { count: names.length } : {}) }; } catch (error) { return { index, family, label: labels[index], status: ['SOURCE_TOO_LARGE', 'SOURCE_UNSUPPORTED'].includes(error.message) ? error.message : 'unavailable' }; } });
        return pack({ kind: 'directory', mainApi, families, selectors: 'mode:N; mode:N:current; mode:N:saved:M; mode:N:compare:M; mode:N:current:field:K; mode:N:saved:M:field:K', notice: note }, false, families);
    }
    const match = /^mode:([0-7])(?::(current|saved:(0|[1-9]\d{0,2})|compare:(0|[1-9]\d{0,2}))(?::field:(0|[1-9]\d{0,2}))?)?$/.exec(selector);
    if (!match || match[2]?.startsWith('compare:') && match[5] !== undefined) throw Error('INVALID_SELECTOR');
    const index = Number(match[1]), directory = state(ctx, index);
    if (index === 3) throw Error('SOURCE_UNSUPPORTED');
    if (!match[2]) return pack({ kind: 'directory', ...directory, presets: directory.names.map((name, index) => ({ index, name })), notice: note }, false, directory);
    const manager = ctx.getPresetManager(kinds[index]);
    function current() {
        const raw = index >= 4 ? ctx.powerUserSettings?.[kinds[index]] : null;
        if (object(raw)) return project(raw, index);
        if (typeof manager.getPresetSettings === 'function') return project(manager.getPresetSettings(directory.selected), index);
        if (index === 2) return project(ctx.textCompletionSettings, index);
        throw Error('SOURCE_UNAVAILABLE');
    }
    const live = match[2] === 'current', compared = match[2].startsWith('compare:'), savedIndex = Number(match[3] ?? match[4]);
    if (!live && savedIndex >= directory.names.length) throw Error('INVALID_SELECTOR');
    if (!live && typeof manager.getCompletionPresetByName !== 'function') throw Error('SOURCE_UNAVAILABLE');
    const value = live ? current() : project(manager.getCompletionPresetByName(directory.names[savedIndex]), index);
    let data, identity = { directory, mainApi, value };
    if (compared) {
        const now = current(); identity.current = now;
        const fields = [...new Set([...value.parameters, ...now.parameters].map(row => row.field))];
        data = { kind: 'comparison', parameters: fields.flatMap(field => {
            const saved = value.parameters.find(row => row.field === field), current = now.parameters.find(row => row.field === field);
            return JSON.stringify(saved) === JSON.stringify(current) ? [] : [{ field, label: (saved || current).label, savedPresent: !!saved, currentPresent: !!current, ...(saved ? { saved: saved.value } : {}), ...(current ? { current: current.value } : {}) }];
        }), changedBodyFields: [...new Set([...value.bodies, ...now.bodies].map(row => row.field))].filter(field => value.bodies.find(row => row.field === field)?.text !== now.bodies.find(row => row.field === field)?.text), bodyIncluded: false };
    } else if (match[5] !== undefined) {
        const field = value.bodies[Number(match[5])]; if (!field) throw Error('INVALID_SELECTOR');
        data = { kind: live ? 'current-field' : 'saved-field', ...field };
    } else data = { kind: live ? 'current-settings' : 'saved-resource', parameters: value.parameters, fields: value.bodies.map(({ text, ...field }, index) => ({ ...field, index, contentChars: text.length })) };
    function coverage(projected, scope) {
        const present = new Set([...projected.parameters, ...projected.bodies].map(row => row.field));
        return { scope, absentFields: specs[index].map(([field]) => field).filter(field => !present.has(field)) };
    }
    const evidence = {
        ...(compared ? { scope: 'snapshot-comparison', saved: coverage(value, 'host-loaded-saved-resource'), current: coverage(identity.current, 'current-memory') }
            : coverage(value, live ? 'current-memory' : 'host-loaded-saved-resource')),
        bodyCoverage: compared ? 'changed-field-names-only' : match[5] !== undefined ? 'selected-field-only' : 'field-metadata-only',
        notObserved: ['final-request', 'execution-history', 'persistence'],
        missingMeaning: 'Allowed field absent in this object; not unsupported, an inferred default or a deletion event. Differences do not establish who changed a value or why.',
    };
    return pack({ evidence, ...data, family: directory.family, label: directory.label, mainApi, selectedName: directory.selected, ...(live ? {} : { savedName: directory.names[savedIndex] }), notice: note }, false, identity);
}
