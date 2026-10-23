import { configDataSchema, validateConfigData } from './config-contract.js';

// Closed, first-party output contracts. Adding a structured format requires an explicit wire-schema change.
export const structuredContracts = Object.freeze({ memoryConfig: Object.freeze({ schema: configDataSchema, validate: validateConfigData }) });
export function validateTextSource(value, maxTextChars = 131072) {
    if (!value || typeof value.text !== 'string' || typeof value.limited !== 'boolean') throw Error('SOURCE_UNSUPPORTED');
    if (value.text.length > maxTextChars) throw Error('SOURCE_TOO_LARGE');
    return value;
}
