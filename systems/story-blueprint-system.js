import {
    assertExecutionSnapshot,
    captureExecutionSnapshot,
    staleExecutionError,
} from './execution-snapshot.js';

const DEFAULT_COMPLETION_VARIABLE = 'gd_story_chapter_done';

export const DEFAULT_STORY_BLUEPRINT_SCHEMA = `Reply with ONLY a JSON object, no prose, no code fences:
{
  "version": 1,
  "title": "story blueprint title",
  "meta": {
    "premise": "short premise",
    "style": "genre, tone, pacing"
  },
  "nodes": [
    {
      "id": "node_001",
      "type": "chapter",
      "title": "Chapter title",
      "content": {
        "purpose": "why this block exists",
        "director_prompt": "how the Director should guide this block",
        "completion_rule": "when this block counts as complete"
      },
      "children": []
    }
  ]
}`;

export const DEFAULT_STORY_BLUEPRINT_TEMPLATE = `[Story Blueprint]
Story: {{blueprint.title}}
Progress: {{progress.current}} / {{progress.total}}

Current Path:
{{current.path}}

Current Step JSON:
{{current.nodeJson}}

When and only when the current step is complete, set:
variable_update.global.{{completionVariable}} = true

Otherwise keep it false.`;

export const DEFAULT_STORY_BLUEPRINT_PROMPT_ZH = `请基于当前群聊上下文，生成一份结构化故事蓝图。

[最近消息]
{{newRecentMessages}}

[可用角色]
{{characters}}

[角色档案]
{{character_profiles}}

[世界信息]
{{worldInfo}}

[世界书无条件设定]
{{gdWorldBooksConstant}}

[导演账本]
{{directorLedger}}

[上下文总结]
{{chatSummary}}

[已有故事蓝图（如有）]
{{storyBlueprintFullJson}}

[当前蓝图进度（如有）]
{{storyBlueprintProgress}}

如果已有故事蓝图，优先保护已有连续性和已发生剧情；除非用户明确要重启，不要与旧蓝图的核心事件矛盾。

目标：
- 蓝图只描述“接下来故事可以如何推进”，不要记录运行进度。
- 使用动态 nodes 树，可以是一层，也可以有章、节、小结等多层。
- 每个可推进节点都要有稳定 id、type、title、content、children。
- content 是自由对象，但建议包含 purpose、director_prompt、completion_rule。
- director_prompt 负责指导 Director 如何推进当前节点。
- completion_rule 负责告诉 Director 什么时候可以把完成变量设为 true。
- 角色安排要符合可用角色的设定、关系和当前状态。
- 世界设定、地点、势力、道具、规则等应优先来自世界书/世界信息。
- 尊重玩家行动，不要在蓝图中强制替玩家做决定。

请生成约 {{storyBlueprintMaxNodes}} 个适合逐步推进的叶子节点。`;

export const DEFAULT_STORY_BLUEPRINT_PROMPT_EN = `Generate a structured Story Blueprint from the current group-chat context.

[Recent messages]
{{newRecentMessages}}

[Available characters]
{{characters}}

[Character profiles]
{{character_profiles}}

[World info]
{{worldInfo}}

[Always-on world book entries]
{{gdWorldBooksConstant}}

[Director ledger]
{{directorLedger}}

[Chat summary]
{{chatSummary}}

[Existing Story Blueprint, if any]
{{storyBlueprintFullJson}}

[Current blueprint progress, if any]
{{storyBlueprintProgress}}

Goals:
- The blueprint describes how the story can proceed next. Do not store runtime progress in it.
- Use a dynamic nodes tree. It may be flat, or it may contain chapters, sections, beats, or deeper layers.
- Each node should have a stable id, type, title, content, and children.
- content is free-form, but purpose, director_prompt, and completion_rule are recommended.
- director_prompt guides the Director on how to advance the current node.
- completion_rule tells the Director when it may set the completion variable to true.
- Character usage should fit the available characters' profiles, relationships, and current state.
- World details, locations, factions, items, and rules should come primarily from world book / world info.
- Respect player agency. Do not force or overwrite user actions in the blueprint.
- If an existing Story Blueprint is present, preserve established continuity and played events unless the user clearly wants a restart. Do not contradict the old blueprint's core events.

Generate about {{storyBlueprintMaxNodes}} leaf-level progression nodes.`;

export const DEFAULT_STORY_BLUEPRINT_CONTINUE_PROMPT_ZH = `请基于现有故事蓝图、当前进度和最近群聊上下文，续写下一段故事蓝图。

[当前进度]
{{storyBlueprintProgress}}

[现有蓝图]
{{storyBlueprintFullJson}}

[最近消息]
{{newRecentMessages}}

[可用角色]
{{characters}}

[角色档案]
{{character_profiles}}

[世界信息]
{{worldInfo}}

[世界书无条件设定]
{{gdWorldBooksConstant}}

[导演账本]
{{directorLedger}}

[上下文总结]
{{chatSummary}}

续写必须保护已有蓝图的连续性，不要重复已完成节点，不要推翻已经发生的关键事件。

要求：
- 不要重写旧蓝图，只输出要追加的新蓝图片段。
- 新节点应自然承接现有蓝图的最后阶段。
- 继续使用动态 nodes 树结构。
- 每个可推进节点都要有稳定 id、type、title、content、children。
- content 建议包含 purpose、director_prompt、completion_rule。
- 续写内容要尊重角色设定、世界书信息和已发生剧情。
- 不要记录运行进度，不要包含 done/status/currentIndex。

请续写约 {{storyBlueprintMaxNodes}} 个适合逐步推进的叶子节点。`;

export const DEFAULT_STORY_BLUEPRINT_CONTINUE_PROMPT_EN = `Continue the existing Story Blueprint from the current progress and recent group-chat context.

[Current progress]
{{storyBlueprintProgress}}

[Existing blueprint]
{{storyBlueprintFullJson}}

[Recent messages]
{{newRecentMessages}}

[Available characters]
{{characters}}

[Character profiles]
{{character_profiles}}

[World info]
{{worldInfo}}

[Always-on world book entries]
{{gdWorldBooksConstant}}

[Director ledger]
{{directorLedger}}

[Chat summary]
{{chatSummary}}

Requirements:
- Do not rewrite the old blueprint. Output only the new blueprint segment to append.
- New nodes should naturally follow the current blueprint's latest stage.
- Keep using the dynamic nodes tree structure.
- Each progression node should have a stable id, type, title, content, and children.
- content should usually include purpose, director_prompt, and completion_rule.
- Continue from established character details, world book context, and already-played plot.
- Do not store runtime progress. Do not include done, status, or currentIndex.
- Preserve existing blueprint continuity. Do not repeat completed nodes or contradict key events that already happened.

Generate about {{storyBlueprintMaxNodes}} leaf-level progression nodes.`;

