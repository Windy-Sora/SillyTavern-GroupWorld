import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderPort } from '../../muyu/host/providers.js';
import { createProviderModule } from '../../muyu/modules/providers/index.js';
import { createPermissions } from '../../muyu/application/permissions.js';
import { assistantToolAccess } from '../../muyu/application/capabilities.js';
import { validateJson } from '../../muyu/core/json-contract.js';

test('World-book metadata continuation uses root and book revisions and rejects changed directory', async () => {
    const f=fixture();f.module.bindRun('r',50000);f.state.names=Array.from({length:160},(_,i)=>'Book'+i);
    f.books.Book0={entries:Object.fromEntries(Array.from({length:160},(_,i)=>[i,{uid:i,comment:'Entry'+i,content:'body'}]))};
    const root=await f.read('stWorldBookEntries');
    const rest=await f.read('stWorldBookEntries','books:80',root.revision);assert.match(rest.text,/book\[159\]/);
    const book=await f.read('stWorldBookEntries','book:0',root.revision);
    let entries=await f.read('stWorldBookEntries','entries:0:80',book.revision),all=entries.text;
    while(entries.nextOffset>=0){entries=await f.module.handlers['muyu.provider.read']({...entries.readHint.nextRead},{runId:'r',target:f.target});all+=entries.text;}
    assert.match(all,/entry\[0:159\]/);
    const entry=await f.read('stWorldBookEntries','entry:0:159',book.revision);assert.match(entry.text,/body/);
    f.books.Book0.entries[159].content='changed';
    const stale=await f.read('stWorldBookEntries','entries:0:80',book.revision);assert.equal(stale.status,'STALE_SOURCE');
    f.module.dispose();
});

function fixture(loadOverride) {
    const target = { kind: 'chat', userKey: 'u', chatKey: 'a' };
    let current = target, loads = 0;
    const state = { names: ['Atlas', 'Boreal'], global: ['Atlas'], chat: 'Boreal',
        characterPrimary: 'Atlas', characterAdditional: ['Boreal'], persona: 'Atlas' };
    const books = { Atlas: { entries: {
        10: { uid: 10, comment: 'Currency', key: ['gold', 'coins'], keysecondary: [], content: 'The realm uses gold coins.', disable: false },
        11: { uid: 11, comment: 'Capital', key: ['city'], keysecondary: [], content: 'The capital is Ardent.', constant: true },
    } }, Boreal: { entries: {} } };
    const worldBooks = { getState: () => state, load: async name => { loads++; return loadOverride ? loadOverride(name) : books[name]; } };
    const port = createProviderPort({ getContext: () => ({ chat: [] }), getSettings: () => ({}), extensionKey: 'gd', bindings: [], getProviders: () => [], worldBooks });
    const module = createProviderModule({ providerPort: port, currentTarget: () => current });
    const read = async (id, selector = '', revision = '', runId = 'r', signal) => {
        const value = await module.handlers['muyu.provider.read']({ id, selector, revision, offset: 0 }, { runId, target, signal });
        validateJson(module.registry.get('muyu.provider.read').outputSchema, value);
        return value;
    };
    return { target, state, books, port, module, read, loads: () => loads, switchChat: () => { current = { ...target, chatKey: 'b' }; } };
}

test('World-book metadata is separate from entry content authorization and never loads a book', async () => {
    const f = fixture(), permissions = createPermissions();
    const access = id => assistantToolAccess({ id: 'muyu.provider.read', effect: 'read' }, { id }, f.target, 'task', permissions, f.port);
    permissions.grant('chat', f.target);
    assert.deepEqual(access('stWorldBooks').missingSources, ['source:stWorldBooks']);
    permissions.decide({ source: 'stWorldBooks', reason: 'Check bindings', target: f.target, taskId: 'task' }, 'task', () => {});
    assert.equal(access('stWorldBooks').decision, true);
    assert.deepEqual(access('stWorldBookEntries').missingSources, ['source:stWorldBookEntries']);
    const overview = await f.read('stWorldBooks');
    assert.match(overview.text, /promptInjection=unknown/);
    assert.match(overview.text, /book\[0\] "Atlas" bindings=global,selected-character-primary,persona/);
    assert.match(overview.text, /book\[1\] "Boreal" bindings=chat,selected-character-additional/);
    assert.equal(f.loads(), 0);
    assert.doesNotMatch(overview.text, /gold coins|Ardent/);
    f.module.dispose();
});

