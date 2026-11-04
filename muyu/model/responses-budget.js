import { bytes, estimateTokens } from '../context/policy.js';

/** Actual wire shape, including encrypted reasoning. Byte-based tokens remain an estimate. */
export function measureResponsesPayload(payload) {
    const input = payload.input || [];
    return { estimatedTokens: estimateTokens(payload), requestBytes: bytes(payload),
        instructionBytes: payload.instructions === undefined ? 0 : bytes(payload.instructions),
        toolDefinitionBytes: bytes(payload.tools || []), toolResultBytes: bytes(input.filter(m => m.type === 'function_call_output')),
        reasoningBytes: bytes(input.filter(m => m.type === 'reasoning')), messageBytes: bytes(input) };
}
