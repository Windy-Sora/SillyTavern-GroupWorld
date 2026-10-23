import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderPort } from '../../muyu/host/providers.js';
import { createProviderModule } from '../../muyu/modules/providers/index.js';
import { createProcessStore } from '../../muyu/application/process-store.js';
import { createProcessView, processEventState } from '../../muyu/ui/process-view.js';
import { validateJson } from '../../muyu/core/json-contract.js';

class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.textContent = ''; }
    append(el) { this.children.push(el); }
    setAttribute(name, value) { this[name] = value; }
    replaceChildren() { this.children = []; }
}
function fixture(chat, limit = 50000) {
    const target = { kind: 'chat', userKey: 'u', chatKey: 'a' };
    const binding = { id: 'recentMessages', render() { throw Error('must not execute'); } };
    const port = createProviderPort({ getContext: () => ({ chat }), getSettings: () => ({}), extensionKey: 'gd', bindings: [binding], getProviders: () => [binding] });
    const module = createProviderModule({ providerPort: port, currentTarget: () => target });
    module.bindRun('r', limit);
    const store = createProcessStore(); store.create('r'); let seq = 0;
    function record(d) {
        store.event('r', { runId: 'r', seq: ++seq, type: 'tool.completed', payload: { attemptId: seq, toolId: 'muyu.provider.read', result: { data: d } } });
    }
    return {
        store, record,
        read(args = { id: 'recentMessages' }) {
            const d = module.handlers['muyu.provider.read'](args, { runId: 'r', target });
            validateJson(module.registry.get('muyu.provider.read').outputSchema, d); record(d); return d;
        },
        view(lang = 'zh', detail = 'verbose') {
            return createProcessView({ doc: { createElement: tag => new Element(tag) }, lang }).update({ id: 'r', process: store.snapshot('r') }, true, false, detail);
        },
    };
}
const continuation = d => ({ id: d.readHint.continuation.id, continuationToken: d.readHint.continuation.token });

for (const lang of ['zh', 'en']) test(`Normal pagination has no incomplete/error warning before or after completion (${lang})`, () => {
    const f = fixture([{ name: 'test', mes: 'x'.repeat(4500) }]);
    let d = f.read(); assert.equal(d.truncated, true); assert.equal(d.sourceLimited, false);
    assert.equal(processEventState(f.store.snapshot('r').rows[0]), 'done');
    const first = f.view(lang);
    assert.doesNotMatch(first.children[0].textContent, /异常|有限|不完整|error|partial|Limited/i);
    assert.match(first.children[1].children[0].textContent, lang === 'zh' ? /分段读取/ : /Paged read/);
    assert.equal(first.children[1].children[0]['data-state'], 'neutral');
    const pages = [d];
    while (d.nextOffset !== -1) { d = f.read(continuation(d)); pages.push(d); }
    assert.deepEqual(pages.map(d => d.text.length), [2000, 2000, 511]);
    assert.equal(d.truncated, false);
    f.store.lifecycle('r', 'succeeded'); f.store.lifecycle('r', 'cleaned');
    for (const detail of ['compact', 'standard', 'verbose']) {
        assert.equal(f.view(lang, detail).children[0].textContent, lang === 'zh' ? '执行过程 · 回答完成' : 'Execution process · Answer completed');
    }
    assert.doesNotMatch(JSON.stringify(f.store.snapshot('r')), /provider:\d|test|continuation|xxxxx/);
});

test('Real source omissions remain visible even when every page was read', () => {
    const f = fixture(Array.from({ length: 51 }, () => ({ name: 'test', mes: 'x'.repeat(100) })));
    let d = f.read(); assert.equal(d.sourceLimited, true);
    while (d.nextOffset !== -1) d = f.read(continuation(d));
    assert.equal(d.truncated, true); assert.equal(d.sourceLimited, true);
    f.store.lifecycle('r', 'succeeded');
    assert.match(f.view().children[0].textContent, /资料范围有限/);
    assert.match(f.view('en').children[0].textContent, /Limited scope/);
    assert.equal(processEventState(f.store.snapshot('r').rows.at(-1)), 'warning');
});

test('Budget exhaustion and read errors remain distinct from normal pagination', () => {
    const f = fixture([{ name: 'test', mes: 'x'.repeat(9000) }], 6000);
    let d = f.read();
    while (d.status === 'ok' && d.nextOffset !== -1) d = f.read(continuation(d));
    assert.equal(d.status, 'BUDGET_EXCEEDED');
    assert.match(f.view().children[0].textContent, /读取异常记录/);
    assert.match(f.view('en').children[0].textContent, /read error records/);
});

test('Legacy results without pagination metadata keep conservative partial warnings', () => {
    const f = fixture([]);
    f.record({ source: 'charMemory', status: 'ok', text: 'PRIVATE', revision: 'PRIVATE', truncated: true, nextOffset: 2000 });
    assert.equal(processEventState(f.store.snapshot('r').rows[0]), 'warning');
    assert.match(f.view().children[0].textContent, /资料范围有限或未完整返回/);
    assert.equal(f.store.snapshot('r').rows[0].read.nextOffset, 2000);
    assert.doesNotMatch(JSON.stringify(f.store.snapshot('r')), /PRIVATE/);
});
