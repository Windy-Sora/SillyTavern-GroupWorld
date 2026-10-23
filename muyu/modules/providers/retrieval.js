import { randomUUID } from '../../runtime/crypto.js';
import { searchRecords } from '../../retrieval/literal.js';
import { fingerprint } from '../../context/planner.js';
import { jsonKey } from '../../core/json-contract.js';

const str = maxLength => ({ type: 'string', maxLength });
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const states = ['ok', 'empty', 'SOURCE_UNAVAILABLE', 'SOURCE_TOO_LARGE', 'INVALID_SELECTOR', 'INVALID_REFERENCE', 'STALE_SOURCE', 'TARGET_UNAVAILABLE', 'BUDGET_EXCEEDED'];
const base = { id: str(80), selector: str(32), revision: str(80), resultId: str(40) };
const key = args => jsonKey([args.id, args.selector || '', args.revision || '', args.resultId || '']);
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;

/** Run-local references carry locations, never grants. Search cannot execute render. */
export function createProviderRetrieval({ registry, getRun, current, source }) {
    registry.register({ id: 'muyu.provider.search', version: 1, description: '只读字面检索：id=chatHistory搜当前酒馆正文，selector为空；id=charMemory需先用provider.read读空角色目录，selector=character:N且revision必须携带该目录版本；STALE_SOURCE须重读目录，不沿用旧序号。续搜和match也必须沿用目录revision。查询局部细节时优先搜片段，再用muyu.provider.match回读。已有Provider结果需id/revision/resultId，不能执行render。每次有界扫描32步/65536字符，最多8个片段；scannedSteps是可重复访问同条记录的扫描步数，scannedRecords是本页涉及的不同记录数，不可跨页相加当总数；totalRecords仅是所选来源/角色的记录总数。complete仅表示本次query在所选来源搜完，不证明无其他主题记录。cursor非空说明未搜完，原样续搜，不能断言不存在。按页核验来源，非全库原子快照；片段不能代替完整证据。仍需原来源授权。',
        inputSchema: obj({ ...base, query: str(128), cursor: str(40) }, ['id', 'query']),
        outputSchema: obj({ source: str(80), status: { type: 'string', enum: states }, complete: { type: 'boolean' }, cursor: str(40), query: str(128), totalRecords: { type: 'integer', minimum: 0, maximum: 65536 }, scannedSteps: { type: 'integer', minimum: 0, maximum: 32 }, scannedRecords: { type: 'integer', minimum: 0, maximum: 32 }, scannedChars: { type: 'integer', minimum: 0, maximum: 65536 },
            items: { type: 'array', maxItems: 8, items: obj({ index: { type: 'integer', minimum: 0, maximum: 65535 }, role: str(16), text: str(240), matchToken: str(40) }) } }),
        scope: 'chat', effect: 'read', dataClasses: ['chat-content', 'provider-code'], confirmation: 'policy', resourceKeys: [], timeoutMs: 2000, retryPolicy: { kind: 'none', maxAttempts: 1 } });
    registry.register({ id: 'muyu.provider.match', version: 1, description: '回读provider.search命中的原文上下文，每次最多4000字符。原样携带id/selector及必要的revision/resultId、matchToken；nextToken非空可续读。修改、排序变化或跨任务引用失效；不重新执行Provider，不恢复授权。引用为本次核验的证据，不证明持久化/实际执行或全库一致。',
        inputSchema: obj({ ...base, matchToken: str(40) }, ['id', 'matchToken']),
        outputSchema: obj({ source: str(80), status: { type: 'string', enum: states }, text: str(4000), nextToken: str(40) }),
        scope: 'chat', effect: 'read', dataClasses: ['chat-content', 'provider-code'], confirmation: 'policy', resourceKeys: [], timeoutMs: 2000, retryPolicy: { kind: 'none', maxAttempts: 1 } });
    function state(args, ctx) {
        if (!current(ctx, { scope: 'chat' })) throw Error('TARGET_UNAVAILABLE');
        const run = getRun(ctx.runId);
        if (!run || run.exhausted || run.bytes >= run.limit) throw Error('BUDGET_EXCEEDED');
        if (!run.retrieval) run.retrieval = new Map();
        return run;
    }
    function record(args, ctx, run, token, kind) {
        const ref = run.retrieval.get(token);
        if (!ref || ref.kind !== kind || ref.key !== key(args) || ref.target !== jsonKey(ctx.target)) throw Error('INVALID_REFERENCE');
        const fresh = source(args, run, ctx);
        if (fresh.identity !== ref.identity || fresh.length !== ref.total || !fresh.at(ref.index) || fingerprint(fresh.at(ref.index)) !== ref.fingerprint) throw Error('STALE_SOURCE');
        return { ref, fresh };
    }
    function charge(run, output, refs) {
        const cost = bytes(output);
        if (run.retrieval.size + refs.length > 256 || run.bytes + cost > run.limit) { run.exhausted = true; throw Error('BUDGET_EXCEEDED'); }
        run.bytes += cost; run.exhausted ||= run.bytes >= run.limit;
        refs.forEach(([token, value]) => run.retrieval.set(token, value));
        return output;
    }
    const error = e => states.includes(e?.message) ? e.message : e?.message === 'HISTORY_STALE' ? 'STALE_SOURCE' : 'INVALID_SELECTOR';
    return {
        'muyu.provider.search': (args, ctx) => {
            const output = { source: args.id, status: 'ok', complete: false, cursor: '', query: args.query, totalRecords: 0, scannedSteps: 0, scannedRecords: 0, scannedChars: 0, items: [] };
            try {
                const run = state(args, ctx);
                let fresh, offset = 0, start = 0, expected = '';
                if (args.cursor) {
                    const resolved = record(args, ctx, run, args.cursor, 'cursor');
                    if (resolved.ref.query !== args.query) throw Error('INVALID_REFERENCE');
                    fresh = resolved.fresh; offset = resolved.ref.index; start = resolved.ref.start; expected = resolved.ref.fingerprint;
                } else fresh = source(args, run, ctx);
                const page = searchRecords(fresh, { query: args.query, offset, start, fingerprint: expected, oneHitPerRecord: false });
                const refs = [], reference = (kind, index, position) => {
                    const token = randomUUID();
                    refs.push([token, { kind, index, start: position, fingerprint: fingerprint(fresh.at(index)), identity: fresh.identity, total: fresh.length, key: key(args), target: jsonKey(ctx.target), query: args.query }]);
                    return token;
                };
                output.complete = page.complete; output.totalRecords = fresh.length; output.scannedSteps = page.scannedMessages;
                // Count actual visits, not the Unicode-adjusted continuation cursor.
                output.scannedRecords = page.scannedRecords;
                output.scannedChars = page.scannedChars;
                output.items = page.items.map(item => ({ index: item.index, role: item.role, text: item.text, matchToken: reference('match', item.index, item.start) }));
                if (!page.complete) output.cursor = reference('cursor', page.nextOffset, page.nextStart);
                return charge(run, output, refs);
            } catch (e) { return { ...output, status: error(e), complete: false, cursor: '', totalRecords: 0, scannedSteps: 0, scannedRecords: 0, scannedChars: 0, items: [] }; }
        },
        'muyu.provider.match': (args, ctx) => {
            const output = { source: args.id, status: 'ok', text: '', nextToken: '' };
            try {
                const run = state(args, ctx), { ref, fresh } = record(args, ctx, run, args.matchToken, 'match');
                const content = fresh.at(ref.index).content;
                let end = Math.min(content.length, ref.start + 4000);
                if (end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1])) end--;
                output.text = content.slice(ref.start, end);
                const refs = [];
                if (end < content.length) { output.nextToken = randomUUID(); refs.push([output.nextToken, { ...ref, start: end }]); }
                return charge(run, output, refs);
            } catch (e) { return { ...output, status: error(e), text: '', nextToken: '' }; }
        },
    };
}
