import { configPresentation, configValue } from './presentation.js';

const text = { type: 'string', maxLength: 400 };
const pair = { type: 'object', properties: { zh: text, en: text }, required: ['zh', 'en'], additionalProperties: false };
export const readPresentationSchema = { type: 'array', maxItems: 64, items: { type: 'object', properties: {
    field: { type: 'string', maxLength: 80 }, kind: { type: 'string', enum: ['setting', 'runtime'] }, label: pair, value: pair, section: pair,
}, required: ['field', 'kind', 'label', 'value', 'section'], additionalProperties: false } };
const bilingual = (zh, en) => ({ zh, en });
const unknown = () => bilingual('未知', 'Unknown');
const runtimeLabels = {
    hasGroup: ['当前是否为群聊', 'Current chat is a group'], enabledMembers: ['启用的群聊成员数', 'Enabled group members'],
    manualGenerating: ['是否正在手动生成', 'Manual generation in progress'], roundActive: ['是否正在进行对话轮次', 'Round in progress'],
    generationType: ['当前生成类型', 'Current generation type'], takeoverPending: ['是否等待接管发言队列', 'Speaker queue takeover pending'],
    takeoverRemaining: ['待接管的剩余发言数', 'Remaining takeover speakers'], takeoverFailed: ['是否有接管失败标志', 'Takeover failure flag'],
    historyCount: ['已记录的导演决策数', 'Recorded director decisions'], lastSpeakerCount: ['最近记录中的发言人数', 'Speakers in the latest record'],
    reasonFieldPresent: ['最近记录是否含选择原因字段', 'Latest record has a reason field'], lastChatLength: ['最近决策记录的消息长度锚点', 'Message-length anchor of the latest decision'],
    revision: ['诊断快照修订号', 'Diagnostic snapshot revision'], messageCount: ['当前聊天消息数', 'Current chat message count'],
    baseline: ['记忆覆盖基线', 'Memory coverage baseline'], baselineSource: ['覆盖基线来源', 'Coverage baseline source'],
    canFinalize: ['当前是否允许轮次收尾', 'Round can finalize'], members: ['逐角色记忆进度', 'Per-character memory progress'],
    'members.slot': ['角色序号', 'Character slot'], 'members.memoryCount': ['已存储记忆条数', 'Stored memory count'],
    'members.covered': ['已覆盖消息数', 'Covered message count'], 'members.newMessages': ['未覆盖的新消息数', 'Uncovered new messages'],
    'members.intervalStatus': ['角色提取间隔是否达到', 'Character extraction interval status'],
};
const aliases = { respectOrder: 'llmRespectOrder', speakersOnly: 'autoMemorySpeakers', interval: 'autoMemoryInterval' };
const runtimeValues = { on: ['是', 'Yes'], off: ['否', 'No'], unknown: ['未知', 'Unknown'], normal: ['正常生成', 'Normal generation'], swipe: ['切换回复', 'Swipe'], regenerate: ['重新生成', 'Regenerate'] };

/** Annotations are for expression only; raw evidence and execution identifiers stay intact. */
export function diagnosticPresentation(state) {
    const result = [];
    for (const [field, raw] of Object.entries(state)) {
        const id = (Object.hasOwn(aliases, field) ? aliases[field] : field), metadata = configPresentation(id);
        const label = metadata?.label || (Object.hasOwn(runtimeLabels, field) && bilingual(...runtimeLabels[field]));
        if (!label) continue;
        let value;
        if (raw === -1 || raw === 'unknown' || raw === undefined) value = unknown();
        else if (field === 'baselineSource') {
            const sources = { batch: ['当前批次记录', 'Current batch record'], legacy: ['旧版记录', 'Legacy record'], initial: ['初始基线', 'Initial baseline'] };
            value = Object.hasOwn(sources, raw) ? bilingual(...sources[raw]) : unknown();
        }
        else if (Array.isArray(raw)) value = bilingual('见逐角色明细', 'See per-character details');
        else if (metadata) { const normalized = raw === 'on' ? true : raw === 'off' && id !== 'mode' ? false : raw; value = bilingual(configValue(id, normalized, 'zh'), configValue(id, normalized, 'en')); }
        else value = Object.hasOwn(runtimeValues, raw) ? bilingual(...runtimeValues[raw]) : bilingual(String(raw), String(raw));
        result.push({ field, kind: metadata ? 'setting' : 'runtime', label, value, section: metadata?.section || bilingual('', '') });
    }
    if (Array.isArray(state.members)) for (const field of Object.keys(runtimeLabels).filter(key => key.startsWith('members.'))) {
        result.push({ field, kind: 'runtime', label: bilingual(...runtimeLabels[field]), value: field.endsWith('intervalStatus') ? bilingual('met=已达到；pending=未达到；unknown=未知', 'met=reached; pending=not reached; unknown=unknown') : bilingual('见逐角色明细', 'See per-character details'), section: bilingual('', '') });
    }
    return result;
}

export function memoryConfigPresentation(data) {
    return data.fields.map(({ field, state, value }) => {
        const metadata = configPresentation(field);
        const display = state === 'value' ? bilingual(configValue(field, JSON.parse(value), 'zh'), configValue(field, JSON.parse(value), 'en'))
            : state === 'missing' ? bilingual('缺失／未读取', 'Missing / not read') : bilingual('当前值类型不受支持', 'Current value type is unsupported');
        return { field, kind: 'setting', label: metadata.label, value: display, section: metadata.section };
    });
}

/** No repeated Prompt bodies; labels remain in the existing labels map. */
export function settingDisplayValues(values) {
    return Object.fromEntries(Object.entries(values).filter(([id, value]) => typeof value === 'boolean' || typeof value === 'number' || Object.hasOwn(configPresentation(id)?.valueLabels || {}, String(value)))
        .map(([id, value]) => [id, bilingual(configValue(id, value, 'zh'), configValue(id, value, 'en'))]));
}

/** A small answer aid, not another source of truth. Never repeat free-text Prompt bodies. */
export function settingAnswerView(values) {
    if (Object.keys(values).length > 8) return null;
    const display = settingDisplayValues(values);
    return Object.entries(display).map(([id, value]) => {
        const label = configPresentation(id)?.label;
        return label ? bilingual(`${label.zh}：${value.zh}`, `${label.en}: ${value.en}`) : null;
    }).filter(Boolean);
}
