import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryEditorPort } from '../../muyu/host/memory-editor.js';
import { createMemoryEditorModule } from '../../muyu/modules/memory-editor/index.js';
import { actionReceipt, receiptSources, receiptText, validateReceipt } from '../../muyu/actions/receipts.js';
import { renderMemoryEditor } from '../../muyu/ui/memory-editor-view.js';
function fixture(initial = {}, save = async () => {}) {
    const target = {kind:'chat',chatKey:'A'}, metadata = structuredClone(initial), settings = {memoryMaxEntries:200,memoryEnabled:false};
    let current=target, meta=metadata, chars=[{avatar:'a.png',name:'Alice'},{avatar:'b.png',name:'Bob'}], round=7, busy=false, saves=0;
    const port=createMemoryEditorPort({getTarget:()=>current,getMetadata:()=>meta,getCharacters:()=>chars,getSettings:()=>settings,getChatLength:()=>round,extensionKey:'gd',isBusy:()=>busy,saveChatConfirmed:async()=>{saves++;await save();}});
    const draft=(changes={event:'PRIVATE_EVENT'},index=0)=>{const row=port.createTargets(target).items[index];return port.createPreview(target,{...row,changes});};
    return {port,target,metadata,settings,draft,get saves(){return saves;},setTarget:v=>current=v,setMeta:v=>meta=v,setChars:v=>chars=v,setRound:v=>round=v,setBusy:v=>busy=v};
}
for(const initial of [{},{gd:{}},{gd:{charMemories:{}}},{gd:{charMemories:{'a.png':[]}}}])test('Creation list/preview are pure for missing containers '+JSON.stringify(initial),async()=>{
    const f=fixture(initial),before=structuredClone(f.metadata),d=f.draft();
    assert.deepEqual(f.metadata,before);assert.equal(f.saves,0);assert.equal(d.before,null);assert.equal(d.after.round,7);assert.equal(d.after.mood,'neutral');assert.ok(d.after.timestamp>0);
    assert.equal((await f.port.apply(d)).status,'applied_confirmed');assert.equal(f.saves,1);assert.equal(f.metadata.gd.charMemories['a.png'][0].event,'PRIVATE_EVENT');assert.equal(f.settings.memoryEnabled,false);
    await assert.rejects(f.port.apply(d),/STALE/);
});
test('Append keeps previous entries, other roles and unrelated root data',async()=>{
    const f=fixture({gd:{other:{keep:true},charMemories:{'a.png':[{event:'old',round:1,custom:{keep:true}}],'b.png':[{event:'Bob'}]}}}),old=structuredClone(f.metadata),d=f.draft({event:' new ',mood:'happy'});
    assert.equal(d.index,1);await f.port.apply(d);assert.deepEqual(f.metadata.gd.charMemories['a.png'][0],old.gd.charMemories['a.png'][0]);assert.equal(f.metadata.gd.charMemories['a.png'][1].event,'new');assert.deepEqual(f.metadata.gd.charMemories['b.png'],old.gd.charMemories['b.png']);assert.deepEqual(f.metadata.gd.other,old.gd.other);
});
for(const [label,mutate] of [
    ['chat switch',f=>f.setTarget({kind:'chat',chatKey:'B'})],
    ['metadata replaced',f=>f.setMeta(structuredClone(f.metadata))],
    ['root replaced',f=>f.metadata.gd={...f.metadata.gd}],
    ['store replaced',f=>f.metadata.gd.charMemories={...f.metadata.gd.charMemories}],
    ['selected append',f=>f.metadata.gd.charMemories['a.png'].push({event:'concurrent'})],
    ['mapping reordered',f=>f.setChars([{avatar:'b.png',name:'Bob'},{avatar:'a.png',name:'Alice'}])],
    ['renamed',f=>f.setChars([{avatar:'a.png',name:'Renamed'}])],
    ['message count changed',f=>f.setRound(8)],
    ['capacity changed',f=>f.settings.memoryMaxEntries=10],
    ['busy',f=>f.setBusy(true)],
])test('Creation exact approval rejects '+label,async()=>{
    const f=fixture({gd:{charMemories:{'a.png':[{event:'before'}]}}}),d=f.draft();mutate(f);await assert.rejects(f.port.apply(d));assert.equal(f.saves,0);
});
test('Unrelated role edit survives and does not invalidate append',async()=>{
    const f=fixture({gd:{charMemories:{'a.png':[],'b.png':[{event:'old'}]}}}),d=f.draft();f.metadata.gd.charMemories['b.png'][0].event='concurrent';await f.port.apply(d);assert.equal(f.metadata.gd.charMemories['b.png'][0].event,'concurrent');
});
test('Capacity rejects without pruning even while feature disabled',()=>{
    const f=fixture({gd:{charMemories:{'a.png':[{event:'old'}]}}});f.settings.memoryMaxEntries=1;const before=structuredClone(f.metadata);
    assert.equal(f.port.createTargets(f.target).items[0].canAppend,false);assert.throws(()=>f.draft(),/CAPACITY/);assert.deepEqual(f.metadata,before);
});
for(const changes of [{},{event:''},{event:' '},{event:3},{event:'x',mood:'bad'},{event:'x',round:4},{event:'x',timestamp:1},{event:'x',custom:{}},JSON.parse('{"event":"x","__proto__":{}}')])test('Creation input rejects '+JSON.stringify(changes),()=>{const f=fixture();assert.throws(()=>f.draft(changes));assert.deepEqual(f.metadata,{});});
test('Model supplied avatar and old edit selector cannot select creation target',()=>{
    const f=fixture(),r=f.port.createTargets(f.target).items[0];for(const character of ['a.png','Alice','memory-role:0','memory-character:99'])assert.throws(()=>f.port.createPreview(f.target,{...r,character,changes:{event:'x'}}));
});
test('Tampered candidate cannot apply',async()=>{const f=fixture(),d=f.draft();d.after.round=999;await assert.rejects(f.port.apply(d),/STALE/);assert.equal(f.saves,0);});
test('Save rejection preserves own append and concurrent edit without retry',async()=>{
    const f=fixture({},async()=>{f.metadata.gd.charMemories['b.png']=[{event:'concurrent'}];throw Error('offline');}),d=f.draft(),r=await f.port.apply(d);
    assert.equal(r.status,'outcome_unknown');assert.equal(r.chatSave,'unknown');assert.equal(f.metadata.gd.charMemories['a.png'][0].event,'PRIVATE_EVENT');assert.equal(f.metadata.gd.charMemories['b.png'][0].event,'concurrent');assert.equal(f.saves,1);await assert.rejects(f.port.apply(d));assert.equal(f.saves,1);
});
test('Successful save with concurrent selected append reports partial',async()=>{const f=fixture({},async()=>f.metadata.gd.charMemories['a.png'].push({event:'later'}));assert.equal((await f.port.apply(f.draft())).status,'partial');});
test('Creation list charges shared budget; no implicit old edit permission',()=>{
    const f=fixture(),m=createMemoryEditorModule({port:f.port,charge:()=>false});assert.throws(()=>m.handlers['muyu.memory_editor.create_targets']({offset:0},{target:f.target,runId:'r'}),/BUDGET/);assert.deepEqual(f.metadata,{});
});
test('Combined target list exceeding JSON capacity rejects before writing',()=>{
    const f=fixture({gd:{charMemories:{'a.png':[{event:'a'.repeat(26000)}]}}}),before=structuredClone(f.metadata);
    assert.throws(()=>f.draft({event:'b'.repeat(8000)}),/byte limit/);assert.deepEqual(f.metadata,before);assert.equal(f.saves,0);
});
test('Creation receipt v28 is metadata-only and old v21 remains closed',()=>{
    const f=fixture(),content=f.draft(),r=actionReceipt({id:'op',artifactId:'draft',revision:1,status:'applied_confirmed',content,result:{chatSave:'confirmed'}});
    assert.equal(r.version,28);assert.deepEqual(receiptSources(r),[]);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_EVENT|Alice|a.png/);assert.match(receiptText(r,'zh'),/历史/);assert.match(receiptText(r,'en'),/Historical/);assert.throws(()=>validateReceipt({...r,version:21}));
});
for(const lang of ['zh','en'])test('Creation card uses localized operation and full single-entry diff '+lang,()=>{
    const elements=[],doc={createElement(tag){const e={tag,textContent:'',children:[],append(x){this.children.push(x);},setAttribute(){}};elements.push(e);return e;}},card=doc.createElement('article'),f=fixture();
    renderMemoryEditor({doc,card,artifact:{id:'a',revision:1,content:f.draft()},state:{canApplyMemoryEdit:true},controller:{},act(){},lang});
    const text=elements.map(e=>e.textContent).join('\n');assert.match(text,lang==='zh'?/新增记忆/:/New memory/);assert.match(text,/PRIVATE_EVENT/);assert.match(text,/"before": null/);assert.ok(elements.some(e=>e.tag==='details'));
});
