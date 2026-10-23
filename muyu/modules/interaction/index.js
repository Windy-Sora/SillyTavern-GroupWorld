import { createToolRegistry } from '../../tools/registry.js';
import { CLARIFICATION_TOOL, questionSchema, validateQuestion } from '../../interactions/contract.js';

export function createInteractionModule() {
    const registry = createToolRegistry();
    registry.register({ id: CLARIFICATION_TOOL, version: 1,
        description: 'Only when missing user intent materially blocks this task, ask one concise clarification with 0–3 suggested answers. Send this tool ALONE, never alongside other tools. This ends this execution segment and waits for explicit user input. Not for permissions, credentials, approval, or questions answerable from available evidence.',
        inputSchema: questionSchema, outputSchema: questionSchema, scope: 'global', effect: 'read', dataClasses: ['public-knowledge'], confirmation: 'policy', resourceKeys: [], timeoutMs: 1000, retryPolicy: { kind: 'none', maxAttempts: 1 } });
    registry.seal();
    return { registry, handlers: { [CLARIFICATION_TOOL]: validateQuestion }, transferRun() {}, retainArtifacts() {}, forgetRun() {}, dispose() {} };
}
