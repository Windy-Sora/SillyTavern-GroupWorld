import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldBookEditorPort } from '../../muyu/host/worldbook-editor.js';
import { createWorldBookEditorModule } from '../../muyu/modules/worldbook-editor/index.js';
import { createWorldBookEditActions } from '../../muyu/actions/worldbook-edit.js';
import { createBuiltins } from '../../muyu/modules/builtins.js';
import { actionReceipt, receiptSources, receiptText } from '../../muyu/actions/receipts.js';
import { readWorldBookEntries } from '../../muyu/host/st-world-books.js';
function fixture() {
    const target = { kind: 'global', userKey: 'u' }, state = { names: ['Atlas', 'Boreal'] }, books = { Atlas: { entries: {
        1: { uid: 1, comment: 'Gold', content: 'OLD {{char}}', key: ['gold'], keysecondary: [], disable: false, constant: false, probability: 77, extensions: { private: 'PRIVATE_EXTRA' } },
        7: { uid: 7, comment: 'Other', content: 'OTHER_PRIVATE' } }, extensions: { keep: true } }, Boreal: { entries: {} } };
    let current = target, busy = false, saves = 0, onSave = async () => {}, onLoad = null, onRefresh = () => { state.names = Object.keys(books); };
    const port = createWorldBookEditorPort({ getTarget: () => current, getState: () => state, load: async name => onLoad ? onLoad(name) : structuredClone(books[name]),
        refresh: async () => onRefresh(), createEntry: (_name,data) => { let uid=0;while(Object.hasOwn(data.entries,uid))uid++;const value={uid,key:[],keysecondary:[],comment:'',content:'',constant:false,disable:false,selective:true,order:100,position:0};data.entries[uid]=value;return value; },
        save: async (name, data, immediate) => { assert.equal(immediate, true); saves++; books[name] = data; await onSave(name, data); }, isBusy: () => busy });
    const read = async () => { const dir = port.list(target), overview = await port.read(target, 'book:0', dir.revision, 0); return overview; };
    const draft = async changes => { const r = await read(); return port.preview(target, { operation: 'update', selector: 'entry:0:0', revision: r.revision, changes }); };
    return { target, state, books, port, read, draft, saves: () => saves, setSave: fn => { onSave = fn; }, setLoad: fn => { onLoad = fn; }, setRefresh:fn=>{onRefresh=fn;}, switch: () => { current = { ...target, userKey: 'other' }; }, busy: () => { busy = true; } };
}

for(const operation of ['create_entry','delete_entry','create_book','copy_book'])test('World-book '+operation+' previews complete data, writes once and leaves bindings/source untouched',async()=>{
    const f=fixture(),original=structuredClone(f.books),root=f.port.list(f.target),book=await f.read();
    const content=await f.port.preview(f.target,{operation,selector:operation==='create_book'?'':operation==='delete_entry'?'entry:0:0':'book:0',revision:operation==='create_book'?root.revision:book.revision,changes:operation==='create_entry'?{content:'NEW',key:['new'],disable:true}:{},...(['create_book','copy_book'].includes(operation)?{name:'新世界'}:{})});
    assert.deepEqual(f.books,original);assert.equal(f.saves(),0);assert.equal(content.operation,operation);
    if(operation==='delete_entry'){assert.equal(content.after,null);assert.deepEqual(content.before,original.Atlas.entries[1]);}
    if(operation==='copy_book')assert.deepEqual(content.after,original.Atlas);
    if(operation==='create_entry'){assert.equal(content.before,null);assert.equal(content.after.selective,true);assert.equal(content.after.uid,0);}
    const result=await f.port.apply(content);assert.equal(result.status,'applied_unconfirmed');assert.equal(f.saves(),1);
    if(operation==='copy_book'){assert.deepEqual(f.books['新世界'],original.Atlas);assert.deepEqual(f.books.Atlas,original.Atlas);}
    if(operation==='create_book'){assert.deepEqual(f.books['新世界'],{entries:{}});assert.deepEqual(f.books.Atlas,original.Atlas);}
    if(operation==='delete_entry'){assert.equal(f.books.Atlas.entries[1],undefined);assert.deepEqual(f.books.Atlas.entries[7],original.Atlas.entries[7]);}
    if(operation==='create_entry'){assert.deepEqual(f.books.Atlas.entries[1],original.Atlas.entries[1]);assert.equal(f.books.Atlas.entries[0].content,'NEW');}
    assert.deepEqual(f.books.Boreal,original.Boreal);await assert.rejects(()=>f.port.apply(content),/STALE/);
    const receipt=actionReceipt({id:'op',artifactId:'draft',revision:1,status:result.status,content,result});assert.equal(receipt.operation,operation);assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE_EXTRA|新世界|NEW|OLD/);
});

