const DEFAULT_LOG_LIMIT = 100;

const BUILTIN_TEMPLATES = [
    { id: 'story_phase', label: 'Story Phase', labelZh: '故事阶段', scope: 'global', type: 'string', value: '', rule: 'Update when the story phase clearly changes. Keep it short.', ruleZh: '当故事阶段明确变化时更新，保持简短。', showInDashboard: true },
    { id: 'current_goal', label: 'Current Goal', labelZh: '当前目标', scope: 'global', type: 'string', value: '', rule: 'Update when the active narrative goal changes.', ruleZh: '当当前叙事目标变化时更新。', showInDashboard: true },
    { id: 'current_location', label: 'Current Location', labelZh: '当前位置', scope: 'global', type: 'string', value: '', rule: 'Update when the active scene moves to a new location.', ruleZh: '当当前场景移动到新地点时更新。', showInDashboard: true },
    { id: 'current_mood', label: 'Current Mood', labelZh: '当前气氛', scope: 'global', type: 'string', value: '', rule: 'Update when the scene atmosphere noticeably changes.', ruleZh: '当场景气氛明显变化时更新。', showInDashboard: true },
    { id: 'current_chapter', label: 'Current Chapter', labelZh: '当前章节', scope: 'global', type: 'string', value: '', rule: 'Update when the story enters a new chapter, act, or major narrative segment.', ruleZh: '当故事进入新章节、新幕或重要叙事段落时更新。', showInDashboard: true },
    { id: 'current_scene', label: 'Current Scene', labelZh: '当前场景', scope: 'global', type: 'string', value: '', rule: 'Update when the immediate scene changes. Keep it as a short scene name.', ruleZh: '当当前即时场景变化时更新，保持为简短场景名。', showInDashboard: true },
    { id: 'scene_goal', label: 'Scene Goal', labelZh: '场景目标', scope: 'global', type: 'string', value: '', rule: 'Track what the current scene is trying to resolve or reveal.', ruleZh: '记录当前场景要解决、推进或揭示的目标。', showInDashboard: true },
    { id: 'current_date', label: 'Current Date', labelZh: '当前日期', scope: 'global', type: 'string', value: '', rule: 'Update when the in-story date changes or becomes clear.', ruleZh: '当故事内日期变化或被明确时更新。', showInDashboard: true },
    { id: 'current_time', label: 'Current Time', labelZh: '当前时间', scope: 'global', type: 'string', value: '', rule: 'Update when the in-story time of day changes or becomes clear.', ruleZh: '当故事内时间段变化或被明确时更新。', showInDashboard: true },
    { id: 'weather', label: 'Weather', labelZh: '天气', scope: 'global', type: 'string', value: '', rule: 'Update when weather is mentioned or changes in the active scene.', ruleZh: '当当前场景提到天气或天气发生变化时更新。', showInDashboard: true },
    { id: 'currency', label: 'Currency', labelZh: '当前货币', scope: 'global', type: 'string', value: '', rule: 'Track the main currency currently used in the setting or scene.', ruleZh: '记录当前世界或场景中主要使用的货币。', showInDashboard: true },
    { id: 'party_funds', label: 'Party Funds', labelZh: '队伍资金', scope: 'global', type: 'number', value: 0, rule: 'Adjust when the group gains or spends money. Use deltas for changes.', ruleZh: '当队伍获得或花费金钱时调整，变化时使用增减值。', updateMode: 'delta', min: 0, showInDashboard: true },
    { id: 'important_items', label: 'Important Items', labelZh: '重要物品', scope: 'global', type: 'array', value: [], rule: 'Add or remove only important items that affect the plot or current problem.', ruleZh: '只记录会影响剧情或当前问题的重要物品。', updateMode: 'append', showInDashboard: true },
    { id: 'active_quest', label: 'Active Quest', labelZh: '当前委托', scope: 'global', type: 'string', value: '', rule: 'Track the current mission, commission, request, or main task if one exists.', ruleZh: '记录当前任务、委托、请求或主线事项。', showInDashboard: true },
    { id: 'danger_level', label: 'Danger Level', labelZh: '危险等级', scope: 'global', type: 'number', value: 0, rule: 'Adjust when the overall danger increases or decreases. Range 0-100.', ruleZh: '当整体危险程度上升或下降时调整，范围 0-100。', updateMode: 'delta', min: 0, max: 100, showInDashboard: true },
    { id: 'plot_threads', label: 'Open Plot Threads', labelZh: '未解决线索', scope: 'global', type: 'array', value: [], rule: 'Track unresolved clues, promises, conflicts, or open questions.', ruleZh: '记录尚未解决的线索、承诺、冲突或悬念。', updateMode: 'append', showInDashboard: false },
    { id: 'trust_user', label: 'Trust Toward User', labelZh: '对用户信任度', scope: 'character', type: 'number', value: 50, rule: 'Adjust only when this character gains or loses trust in the user. Use small deltas.', ruleZh: '仅当该角色对用户的信任发生变化时调整，使用小幅增减。', updateMode: 'delta', min: 0, max: 100, showInDashboard: true },
    { id: 'emotion', label: 'Emotion', labelZh: '情绪', scope: 'character', type: 'string', value: '', rule: 'Track the character current dominant emotion in a few words.', ruleZh: '用几个词记录角色当前的主要情绪。', showInDashboard: true },
    { id: 'suspicion', label: 'Suspicion', labelZh: '怀疑度', scope: 'character', type: 'number', value: 0, rule: 'Adjust when this character becomes more or less suspicious. Use small deltas.', ruleZh: '当角色怀疑增加或降低时调整，使用小幅增减。', updateMode: 'delta', min: 0, max: 100, showInDashboard: true },
    { id: 'relationship_user', label: 'Relationship With User', labelZh: '与用户关系', scope: 'character', type: 'string', value: '', rule: 'Track the character relationship stance toward the user in a short phrase.', ruleZh: '用简短短语记录该角色与用户的关系状态。', showInDashboard: true },
    { id: 'character_location', label: 'Character Location', labelZh: '角色位置', scope: 'character', type: 'string', value: '', rule: 'Update when this character moves to a different meaningful location.', ruleZh: '当该角色移动到不同的重要地点时更新。', showInDashboard: true },
    { id: 'character_status', label: 'Character Status', labelZh: '角色状态', scope: 'character', type: 'string', value: '', rule: 'Track notable conditions such as injured, hidden, captured, exhausted, or busy.', ruleZh: '记录受伤、隐藏、被俘、疲惫、忙碌等值得追踪的状态。', showInDashboard: true },
    { id: 'health', label: 'Health', labelZh: '生命值', scope: 'character', type: 'number', value: 100, rule: 'Adjust when this character is hurt or recovers. Range 0-100.', ruleZh: '当该角色受伤或恢复时调整，范围 0-100。', updateMode: 'delta', min: 0, max: 100, showInDashboard: true },
    { id: 'inventory', label: 'Inventory', labelZh: '随身物品', scope: 'character', type: 'array', value: [], rule: 'Track only items this character carries that matter to the story or current scene.', ruleZh: '只记录该角色随身携带且对剧情或当前场景有意义的物品。', updateMode: 'append', showInDashboard: false },
];

