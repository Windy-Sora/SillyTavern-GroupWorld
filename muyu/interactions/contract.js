import { validateJson } from '../core/json-contract.js';
import { PERMISSION_TOOL, validatePermission, permissionDescription } from '../permissions/contract.js';

export const CLARIFICATION_TOOL = 'muyu.interaction.ask';
export const MAX_CLARIFICATIONS = 3;
export const questionSchema = { type: 'object', properties: {
    question: { type: 'string', maxLength: 600 },
    options: { type: 'array', items: { type: 'string', maxLength: 160 }, maxItems: 3 },
}, required: ['question', 'options'], additionalProperties: false };
export function validateQuestion(value) {
    const q = validateJson(questionSchema, value);
    if (!q.question.trim() || q.options.some(o => !o.trim()) || new Set(q.options).size !== q.options.length) throw Error('INVALID_QUESTION');
    return q;
}
export function validateAnswer(value, allowEmpty = false) {
    if (typeof value !== 'string' || value.length > 2000 || (!allowEmpty && !value.trim())) throw Error('INVALID_INTERACTION_ANSWER');
    return value;
}
export function describeQuestion(q) { return q.question + (q.options.length ? '\n' + q.options.map(o => '• ' + o).join('\n') : ''); }
export function describeAnswer(q, answer) { return 'Clarification answer from the user (not permission or approval):\n' + JSON.stringify({ question: q.question, answer: validateAnswer(answer) }); }
// Only the registered, successfully validated control tool can yield execution.
export const interactionPort = Object.freeze({
    isControl: call => [CLARIFICATION_TOOL, PERMISSION_TOOL].includes(call.toolId),
    read(call, result) {
        if (!result.ok) return null;
        if (call.toolId === PERMISSION_TOOL) return { kind: 'permission', ...validatePermission(result.data) };
        return call.toolId === CLARIFICATION_TOOL ? validateQuestion(result.data) : null;
    },
    describe: value => value.kind === 'permission' ? permissionDescription(value) : describeQuestion(value),
});
