import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolBroker } from '../../muyu/tools/broker.js';
import { createScriptExecutorPort } from '../../muyu/host/script-executors.js';
import { createProviderAssetPort } from '../../muyu/host/provider-assets.js';
import { createScriptExecutorModule } from '../../muyu/modules/script-executors/index.js';
import { createProviderAssetModule } from '../../muyu/modules/provider-assets/index.js';
import { prepareProviderDraft } from '../../muyu/providers/draft.js';

function fixture(scripts, count, policy = () => true) {
    const settings = scripts
        ? { scriptExecutors: Array.from({ length: count }, (_, i) => ({ id: `s${i}`, name: `Saved ${i}`, enabled: false, triggerOn: 'message', priority: 0, code: '' })) }
        : { userProviders: Array.from({ length: count }, (_, i) => ({ name: `Saved ${i}`, source: 'export function register() {}', ids: [] })) };
    const port = scripts ? createScriptExecutorPort({ getSettings: () => settings }) : createProviderAssetPort({ getSettings: () => settings });
    const module = scripts ? createScriptExecutorModule({ port }) : createProviderAssetModule({ port });
    const listId = scripts ? 'muyu.scripts.list' : 'muyu.provider.assets';
    const readId = scripts ? 'muyu.scripts.read' : 'muyu.provider.source';
    let broker, calls = 0;
    const call = (toolId, args) => {
        // Traverse large legacy collections across bounded runs, not by raising the tool budget.
        if (!broker || calls % 60 === 0) broker = createToolBroker({ ...module, runId: `run:${calls}`, target: { kind: 'global' }, allowedTools: [listId, readId], policy, signal: new AbortController().signal, maxCalls: 64 });
        return broker.call({ callId: `call:${++calls}`, toolId, version: 1, args });
    };
    return { port, listId, readId, call };
}

for (const scripts of [true, false]) {
    const kind = scripts ? 'scripts' : 'providers';
    for (const count of [289, 4096]) test(`BUG-4F1-01 ${kind}: broker traverses all ${count} legacy assets`, async () => {
        const f = fixture(scripts, count), items = [];
        let offset = 0;
        do {
            const result = await f.call(f.listId, { offset });
            assert.equal(result.ok, true, `offset ${offset}: ${JSON.stringify(result.error)}`);
            const page = JSON.parse(result.data.text);
            assert.ok(page.items.length > 0 && page.items.length <= 32);
            items.push(...page.items);
            assert.ok(page.nextOffset === -1 || page.nextOffset > offset);
            offset = page.nextOffset;
        } while (offset !== -1);
        assert.deepEqual(items.map(row => row.name), Array.from({ length: count }, (_, i) => `Saved ${i}`));
        const last = items.at(-1);
        const args = scripts ? { id: last.id, revision: last.revision, offset: 0 } : { name: last.name, revision: last.revision, offset: 0 };
        const read = await f.call(f.readId, args);
        assert.equal(read.ok, true);
        assert.ok(JSON.parse(read.data.text).text);
        if (scripts) {
            assert.equal(f.port.preview({ operation: 'delete', id: last.id, revision: last.revision }).operation, 'delete');
            assert.throws(() => f.port.preview({ operation: 'create', changes: { name: 'Extra', code: '' } }), /SCRIPT_ASSET_CAPACITY/);
        } else {
            assert.equal(f.port.previewDelete(last).operation, 'delete');
            assert.throws(() => f.port.assertNew(prepareProviderDraft({ name: 'extra', source: 'export function register() {}', ids: ['extra'] })), /PROVIDER_ASSET_CAPACITY/);
        }
    });
    test(`BUG-4F1-01 ${kind}: broker retains offset and permission validation`, async () => {
        const f = fixture(scripts, 289);
        for (const offset of [-1, 0.5, 4097]) assert.equal((await f.call(f.listId, { offset })).error.code, 'INVALID_ARGUMENT');
        const terminal = await f.call(f.listId, { offset: 4096 });
        assert.equal(terminal.ok, true);
        assert.deepEqual(JSON.parse(terminal.data.text), { items: [], nextOffset: -1 });
        const denied = fixture(scripts, 289, () => false);
        assert.equal((await denied.call(denied.listId, { offset: 288 })).error.code, 'PERMISSION_DENIED');
    });
}