function clone(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; }
}

function sameJsonValue(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function findMatchingArrayValues(left, right) {
    const leftKeys = left.map(value => JSON.stringify(value));
    const rightKeys = right.map(value => JSON.stringify(value));
    const table = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
    for (let i = left.length - 1; i >= 0; i--) {
        for (let j = right.length - 1; j >= 0; j--) {
            table[i][j] = leftKeys[i] === rightKeys[j]
                ? table[i + 1][j + 1] + 1
                : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }
    const matches = [];
    for (let i = 0, j = 0; i < left.length && j < right.length;) {
        if (leftKeys[i] === rightKeys[j]) matches.push([i++, j++]);
        else if (table[i + 1][j] >= table[i][j + 1]) i++;
        else j++;
    }
    return matches;
}

function rollbackJsonArray(previous = [], applied = [], current = []) {
    const appliedToPrevious = new Map(findMatchingArrayValues(previous, applied).map(([before, after]) => [after, before]));
    const matches = [[-1, -1], ...findMatchingArrayValues(applied, current), [applied.length, current.length]];
    const result = clone(previous);
    for (let gap = matches.length - 2; gap >= 0; gap--) {
        const [leftApplied, leftCurrent] = matches[gap];
        const [rightApplied, rightCurrent] = matches[gap + 1];
        const removedIndexes = [];
        for (let index = leftApplied + 1; index < rightApplied; index++) {
            if (appliedToPrevious.has(index)) removedIndexes.push(appliedToPrevious.get(index));
        }
        const inserted = current.slice(leftCurrent + 1, rightCurrent);
        if (!removedIndexes.length && !inserted.length) continue;
        let insertAt;
        if (removedIndexes.length) {
            insertAt = Math.min(...removedIndexes);
            for (const index of removedIndexes.sort((a, b) => b - a)) result.splice(index, 1);
        } else {
            let anchor = leftApplied;
            while (anchor >= 0 && !appliedToPrevious.has(anchor)) anchor--;
            if (anchor >= 0) insertAt = appliedToPrevious.get(anchor) + 1;
            else {
                anchor = rightApplied;
                while (anchor < applied.length && !appliedToPrevious.has(anchor)) anchor++;
                insertAt = anchor < applied.length ? appliedToPrevious.get(anchor) : result.length;
            }
        }
        result.splice(insertAt, 0, ...clone(inserted));
    }
    return result;
}

function isJsonObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function rollbackJsonValue(previous, applied, current) {
    if (sameJsonValue(current, applied)) return clone(previous);
    if (sameJsonValue(previous, applied)) return clone(current);
    if (Array.isArray(applied) && Array.isArray(current)) {
        return rollbackJsonArray(Array.isArray(previous) ? previous : [], applied, current);
    }
    if (!isJsonObject(applied) || !isJsonObject(current)) return clone(current);
    const result = {};
    const keys = new Set([
        ...Object.keys(isJsonObject(previous) ? previous : {}),
        ...Object.keys(applied),
        ...Object.keys(current),
    ]);
    for (const key of keys) {
        const value = rollbackJsonValue(previous?.[key], applied[key], current[key]);
        if (value !== undefined) result[key] = value;
    }
    return result;
}

function getChatLength(getChat) {
    return getChat?.()?.length ?? 0;
}

function slug(input) {
    return String(input || 'node')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_\-\u4e00-\u9fff]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48) || 'node';
}

function variableId(input) {
    return String(input || DEFAULT_COMPLETION_VARIABLE)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64) || DEFAULT_COMPLETION_VARIABLE;
}

function ensureArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeNode(node, path = []) {
    const obj = node && typeof node === 'object' && !Array.isArray(node) ? (clone(node) || {}) : {};
    const indexPath = path.join('_') || '0';
    if (!obj.id) obj.id = `${slug(obj.type || obj.title || 'node')}_${indexPath}`;
    if (!obj.type) obj.type = 'node';
    if (!obj.title) obj.title = obj.id;
    if (!obj.content || typeof obj.content !== 'object' || Array.isArray(obj.content)) {
        const { id, type, title, children, content, ...rest } = obj;
        obj.content = Object.keys(rest).length ? rest : {};
        if (content !== undefined && content !== null && content !== '') {
            obj.content.text = String(content);
        }
    }
    obj.children = ensureArray(obj.children).map((child, idx) => normalizeNode(child, path.concat(idx)));
    return obj;
}

function normalizeBlueprint(input) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? (clone(input) || {}) : {};
    if (!source.version) source.version = 1;
    if (!source.title) source.title = 'Story Blueprint';
    if (!source.meta || typeof source.meta !== 'object' || Array.isArray(source.meta)) source.meta = {};
    if (!Array.isArray(source.nodes) && Array.isArray(source.chapters)) {
        source.nodes = source.chapters;
        delete source.chapters;
    }
    source.nodes = ensureArray(source.nodes).map((node, idx) => normalizeNode(node, [idx]));
    const usedIds = new Set();
    source.nodes = source.nodes.map(node => uniquifyNodeIds(node, usedIds, 'dup'));
    return source;
}

function collectNodeIds(nodes, ids = new Set()) {
    for (const node of ensureArray(nodes)) {
        if (node?.id) ids.add(node.id);
        collectNodeIds(node?.children, ids);
    }
    return ids;
}

function uniquifyNodeIds(node, usedIds, suffixBase = 'cont') {
    if (!node || typeof node !== 'object') return node;
    const original = node.id || slug(node.title || node.type || 'node');
    let candidate = original;
    let i = 1;
    while (usedIds.has(candidate)) {
        candidate = `${original}_${suffixBase}_${i++}`;
    }
    node.id = candidate;
    usedIds.add(candidate);
    node.children = ensureArray(node.children).map(child => uniquifyNodeIds(child, usedIds, suffixBase));
    return node;
}