test('New books reject invalid or colliding names and never overwrite refreshed concurrent resources',async()=>{
    const f=fixture(),revision=f.port.list(f.target).revision;
    for(const name of ['','../x','x.json','CON',' book','book ','atlas','Atlas','a/b','x:1','😀','a'.repeat(121)])await assert.rejects(()=>f.port.preview(f.target,{operation:'create_book',selector:'',revision,changes:{},name}),/INVALID|CONFLICT/);
    const content=await f.port.preview(f.target,{operation:'create_book',selector:'',revision,changes:{},name:'New'});
    f.setRefresh(()=>{f.books.New={entries:{4:{uid:4,content:'CONCURRENT'}}};f.state.names.push('New');});
    await assert.rejects(()=>f.port.apply(content),/STALE|CONFLICT/);assert.equal(f.saves(),0);assert.equal(f.books.New.entries[4].content,'CONCURRENT');
});

test('Copy and delete refuse changed source baselines, oversize complete previews and extra hidden changes',async()=>{
    const f=fixture(),r=await f.read();
    for(const operation of ['copy_book','delete_entry'])await assert.rejects(()=>f.port.preview(f.target,{operation,selector:operation==='copy_book'?'book:0':'entry:0:0',revision:r.revision,changes:{content:'hidden'},...(operation==='copy_book'?{name:'New'}:{})}),/INVALID/);
    const content=await f.port.preview(f.target,{operation:'copy_book',selector:'book:0',revision:r.revision,changes:{},name:'New'});
    f.books.Atlas.entries[7].content='CONCURRENT';await assert.rejects(()=>f.port.apply(content),/STALE/);assert.equal(f.saves(),0);
    f.books.Atlas.entries[1].content='长'.repeat(9000);const large=await f.read();
    await assert.rejects(()=>f.port.preview(f.target,{operation:'copy_book',selector:'book:0',revision:large.revision,changes:{},name:'New'}),/limit|TOO_LARGE/);assert.equal(f.saves(),0);
});

