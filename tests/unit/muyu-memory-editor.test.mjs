import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryEditorPort } from '../../muyu/host/memory-editor.js';
import { createMemoryEditorModule } from '../../muyu/modules/memory-editor/index.js';
import { actionReceipt, receiptSources, receiptText } from '../../muyu/actions/receipts.js';
function fixture(save=async()=>{}) {
 const target={kind:'chat',chatKey:'chat:A'},metadata={gd:{charMemories:{'a.png':[{event:'PRIVATE_OLD',mood:'neutral',round:7,timestamp:123,custom:{source:'keep'}},{event:'second',mood:'happy'}],'b.png':[{event:'Bob'}]}}};
 let current=target,meta=metadata,busy=false,chars=[{avatar:'a.png',name:'Alice'},{avatar:'b.png',name:'Bob'}],saves=0;
 const port=createMemoryEditorPort({getTarget:()=>current,getMetadata:()=>meta,getCharacters:()=>chars,extensionKey:'gd',isBusy:()=>busy,saveChatConfirmed:async(m)=>{saves++;await save(m);}});
 const draft=(changes={event:'PRIVATE_NEW'},operation='update')=>{const r=port.list(target).items[0];return port.preview(target,{...r,operation,index:0,changes});};
 return {target,metadata,port,draft,get saves(){return saves;},setTarget:t=>current=t,setMeta:m=>meta=m,setBusy:v=>busy=v,setChars:v=>chars=v};
}
test('Memory preview is pure and complete; apply preserves all nonedited fields',async()=>{
 const f=fixture(),before=structuredClone(f.metadata),d=f.draft();
 assert.deepEqual(f.metadata,before);assert.equal(f.saves,0);assert.equal(d.before.event,'PRIVATE_OLD');assert.equal(d.after.event,'PRIVATE_NEW');
 assert.equal((await f.port.apply(d)).status,'applied_confirmed');assert.equal(f.saves,1);
 assert.deepEqual(f.metadata.gd.charMemories['a.png'][0],{...before.gd.charMemories['a.png'][0],event:'PRIVATE_NEW'});
 assert.deepEqual(f.metadata.gd.charMemories['b.png'],before.gd.charMemories['b.png']);
 await assert.rejects(f.port.apply(d),/STALE/);
});
test('Delete removes exactly one entry and preserves other roles',async()=>{
 const f=fixture(),d=f.draft({},'delete');assert.equal(d.after,null);await f.port.apply(d);
 assert.deepEqual(f.metadata.gd.charMemories['a.png'],[{event:'second',mood:'happy'}]);assert.equal(f.metadata.gd.charMemories['b.png'][0].event,'Bob');
});
for(const [label,mutate] of [
 ['same-role append',f=>f.metadata.gd.charMemories['a.png'].push({event:'third'})],
 ['entry deletion changes index',f=>f.metadata.gd.charMemories['a.png'].shift()],
 ['same entry update',f=>f.metadata.gd.charMemories['a.png'][0].event='concurrent'],
 ['replaced store',f=>f.metadata.gd.charMemories=structuredClone(f.metadata.gd.charMemories)],
 ['replaced metadata',f=>f.setMeta(structuredClone(f.metadata))],
 ['character remapping',f=>f.setChars([{avatar:'a.png',name:'Renamed'}])],
 ['chat switch',f=>f.setTarget({kind:'chat',chatKey:'B'})],
 ['busy',f=>f.setBusy(true)],
])test('Stale memory approval blocks '+label,async()=>{const f=fixture(),d=f.draft();mutate(f);await assert.rejects(f.port.apply(d));assert.equal(f.saves,0);});
test('Unrelated role updates do not invalidate an exact draft',async()=>{const f=fixture(),d=f.draft();f.metadata.gd.charMemories['b.png'][0].event='concurrent';await f.port.apply(d);assert.equal(f.metadata.gd.charMemories['b.png'][0].event,'concurrent');});
for(const operation of ['update','delete'])test('Rejected save preserves concurrent updates and is unknown / '+operation,async()=>{
 const f=fixture(async()=>{f.metadata.gd.charMemories['b.png'][0].event='concurrent';f.metadata.gd.charMemories['a.png'].push({event:'append'});throw Error('save rejected');});
 const d=f.draft(operation==='delete'?{}:{event:'PRIVATE_NEW'},operation),result=await f.port.apply(d);
 assert.equal(result.status,'outcome_unknown');assert.equal(result.chatSave,'unknown');assert.equal(f.saves,1);
 assert.equal(f.metadata.gd.charMemories['b.png'][0].event,'concurrent');assert.equal(f.metadata.gd.charMemories['a.png'].at(-1).event,'append');
 await assert.rejects(f.port.apply(d),/STALE/);
});
test('Confirmed save with same-role changes returns partial',async()=>{const f=fixture(async()=>f.metadata.gd.charMemories['a.png'].push({event:'new'}));assert.equal((await f.port.apply(f.draft())).status,'partial');});
for(const changes of [{event:''},{event:' '},{event:3},{mood:'invented'},{round:2},{timestamp:999},{custom:{}},JSON.parse('{"__proto__":{}}')])test('Memory changes reject invalid or source metadata edits '+JSON.stringify(changes),()=>{const f=fixture();assert.throws(()=>f.draft(changes));assert.equal(f.saves,0);});
test('Delete does not accept hidden edits; empty update rejected',()=>{const f=fixture();assert.throws(()=>f.draft({event:'hidden'},'delete'));assert.throws(()=>f.draft({}),/EMPTY/);});
test('Missing characters, malformed selector and tampered draft reject',async()=>{
 const f=fixture(),row=f.port.list(f.target).items[0];assert.throws(()=>f.port.read(f.target,'a.png',row.revision,0));
 const d=f.draft();d.after.event='tamper';await assert.rejects(f.port.apply(d),/STALE/);
});
test('Memory reads paginate exact revisions and share tool byte budget',()=>{
 const f=fixture(),r=f.port.list(f.target).items[0],module=createMemoryEditorModule({port:f.port,charge:()=>false});
 assert.equal(f.port.read(f.target,r.character,r.revision,0).untrusted,true);
 assert.throws(()=>module.handlers['muyu.memory_editor.read']({...r,offset:0},{target:f.target,runId:'run'}),/BUDGET/);
 f.metadata.gd.charMemories['a.png'][0].event='changed';assert.throws(()=>f.port.read(f.target,r.character,r.revision,0),/STALE/);
});
test('Multibyte oversized complete diff rejects instead of truncating',()=>{const f=fixture();f.metadata.gd.charMemories['a.png'][0].event='猫'.repeat(8000);assert.throws(()=>f.draft({event:'猫'.repeat(8001)}),/TOO_LARGE/);});
test('Text-free receipt is historical and does not grant body access',()=>{
 const f=fixture(),content=f.draft(),r=actionReceipt({id:'op',artifactId:'draft',revision:1,status:'applied_confirmed',content,result:{chatSave:'confirmed'}});
 assert.equal(r.version,21);assert.deepEqual(receiptSources(r),[]);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_|Alice|a.png/);assert.match(receiptText(r,'zh'),/历史/);
});
