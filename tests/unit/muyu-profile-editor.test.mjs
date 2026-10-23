import test from 'node:test';
import assert from 'node:assert/strict';
import {createProfileEditorPort} from '../../muyu/host/profile-editor.js';
import {createProfileEditorModule} from '../../muyu/modules/profile-editor/index.js';
import {actionReceipt,receiptSources,receiptText} from '../../muyu/actions/receipts.js';
import {createConfirmedChatMetadataSave} from '../../systems/chat-metadata-save-confirmation.js';
function fixture(save=async()=>{}){
 const target={kind:'chat',chatKey:'A'},profile={summary:'PRIVATE_OLD',tags:['old'],motivation:'goal',relationships:'friend',custom:{secret:'KEEP'}};
 const metadata={gd:{characterProfiles:{'a.png':{profile,state:'ready',manualEdited:false,hash:'oldHash',name:'Alice',updatedAt:1,source:'KEEP_SOURCE'},'b.png':{profile:{summary:'Bob'}}},archivedProfiles:{'a.png':{profile:{summary:'OLD_ARCHIVE'}}},profileVersion:1,profileSchemaHash:'schema'}};
 let current=target,meta=metadata,busy=false,chars=[{avatar:'a.png',name:'Alice'},{avatar:'b.png',name:'Bob'}],saves=0;
 const port=createProfileEditorPort({getTarget:()=>current,getMetadata:()=>meta,getCharacters:()=>chars,extensionKey:'gd',isBusy:()=>busy,saveChatConfirmed:async(m)=>{saves++;await save(m);}});
 const draft=(changes={summary:'PRIVATE_NEW'},operation='update')=>{const r=port.list(target).items[0];return port.preview(target,{...r,operation,changes});};
 return{target,metadata,port,draft,get saves(){return saves;},setTarget:t=>current=t,setMeta:m=>meta=m,setBusy:v=>busy=v,setChars:v=>chars=v};
}
test('Profile preview is pure; edit preserves custom/source fields and sets manual-ready metadata',async()=>{
 const f=fixture(),before=structuredClone(f.metadata),d=f.draft({summary:'PRIVATE_NEW',tags:[' new ']});
 assert.deepEqual(f.metadata,before);assert.equal(f.saves,0);assert.deepEqual(d.after.profile.tags,['new']);assert.equal(d.after.manualEdited,true);assert.equal(d.after.state,'ready');assert.ok(d.after.updatedAt>1);
 assert.equal((await f.port.apply(d)).status,'applied_confirmed');assert.equal(f.saves,1);
 assert.equal(f.metadata.gd.characterProfiles['a.png'].profile.custom.secret,'KEEP');assert.equal(f.metadata.gd.characterProfiles['a.png'].source,'KEEP_SOURCE');assert.equal(f.metadata.gd.characterProfiles['a.png'].hash,'oldHash');
 assert.deepEqual(f.metadata.gd.archivedProfiles,before.gd.archivedProfiles);assert.deepEqual(f.metadata.gd.characterProfiles['b.png'],before.gd.characterProfiles['b.png']);await assert.rejects(f.port.apply(d),/STALE/);
});
test('Delete follows GUI archive semantics and previews loss of previous archive',async()=>{
 const f=fixture(),before=structuredClone(f.metadata.gd.characterProfiles['a.png']),d=f.draft({},'delete');
 assert.equal(d.after,null);assert.equal(d.archiveBefore.profile.summary,'OLD_ARCHIVE');assert.deepEqual(d.archiveAfter,before);
 await f.port.apply(d);assert.equal(Object.hasOwn(f.metadata.gd.characterProfiles,'a.png'),false);assert.deepEqual(f.metadata.gd.archivedProfiles['a.png'],before);assert.equal(f.metadata.gd.characterProfiles['b.png'].profile.summary,'Bob');
});
test('Archive deletion initializes missing archive only during approved apply',async()=>{const f=fixture();delete f.metadata.gd.archivedProfiles;const d=f.draft({},'delete');assert.equal(f.metadata.gd.archivedProfiles,undefined);await f.port.apply(d);assert.ok(f.metadata.gd.archivedProfiles['a.png']);});
for(const [label,mutate]of [
 ['selected edit',f=>f.metadata.gd.characterProfiles['a.png'].profile.summary='concurrent'],
 ['archive edit',f=>f.metadata.gd.archivedProfiles['a.png'].profile.summary='concurrent'],
 ['replaced active store',f=>f.metadata.gd.characterProfiles=structuredClone(f.metadata.gd.characterProfiles)],
 ['replaced archive store',f=>f.metadata.gd.archivedProfiles=structuredClone(f.metadata.gd.archivedProfiles)],
 ['replaced metadata',f=>f.setMeta(structuredClone(f.metadata))],
 ['character mapping',f=>f.setChars([{avatar:'a.png',name:'Renamed'}])],
 ['chat switch',f=>f.setTarget({kind:'chat',chatKey:'B'})],
 ['schema change',f=>f.metadata.gd.profileSchemaHash='new'],
 ['busy generation',f=>f.setBusy(true)]
])test('Stale profile draft rejects '+label,async()=>{const f=fixture(),d=f.draft();mutate(f);await assert.rejects(f.port.apply(d));assert.equal(f.saves,0);});
test('Unrelated role edit remains preserved and does not invalidate approval',async()=>{const f=fixture(),d=f.draft();f.metadata.gd.characterProfiles['b.png'].profile.summary='concurrent';await f.port.apply(d);assert.equal(f.metadata.gd.characterProfiles['b.png'].profile.summary,'concurrent');});
for(const operation of ['update','delete'])test('Save rejection keeps concurrent updates and does not retry / '+operation,async()=>{
 const f=fixture(async()=>{f.metadata.gd.characterProfiles['b.png'].profile.summary='concurrent';f.metadata.gd.archivedProfiles['a.png'].extra='concurrent archive';throw Error('rejected');});
 const d=f.draft(operation==='delete'?{}:{summary:'PRIVATE_NEW'},operation),result=await f.port.apply(d);
 assert.equal(result.status,'outcome_unknown');assert.equal(result.chatSave,'unknown');assert.equal(f.saves,1);assert.equal(f.metadata.gd.characterProfiles['b.png'].profile.summary,'concurrent');assert.equal(f.metadata.gd.archivedProfiles['a.png'].extra,'concurrent archive');await assert.rejects(f.port.apply(d),/STALE/);
});
for(const mutation of ['selected','schema','chat','archive'])test('Confirmed save returns partial after '+mutation+' changed',async()=>{
 const f=fixture(async()=>{if(mutation==='selected')f.metadata.gd.characterProfiles['a.png'].profile.summary='later';if(mutation==='schema')f.metadata.gd.profileSchemaHash='later';if(mutation==='chat')f.setTarget({kind:'chat',chatKey:'B'});if(mutation==='archive')f.metadata.gd.archivedProfiles['a.png'].profile.summary='later';});
 assert.equal((await f.port.apply(f.draft(mutation==='archive'?{}:{summary:'PRIVATE_NEW'},mutation==='archive'?'delete':'update'))).status,'partial');
});
for(const changes of [{summary:3},{tags:'a'},{tags:['']},{tags:[3]},{tags:Array(65).fill('a')},{motivation:null},{relationships:{}},{state:'ready'},{hash:'new'},{updatedAt:5},{profile:{}},JSON.parse('{"__proto__":{}}')])test('Closed profile changes reject '+JSON.stringify(changes),()=>{const f=fixture();assert.throws(()=>f.draft(changes));assert.equal(f.saves,0);});
test('Empty update and hidden archive changes reject',()=>{const f=fixture();assert.throws(()=>f.draft({}),/EMPTY/);assert.throws(()=>f.draft({summary:'hidden'},'delete'));});
test('Failed incomplete profile can archive but not edit; empty store stays uninitialized',async()=>{
 const f=fixture();f.metadata.gd.characterProfiles['a.png']={state:'failed',error:'opaque'};assert.equal(f.port.list(f.target).items[0].editable,false);assert.throws(()=>f.draft(),/NOT_EDITABLE/);await f.port.apply(f.draft({},'delete'));assert.equal(f.metadata.gd.archivedProfiles['a.png'].state,'failed');
 const empty={};const port=createProfileEditorPort({getTarget:()=>f.target,getMetadata:()=>empty,getCharacters:()=>[],extensionKey:'gd'});assert.deepEqual(port.list(f.target).items,[]);assert.deepEqual(empty,{});
});
test('Read revision and shared byte budget enforced; avatar and tampering rejected',async()=>{
 const f=fixture(),r=f.port.list(f.target).items[0],m=createProfileEditorModule({port:f.port,charge:()=>false});
 assert.throws(()=>f.port.read(f.target,'a.png',r.revision,0));assert.equal(f.port.read(f.target,r.character,r.revision,0).untrusted,true);
 assert.throws(()=>m.handlers['muyu.profile_editor.read']({...r,offset:0},{target:f.target,runId:'run'}),/BUDGET/);
 const d=f.draft();d.after.profile.summary='tamper';await assert.rejects(f.port.apply(d),/STALE/);
 f.metadata.gd.characterProfiles['a.png'].profile.summary='changed';assert.throws(()=>f.port.read(f.target,r.character,r.revision,0),/STALE/);
});
test('Multibyte complete diff rejects oversize without truncation',()=>{const f=fixture();f.metadata.gd.characterProfiles['a.png'].profile.summary='猫'.repeat(4000);assert.throws(()=>f.draft({summary:'猫'.repeat(4001)}),/TOO_LARGE/);});
test('Profile receipt omits all character and archive content',()=>{const f=fixture(),content=f.draft({},'delete'),r=actionReceipt({id:'op',artifactId:'draft',revision:1,status:'applied_confirmed',content,result:{chatSave:'confirmed'}});assert.equal(r.version,22);assert.deepEqual(receiptSources(r),[]);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|ARCHIVE|KEEP|Alice|a.png/);assert.match(receiptText(r,'zh'),/归档/);});
test('Persistence confirmation verifies active and archived profile slices together',async()=>{
 const metadata={gd:{characterProfiles:{},archivedProfiles:{a:{profile:{summary:'new'}}}}};
 let stored=structuredClone(metadata),saves=0;
 const save=createConfirmedChatMetadataSave({saveChatConditional:async()=>{saves++;},getCurrentChatId:()=> 'chat',getCurrentGroup:()=>({id:'group'}),getChatMetadata:()=>metadata,getRequestHeaders:()=>({}),selectValue:m=>({profiles:m.gd?.characterProfiles??{},archived:m.gd?.archivedProfiles??{}}),fetchChat:async()=>({ok:true,json:async()=>[{chat_metadata:stored}]})});
 await save(metadata);stored.gd.archivedProfiles.a.profile.summary='old';
 await assert.rejects(save(metadata),/could not be confirmed/);assert.equal(saves,2);
});