function slugifyId(input) {
    return String(input || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64);
}

function clone(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
}

function validateImportData(obj) {
    if (!obj || typeof obj !== 'object') return { ok: false, error: 'Not a valid JSON object' };
    if (obj.type && obj.type !== 'group-director-variables') return { ok: false, error: 'Not a variables export file' };
    const payload = obj.variables || obj;
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'Missing variables payload' };
    if (!Array.isArray(payload.defs)) return { ok: false, error: 'Missing variables.defs array' };
    if (!payload.values || typeof payload.values !== 'object') return { ok: false, error: 'Missing variables.values object' };
    return { ok: true, variables: payload };
}

function ensureStore(chatMetadata, EXT_KEY) {
    if (!chatMetadata[EXT_KEY]) chatMetadata[EXT_KEY] = {};
    const root = chatMetadata[EXT_KEY];
    if (!root.variables) root.variables = {};
    const vars = root.variables;
    if (!vars.defs) vars.defs = [];
    if (!vars.values) vars.values = { global: {}, character: {} };
    if (!vars.values.global) vars.values.global = {};
    if (!vars.values.character) vars.values.character = {};
    if (!Array.isArray(vars.log)) vars.log = [];
    return vars;
}

function normalizeDefinition(def = {}) {
    const id = slugifyId(def.id || def.label || 'unnamed_variable');
    const type = ['string', 'number', 'boolean', 'enum', 'object', 'array'].includes(def.type) ? def.type : 'string';
    const scope = def.scope === 'character' ? 'character' : 'global';
    const updateMode = ['replace', 'append', 'merge', 'delta'].includes(def.updateMode) ? def.updateMode : 'replace';
    const injectMode = def.injectMode === 'manual' ? 'manual' : 'always';
    return {
        id,
        label: String(def.label || id),
        labelZh: def.labelZh ? String(def.labelZh) : '',
        scope,
        type,
        defaultValue: def.defaultValue !== undefined ? def.defaultValue : (def.value !== undefined ? def.value : defaultForType(type)),
        rule: String(def.rule || ''),
        ruleZh: def.ruleZh ? String(def.ruleZh) : '',
        autoUpdate: def.autoUpdate !== false,
        injectMode,
        updateMode,
        min: def.min === '' || def.min === null || def.min === undefined ? null : Number(def.min),
        max: def.max === '' || def.max === null || def.max === undefined ? null : Number(def.max),
        enumValues: Array.isArray(def.enumValues) ? def.enumValues.map(String).filter(Boolean) : parseEnumValues(def.enumValues),
        showInDashboard: def.showInDashboard !== false,
        locked: !!def.locked,
        dashboardOrder: Number.isFinite(Number(def.dashboardOrder)) ? Number(def.dashboardOrder) : 100,
    };
}

