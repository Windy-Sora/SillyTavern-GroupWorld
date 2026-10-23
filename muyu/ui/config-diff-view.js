import { configDiffText, configLabel, configPresentation, configValue } from '../config/presentation.js';

/** Display only. Exact raw values remain available without changing approval payloads. */
export function renderConfigDiff({ doc, parent, diff, settings, lang = 'zh', technicalOnly = false }) {
    const rows = diff ?? Object.entries(settings).map(([field, value]) => ({ field, after: JSON.stringify(value) }));
    const append = (tag, text, target = parent) => { const el = doc.createElement(tag); el.textContent = text; target.append(el); return el; };
    for (const row of technicalOnly ? [] : rows) {
        const section = configPresentation(row.field)?.section[lang === 'en' ? 'en' : 'zh'];
        append('p', (section ? section + ' · ' : '') + (diff ? configDiffText(row, lang) : `${configLabel(row.field, lang)}：${configValue(row.field, row.after, lang, { serialized: true })}`));
    }
    const details = append('details', '');
    append('summary', lang === 'en' ? 'Technical details · exact fields and values' : '技术详情 · 原始字段与完整值', details);
    const raw = append('pre', JSON.stringify(diff ?? settings, null, 2), details);
    raw.setAttribute('style', 'white-space: pre-wrap; overflow-wrap: anywhere');
}
