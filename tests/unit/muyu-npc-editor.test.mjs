import test from 'node:test';
import assert from 'node:assert/strict';
import {createNpcSystem} from '../../systems/npc-system.js';
import {createNpcEditorPort} from '../../muyu/host/npc-editor.js';
import {createNpcEditorModule} from '../../muyu/modules/npc-editor/index.js';
import {actionReceipt,receiptSources,receiptText} from '../../muyu/actions/receipts.js';
function fixture(save=async()=>{},legacySave=async()=>{}){
 const target={kind:'chat',chatKey:'A'},metadata={gd:{npcs:[{name:'Alice',description:'PRIVATE_OLD',personality:'calm',scenario:'town',first_mes:'hello',imported:true,importedAvatar:'a.png',importId:'private_id',createdAt:1,custom:{secret:'KEEP'}},{name:'Bob',description:'second'}]}};
 let current=target,meta=metadata,busy=false,saves=0;
 const system=createNpcSystem({settings:{},EXT_KEY:'gd',getChatMetadata:()=>meta,saveChatConditional:legacySave,getCharacters:()=>[],log(){}});
 const port=createNpcEditorPort({getTarget:()=>current,getMetadata:()=>meta,extensionKey:'gd',system,isBusy:()=>busy,saveChatConfirmed:async(m)=>{saves++;await save(m);}});
 const draft=(changes={description:'PRIVATE_NEW'},operation='update')=>{const r=port.list(target).items[0];return port.preview(target,{...r,operation,changes});};
 return{target,metadata,port,system,draft,get saves(){return saves;},setTarget:t=>current=t,setMeta:m=>meta=m,setBusy:v=>busy=v};
}
test('NPC preview is pure and edit preserves import/card/source fields',async()=>{
 const f=fixture(),before=structuredClone(f.metadata),d=f.draft({name:' Alice2 ',description:' PRIVATE_NEW ',first_mes:'changed'});
 assert.deepEqual(f.metadata,before);assert.equal(f.saves,0);assert.equal(d.after.name,'Alice2');
 const entry=f.metadata.gd.npcs[0];assert.equal((await f.port.apply(d)).status,'applied_confirmed');assert.equal(f.saves,1);assert.equal(f.metadata.gd.npcs[0],entry);
 assert.deepEqual(entry,{...before.gd.npcs[0],name:'Alice2',description:'PRIVATE_NEW',first_mes:'changed'});assert.deepEqual(f.metadata.gd.npcs[1],before.gd.npcs[1]);await assert.rejects(f.port.apply(d),/STALE/);
});
test('Delete removes exactly the NPC record, not an exported card or archive',async()=>{const f=fixture(),d=f.draft({},'delete');assert.equal(d.after,null);await f.port.apply(d);assert.deepEqual(f.metadata.gd.npcs,[{name:'Bob',description:'second'}]);assert.equal(f.metadata.gd.archivedNpcs,undefined);});
for(const [label,mutate]of [
 ['selected edit',f=>f.metadata.gd.npcs[0].description='concurrent'],
 ['list shift',f=>f.metadata.gd.npcs.shift()],
 ['list append',f=>f.metadata.gd.npcs.push({name:'third'})],
 ['other renamed',f=>f.metadata.gd.npcs[1].name='Alice2'],
 ['import status',f=>f.metadata.gd.npcs[0].imported=false],
 ['replaced entry',f=>f.metadata.gd.npcs[0]=structuredClone(f.metadata.gd.npcs[0])],
 ['replaced list',f=>f.metadata.gd.npcs=structuredClone(f.metadata.gd.npcs)],
 ['replaced metadata',f=>f.setMeta(structuredClone(f.metadata))],
 ['chat switch',f=>f.setTarget({kind:'chat',chatKey:'B'})],
 ['busy',f=>f.setBusy(true)]
])test('Stale NPC approval blocks '+label,async()=>{const f=fixture(),d=f.draft();mutate(f);await assert.rejects(f.port.apply(d));assert.equal(f.saves,0);});
test('Other NPC body changes remain and do not invalidate selected edit',async()=>{const f=fixture(),d=f.draft();f.metadata.gd.npcs[1].description='concurrent';await f.port.apply(d);assert.equal(f.metadata.gd.npcs[1].description,'concurrent');});
for(const operation of ['update','delete'])test('Save rejection preserves concurrent edits and reports unknown / '+operation,async()=>{
 const f=fixture(async()=>{f.metadata.gd.npcs.at(-1).description='concurrent';f.metadata.gd.npcs.push({name:'new'});throw Error('rejected');});
 const result=await f.port.apply(f.draft(operation==='delete'?{}:{description:'PRIVATE_NEW'},operation));
 assert.equal(result.status,'outcome_unknown');assert.equal(result.chatSave,'unknown');assert.equal(f.saves,1);assert.equal(f.metadata.gd.npcs.at(-1).name,'new');assert.equal(f.metadata.gd.npcs.find(n=>n.name==='Bob').description,'concurrent');
});
for(const mutation of ['selected','layout','chat'])test('Confirmed NPC save reports partial after '+mutation,async()=>{
 const f=fixture(async()=>{if(mutation==='selected')f.metadata.gd.npcs[0].description='later';if(mutation==='layout')f.metadata.gd.npcs.push({name:'later'});if(mutation==='chat')f.setTarget({kind:'chat',chatKey:'B'});});
 assert.equal((await f.port.apply(f.draft())).status,'partial');
});
test('Shared NPC field revisions stop an older GUI failed-save rollback overwriting approved edits',async()=>{
 let reject;const legacyPending=new Promise((resolve,r)=>reject=r);const f=fixture(async()=>{},()=>legacyPending);
 const legacy=f.system.updateNpc(0,{description:'legacy'});const check=assert.rejects(legacy,/rejected/);
 await f.port.apply(f.draft({description:'PRIVATE_NEW'}));reject(Error('rejected'));await check;
 assert.equal(f.metadata.gd.npcs[0].description,'PRIVATE_NEW');
});
for(const changes of [{name:''},{name:' '},{name:3},{description:{}},{personality:null},{scenario:3},{imported:false},{importId:'new'},{createdAt:2},{importedAvatar:'new.png'},{custom:{}},JSON.parse('{"__proto__":{}}')])test('Closed NPC fields reject '+JSON.stringify(changes),()=>{const f=fixture();assert.throws(()=>f.draft(changes));assert.equal(f.saves,0);});
test('Case-insensitive duplicate names rejected; existing same-name self is allowed',()=>{const f=fixture();assert.throws(()=>f.draft({name:' bOB '}),/COLLISION/);assert.equal(f.draft({name:'ALICE'}).after.name,'ALICE');});
test('First message cannot be added if absent; empty update and hidden delete rejected',()=>{const f=fixture();delete f.metadata.gd.npcs[0].first_mes;assert.throws(()=>f.draft({first_mes:'add'}),/UNAVAILABLE/);assert.throws(()=>f.draft({}),/EMPTY/);assert.throws(()=>f.draft({name:'hidden'},'delete'));});
test('Read exact revision, budget and selectors are enforced',async()=>{const f=fixture(),r=f.port.list(f.target).items[0],m=createNpcEditorModule({port:f.port,charge:()=>false});assert.throws(()=>f.port.read(f.target,'Alice',r.revision,0));assert.equal(f.port.read(f.target,r.selector,r.revision,0).untrusted,true);assert.throws(()=>m.handlers['muyu.npc_editor.read']({...r,offset:0},{target:f.target,runId:'run'}),/BUDGET/);const d=f.draft();d.after.name='tamper';await assert.rejects(f.port.apply(d),/STALE/);f.metadata.gd.npcs[0].description='changed';assert.throws(()=>f.port.read(f.target,r.selector,r.revision,0),/STALE/);});
test('Empty list stays uninitialized; complete multibyte diff fails closed',()=>{const f=fixture();f.metadata.gd.npcs[0].description='猫'.repeat(4000);assert.throws(()=>f.draft({description:'猫'.repeat(4001)}),/TOO_LARGE/);const empty={};const port=createNpcEditorPort({getTarget:()=>f.target,getMetadata:()=>empty,extensionKey:'gd'});assert.deepEqual(port.list(f.target).items,[]);assert.deepEqual(empty,{});});
test('Receipt omits NPC names, card IDs, body and custom fields',()=>{const f=fixture(),content=f.draft(),r=actionReceipt({id:'op',artifactId:'draft',revision:1,status:'applied_confirmed',content,result:{chatSave:'confirmed'}});assert.equal(r.version,23);assert.deepEqual(receiptSources(r),[]);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|KEEP|Alice|a.png|private_id/);assert.match(receiptText(r,'zh'),/NPC/);});