function parseEnumValues(raw) {
    if (!raw) return [];
    return String(raw).split(',').map(s => s.trim()).filter(Boolean);
}

function defaultForType(type) {
    if (type === 'number') return 0;
    if (type === 'boolean') return false;
    if (type === 'array') return [];
    if (type === 'object') return {};
    return '';
}

function coerceValue(def, incoming, oldValue) {
    let value = incoming;
    const mode = def.updateMode;

    if (def.type === 'number') {
        if (mode === 'delta' && typeof value === 'string' && /^[+-]?\s*(?:\d+(\.\d+)?|\.\d+)$/.test(value.trim())) {
            value = Number(oldValue || 0) + Number(value.replace(/\s+/g, ''));
        } else if (mode === 'delta' && typeof value === 'number') {
            value = Number(oldValue || 0) + value;
        } else {
            value = Number(value);
        }
        if (!Number.isFinite(value)) return { ok: false, error: 'not a finite number' };
        if (Number.isFinite(def.min)) value = Math.max(def.min, value);
        if (Number.isFinite(def.max)) value = Math.min(def.max, value);
        return { ok: true, value };
    }

    if (def.type === 'boolean') {
        if (typeof value === 'number') {
            if (value === 1) value = true;
            else if (value === 0) value = false;
        }
        if (typeof value === 'string') {
            const lower = value.trim().toLowerCase();
            if (['true', 'yes', '1', 'on'].includes(lower)) value = true;
            else if (['false', 'no', '0', 'off'].includes(lower)) value = false;
        }
        return { ok: typeof value === 'boolean', value, error: 'not a boolean' };
    }

    if (def.type === 'enum') {
        value = String(value ?? '');
        if (def.enumValues.length && !def.enumValues.includes(value)) {
            return { ok: false, error: `not in enum: ${def.enumValues.join(', ')}` };
        }
        return { ok: true, value };
    }

    if (def.type === 'array') {
        if (mode === 'append') {
            const base = Array.isArray(oldValue) ? oldValue.slice() : [];
            return { ok: true, value: base.concat(Array.isArray(value) ? value : [value]) };
        }
        if (!Array.isArray(value)) {
            if (typeof value === 'string') {
                try { value = JSON.parse(value); } catch (_) {}
            }
        }
        return { ok: Array.isArray(value), value, error: 'not an array' };
    }

    if (def.type === 'object') {
        if (typeof value === 'string') {
            try { value = JSON.parse(value); } catch (_) {}
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'not an object' };
        if (mode === 'merge' && oldValue && typeof oldValue === 'object' && !Array.isArray(oldValue)) {
            return { ok: true, value: { ...oldValue, ...value } };
        }
        return { ok: true, value };
    }

    value = String(value ?? '');
    if (mode === 'append' && oldValue) value = `${oldValue}\n${value}`;
    return { ok: true, value };
}

