import { INSTRUCTION_DEFAULTS, validateInstructionConfig } from '../instructions/contract.js';
export function createInstructionConfigStore({ getSettings, saveSettings }) {
    return {
        read() { try { return validateInstructionConfig(getSettings().muyuInstructionConfig); } catch { return { ...INSTRUCTION_DEFAULTS }; } },
        async save(value) {
            const next = validateInstructionConfig(value), settings = getSettings(), previous = settings.muyuInstructionConfig;
            settings.muyuInstructionConfig = next;
            try { await saveSettings(); }
            catch { if (settings.muyuInstructionConfig === next) { if (previous === undefined) delete settings.muyuInstructionConfig; else settings.muyuInstructionConfig = previous; } throw Error('INSTRUCTION_CONFIG_SAVE_FAILED'); }
            return validateInstructionConfig(next);
        },
    };
}
