import { copyJson } from './json-contract.js';
import { MAX_MESSAGE_BYTES } from './context-limits.js';

/** Large model text has a separate boundary; tool arguments/results stay bounded DTOs. */
export function copyModelText(value) {
    if (typeof value !== 'string' || value.length > MAX_MESSAGE_BYTES || new TextEncoder().encode(JSON.stringify(value)).length > MAX_MESSAGE_BYTES) throw new TypeError('Model text byte limit');
    return value;
}
export function copyModelMessage(value) {
    if (!value || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('Invalid model message');
    const metadata = {}; let content;
    for (const key of Reflect.ownKeys(value)) {
        if (!['role', 'content', 'toolCalls', 'callId', 'result'].includes(key)) throw new TypeError('Invalid model message field');
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Invalid model message descriptor');
        if (key === 'content') content = copyModelText(descriptor.value);
        else metadata[key] = descriptor.value;
    }
    const copied = copyJson(metadata);
    if (!['user', 'assistant', 'tool'].includes(copied.role) || copied.role !== 'tool' && content === undefined || copied.role === 'tool' && content !== undefined) throw new TypeError('Invalid model message role');
    return content === undefined ? copied : { ...copied, content };
}