test('Async world-book loading supports a bounded directory, search and exact entry read', async () => {
    const f = fixture();
    assert.equal(f.module.registry.get('muyu.provider.read').timeoutMs, 10000);
    const root = await f.read('stWorldBookEntries');
    assert.match(root.text, /books=2/);
    assert.equal(f.loads(), 0);
    const book = await f.read('stWorldBookEntries', 'book:0', root.revision);
    assert.match(book.text, /entry\[0:0\] "Currency"/);
    assert.doesNotMatch(book.text, /realm uses gold/);
    const search = await f.read('stWorldBookEntries', 'search:0:gold', book.revision);
    assert.match(search.text, /entry\[0:0\]/);
    const detail = await f.read('stWorldBookEntries', 'entry:0:0', book.revision);
    assert.equal(JSON.parse(detail.text).content, 'The realm uses gold coins.');
    assert.equal(await f.read('stWorldBookEntries', 'entry:0:9', book.revision).then(r => r.status), 'INVALID_SELECTOR');
    f.module.dispose();
});

test('World-book entry reads reject missing parent, changed content, reordered books and failed loads', async () => {
    const f = fixture();
    assert.equal((await f.read('stWorldBookEntries', 'entry:0:0')).status, 'STALE_SOURCE');
    const root = await f.read('stWorldBookEntries');
    const book = await f.read('stWorldBookEntries', 'book:0', root.revision);
    f.books.Atlas.entries[10].content = 'Changed after directory read';
    assert.equal((await f.read('stWorldBookEntries', 'entry:0:0', book.revision)).status, 'STALE_SOURCE');
    f.state.names.reverse();
    assert.equal((await f.read('stWorldBookEntries', 'book:0', root.revision)).status, 'STALE_SOURCE');
    f.module.dispose();
    const broken = fixture(async () => { throw Error('PRIVATE_HOST_FAILURE'); });
    const freshRoot = await broken.read('stWorldBookEntries');
    const result = await broken.read('stWorldBookEntries', 'book:0', freshRoot.revision);
    assert.equal(result.status, 'SOURCE_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_HOST_FAILURE/);
    broken.module.dispose();
    const missing = fixture(async () => null);
    const missingRoot = await missing.read('stWorldBookEntries');
    assert.equal((await missing.read('stWorldBookEntries', 'book:0', missingRoot.revision)).status, 'SOURCE_UNAVAILABLE');
    missing.module.dispose();
});

test('A delayed world-book load cannot publish its result after chat switch or cancellation', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const f = fixture(() => pending);
    const root = await f.read('stWorldBookEntries');
    const late = f.read('stWorldBookEntries', 'book:0', root.revision);
    f.switchChat();
    release(f.books.Atlas);
    assert.equal((await late).status, 'TARGET_UNAVAILABLE');
    f.module.dispose();
    let releaseCancelled;
    const pendingCancelled = new Promise(resolve => { releaseCancelled = resolve; });
    const g = fixture(() => pendingCancelled), controller = new AbortController();
    const initial = await g.read('stWorldBookEntries');
    const cancelled = g.read('stWorldBookEntries', 'book:0', initial.revision, 'r', controller.signal);
    controller.abort();
    releaseCancelled(g.books.Atlas);
    assert.equal((await cancelled).status, 'TARGET_UNAVAILABLE');
    g.module.dispose();
    let releaseForgotten;
    const pendingForgotten = new Promise(resolve => { releaseForgotten = resolve; });
    const h = fixture(() => pendingForgotten);
    const base = await h.read('stWorldBookEntries');
    const forgotten = h.read('stWorldBookEntries', 'book:0', base.revision);
    h.module.forgetRun('r');
    releaseForgotten(h.books.Atlas);
    assert.equal((await forgotten).status, 'TARGET_UNAVAILABLE');
    h.module.dispose();
});