function findNodeById(nodes, id) {
    for (const node of ensureArray(nodes)) {
        if (node?.id === id) return node;
        const child = findNodeById(node?.children, id);
        if (child) return child;
    }
    return null;
}

function removeNodeById(nodes, id) {
    const list = ensureArray(nodes);
    const idx = list.findIndex(node => node?.id === id);
    if (idx >= 0) {
        list.splice(idx, 1);
        return true;
    }
    for (const node of list) {
        if (removeNodeById(node?.children, id)) return true;
    }
    return false;
}

function flattenNodes(nodes, options = {}, parents = [], depth = 0, out = []) {
    const mode = options.mode || 'leaf';
    const level = Number(options.level || 0);
    for (const node of ensureArray(nodes)) {
        const path = parents.concat(node);
        const isLeaf = !node.children || node.children.length === 0;
        const include = mode === 'all' || (mode === 'level' ? depth === level : isLeaf);
        if (include) {
            out.push({
                id: node.id,
                node,
                depth,
                path,
                pathText: path.map(n => n.title || n.id).join(' > '),
            });
        }
        flattenNodes(node.children, options, path, depth + 1, out);
    }
    return out;
}

function renderObject(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
}

    function renderTemplate(template, data) {
    return String(template || '').replace(/\{\{([^}]+)\}\}/g, (match, rawPath) => {
        const path = rawPath.trim().split('.');
        let cur = data;
        for (const key of path) {
            if (cur === undefined || cur === null) return '';
            cur = cur[key];
        }
        return renderObject(cur);
    });
}

function renderInlineSettings(template, settings) {
    return String(template || '')
        .replace(/\{\{storyBlueprintMaxNodes\}\}/g, String(settings.storyBlueprintMaxNodes || 8));
}

function validateImportData(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: 'Not a JSON object' };
    const payload = obj.type === 'group-director-story-blueprint' ? obj.storyBlueprint : obj;
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'Missing storyBlueprint payload' };
    const blueprint = payload.blueprint || payload;
    if (!blueprint || typeof blueprint !== 'object') return { ok: false, error: 'Missing blueprint object' };
    if (!Array.isArray(blueprint.nodes) && !Array.isArray(blueprint.chapters)) return { ok: false, error: 'Missing nodes array' };
    return { ok: true, payload };
}

function sanitizeDoneSignals(doneSignals, steps, chatLength, source = 'import') {
    const incoming = Array.isArray(doneSignals) ? doneSignals : [];
    const byId = new Map();
    for (const signal of incoming) {
        if (!signal?.nodeId || byId.has(signal.nodeId)) continue;
        byId.set(signal.nodeId, signal);
    }

    const sanitized = [];
    for (let i = 0; i < steps.length; i++) {
        const signal = byId.get(steps[i].id);
        if (!signal) break;
        sanitized.push({
            nodeId: steps[i].id,
            stepIndex: i,
            chatLength: Number.isFinite(Number(signal.chatLength)) ? Math.min(Number(signal.chatLength), chatLength) : chatLength,
            time: Number.isFinite(Number(signal.time)) ? Number(signal.time) : Date.now(),
            source: signal.source || source,
        });
    }
    return sanitized;
}

// Recovery copies may be sparse or come from a different progression mode.
// Validate against every node without promoting them into the active progress.
function sanitizeLegacyDoneSignals(signals, nodes, chatLength) {
    const steps = flattenNodes(nodes, { mode: 'all', level: 0 });
    const indexes = new Map(steps.map((step, index) => [step.id, index]));
    const seen = new Set();
    const numeric = value => typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
    return signals.flatMap(signal => {
        if (!isJsonObject(signal) || typeof signal.nodeId !== 'string' || !indexes.has(signal.nodeId) || seen.has(signal.nodeId)) return [];
        seen.add(signal.nodeId);
        const length = numeric(signal.chatLength);
        const time = numeric(signal.time);
        return [{ nodeId: signal.nodeId, stepIndex: indexes.get(signal.nodeId),
            chatLength: Number.isFinite(length) ? Math.min(Math.max(0, length), chatLength) : chatLength,
            time: Number.isFinite(time) && time >= 0 ? time : Date.now(),
            source: typeof signal.source === 'string' && signal.source ? signal.source : 'import' }];
    });
}

function progressScopeKey(mode, level) {
    if (mode === 'all') return 'all';
    if (mode === 'level') {
        const number = Number(level);
        return `level:${Number.isSafeInteger(number) && number >= 0 ? number : 0}`;
    }
    return 'leaf';
}

function validProgressKey(key) {
    if (key === 'leaf' || key === 'all') return true;
    if (typeof key !== 'string' || !/^level:(0|[1-9]\d*)$/.test(key)) return false;
    return Number.isSafeInteger(Number(key.slice(6)));
}

function isProgressTrack(value) {
    return isJsonObject(value) && Array.isArray(value.doneSignals);
}

/** Read-only calculation for impact previews; never initializes or saves chat state. */
export function projectStoryBlueprintProgress({ blueprint, doneSignals = [], progressTracks = null, chatLength = 0, mode = 'leaf', level = 0 }) {
    const normalized = blueprint ? normalizeBlueprint(blueprint) : null;
    const steps = normalized ? flattenNodes(normalized.nodes, { mode, level }) : [];
    const scopedSignals = isJsonObject(progressTracks)
        ? progressTracks[progressScopeKey(mode, level)]?.doneSignals || []
        : doneSignals;
    const validSignals = ensureArray(scopedSignals).filter(signal => signal?.chatLength == null || signal.chatLength <= chatLength);
    const active = sanitizeDoneSignals(validSignals, steps, chatLength, 'projection');
    return {
        total: steps.length,
        doneCount: active.length,
        complete: steps.length > 0 && active.length >= steps.length,
        currentNodeId: steps[Math.min(active.length, Math.max(steps.length - 1, 0))]?.id || null,
        stepIds: steps.map(step => step.id),
        activeSignalIds: active.map(signal => signal.nodeId),
        inactiveSignalCount: validSignals.length - active.length,
        expiredSignalCount: ensureArray(scopedSignals).length - validSignals.length,
    };
}

/** Pure structural-edit reconciliation using the same ordering/prefix rules as runtime.
 * Preserves custom signal fields; never advances variables or initializes host state. */
