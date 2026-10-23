import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcLibrarySystem } from '../../systems/npc-library-system.js';
import { createNpcLibraryPort } from '../../muyu/host/npc-libraries.js';
import { createNpcLibraryModule } from '../../muyu/modules/npc-libraries/index.js';
import { createNpcLibraryActions } from '../../muyu/actions/npc-library-save.js';
import { actionReceipt, receiptContext, validateReceipt } from '../../muyu/actions/receipts.js';
import { renderNpcLibrarySave } from '../../muyu/ui/npc-library-save-view.js';
import { configurationCoverage } from '../../muyu/config/coverage.js';
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function fixture(save=()=>{}) {
 const settings={npcEnabled:false,npcPrompt:'ACTIVE_PROMPT'},ext={};let saves=0,current=settings;
 const forbidden=()=>{throw Error('must not access chat, apply or generate');};
 const system=createNpcLibrarySystem({settings,extension_settings:ext,EXT_KEY:'gd',saveSettings:()=>{saves++;return save();},
 getCurrentGroup:forbidden,npcSystem:{getNpcs:forbidden},parseNpcImportFile:forbidden,applyNpcImport:forbidden,getDefaultNpcPrompt:forbidden,log(){}});
 const port=createNpcLibraryPort({getSettings:()=>current,system});
 return {settings,port,system,ext,saves:()=>saves,replaceSettings:()=>current={}};
}
const data=()=>({type:'npc-export',version:1,template:{npcPrompt:'PRIVATE_TEMPLATE'},npcs:[{name:'Alice',description:'PRIVATE_BODY',personality:'calm',scenario:'town',first_mes:'hello'}]});
const create=f=>f.port.preview({operation:'create',changes:{name:'pack',exportData:data()}});
const change=(f,changes={},operation='update')=>{const row=f.port.list().items[0];return f.port.preview({operation,id:row.id,revision:row.revision,changes});};
test('NPC library reads and preview stay pure; CRUD changes only global library assets',async()=>{
 const f=fixture();assert.deepEqual(f.port.list().items,[]);const draft=create(f);assert.equal(f.settings.npcLibraries,undefined);assert.equal(f.saves(),0);
 assert.equal((await f.port.save(draft)).status,'saved_unconfirmed');const id=f.settings.npcLibraries[0].id,at=f.settings.npcLibraries[0].createdAt;
 await f.port.save(change(f,{name:'renamed',description:'info'}));assert.equal(f.settings.npcLibraries[0].id,id);assert.equal(f.settings.npcLibraries[0].createdAt,at);
 assert.equal(f.settings.npcLibraries[0].npcCount,1);const row=f.port.list().items[0];
 const exported=f.port.exportEntry(row.id,row.revision);assert.equal(exported.libraryMeta.name,'renamed');assert.equal(exported.npcs[0].description,'PRIVATE_BODY');
 assert.equal(JSON.parse(f.port.read(row.id,row.revision).text).name,'renamed');
 await f.port.save(change(f,{},'delete'));assert.deepEqual(f.settings.npcLibraries,[]);
 assert.equal(f.saves(),3);assert.equal(f.settings.npcEnabled,false);assert.equal(f.settings.npcPrompt,'ACTIVE_PROMPT');
});
test('NPC library validates version, closed shape, unique names, types and prototype keys',()=>{
 const f=fixture(),bad=[
 {...data(),version:2},{...data(),npcs:[]},{...data(),npcs:[{name:'Alice'},{name:'alice'}]},
 {...data(),npcs:[{name:' Alice'}]},{...data(),npcs:[{name:'x',description:{code:'bad'}}]},
 {...data(),npcs:[{name:'x',avatar:'unsupported'}]},{...data(),template:{npcPrompt:'x',apiKey:'secret'}},
 {...data(),npcs:Array.from({length:65},(_,i)=>({name:'npc'+i}))},
 {...data(),source:{chatMetadata:{}}}, {...data(),libraryMeta:{createdAt:-1}},
 ];
 for(const exportData of bad)assert.throws(()=>f.port.preview({operation:'create',changes:{name:'pack',exportData}}),/INVALID/);
 assert.throws(()=>f.port.preview({operation:'create',changes:JSON.parse('{"name":"x","__proto__":{}}')}),/INVALID/);
 assert.throws(()=>f.port.preview({operation:'create',changes:{name:'',exportData:data()}}),/INVALID/);
});
test('NPC library full-diff size limit never truncates; large existing assets remain readable',async()=>{
 const f=fixture();await f.port.save(create(f));const large=data();large.npcs[0].description='字'.repeat(9000);
 assert.throws(()=>f.port.preview({operation:'create',changes:{name:'large',exportData:large}}),/DRAFT_TOO_LARGE/);
 f.settings.npcLibraries[0].exportData=large;const row=f.port.list().items[0];
 assert.ok(f.port.read(row.id,row.revision).nextOffset>0);assert.throws(()=>f.port.exportEntry(row.id,row.revision),/EXPORT_TOO_LARGE/);
 assert.throws(()=>change(f,{},'delete'),/DRAFT_TOO_LARGE/);
});
test('NPC library duplicate IDs, unknown entry fields and duplicate package names fail closed',async()=>{
 const f=fixture();await f.port.save(create(f));assert.throws(()=>create(f),/NAME_CONFLICT/);
 f.settings.npcLibraries[0].extra='preserve';assert.throws(()=>change(f,{description:'x'}),/UNSUPPORTED/);
 f.settings.npcLibraries.push({...f.settings.npcLibraries[0]});assert.throws(()=>f.port.list(),/STORE_UNAVAILABLE/);
});
test('NPC library stale revision and replaced settings reject without saving',async()=>{
 const f=fixture();await f.port.save(create(f));const d=change(f,{description:'edit'});f.settings.npcLibraries[0].description='concurrent';
 await assert.rejects(f.port.save(d),/STALE/);assert.equal(f.saves(),1);
 const fresh=change(f,{description:'edit'});f.replaceSettings();await assert.rejects(f.port.save(fresh));assert.equal(f.saves(),1);
});
test('NPC legacy deletion shares queue; approved update rechecks after target removal',async()=>{
 const started=gate(),wait=gate();let hold=false;const f=fixture(()=>{if(hold){started.resolve();return wait.promise;}});
 await f.port.save(create(f));const row=f.port.list().items[0],draft=change(f,{description:'update'});hold=true;
 const deletion=f.system.deleteLibrary(row.id);await started.promise;const updating=f.port.save(draft);wait.resolve();await deletion;
 await assert.rejects(updating,/STALE/);assert.equal(f.saves(),2);assert.deepEqual(f.settings.npcLibraries,[]);
});
for(const mutation of ['edit','replace','delete'])test('NPC save detects concurrent '+mutation+' and does not overwrite it',async()=>{
 const started=gate(),wait=gate();let hold=false;const f=fixture(()=>{if(hold){started.resolve();return wait.promise;}});
 await f.port.save(create(f));const draft=change(f,{description:'proposal'});hold=true;
 const pending=f.port.save(draft);await started.promise;
 if(mutation==='edit')f.settings.npcLibraries[0].exportData.npcs[0].description='concurrent';
 if(mutation==='replace')f.settings.npcLibraries=[];
 if(mutation==='delete')f.settings.npcLibraries.splice(0,1);
 wait.resolve();assert.equal((await pending).status,'outcome_unknown');
 if(mutation==='edit')assert.equal(f.settings.npcLibraries[0].exportData.npcs[0].description,'concurrent');
 else assert.deepEqual(f.settings.npcLibraries,[]);
});
test('NPC failed persistence reports unknown, preserves edits and never retries',async()=>{
 const f=fixture(async()=>{throw Error('offline');});const d=create(f);
 const result=await f.port.save(d);assert.equal(result.status,'outcome_unknown');assert.equal(result.persistence,'unknown');
 assert.equal(f.settings.npcLibraries.length,1);await assert.rejects(f.port.save(d),/NAME_CONFLICT/);assert.equal(f.saves(),1);
});
test('NPC exact approval and v16 receipt omit private package content',async()=>{
 const f=fixture(),content=create(f),artifact={id:'a',revision:1,sessionId:'s',kind:'npc-library-draft',content};
 const actions=createNpcLibraryActions({getArtifact:()=>artifact,validate:()=>f.port.assertDraft(content),getTarget:()=>({kind:'global'}),writer:f.port});
 const pending=actions.prepare('a',1);assert.equal(f.saves(),0);const action=await actions.approve(pending.id);assert.throws(()=>actions.approve(pending.id),/STALE/);
 const receipt=actionReceipt(action);assert.equal(receipt.version,16);assert.doesNotMatch(receiptContext([receipt]),/PRIVATE_BODY|PRIVATE_TEMPLATE|Alice/);
 assert.throws(()=>validateReceipt({...receipt,body:'PRIVATE_BODY'}));
 const doc={createElement:tag=>({tag,children:[],append(e){this.children.push(e);}})},card=doc.createElement('div');
 renderNpcLibrarySave({doc,card,artifact,state:{canSaveNpcLibrary:true,npcLibraryActions:[pending]},controller:{},act:fn=>fn(),lang:'en'});
 assert.equal(card.children.find(e=>e.tag==='details').open,true);assert.ok(card.children.some(e=>e.tag==='button'&&e.textContent==='Confirm this operation'));
});
test('NPC cancelled approval and changed global target cannot execute',async()=>{
 const f=fixture(),content=create(f),artifact={id:'a',revision:1,sessionId:'s',kind:'npc-library-draft',content};let target={kind:'global',userKey:'a'};
 const actions=createNpcLibraryActions({getArtifact:()=>artifact,validate:()=>f.port.assertDraft(content),getTarget:()=>target,writer:f.port});
 const a=actions.prepare('a',1);actions.cancel(a.id);assert.throws(()=>actions.approve(a.id));assert.equal(f.saves(),0);
 const second=createNpcLibraryActions({getArtifact:()=>artifact,validate:()=>f.port.assertDraft(content),getTarget:()=>target,writer:f.port});
 const b=second.prepare('a',1);target={kind:'global',userKey:'b'};assert.throws(()=>second.approve(b.id));assert.equal(f.saves(),0);
});
test('NPC source paging consumes shared budget and obsolete candidate cannot publish',async()=>{
 const f=fixture();await f.port.save(create(f));const row=f.port.list().items[0],module=createNpcLibraryModule({port:f.port,charge:()=>false});
 assert.throws(()=>module.handlers['muyu.npc_libraries.export']({id:row.id,revision:row.revision},{runId:'r'}),/BUDGET/);
 const target={kind:'global'};module.bindRun({id:'r',taskId:'t',target});
 const candidate=module.handlers['muyu.npc_libraries.preview']({operation:'create',changesJson:JSON.stringify({name:'another',exportData:data()})},{runId:'r',target});
 assert.throws(()=>module.handlers['muyu.npc_libraries.preview']({operation:'create',changesJson:'{}'},{runId:'r',target}));
 assert.throws(()=>module.publishDraft({snapshot:()=>({runs:[]})},'r',candidate.candidateId),/CANDIDATE/);
 module.dispose();assert.throws(()=>module.handlers['muyu.npc_libraries.preview']({operation:'create',changesJson:'{}'},{runId:'r',target}),/BOUND/);
 assert.equal(configurationCoverage().find(r=>r.key==='npcLibraries').status,'special-editor-supported');
});