function formatValue(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function simpleHash(input) {
    let hash = 5381;
    const text = String(input || '');
    for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash) + text.charCodeAt(i);
    return (hash >>> 0).toString(36);
}

export function createVariableSystem({ chat_metadata, getChatMetadata, EXT_KEY, saveChatConditional, getCharacters, getCurrentGroup, getChat, getLang, log = console.log }) {
    function store() { return ensureStore(getChatMetadata ? getChatMetadata() : chat_metadata, EXT_KEY); }
    function characters() { return getCharacters?.() || []; }
    function activeCharacters() {
        const list = characters();
        const group = getCurrentGroup?.();
        if (!group?.members?.length) return list;
        const enabled = group.members.filter(a => !group.disabled_members?.includes(a));
        return enabled.map(a => list.find(c => c.avatar === a)).filter(Boolean);
    }
    function lang() { return getLang?.() || 'en'; }
    function localizeTemplate(tpl) {
        if (lang() !== 'zh') return clone(tpl);
        const localized = clone(tpl);
        localized.label = tpl.labelZh || tpl.label;
        localized.rule = tpl.ruleZh || tpl.rule;
        return localized;
    }

    function getDefs() {
        return store().defs.map(normalizeDefinition);
    }

    function saveDefs(defs) {
        const seen = new Set();
        store().defs = defs.map(normalizeDefinition).filter(d => {
            if (!d.id || seen.has(d.id)) return false;
            seen.add(d.id);
            return true;
        });
        saveChatConditional?.();
    }

    function getDefinition(id) {
        return getDefs().find(d => d.id === id) || null;
    }

    function upsertDefinition(def) {
        const normalized = normalizeDefinition(def);
        const vars = store();
        const idx = vars.defs.findIndex(d => d.id === normalized.id);
        if (idx >= 0) {
            const old = normalizeDefinition(vars.defs[idx]);
            if (old.scope !== normalized.scope) {
                if (old.scope === 'global') delete vars.values.global[normalized.id];
                else delete vars.values.character[normalized.id];
            }
            vars.defs[idx] = { ...vars.defs[idx], ...normalized };
        }
        else vars.defs.push(normalized);
        if (normalized.scope === 'global' && vars.values.global[normalized.id] === undefined) {
            vars.values.global[normalized.id] = clone(normalized.defaultValue);
        }
        saveChatConditional?.();
        return normalized;
    }

    function deleteDefinition(id) {
        const vars = store();
        vars.defs = vars.defs.filter(d => d.id !== id);
        delete vars.values.global[id];
        delete vars.values.character[id];
        vars.log = vars.log.filter(e => e?.id !== id);
        saveChatConditional?.();
    }

    function addTemplate(templateId) {
        const tpl = BUILTIN_TEMPLATES.find(t => t.id === templateId);
        if (!tpl) return null;
        return upsertDefinition(localizeTemplate(tpl));
    }

    function normalizeTargetText(value) {
        return String(value || '').trim().toLowerCase();
    }

    function resolveAvatar(target) {
        if (!target) return null;
        const text = String(target).trim();
        const list = activeCharacters();
        return list.find(c => c.avatar === text)?.avatar
            || list.find(c => c.name === text)?.avatar
            || list.find(c => normalizeTargetText(c.name) === normalizeTargetText(text))?.avatar
            || null;
    }

    function characterStorageKeys(target) {
        const avatar = resolveAvatar(target) || target;
        const character = activeCharacters().find(c => c.avatar === avatar) || characters().find(c => c.avatar === avatar);
        return [...new Set([
            avatar,
            ...(character ? [character.avatar, character.name] : []),
            target,
        ].map(v => String(v || '').trim()).filter(Boolean))];
    }

    function getValue(defOrId, targetAvatar = null) {
        const def = typeof defOrId === 'string' ? getDefinition(defOrId) : defOrId;
        if (!def) return undefined;
        const vars = store();
        if (def.scope === 'character') {
            const bucket = vars.values.character[def.id] || {};
            const avatar = resolveAvatar(targetAvatar) || targetAvatar;
            for (const key of characterStorageKeys(avatar)) {
                if (bucket[key] !== undefined) {
                    return bucket[key];
                }
            }
            return clone(def.defaultValue);
        }
        return vars.values.global[def.id] !== undefined ? vars.values.global[def.id] : clone(def.defaultValue);
    }

    function setValue(id, value, options = {}) {
        const def = getDefinition(id);
        if (!def) return { ok: false, error: 'unknown variable' };
        const avatar = def.scope === 'character' ? resolveAvatar(options.target) : null;
        if (def.scope === 'character' && !avatar) return { ok: false, error: 'unknown character target' };
        const oldValue = getValue(def, avatar);
        const coerced = coerceValue({ ...def, updateMode: options.updateMode || def.updateMode }, value, oldValue);
        if (!coerced.ok) return coerced;
        const vars = store();
        if (def.scope === 'character') {
            if (!vars.values.character[id]) vars.values.character[id] = {};
            vars.values.character[id][avatar] = coerced.value;
        } else {
            vars.values.global[id] = coerced.value;
        }
        pushLog({
            id,
            scope: def.scope,
            target: avatar,
            oldValue,
            newValue: coerced.value,
            reason: options.reason || '',
            source: options.source || 'manual',
            ignored: false,
        });
        saveChatConditional?.();
        return { ok: true, value: coerced.value };
    }

    function messageHash(message) {
        if (!message) return '';
        return simpleHash(JSON.stringify({
            name: message.name || '',
            is_user: !!message.is_user,
            is_system: !!message.is_system,
            mes: message.mes || '',
        }));
    }

    function currentMessageStamp() {
        const chat = getChat?.() || [];
        const messageId = chat.length ? chat.length - 1 : -1;
        return {
            messageId,
            chatLength: chat.length,
            messageHash: messageId >= 0 ? messageHash(chat[messageId]) : '',
        };
    }

    function pushLog(entry) {
        const vars = store();
        vars.log.push({
            ...entry,
            ...currentMessageStamp(),
            time: new Date().toISOString(),
        });
        while (vars.log.length > DEFAULT_LOG_LIMIT) vars.log.shift();
    }

    function sameTarget(a, b) {
        if (!a && !b) return true;
        if (!a || !b) return false;
        if (a === b) return true;
        const resolvedA = resolveAvatar(a) || a;
        const resolvedB = resolveAvatar(b) || b;
        return resolvedA === resolvedB;
    }

    function getLatestLog(id, target = null) {
        return store().log.slice().reverse().find(e => e && !e.ignored && e.id === id && sameTarget(e.target, target)) || null;
    }

    function getLogStaleState(entry) {
        if (!entry || entry.source === 'manual') return { stale: false, reason: '' };
        if (!Number.isInteger(entry.messageId) || entry.messageId < 0) return { stale: false, reason: '' };
        const chat = getChat?.() || [];
        if (entry.messageId >= chat.length) return { stale: true, reason: 'message-missing' };
        if (entry.messageHash && messageHash(chat[entry.messageId]) !== entry.messageHash) {
            return { stale: true, reason: 'message-changed' };
        }
        return { stale: false, reason: '' };
    }

    function getValueStatus(defOrId, target = null) {
        const def = typeof defOrId === 'string' ? getDefinition(defOrId) : defOrId;
        if (!def) return { stale: false, reason: '', latest: null };
        const latest = getLatestLog(def.id, def.scope === 'character' ? target : null);
        return { ...getLogStaleState(latest), latest };
    }

    function revertValue(id, target = null) {
        const def = getDefinition(id);
        if (!def) return { ok: false, error: 'unknown variable' };
        const avatar = def.scope === 'character' ? resolveAvatar(target) : null;
        if (def.scope === 'character' && !avatar) return { ok: false, error: 'unknown character target' };
        const latest = getLatestLog(id, avatar);
        if (!latest) return { ok: false, error: 'no previous record' };
        const previous = latest.oldValue !== undefined ? clone(latest.oldValue) : clone(def.defaultValue);
        return setValue(id, previous, {
            target: avatar,
            source: 'manual',
            reason: 'rollback',
            updateMode: 'replace',
        });
    }

    function applyUpdates(update, options = {}) {
        if (!update || typeof update !== 'object') return { applied: 0, ignored: 0, errors: [] };
        const errors = [];
        let applied = 0;
        let ignored = 0;

        const applyOne = (id, raw, target = null) => {
            const def = getDefinition(id);
            if (!def) { ignored++; return; }
            if (!def.autoUpdate || def.locked) {
                ignored++;
                pushLog({ id, scope: def.scope, target, oldValue: getValue(def, target), newValue: raw?.value ?? raw, reason: raw?.reason || '', source: options.source || 'director', ignored: true });
                return;
            }
            const value = raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw;
            const reason = raw && typeof raw === 'object' ? raw.reason || '' : '';
            const result = setValue(id, value, { target, reason, source: options.source || 'director' });
            if (result.ok) applied++;
            else { ignored++; errors.push(`${id}: ${result.error}`); }
        };

        if (update.global && typeof update.global === 'object') {
            for (const [id, raw] of Object.entries(update.global)) applyOne(id, raw);
        }
        if (update.character && typeof update.character === 'object') {
            for (const [target, values] of Object.entries(update.character)) {
                if (!values || typeof values !== 'object') continue;
                const avatar = resolveAvatar(target);
                if (!avatar) {
                    for (const [id, raw] of Object.entries(values)) {
                        ignored++;
                        const reason = raw && typeof raw === 'object' ? raw.reason || '' : '';
                        errors.push(`${id}: unknown character target "${target}"`);
                        pushLog({ id, scope: 'character', target, oldValue: undefined, newValue: raw?.value ?? raw, reason, source: options.source || 'director', ignored: true });
                    }
                    continue;
                }
                for (const [id, raw] of Object.entries(values)) applyOne(id, raw, avatar);
            }
        }
        if (errors.length) log('[Variables] update errors:', errors.join('; '));
        return { applied, ignored, errors };
    }

    function getSnapshot(context = {}) {
        const defs = getDefs();
        const list = activeCharacters();
        const byAvatar = Object.fromEntries(list.map(c => [c.avatar, c.name]));
        const global = {};
        const character = {};
        for (const def of defs) {
            if (def.scope === 'global') {
                global[def.id] = { ...def, value: getValue(def) };
            } else {
                const values = {};
                for (const c of list) values[c.avatar] = getValue(def, c.avatar);
                character[def.id] = { ...def, values, names: byAvatar };
            }
        }
        const currentAvatar = resolveAvatar(context.avatar) || resolveAvatar(context.character) || null;
        return {
            global,
            character,
            currentCharacter: currentAvatar,
            log: store().log.slice(-20),
        };
    }

    function getExportData(options = {}) {
        const vars = store();
        const payload = {
            defs: clone(vars.defs || []),
            values: clone(vars.values || { global: {}, character: {} }),
        };
        if (options.includeLog) payload.log = clone(vars.log || []);
        return payload;
    }

    function buildExportFile(options = {}) {
        return {
            version: 1,
            type: 'group-director-variables',
            exportedAt: new Date().toISOString(),
            variables: getExportData({ includeLog: options.includeLog !== false }),
        };
    }

    function applyImportData(data, options = {}) {
        const valid = validateImportData(data);
        if (!valid.ok) return valid;
        const incoming = valid.variables;
        const mode = options.mode || 'merge';
        const vars = store();

        if (mode === 'replace') {
            vars.defs = clone(incoming.defs || []);
            vars.values = clone(incoming.values || { global: {}, character: {} });
            vars.log = Array.isArray(incoming.log) ? clone(incoming.log) : vars.log;
        } else {
            const byId = new Map((vars.defs || []).map(d => [d.id, d]));
            for (const def of incoming.defs || []) {
                const normalized = normalizeDefinition(def);
                byId.set(normalized.id, normalized);
            }
            vars.defs = [...byId.values()];
            vars.values.global = { ...(vars.values.global || {}), ...(incoming.values?.global || {}) };
            vars.values.character = { ...(vars.values.character || {}) };
            for (const [id, bucket] of Object.entries(incoming.values?.character || {})) {
                vars.values.character[id] = { ...(vars.values.character[id] || {}), ...(bucket || {}) };
            }
            if (Array.isArray(incoming.log) && options.includeLog) {
                vars.log.push(...clone(incoming.log));
                while (vars.log.length > DEFAULT_LOG_LIMIT) vars.log.shift();
            }
        }
        saveChatConditional?.();
        return { ok: true, count: (incoming.defs || []).length };
    }

    function exportToFile(options = {}) {
        const json = buildExportFile(options);
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const date = new Date().toISOString().slice(0, 10);
        a.download = `group-director-variables-${date}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return json;
    }

    async function importFromFile(file, options = {}) {
        const text = await file.text();
        let json;
        try { json = JSON.parse(text); } catch (e) {
            return { ok: false, error: `Invalid JSON: ${e.message}` };
        }
        return applyImportData(json, options);
    }

    function renderGlobalVars() {
        const defs = getDefs().filter(d => d.scope === 'global');
        if (!defs.length) return '';
        return defs.map(d => `- ${d.label} (${d.id}): ${formatValue(getValue(d))}`).join('\n');
    }

    function renderCharVars(context = {}) {
        const defs = getDefs().filter(d => d.scope === 'character');
        if (!defs.length) return '';
        const avatar = resolveAvatar(context.avatar) || resolveAvatar(context.character);
        if (avatar) {
        const name = activeCharacters().find(c => c.avatar === avatar)?.name || characters().find(c => c.avatar === avatar)?.name || avatar;
            return [`[${name}]`, ...defs.map(d => `- ${d.label} (${d.id}): ${formatValue(getValue(d, avatar))}`)].join('\n');
        }
        return activeCharacters().map(c => {
            const lines = defs.map(d => `  - ${d.label} (${d.id}): ${formatValue(getValue(d, c.avatar))}`);
            return [`[${c.name}]`, ...lines].join('\n');
        }).join('\n');
    }

    function renderMaintenance() {
        const zh = lang() === 'zh';
        const defs = getDefs()
            .filter(d => d.autoUpdate && !d.locked && d.injectMode === 'always')
            .sort((a, b) => b.dashboardOrder - a.dashboardOrder);
        if (!defs.length) return '';
        const lines = zh
            ? [
                '[需要维护的变量]',
                '只有在对话提供明确依据时才更新这些变量。updateMode 为 delta 的数值变量请使用小幅增减。',
                '角色变量只能使用下面列出的角色名作为 character 对象的 key，不要使用头像文件名、卡文件名或自行缩写。',
            ]
            : [
                '[Variables to maintain]',
                'Update these only when the conversation gives clear evidence. Use small numeric deltas when updateMode is delta.',
                'For character variables, use only the character names listed below as keys in the character object. Do not use avatar filenames, card filenames, or invented aliases.',
            ];
        const names = activeCharacters().map(c => c.name).filter(Boolean);
        if (names.length) lines.push(`${zh ? '可用角色名' : 'Valid character names'}: ${names.map(n => JSON.stringify(n)).join(', ')}`);
        for (const d of defs) {
            if (d.scope === 'global') {
                lines.push(`- global.${d.id} (${d.type}, ${d.updateMode}) ${zh ? '当前值' : 'current'}=${formatValue(getValue(d))}`);
            } else {
                lines.push(`- character.*.${d.id} (${d.type}, ${d.updateMode}) ${zh ? '默认值' : 'default'}=${formatValue(d.defaultValue)}`);
            }
            if (d.rule) lines.push(`  ${zh ? '规则' : 'Rule'}: ${d.rule}`);
        }
        lines.push(zh ? '如需更新，请在可选 JSON 字段中返回：' : 'Return updates in this optional JSON field:');
        lines.push('"variable_update": { "global": { "var_id": { "value": "...", "reason": "..." } }, "character": { "Exact Character Name": { "var_id": { "value": "+1 or new value", "reason": "..." } } } }');
        return lines.join('\n');
    }

    return {
        getDefs,
        saveDefs,
        getDefinition,
        upsertDefinition,
        deleteDefinition,
        addTemplate,
        getTemplates: () => BUILTIN_TEMPLATES.map(localizeTemplate),
        resolveAvatar,
        getValue,
        setValue,
        applyUpdates,
        getExportData,
        buildExportFile,
        applyImportData,
        exportToFile,
        importFromFile,
        getSnapshot,
        renderGlobalVars,
        renderCharVars,
        renderMaintenance,
        getLog: () => store().log.slice(),
        getValueStatus,
        revertValue,
    };
}