export function reconcileBlueprintStructureProgress(state, blueprint, {chatLength,mode='leaf',level=0,at=Date.now()}={}) {
    const result=clone(state),tracks=result.progressTracks||{},active=result.activeProgressKey||progressScopeKey(mode,level);
    if(!validProgressKey(active)||!isJsonObject(tracks)||Object.keys(tracks).length>32)throw Error('UNSUPPORTED_BLUEPRINT_PROGRESS');
    function reconcile(signals,key) {
        if(!Array.isArray(signals)||signals.length>256||signals.some(s=>!isJsonObject(s)||typeof s.nodeId!=='string'||
            ['chatLength','stepIndex','time'].some(k=>s[k]!==undefined&&(!Number.isSafeInteger(s[k])||s[k]<0))))throw Error('UNSUPPORTED_BLUEPRINT_PROGRESS');
        const options=key.startsWith('level:')?{mode:'level',level:Number(key.slice(6))}:{mode:key};
        const steps=flattenNodes(blueprint.nodes,options);
        const original=new Map();
        for(const s of signals)if(!original.has(s.nodeId))original.set(s.nodeId,s);
        const valid=signals.filter(s=>s.chatLength==null||s.chatLength<=chatLength).map(s=>({...s,time:s.time??at}));
        return sanitizeDoneSignals(valid,steps,chatLength,'structure').map(s=>({...original.get(s.nodeId),...s}));
    }
    for(const [key,track] of Object.entries(tracks)){
        if(!validProgressKey(key)||!isProgressTrack(track))throw Error('UNSUPPORTED_BLUEPRINT_PROGRESS');
        tracks[key]={...track,doneSignals:reconcile(key===active?(result.doneSignals||track.doneSignals):track.doneSignals,key),completeNoticeKey:''};
    }
    if(!tracks[active])tracks[active]={doneSignals:reconcile(result.doneSignals||[],active),completeNoticeKey:''};
    if(Object.keys(tracks).length>32)throw Error('UNSUPPORTED_BLUEPRINT_PROGRESS');
    result.progressTracks=tracks;result.activeProgressKey=active;
    result.doneSignals=tracks[active].doneSignals;result.completeNoticeKey='';
    if(result.legacyDoneSignals!==undefined){
        if(!Array.isArray(result.legacyDoneSignals))throw Error('UNSUPPORTED_BLUEPRINT_PROGRESS');
        const ids=collectNodeIds(blueprint.nodes);
        result.legacyDoneSignals=result.legacyDoneSignals.filter(s=>isJsonObject(s)&&ids.has(s.nodeId));
    }
    result.blueprint=clone(blueprint);return result;
}

