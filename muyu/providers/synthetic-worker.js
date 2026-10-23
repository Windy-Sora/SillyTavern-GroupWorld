/** Serialized into an isolated module Worker. No imports from the real host. */
export function syntheticWorkerMain() {
    const receive = async event => {
        const port = event.ports[0];
        if (!port) return;
        self.removeEventListener('message', receive);
        const send = port.postMessage.bind(port), input = event.data;
        const close = port.close.bind(port);
        let phase = 'load';
        const rows = [];
        const toJson = JSON.stringify.bind(JSON), parse = JSON.parse.bind(JSON);
        const fixtures = [
            { name: 'empty', context: { recentMessages: [], enabledMembers: [], character: '', avatar: null } },
            { name: 'group', context: { recentMessages: [{ name: 'SyntheticUser', mes: '合成测试：队伍获得10枚金币。', is_user: true }], enabledMembers: ['synthetic-alice', 'synthetic-bob'], character: '', avatar: null,
                chatMessages: [{ name: 'SyntheticUser', mes: '合成测试：队伍获得10枚金币。', is_user: true }], chatMessagesLimited: false } },
            { name: 'single', context: { recentMessages: [{ name: 'SyntheticUser', mes: '合成测试：你好。', is_user: true }], enabledMembers: [], character: 'SyntheticAlice', avatar: 'synthetic-alice',
                chatMessages: [{ name: 'SyntheticUser', mes: '合成测试：你好。', is_user: true }], chatMessagesLimited: false,
                characterCard: { name: 'SyntheticAlice', description: '虚构测试角色', personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '' } } },
        ];
        try {
            const registered = new Map();
            const registerProvider = provider => {
                if (!provider || !input.ids.includes(provider.id) || registered.has(provider.id) ||
                    typeof provider.placeholder !== 'string' || !provider.placeholder || typeof provider.render !== 'function') throw Error('registration');
                const fields = provider.muyuContext ?? [];
                if (!Array.isArray(fields) || new Set(fields).size !== fields.length || fields.some(f => !['chatMessages', 'characterCard'].includes(f))) throw Error('registration');
                registered.set(provider.id, { ...provider, muyuContext: [...fields] });
            };
            const url = URL.createObjectURL(new Blob([input.source], { type: 'application/javascript' }));
            let mod;
            try { mod = await import(url); } finally { URL.revokeObjectURL(url); }
            phase = 'register';
            if (typeof mod.register !== 'function') throw Error('registration');
            await mod.register(Object.freeze({ registerProvider, log: () => {} }));
            if (registered.size !== input.ids.length || input.ids.some(id => !registered.has(id))) throw Error('registration');
            phase = 'render';
            for (const [id, provider] of registered) for (const fixture of fixtures) {
                // Match the real context contract: optional fields exist only when declared.
                const context = parse(toJson(fixture.context));
                if (!provider.muyuContext.includes('chatMessages')) { delete context.chatMessages; delete context.chatMessagesLimited; }
                if (!provider.muyuContext.includes('characterCard')) delete context.characterCard;
                if (provider.muyuContext.includes('characterCard') && !context.characterCard) {
                    rows.push({ id, scenario: fixture.name, status: 'context_unavailable', sample: '', dataSample: '', contentChars: 0 }); continue;
                }
                try {
                    const enabled = typeof provider.enabled === 'function' ? provider.enabled(context) : provider.enabled !== false;
                    if (typeof enabled !== 'boolean') throw Error('enabled');
                    if (!enabled) { rows.push({ id, scenario: fixture.name, status: 'disabled', sample: '', dataSample: '', contentChars: 0 }); continue; }
                    const rendered = await provider.render(context, new AbortController().signal);
                    const content = typeof rendered === 'string' ? rendered : rendered?.content;
                    if (typeof content !== 'string' || content.length > 131072) throw Error('output');
                    const data = rendered && typeof rendered === 'object' && Object.hasOwn(rendered, 'data') ? toJson(rendered.data) : '';
                    if (typeof data !== 'string' || data.length > 8000) throw Error('output');
                    rows.push({ id, scenario: fixture.name, status: 'ok', sample: content.slice(0, 200), dataSample: data.slice(0, 200), contentChars: content.length });
                } catch { rows.push({ id, scenario: fixture.name, status: 'render_failed', sample: '', dataSample: '', contentChars: 0 }); }
            }
            send({ status: rows.some(row => row.status === 'render_failed') || !rows.some(row => row.status === 'ok') ? 'failed' : 'passed', phase, rows });
        } catch { send({ status: 'failed', phase, rows: [] }); }
        finally { close(); }
    };
    self.addEventListener('message', receive);
}
