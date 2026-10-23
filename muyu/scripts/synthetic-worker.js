/** Serialized into a physically terminable Worker; never run in the ST page. */
export function scriptWorkerMain() {
    const receive = async event => {
        const port = event.ports[0]; if (!port) return;
        self.removeEventListener('message', receive);
        const send = port.postMessage.bind(port), close = port.close.bind(port);
        const parse = JSON.parse.bind(JSON), stringify = JSON.stringify.bind(JSON);
        const script = event.data, rows = [];
        let phase = 'compile';
        const snapshot = value => {
            const seen = new Set();
            const visit = item => {
                if (item === null || ['string', 'boolean', 'undefined'].includes(typeof item)) return;
                if (typeof item === 'number' && Number.isFinite(item)) return;
                if (typeof item !== 'object' || seen.has(item) || (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item)))) throw Error('unsupported');
                seen.add(item); for (const value of Object.values(item)) visit(value); seen.delete(item);
            };
            visit(value);
            const json = stringify(value); if (json === undefined || json.length > 8000) throw Error('bounded');
            return parse(json);
        };
        const freeze = value => { if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; };
        try {
            // Blob module avoids requiring unsafe-eval in the frame/Worker CSP.
            const url = URL.createObjectURL(new Blob(['export default function(ctx) {\n', script.code, '\n}'], { type: 'application/javascript' }));
            let fn;
            try { fn = (await import(url)).default; } finally { URL.revokeObjectURL(url); }
            phase = 'execute';
            const stages = script.triggerOn === 'all' ? ['decision', 'message', 'round'] : script.triggerOn === 'both' ? ['message', 'round'] : [script.triggerOn];
            for (const scenario of ['empty', 'group', 'single']) {
                let shared = {}, decision = { speakers: scenario === 'group' ? ['synthetic-alice'] : [], names: [], reason: 'Synthetic decision', scripts: {} };
                const chat = scenario === 'empty' ? [] : [{ name: 'SyntheticUser', mes: '虚构测试：获得10枚金币。', is_user: true }];
                const characters = scenario === 'empty' ? [] : [{ name: 'SyntheticAlice', avatar: 'synthetic-alice' }];
                const group = scenario === 'group' ? { id: 'synthetic-group', members: ['synthetic-alice'], disabled_members: [] } : null;
                for (const stage of stages) {
                    try {
                        const params = Object.create(null);
                        for (const p of script.params) params[p.key] = p.default;
                        const context = { chat: snapshot(chat), characters: snapshot(characters), group: snapshot(group), settings: {}, params, shared: snapshot(shared) };
                        // No real Provider render or host API; literal params deliberately retained.
                        context.getContext = () => ({ chat: context.chat, characters: context.characters, groupId: group?.id ?? null });
                        if (stage === 'decision') context.decision = snapshot(decision);
                        else {
                            context.decisionSnapshot = freeze(snapshot({ decision, shared }));
                            context.message = stage === 'message' ? context.chat[0] || null : null;
                            context.character = stage === 'message' ? context.characters[0] || null : null;
                        }
                        const returned = await fn(context);
                        if (script.returnMode === 'shared' && returned !== null && typeof returned === 'object') {
                            if (Array.isArray(returned)) throw Error('shared-array');
                            shared = Object.assign(shared, snapshot(returned));
                        }
                        if (stage === 'decision') decision = snapshot(context.decision);
                        const result = stringify({ shared: snapshot(shared), decision: snapshot(decision) });
                        rows.push({ scenario, stage, status: 'ok', sample: result.slice(0, 300), resultChars: result.length });
                    } catch { rows.push({ scenario, stage, status: 'failed', sample: '', resultChars: 0 }); }
                }
            }
            send({ status: rows.some(row => row.status !== 'ok') ? 'failed' : 'passed', phase, rows });
        } catch { send({ status: 'failed', phase, rows: [] }); }
        finally { close(); }
    };
    self.addEventListener('message', receive);
}
