import { validateJson } from '../core/json-contract.js';
const str = maxLength => ({ type: 'string', maxLength });
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const syntheticReportSchema = obj({ status: { type: 'string', enum: ['passed', 'failed', 'timeout', 'cancelled', 'unavailable'] },
    phase: { type: 'string', enum: ['startup', 'load', 'register', 'render'] },
    rows: { type: 'array', maxItems: 24, items: obj({ id: str(80), scenario: { type: 'string', enum: ['empty', 'group', 'single'] },
        status: { type: 'string', enum: ['ok', 'disabled', 'context_unavailable', 'render_failed'] }, sample: str(200), dataSample: str(200), contentChars: { type: 'integer', minimum: 0, maximum: 131072 } }) } });
export function checkedSyntheticReport(value, ids) {
    const report = validateJson(syntheticReportSchema, value);
    const keys = report.rows.map(row => row.id + ':' + row.scenario);
    if (new Set(keys).size !== keys.length || report.rows.some(row => !ids.includes(row.id))) throw Error('INVALID_SYNTHETIC_REPORT');
    if (report.status === 'passed' && (report.phase !== 'render' || report.rows.length !== ids.length * 3 || report.rows.some(row => row.status === 'render_failed') || !report.rows.some(row => row.status === 'ok'))) throw Error('INVALID_SYNTHETIC_REPORT');
    return report;
}