test('Created resource save failure is unknown without retry or deleting concurrent data',async()=>{
    const f=fixture(),revision=f.port.list(f.target).revision;
    const content=await f.port.preview(f.target,{operation:'create_book',selector:'',revision,changes:{},name:'New'});
    f.setSave(()=>{f.books.New.entries[5]={uid:5,content:'CONCURRENT'};throw Error('rejected');});
    assert.equal((await f.port.apply(content)).status,'outcome_unknown');assert.equal(f.saves(),1);assert.equal(f.books.New.entries[5].content,'CONCURRENT');
});
test('World-book preview is pure; writes only named fields and preserves unknown fields, other entries and root metadata', async () => {
    const f = fixture(), original = structuredClone(f.books), d = await f.draft({ content: 'NEW {{char}}', key: ['money'], disable: true });
    assert.deepEqual(f.books, original); assert.equal(f.saves(), 0); assert.doesNotMatch(JSON.stringify(d), /PRIVATE_EXTRA|OTHER_PRIVATE/);
    const result = await f.port.apply(d); assert.equal(result.status, 'applied_unconfirmed'); assert.equal(f.saves(), 1);
    assert.equal(f.books.Atlas.entries[1].content, 'NEW {{char}}'); assert.deepEqual(f.books.Atlas.entries[1].key, ['money']);
    assert.equal(f.books.Atlas.entries[1].probability, 77); assert.deepEqual(f.books.Atlas.entries[7], original.Atlas.entries[7]);
    assert.deepEqual(f.books.Atlas.extensions, original.Atlas.extensions); assert.deepEqual(f.books.Boreal, original.Boreal);
    await assert.rejects(f.port.apply(d), /STALE/);
});
test('Directory/entry revisions prevent name reorder, removal, unrelated book edits and stale preview execution', async () => {
    for (const mutate of [f => f.state.names.reverse(), f => { f.books.Atlas.entries[7].content = 'CONCURRENT'; }, f => { delete f.books.Atlas.entries[1]; }, f => f.switch()]) {
        const f = fixture(), d = await f.draft({ content: 'NEW' }); mutate(f); await assert.rejects(f.port.apply(d), /STALE|TARGET|INVALID/); assert.equal(f.saves(), 0);
    }
    const f = fixture(), dir = f.port.list(f.target); f.state.names.reverse(); await assert.rejects(f.port.read(f.target, 'book:0', dir.revision), /STALE/);
});
test('Unknown save outcome never retries or rolls back unrelated concurrent edits', async () => {
    const f = fixture(), d = await f.draft({ content: 'NEW' });
    f.setSave(async () => { f.books.Atlas.entries[7].content = 'CONCURRENT'; throw Error('PRIVATE_KEY'); });
    assert.equal((await f.port.apply(d)).status, 'outcome_unknown'); assert.equal(f.saves(), 1);
    assert.equal(f.books.Atlas.entries[7].content, 'CONCURRENT'); assert.equal(f.books.Atlas.entries[1].content, 'NEW');
    await assert.rejects(f.port.apply(d), /STALE/); assert.equal(f.saves(), 1);
});
test('Save resolution does not prove success; post-save replacement is reported unknown', async () => {
    const f = fixture(), d = await f.draft({ constant: true }); f.setSave(async () => { f.books.Atlas.entries[1].content = 'CONCURRENT'; });
    const result = await f.port.apply(d); assert.equal(result.status, 'outcome_unknown'); assert.equal(result.resourceSave, 'unconfirmed');
});
test('Clear, target switch or cancellation during delayed load cannot publish a fresh candidate', async () => {
    const f = fixture(), dir = f.port.list(f.target); let resolve;
    f.setLoad(() => new Promise(done => { resolve = done; })); const pending = f.port.read(f.target, 'book:0', dir.revision); f.port.clear(); resolve(f.books.Atlas);
    await assert.rejects(pending, /STALE/); assert.equal(f.saves(), 0);
});
test('Invalid fields, operations, IDs, booleans, overlarge diffs and malformed stores reject without writes', async () => {
    for (const changes of [{ uid: 999 }, { probability: 0 }, { key: [42] }, { disable: 'true' }, { content: 'x'.repeat(12001) }, {}]) {
        const f = fixture(); await assert.rejects(f.draft(changes), /INVALID|EMPTY/); assert.equal(f.saves(), 0);
    }
    const f = fixture(), r = await f.read(); await assert.rejects(f.port.preview(f.target, { operation: 'delete', selector: 'entry:0:0', revision: r.revision, changes: { content: 'x' } }), /INVALID/);
    f.books.Atlas.entries[1].content = '猫'.repeat(4000); await assert.rejects(f.draft({ content: '猫'.repeat(4001) }), /TOO_LARGE/);
    f.books.Atlas.entries[1].uid = 99; await assert.rejects(f.read(), /UNSUPPORTED/);
});
test('All loaded world-book names and entry metadata can be paged beyond the previous first-80 limit', async () => {
    const state = { names: Array.from({ length: 160 }, (_, i) => 'Book' + i) }, book = { entries: Object.fromEntries(Array.from({ length: 160 }, (_, i) => [i, { uid: i, content: 'Text', comment: 'Entry' + i }])) };
    const root = readWorldBookEntries('', () => state); assert.match(root.text, /nextBooks=books:80/);
    const rest = readWorldBookEntries('books:80', () => state); assert.match(rest.text, /book\[159\]/); assert.equal(rest.limited, false);
    const entries = await readWorldBookEntries('book:0', () => state, async () => book); assert.match(entries.text, /nextEntries=entries:0:80/);
    const tail = await readWorldBookEntries('entries:0:80', () => state, async () => book); assert.match(tail.text, /entry\[0:159\]/); assert.equal(tail.limited, false);
});
test('Read/preview tools charge shared budget, only publish succeeded candidates and require bound runs', async () => {
    const f = fixture(), r = await f.read(), module = createWorldBookEditorModule({ port: f.port, charge: () => false });
    await assert.rejects(module.handlers['muyu.worldbook_editor.read']({ selector: 'entry:0:0', revision: r.revision, offset: 0 }, { target: f.target, runId: 'r' }), /BUDGET/);
    const args = { operation: 'update', selector: 'entry:0:0', revision: r.revision, changesJson: '{"content":"NEW"}' };
    await assert.rejects(module.handlers['muyu.worldbook_editor.preview'](args, { target: f.target, runId: 'r' }), /RUN_NOT_BOUND/);
    module.bindRun({ id: 'r', target: f.target, taskId: 't' }); const result = await module.handlers['muyu.worldbook_editor.preview'](args, { target: f.target, runId: 'r' });
    const app = { snapshot: () => ({ runs: [{ id: 'r', status: 'failed', target: f.target, taskId: 't' }] }) };
    assert.throws(() => module.publishDraft(app, 'r', result.candidateId), /INVALID_CANDIDATE/); assert.equal(f.saves(), 0); module.dispose();
});
test('Exact coordinator approval runs once; receipts disclose metadata only and never confirm persistence', async () => {
    const f = fixture(), content = await f.draft({ content: 'NEW_PRIVATE' }), artifact = { id: 'draft', revision: 1, sessionId: 's', kind: 'worldbook-edit-draft', content };
    const actions = createWorldBookEditActions({ getArtifact: () => artifact, validate: () => f.port.assertFresh(content), getTarget: () => f.target, writer: f.port });
    const prepared = actions.prepare('draft', 1); assert.equal(f.saves(), 0); const result = await actions.approve(prepared.id); assert.equal(result.status, 'applied_unconfirmed');
    assert.throws(() => actions.approve(prepared.id), /STALE/); assert.equal(f.saves(), 1);
    const receipt = actionReceipt(result); assert.equal(receipt.version, 32); assert.deepEqual(receiptSources(receipt), []);
    assert.doesNotMatch(JSON.stringify(receipt), /NEW_PRIVATE|OLD|Atlas|PRIVATE_EXTRA/); assert.match(receiptText(receipt, 'zh'), /不证明持久化/);
});
test('Optional world-book editor composes without orphan labels and is not enabled when host port is absent', () => {
    const f = fixture(), memoryPorts = { extensionKey: 'gd', getTarget: () => f.target, getSettings: () => ({}), getMetadata: () => ({}), getGroup: () => null, getMessageCount: () => 0 }, host = { globalTarget: f.target, currentTarget: () => null, getSettings: () => ({}), memoryPorts };
    host.configTarget = () => f.target;
    const absent = createBuiltins(host); assert.equal(absent.registry.list().some(d => d.id.startsWith('muyu.worldbook_editor.')), false); absent.dispose();
    const present = createBuiltins({ ...host, worldBookEditor: f.port }); assert.equal(present.registry.list().filter(d => d.id.startsWith('muyu.worldbook_editor.')).length, 4); present.dispose();
});