export function createStoryBlueprintSystem({
    settings,
    getChatMetadata,
    getChat,
    EXT_KEY,
    saveChatConditional,
    saveChatConfirmed = saveChatConditional,
    renderPrompt,
    generateRaw,
    createCaller,
    parseJson,
    variableSystem,
    getCurrentGroup,
    getLang,
    log = console.log,
}) {
    let generating = false;
    const warnedVariableConflicts = new WeakSet();

    function lang() { return getLang?.() || settings.lang || 'zh'; }
    function completionVariable() { return variableId(settings.storyBlueprintCompletionVariable); }
    function persistScopeSwitch() {
        try {
            Promise.resolve(saveChatConditional?.()).catch(error => log('[StoryBlueprint] Progress-track save failed:', error));
        } catch (error) {
            log('[StoryBlueprint] Progress-track save failed:', error);
        }
    }

    function root(metadata = getChatMetadata()) {
        const meta = metadata;
        if (!meta[EXT_KEY]) meta[EXT_KEY] = {};
        if (!meta[EXT_KEY].storyBlueprint) {
            meta[EXT_KEY].storyBlueprint = {
                blueprint: null,
                doneSignals: [],
                lastGeneratedAt: 0,
                lastError: '',
                completeNoticeKey: '',
                continuePending: false,
            };
        }
        const state = meta[EXT_KEY].storyBlueprint;
        if (!Array.isArray(state.doneSignals)) state.doneSignals = [];
        if (typeof state.completeNoticeKey !== 'string') state.completeNoticeKey = '';
        if (generating !== true) state.continuePending = false;
        // A generation/import callback may still hold the previous chat's metadata.
        // Never switch its progress track or save the newly selected chat for it.
        if (metadata !== getChatMetadata()) return state;
        const key = progressScopeKey(settings.storyBlueprintProgressionMode, settings.storyBlueprintProgressionLevel);
        if (!isJsonObject(state.progressTracks)) {
            // Legacy signals did not record their mode. Assign them to the mode in use
            // at migration, but retain an untouched copy for manual recovery.
            if (state.doneSignals.length) state.legacyDoneSignals = clone(state.doneSignals);
            state.progressTracks = { [key]: { doneSignals: state.doneSignals, completeNoticeKey: state.completeNoticeKey } };
            state.activeProgressKey = key;
            if (state.doneSignals.length) persistScopeSwitch();
        } else if (state.activeProgressKey !== key) {
            if (validProgressKey(state.activeProgressKey)) {
                state.progressTracks[state.activeProgressKey] = {
                    doneSignals: state.doneSignals,
                    completeNoticeKey: state.completeNoticeKey,
                };
            } else if (state.doneSignals.length && !Array.isArray(state.legacyDoneSignals)) {
                state.legacyDoneSignals = clone(state.doneSignals);
            }
            const track = isProgressTrack(state.progressTracks[key]) ? state.progressTracks[key] : { doneSignals: [], completeNoticeKey: '' };
            state.progressTracks[key] = track;
            state.activeProgressKey = key;
            state.doneSignals = track.doneSignals;
            state.completeNoticeKey = track.completeNoticeKey || '';
            persistScopeSwitch();
        } else {
            state.progressTracks[key] = { doneSignals: state.doneSignals, completeNoticeKey: state.completeNoticeKey };
        }
        return state;
    }

    function updateActiveTrack(state) {
        state.progressTracks[state.activeProgressKey] = {
            doneSignals: state.doneSignals,
            completeNoticeKey: state.completeNoticeKey,
        };
    }

    function clearAllProgress(state) {
        state.doneSignals = [];
        state.completeNoticeKey = '';
        state.progressTracks = { [state.activeProgressKey]: { doneSignals: state.doneSignals, completeNoticeKey: '' } };
        delete state.legacyDoneSignals;
    }

    function completionVariableConflicts(id, existing) {
        if (settings.storyBlueprintCompletionVariableGuard === id && existing) {
            const raw = getChatMetadata()?.[EXT_KEY]?.variables?.defs?.find(def => def?.id === id);
            return raw?.owner !== 'group-director-story-blueprint' || existing.type !== 'boolean' || existing.scope !== 'global';
        }
        return false;
    }

    function ensureCompletionVariable() {
        const id = completionVariable();
        const existing = variableSystem?.getDefinition?.(id);
        const guarded = settings.storyBlueprintCompletionVariableGuard === id;
        if (completionVariableConflicts(id, existing)) {
            log('[StoryBlueprint] Completion variable conflicts with an existing chat variable:', id);
            return false;
        }
        if (!existing) {
            const zh = lang() === 'zh';
            variableSystem?.upsertDefinition?.({
                id,
                label: zh ? '故事蓝图当前块完成' : 'Story Chapter Done',
                labelZh: '故事蓝图当前块完成',
                scope: 'global',
                type: 'boolean',
                defaultValue: false,
                value: false,
                rule: zh ? '仅当当前故事蓝图推进块完成时设为 true。' : 'Set to true only when the current Story Blueprint step is complete.',
                ruleZh: '仅当当前故事蓝图推进块完成时设为 true。',
                showInDashboard: true,
                injectMode: 'manual',
                locked: false,
            });
            if (guarded) {
                const raw = getChatMetadata()?.[EXT_KEY]?.variables?.defs?.find(def => def?.id === id);
                if (!raw) return false;
                raw.owner = 'group-director-story-blueprint';
                saveChatConditional?.();
            }
        } else if (settings.storyBlueprintEnabled && existing.locked) {
            log('[StoryBlueprint] Completion variable is locked; Story Blueprint advancement may not work until it is unlocked:', id);
        } else if (settings.storyBlueprintEnabled && (existing.injectMode !== 'manual' || existing.autoUpdate === false)) {
            variableSystem?.upsertDefinition?.({
                ...existing,
                autoUpdate: true,
                injectMode: 'manual',
            });
        }
        return true;
    }

    function clearCompletionSignal(reason = 'clear') {
        const id = completionVariable();
        if (completionVariableConflicts(id, variableSystem?.getDefinition?.(id))) return;
        if (settings.storyBlueprintEnabled && !ensureCompletionVariable()) return;
        else if (!variableSystem?.getDefinition?.(id)) return;
        variableSystem?.setValue?.(id, false, {
            source: 'story-blueprint',
            reason,
        });
    }

    function getBlueprint() {
        const state = root();
        if (!state.blueprint) return null;
        state.blueprint = normalizeBlueprint(state.blueprint);
        return state.blueprint;
    }

    function setBlueprint(blueprint, options = {}) {
        const state = root();
        state.blueprint = normalizeBlueprint(blueprint);
        if (options.resetProgress !== false) clearAllProgress(state);
        state.completeNoticeKey = '';
        updateActiveTrack(state);
        state.lastGeneratedAt = Date.now();
        state.lastError = '';
        state.continuePending = false;
        if (options.persist !== false) saveChatConditional?.();
        return state.blueprint;
    }

    function getSteps() {
        const blueprint = getBlueprint();
        if (!blueprint) return [];
        return flattenNodes(blueprint.nodes, {
            mode: settings.storyBlueprintProgressionMode || 'leaf',
            level: settings.storyBlueprintProgressionLevel || 0,
        });
    }

    function pruneDoneSignals(steps = null) {
        const state = root();
        steps = steps || getSteps();
        const chatLen = getChatLength(getChat);
        const next = sanitizeDoneSignals(
            state.doneSignals.filter(s => s.chatLength == null || s.chatLength <= chatLen),
            steps,
            chatLen,
            'prune',
        );
        const changed = JSON.stringify(next) !== JSON.stringify(state.doneSignals);
        if (changed) {
            state.doneSignals = next;
            updateActiveTrack(state);
            saveChatConditional?.();
        }
        return changed;
    }

    function getProgress() {
        const steps = getSteps();
        pruneDoneSignals(steps);
        const doneCount = root().doneSignals.length;
        const complete = steps.length > 0 && doneCount >= steps.length;
        const idx = complete ? Math.max(steps.length - 1, 0) : doneCount;
        const current = steps[idx] || null;
        return {
            currentIndex: idx,
            doneCount,
            total: steps.length,
            complete,
            current,
            steps,
            completionVariable: completionVariable(),
            completionValue: variableSystem?.getValue?.(completionVariable()) === true,
        };
    }

    function getProviderData() {
        const blueprint = getBlueprint();
        const progress = getProgress();
        const current = progress.current ? {
            id: progress.current.id,
            depth: progress.current.depth,
            path: progress.current.pathText,
            node: progress.current.node,
            nodeJson: JSON.stringify(progress.current.node, null, 2),
            content: progress.current.node?.content || {},
        } : null;
        return {
            blueprint,
            progress: {
                current: progress.complete ? progress.total : Math.min(progress.doneCount + 1, progress.total),
                done: progress.doneCount,
                total: progress.total,
                complete: progress.complete,
                currentIndex: progress.currentIndex,
            },
            current,
            completionVariable: completionVariable(),
            doneSignals: root().doneSignals,
        };
    }

    function completeNoticeKey(data) {
        const last = data.doneSignals[data.doneSignals.length - 1];
        return `${data.progress.total}:${data.progress.done}:${last?.nodeId || 'complete'}`;
    }

    function renderCurrent(options = {}) {
        if (!settings.storyBlueprintEnabled) return '';
        if (!ensureCompletionVariable()) return '';
        const data = getProviderData();
        if (!data.blueprint || !data.current || data.progress.total === 0) return '';
        if (data.progress.complete) {
            if (options.consumeCompleteNotice) {
                const state = root();
                const key = completeNoticeKey(data);
                if (state.completeNoticeKey === key) return '';
                state.completeNoticeKey = key;
                updateActiveTrack(state);
                saveChatConditional?.();
            }
            return lang() === 'zh'
                ? '[Story Blueprint]\n当前故事蓝图已完成。请生成或续写新的蓝图。'
                : '[Story Blueprint]\nThe current story blueprint is complete. Generate or continue a new blueprint.';
        }
        const template = settings.storyBlueprintProviderTemplate || DEFAULT_STORY_BLUEPRINT_TEMPLATE;
        return renderTemplate(template, data);
    }

    function renderProgress() {
        const p = getProgress();
        if (!p.total) {
            return getBlueprint()
                ? (lang() === 'zh' ? '蓝图存在，但当前推进模式无匹配节点' : 'Blueprint loaded, but current progression mode has no matching steps')
                : (lang() === 'zh' ? '无蓝图' : 'No blueprint');
        }
        const label = p.complete ? (lang() === 'zh' ? '已完成' : 'complete') : (p.current?.pathText || '');
        return `${p.doneCount}/${p.total} ${label}`;
    }

    function healthCheck() {
        const blueprint = getBlueprint();
        const issues = [];
        if (settings.storyBlueprintEnabled && completionVariableConflicts(completionVariable(), variableSystem?.getDefinition?.(completionVariable()))) {
            issues.push('Completion variable conflicts with an existing chat variable');
        }
        if (!blueprint) issues.push('Missing blueprint');
        else {
            if (!Array.isArray(blueprint.nodes) || !blueprint.nodes.length) issues.push('Missing or empty nodes');
            const steps = getSteps();
            if (!steps.length) issues.push('No progression steps for current mode');
            for (const step of steps) {
                if (!step.node.title) issues.push(`Node ${step.id} has no title`);
                if (!step.node.content || typeof step.node.content !== 'object') issues.push(`Node ${step.id} has no content object`);
            }
        }
        const p = getProgress();
        if (root().doneSignals.length > p.total && p.total >= 0) issues.push('More done signals than available steps');
        return { ok: issues.length === 0, issues };
    }

    function consumeCompletionSignal(source = 'director') {
        if (!settings.storyBlueprintEnabled) {
            if (variableSystem?.getValue?.(completionVariable()) === true) {
                clearCompletionSignal('disabled-reset');
            }
            return { advanced: false, complete: false, reason: 'disabled' };
        }
        if (!ensureCompletionVariable()) {
            const metadata = getChatMetadata();
            if (metadata && !warnedVariableConflicts.has(metadata)) {
                warnedVariableConflicts.add(metadata);
                throw Error('Story Blueprint completion variable conflicts with an existing chat variable');
            }
            return { advanced: false, complete: false, reason: 'variable-conflict' };
        }
        const id = completionVariable();
        if (variableSystem?.getValue?.(id) !== true) return { advanced: false, complete: getProgress().complete, reason: 'not-set' };

        const state = root();
        const progress = getProgress();
        if (!progress.total || !progress.current) {
            variableSystem.setValue(id, false, { source: 'story-blueprint', reason: 'no-progress-step-reset' });
            return { advanced: false, complete: false, reason: 'no-progress-step', progress };
        }
        const chatLen = getChatLength(getChat);
        const last = state.doneSignals[state.doneSignals.length - 1];
        if (last && last.chatLength === chatLen && last.nodeId === progress.current?.id) {
            variableSystem.setValue(id, false, { source: 'story-blueprint', reason: 'dedupe-reset' });
            return { advanced: false, complete: progress.complete, reason: 'duplicate' };
        }

        if (!progress.complete && progress.current) {
            state.doneSignals.push({
                nodeId: progress.current.id,
                stepIndex: progress.doneCount,
                chatLength: chatLen,
                time: Date.now(),
                source,
            });
            updateActiveTrack(state);
        }
        variableSystem.setValue(id, false, { source: 'story-blueprint', reason: 'advance-reset' });
        saveChatConditional?.();

        const next = getProgress();
        return { advanced: true, complete: next.complete, progress: next };
    }

    function rollbackOne() {
        const state = root();
        if (!state.doneSignals.length) return false;
        state.doneSignals.pop();
        state.completeNoticeKey = '';
        updateActiveTrack(state);
        variableSystem?.setValue?.(completionVariable(), false, { source: 'story-blueprint', reason: 'rollback' });
        saveChatConditional?.();
        return true;
    }

    function setCurrentStep(stepIndex) {
        const steps = getSteps();
        const idx = Number(stepIndex);
        if (!Number.isInteger(idx) || idx < 0 || idx > steps.length) {
            throw new Error(lang() === 'zh' ? '无效的故事蓝图步骤索引。' : 'Invalid Story Blueprint step index.');
        }
        const state = root();
        state.doneSignals = steps.slice(0, idx).map((step, i) => ({
            nodeId: step.id,
            stepIndex: i,
            chatLength: getChatLength(getChat),
            time: Date.now(),
            source: 'manual',
        }));
        state.completeNoticeKey = '';
        updateActiveTrack(state);
        variableSystem?.setValue?.(completionVariable(), false, { source: 'story-blueprint', reason: 'set-current-step' });
        saveChatConditional?.();
        return getProgress();
    }

    function resetProgress() {
        const state = root();
        state.doneSignals = [];
        state.completeNoticeKey = '';
        updateActiveTrack(state);
        variableSystem?.setValue?.(completionVariable(), false, { source: 'story-blueprint', reason: 'reset-progress' });
        saveChatConditional?.();
    }

    function resetBlueprint() {
        const state = root();
        state.blueprint = null;
        clearAllProgress(state);
        saveChatConditional?.();
    }

    function updateStepTitle(stepIndex, title) {
        const steps = getSteps();
        const idx = Number(stepIndex);
        if (!Number.isInteger(idx) || idx < 0 || idx >= steps.length) {
            throw new Error(lang() === 'zh' ? '无效的故事蓝图步骤索引。' : 'Invalid Story Blueprint step index.');
        }
        const nextTitle = String(title || '').trim();
        if (!nextTitle) {
            throw new Error(lang() === 'zh' ? '标题不能为空。' : 'Title cannot be empty.');
        }
        const blueprint = getBlueprint();
        const node = findNodeById(blueprint?.nodes, steps[idx].id);
        if (!node) {
            throw new Error(lang() === 'zh' ? '找不到要编辑的节点。' : 'Step node not found.');
        }
        node.title = nextTitle;
        setBlueprint(blueprint, { resetProgress: false });
        pruneDoneSignals();
        return getProgress();
    }

    function deleteStep(stepIndex) {
        const steps = getSteps();
        const idx = Number(stepIndex);
        if (!Number.isInteger(idx) || idx < 0 || idx >= steps.length) {
            throw new Error(lang() === 'zh' ? '无效的故事蓝图步骤索引。' : 'Invalid Story Blueprint step index.');
        }
        const blueprint = getBlueprint();
        const removed = removeNodeById(blueprint?.nodes, steps[idx].id);
        if (!removed) {
            throw new Error(lang() === 'zh' ? '找不到要删除的节点。' : 'Step node not found.');
        }
        setBlueprint(blueprint, { resetProgress: false });
        pruneDoneSignals();
        return getProgress();
    }

    function createBlankBlueprint() {
        const zh = lang() === 'zh';
        return setBlueprint({
            version: 1,
            title: zh ? '用户自建故事蓝图' : 'User Story Blueprint',
            meta: {
                premise: '',
                style: '',
            },
            nodes: [
                {
                    id: 'node_001',
                    type: 'chapter',
                    title: zh ? '第1章' : 'Chapter 1',
                    content: {
                        purpose: '',
                        director_prompt: '',
                        completion_rule: '',
                    },
                    children: [],
                },
            ],
        }, { resetProgress: true });
    }

    function appendBlankChapter() {
        const zh = lang() === 'zh';
        const blueprint = getBlueprint();
        if (!blueprint) return createBlankBlueprint();
        const nextNumber = ensureArray(blueprint.nodes).length + 1;
        const usedIds = collectNodeIds(blueprint.nodes);
        const node = uniquifyNodeIds(normalizeNode({
            id: `chapter_${String(nextNumber).padStart(3, '0')}`,
            type: 'chapter',
            title: zh ? `第${nextNumber}章` : `Chapter ${nextNumber}`,
            content: {
                purpose: '',
                director_prompt: '',
                completion_rule: '',
            },
            children: [],
        }, [nextNumber - 1]), usedIds, `manual${nextNumber}`);
        blueprint.nodes = ensureArray(blueprint.nodes).concat(node);
        return setBlueprint(blueprint, { resetProgress: false });
    }

    function buildGenerationLocals() {
        const data = getProviderData();
        return {
            storyBlueprintFullJson: data.blueprint ? JSON.stringify(data.blueprint, null, 2) : '',
            storyBlueprintProgress: renderProgress(),
        };
    }

    function buildGenerationPrompt(mode = 'new') {
        const schema = settings.storyBlueprintJsonSchema || DEFAULT_STORY_BLUEPRINT_SCHEMA;
        const maxNodes = settings.storyBlueprintMaxNodes || 8;
        const baseTemplate = mode === 'continue'
            ? (settings.storyBlueprintContinuePrompt || getDefaultContinuePrompt())
            : (settings.storyBlueprintPrompt || getDefaultPrompt());
        const base = renderInlineSettings(baseTemplate, { ...settings, storyBlueprintMaxNodes: maxNodes });
        return `${base}

[Output Format]
${schema}`;
    }

    function buildRenderContext() {
        const group = getCurrentGroup?.();
        const enabledMembers = group?.members?.filter(a => !group.disabled_members?.includes(a)) || [];
        return {
            group,
            enabledMembers,
        };
    }

    async function generateBlueprint(mode = 'new') {
        if (generating) throw new Error('Story Blueprint generation already in progress');
        if (mode === 'continue' && !getBlueprint()) {
            throw new Error(lang() === 'zh' ? '没有可续写的故事蓝图，请先生成蓝图。' : 'No Story Blueprint to continue. Generate one first.');
        }
        const executionSnapshot = captureExecutionSnapshot({
            getChatMetadata,
            getChat,
            getResource: metadata => {
                const state = root(metadata);
                return { blueprint: state.blueprint, progressTracks: state.progressTracks, doneSignals: state.doneSignals };
            },
        });
        const executionState = root(executionSnapshot.metadata);
        const assertCurrent = () => assertExecutionSnapshot(executionSnapshot, {
            getChatMetadata,
            getChat,
            getResource: metadata => {
                const state = root(metadata);
                return { blueprint: state.blueprint, progressTracks: state.progressTracks, doneSignals: state.doneSignals };
            },
            message: 'Story Blueprint generation became stale',
        });
        generating = true;
        try {
            executionState.continuePending = mode === 'continue';
            saveChatConditional?.();
            const agentConfig = settings.agentConfigs?.['story-blueprint'] || {};
            const caller = createCaller(agentConfig, (opts) => generateRaw(opts));
            const prompt = await renderPrompt(buildGenerationPrompt(mode), buildRenderContext(), {
                maxPasses: settings.templateMaxPasses,
                recursive: settings.templateRecursive,
                debugPlaceholders: settings.templateDebugPlaceholders,
                locals: buildGenerationLocals(),
            });
            assertCurrent();
            const raw = await caller.generate(prompt);
            assertCurrent();
            const parsed = parseJson(raw);
            if (!parsed) throw new Error('LLM returned no valid JSON blueprint');
            if (mode === 'continue' && getBlueprint()) {
                const current = getBlueprint();
                const source = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
                const rawNodes = Array.isArray(source.nodes) ? source.nodes : (Array.isArray(source.chapters) ? source.chapters : []);
                if (!rawNodes.length) {
                    throw new Error(lang() === 'zh' ? '续写蓝图没有返回任何节点。' : 'Story Blueprint continuation returned no nodes.');
                }
                const offset = current.nodes.length;
                const usedIds = collectNodeIds(current.nodes);
                const incomingNodes = rawNodes
                    .map((node, idx) => normalizeNode(node, [offset + idx]))
                    .map((node, idx) => uniquifyNodeIds(node, usedIds, `cont${offset + idx}`));
                current.nodes = current.nodes.concat(incomingNodes);
                const incoming = normalizeBlueprint(parsed);
                current.meta = { ...(current.meta || {}), ...(incoming.meta || {}) };
                setBlueprint(current, { resetProgress: false });
            } else {
                const incoming = normalizeBlueprint(parsed);
                if (!incoming.nodes.length) {
                    throw new Error(lang() === 'zh' ? '生成蓝图没有返回任何节点。' : 'Story Blueprint generation returned no nodes.');
                }
                setBlueprint(incoming, { resetProgress: true });
            }
            return getBlueprint();
        } catch (e) {
            let failure = e;
            try { assertCurrent(); }
            catch (staleError) { failure = staleError; }
            if (failure === e) {
                executionState.lastError = e.message || String(e);
                saveChatConditional?.();
            }
            throw failure;
        } finally {
            generating = false;
            executionState.continuePending = false;
            if (getChatMetadata() === executionSnapshot.metadata) saveChatConditional?.();
        }
    }

    async function renderGenerationPrompt(mode = 'new') {
        return await renderPrompt(buildGenerationPrompt(mode), buildRenderContext(), {
            maxPasses: settings.templateMaxPasses,
            recursive: settings.templateRecursive,
            debugPlaceholders: settings.templateDebugPlaceholders,
            locals: buildGenerationLocals(),
        });
    }

    function buildExportFile(includeProgress = true) {
        const state = root();
        const exportedState = clone(state) || {
            blueprint: clone(state.blueprint),
            doneSignals: clone(state.doneSignals) || [],
            progressTracks: clone(state.progressTracks) || {},
            activeProgressKey: state.activeProgressKey,
            lastGeneratedAt: state.lastGeneratedAt || 0,
            lastError: state.lastError || '',
            completeNoticeKey: state.completeNoticeKey || '',
            continuePending: false,
        };
        return {
            version: 1,
            type: 'group-director-story-blueprint',
            exportedAt: new Date().toISOString(),
            storyBlueprint: includeProgress ? exportedState : { blueprint: clone(getBlueprint()), doneSignals: [], progressTracks: {} },
        };
    }

    function validateBlueprintInput(input) {
        const valid = validateImportData(input);
        if (!valid.ok) return valid;
        const blueprint = valid.payload.blueprint || valid.payload;
        const normalized = normalizeBlueprint(blueprint);
        if (!Array.isArray(normalized.nodes) || !normalized.nodes.length) {
            return { ok: false, error: 'Blueprint must contain a non-empty nodes array' };
        }
        return { ok: true, blueprint: normalized };
    }

    function applyImportText(text, options = {}) {
        let obj;
        try { obj = JSON.parse(text); } catch (e) { return { ok: false, error: `Invalid JSON: ${e.message}` }; }
        const valid = validateImportData(obj);
        if (!valid.ok) return valid;
        const payload = valid.payload;
        const hasProgress = options.includeProgress && (Array.isArray(payload.doneSignals) || isJsonObject(payload.progressTracks));
        setBlueprint(payload.blueprint || payload, { resetProgress: true, persist: options.persist });
        if (hasProgress) {
            const state = root();
            const chatLength = getChatLength(getChat);
            const tracks = {};
            if (isJsonObject(payload.progressTracks)) {
                for (const [key, track] of Object.entries(payload.progressTracks)) {
                    if (!isProgressTrack(track) || !validProgressKey(key)) continue;
                    const mode = key.startsWith('level:') ? 'level' : key;
                    const level = mode === 'level' ? Number(key.slice(6)) : 0;
                    if (!Number.isSafeInteger(level)) continue;
                    const steps = flattenNodes(state.blueprint.nodes, { mode, level });
                    tracks[key] = {
                        doneSignals: sanitizeDoneSignals(track.doneSignals, steps, chatLength, 'import'),
                        completeNoticeKey: '',
                    };
                }
            } else if (Array.isArray(payload.doneSignals)) {
                tracks[state.activeProgressKey] = {
                    doneSignals: sanitizeDoneSignals(payload.doneSignals, getSteps(), chatLength, 'import'),
                    completeNoticeKey: '',
                };
            }
            const active = tracks[state.activeProgressKey] || { doneSignals: [], completeNoticeKey: '' };
            tracks[state.activeProgressKey] = active;
            state.progressTracks = tracks;
            state.doneSignals = active.doneSignals;
            state.completeNoticeKey = '';
            if (Array.isArray(payload.legacyDoneSignals)) state.legacyDoneSignals = sanitizeLegacyDoneSignals(payload.legacyDoneSignals, state.blueprint.nodes, chatLength);
            if (options.persist !== false) saveChatConditional?.();
        }
        return { ok: true };
    }

    async function applyImportTextAndSave(text, options = {}) {
        const metadata = getChatMetadata();
        const state = root(metadata);
        const previous = clone(state);
        const result = applyImportText(text, { ...options, persist: false });
        if (!result.ok) return result;
        const applied = clone(state);
        try {
            await saveChatConfirmed?.(metadata);
        } catch (error) {
            if (error.persistenceUnknown) throw error;
            const restored = rollbackJsonValue(previous, applied, state);
            for (const key of Object.keys(state)) delete state[key];
            Object.assign(state, restored);
            if (getChatMetadata() === metadata) {
                try { await saveChatConfirmed?.(metadata); }
                catch (rollbackError) {
                    const failure = new Error(`Story Blueprint import failed and rollback persistence failed: ${rollbackError.message || rollbackError}`, { cause: error });
                    failure.rollbackIncomplete = true;
                    throw failure;
                }
            }
            throw error;
        }
        if (getChatMetadata() !== metadata) {
            throw staleExecutionError('Story Blueprint import became stale');
        }
        return result;
    }

    function getState() { return root(); }

    function getDefaultPrompt() {
        return lang() === 'zh' ? DEFAULT_STORY_BLUEPRINT_PROMPT_ZH : DEFAULT_STORY_BLUEPRINT_PROMPT_EN;
    }

    function getDefaultContinuePrompt() {
        return lang() === 'zh' ? DEFAULT_STORY_BLUEPRINT_CONTINUE_PROMPT_ZH : DEFAULT_STORY_BLUEPRINT_CONTINUE_PROMPT_EN;
    }

    return {
        ensureCompletionVariable,
        clearCompletionSignal,
        getState,
        getBlueprint,
        setBlueprint,
        getSteps,
        getProgress,
        getProviderData,
        renderCurrent,
        renderProgress,
        healthCheck,
        consumeCompletionSignal,
        rollbackOne,
        setCurrentStep,
        resetProgress,
        resetBlueprint,
        updateStepTitle,
        deleteStep,
        createBlankBlueprint,
        appendBlankChapter,
        renderGenerationPrompt,
        generateBlueprint,
        buildExportFile,
        validateBlueprintInput,
        applyImportText,
        applyImportTextAndSave,
        getDefaultTemplate: () => DEFAULT_STORY_BLUEPRINT_TEMPLATE,
        getDefaultSchema: () => DEFAULT_STORY_BLUEPRINT_SCHEMA,
        getDefaultPrompt,
        getDefaultContinuePrompt,
        getCompletionVariable: completionVariable,
        normalizeCompletionVariable: variableId,
        isGenerating: () => generating,
    };
}
