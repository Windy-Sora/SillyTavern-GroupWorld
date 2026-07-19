/**
 * Test Capability — demonstrates the user import system.
 * Drop this file via 资产管理 → 导入 Capability → 选择此文件.
 *
 * Registers a "weather" capability that logs simulated weather conditions.
 * Uses deps pattern — no relative imports needed.
 */
export function register(deps) {
    const CapabilityRegistry = deps.CapabilityRegistry || window.GroupDirector?.CapabilityRegistry;
    const log = deps.log || (() => {});

    CapabilityRegistry.register({
        id: 'weather',
        displayName: 'Weather Reporter',
        description: 'Logs simulated weather conditions based on scene context.',
        promptHint: 'Activate when the scene describes outdoor environment or weather changes.',
        schema: {
            intents: ['weather', 'climate', 'environment', 'outdoor'],
            params: {
                condition: { type: 'string', values: ['sunny','rainy','stormy','snowy','foggy','windy'], default: 'sunny', description: 'Current weather condition' },
                temperature: { type: 'number', min: -20, max: 50, default: 20, description: 'Temperature in Celsius' },
            },
        },
        constraints: { maxPerMessage: 1, cooldown: 3000 },
        executor: async (params) => {
            log(`[Weather] ${params.condition}, ${params.temperature}°C — (test capability)`, params.reason || '');
        },
    });

    log('[test-capability-import] registered successfully');
}
