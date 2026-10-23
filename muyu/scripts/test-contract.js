import { validateJson } from '../core/json-contract.js';
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const schema = obj({ status: { type: 'string', enum: ['passed', 'failed', 'timeout', 'cancelled', 'unavailable'] },
    phase: { type: 'string', enum: ['startup', 'compile', 'execute'] },
    rows: { type: 'array', maxItems: 9, items: obj({ scenario: { type: 'string', enum: ['empty', 'group', 'single'] },
        stage: { type: 'string', enum: ['decision', 'message', 'round'] }, status: { type: 'string', enum: ['ok', 'failed'] },
        sample: { type: 'string', maxLength: 300 }, resultChars: { type: 'integer', minimum: 0, maximum: 20000 } }) } });
export function checkedScriptReport(value, definition) {
    const report = validateJson(schema, value);
    const stages = definition.triggerOn === 'all' ? ['decision', 'message', 'round'] : definition.triggerOn === 'both' ? ['message', 'round'] : [definition.triggerOn];
    const keys = report.rows.map(row => row.scenario + ':' + row.stage);
    if (new Set(keys).size !== keys.length || report.rows.some(row => !stages.includes(row.stage))) throw Error('INVALID_SCRIPT_REPORT');
    if (report.status === 'passed' && (report.phase !== 'execute' || report.rows.length !== stages.length * 3 || report.rows.some(row => row.status !== 'ok'))) throw Error('INVALID_SCRIPT_REPORT');
    return report;
}
