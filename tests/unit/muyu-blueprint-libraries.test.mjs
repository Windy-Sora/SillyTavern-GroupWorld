import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoryBlueprintLibrarySystem } from '../../systems/story-blueprint-library-system.js';
import { createBlueprintLibraryPort } from '../../muyu/host/blueprint-libraries.js';
import { createBlueprintLibraryModule } from '../../muyu/modules/blueprint-libraries/index.js';
import { createBlueprintLibraryActions } from '../../muyu/actions/blueprint-library-save.js';
import { actionReceipt, receiptContext, validateReceipt } from '../../muyu/actions/receipts.js';
import { renderBlueprintLibrarySave } from '../../muyu/ui/blueprint-library-save-view.js';
import { configurationCoverage } from '../../muyu/config/coverage.js';
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function fixture(save=()=>{}) {
 const settings={npcEnabled:false,npcPrompt:'ACTIVE_PROMPT'},ext={};let saves=0,current=settings;
 const forbidden=()=>{throw Error('must not access chat, apply or generate');};
 const system=createStoryBlueprintLibrarySystem({settings,extension_settings:ext,EXT_KEY:'gd',saveSettings:()=>{saves++;return save();},
 getCurrentGroup:forbidden,saveChatConditional:forbidden,storyBlueprintSystem:new Proxy({}, {get:()=>forbidden}),log(){}});
 const port=createBlueprintLibraryPort({getSettings:()=>current,system});
 return {settings,port,system,ext,saves:()=>saves,replaceSettings:()=>current={}};
}
const data=()=>({type:'group-director-story-blueprint',version:1,storyBlueprint:{blueprint:{version:1,title:'PRIVATE_TITLE',meta:{premise:'PRIVATE_TEMPLATE'},nodes:[{id:'n1',type:'chapter',title:'Chapter',content:{director_prompt:'PRIVATE_BODY'},children:[]}]},doneSignals:[{nodeId:'n1',stepIndex:0,chatLength:3,time:1,source:'manual'}],progressTracks:{leaf:{doneSignals:[{nodeId:'n1',stepIndex:0}]}},activeProgressKey:'leaf'}});
const create=f=>f.port.preview({operation:'create',changes:{name:'pack',exportData:data()}});
const change=(f,changes={},operation='update')=>{const row=f.port.list().items[0];return f.port.preview({operation,id:row.id,revision:row.revision,changes});};
test('Blueprint raw import wraps explicitly and preserves all supplied progress tracks',async()=>{
 const f=fixture(),raw=data().storyBlueprint.blueprint;
 const draft=f.port.preview({operation:'create',changes:{name:'raw',exportData:raw}});
 assert.deepEqual(draft.next.exportData.storyBlueprint.blueprint,raw);
 await f.port.save(draft);const d=data();d.storyBlueprint.progressTracks['level:2']={doneSignals:[]};
 d.storyBlueprint.legacyDoneSignals=[{nodeId:'retired',chatLength:100}];
 await f.port.save(change(f,{exportData:d}));
 assert.deepEqual(f.settings.storyBlueprintLibraries[0].exportData.storyBlueprint,d.storyBlueprint);
 assert.equal(f.settings.storyBlueprintLibraries[0].includeProgress,true);
});
test('Blueprint tampered drafts and overlarge trees reject before mutation',async()=>{
 const f=fixture(),draft=create(f);draft.next.name='tampered';
 await assert.rejects(f.port.save(draft),/INVALID/);assert.equal(f.saves(),0);
 const tooMany=data();tooMany.storyBlueprint.blueprint.nodes=Array.from({length:257},(_,i)=>({id:'n'+i,type:'chapter',title:'x',content:{}}));
 assert.throws(()=>f.port.preview({operation:'create',changes:{name:'x',exportData:tooMany}}));
 const deep=data();let node=deep.storyBlueprint.blueprint.nodes[0];
 for(let i=0;i<9;i++){node.children=[{id:'deep'+i,type:'chapter',title:'x',content:{}}];node=node.children[0];}
 assert.throws(()=>f.port.preview({operation:'create',changes:{name:'x',exportData:deep}}));
 assert.equal(f.settings.storyBlueprintLibraries,undefined);
});
test('Blueprint library reads and preview stay pure; CRUD changes only global library assets',async()=>{
 const f=fixture();assert.deepEqual(f.port.list().items,[]);const draft=create(f);assert.equal(f.settings.storyBlueprintLibraries,undefined);assert.equal(f.saves(),0);
 assert.equal((await f.port.save(draft)).status,'saved_unconfirmed');const id=f.settings.storyBlueprintLibraries[0].id,at=f.settings.storyBlueprintLibraries[0].createdAt;
 await f.port.save(change(f,{name:'renamed',description:'info'}));assert.equal(f.settings.storyBlueprintLibraries[0].id,id);assert.equal(f.settings.storyBlueprintLibraries[0].createdAt,at);
 assert.equal(f.settings.storyBlueprintLibraries[0].nodeCount,1);const row=f.port.list().items[0];
 const exported=f.port.exportEntry(row.id,row.revision);assert.equal(exported.libraryMeta.name,'renamed');assert.equal(exported.storyBlueprint.blueprint.nodes[0].content.director_prompt,'PRIVATE_BODY');
 assert.equal(JSON.parse(f.port.read(row.id,row.revision).text).name,'renamed');
 await f.port.save(change(f,{},'delete'));assert.deepEqual(f.settings.storyBlueprintLibraries,[]);
 assert.equal(f.saves(),3);assert.equal(f.settings.npcEnabled,false);assert.equal(f.settings.npcPrompt,'ACTIVE_PROMPT');
});
test('Blueprint library validates version, closed shape, unique names, types and prototype keys',()=>{
 const f=fixture(),bad=[
 {...data(),version:2},{...data(),source:{chatMetadata:{}}},{...data(),libraryMeta:{createdAt:-1}},
 {...data(),libraryMeta:{includeProgress:false}},
 ];
 for(const edit of [
 d=>d.storyBlueprint.blueprint.nodes=[],
 d=>d.storyBlueprint.blueprint.nodes.push({...d.storyBlueprint.blueprint.nodes[0]}),
 d=>d.storyBlueprint.blueprint.nodes[0].content='invalid',
 d=>d.storyBlueprint.doneSignals[0].nodeId='missing',
 d=>d.storyBlueprint.progressTracks['level:-1']={doneSignals:[]},
 d=>d.storyBlueprint.blueprint.nodes[0].unknown=true,
 ]) {const d=data();edit(d);bad.push(d);}
 for(const exportData of bad)assert.throws(()=>f.port.preview({operation:'create',changes:{name:'pack',exportData}}),/INVALID/);
 assert.throws(()=>f.port.preview({operation:'create',changes:JSON.parse('{"name":"x","__proto__":{}}')}),/INVALID/);
 assert.throws(()=>f.port.preview({operation:'create',changes:{name:'',exportData:data()}}),/INVALID/);
});
test('Blueprint library full-diff size limit never truncates; large existing assets remain readable',async()=>{
 const f=fixture();await f.port.save(create(f));const large=data();large.storyBlueprint.blueprint.nodes[0].content.director_prompt='字'.repeat(9000);
 assert.throws(()=>f.port.preview({operation:'create',changes:{name:'large',exportData:large}}),/DRAFT_TOO_LARGE/);
 f.settings.storyBlueprintLibraries[0].exportData=large;const row=f.port.list().items[0];
 assert.ok(f.port.read(row.id,row.revision).nextOffset>0);assert.throws(()=>f.port.exportEntry(row.id,row.revision),/EXPORT_TOO_LARGE/);
 assert.throws(()=>change(f,{},'delete'),/DRAFT_TOO_LARGE/);
});
test('Blueprint library duplicate IDs, unknown entry fields and duplicate package names fail closed',async()=>{
 const f=fixture();await f.port.save(create(f));assert.throws(()=>create(f),/NAME_CONFLICT/);
 f.settings.storyBlueprintLibraries[0].extra='preserve';assert.throws(()=>change(f,{description:'x'}),/UNSUPPORTED/);
 f.settings.storyBlueprintLibraries.push({...f.settings.storyBlueprintLibraries[0]});assert.throws(()=>f.port.list(),/STORE_UNAVAILABLE/);
});
test('Blueprint library stale revision and replaced settings reject without saving',async()=>{
 const f=fixture();await f.port.save(create(f));const d=change(f,{description:'edit'});f.settings.storyBlueprintLibraries[0].description='concurrent';
 await assert.rejects(f.port.save(d),/STALE/);assert.equal(f.saves(),1);
 const fresh=change(f,{description:'edit'});f.replaceSettings();await assert.rejects(f.port.save(fresh));assert.equal(f.saves(),1);
});
test('Blueprint legacy deletion shares queue; approved update rechecks after target removal',async()=>{
 const started=gate(),wait=gate();let hold=false;const f=fixture(()=>{if(hold){started.resolve();return wait.promise;}});
 await f.port.save(create(f));const row=f.port.list().items[0],draft=change(f,{description:'update'});hold=true;
 const deletion=f.system.deleteLibrary(row.id);await started.promise;const updating=f.port.save(draft);wait.resolve();await deletion;
 await assert.rejects(updating,/STALE/);assert.equal(f.saves(),2);assert.deepEqual(f.settings.storyBlueprintLibraries,[]);
});
for(const mutation of ['edit','replace','delete'])test('Blueprint save detects concurrent '+mutation+' and does not overwrite it',async()=>{
 const started=gate(),wait=gate();let hold=false;const f=fixture(()=>{if(hold){started.resolve();return wait.promise;}});
 await f.port.save(create(f));const draft=change(f,{description:'proposal'});hold=true;
 const pending=f.port.save(draft);await started.promise;
 if(mutation==='edit')f.settings.storyBlueprintLibraries[0].exportData.storyBlueprint.blueprint.nodes[0].content.director_prompt='concurrent';
 if(mutation==='replace')f.settings.storyBlueprintLibraries=[];
 if(mutation==='delete')f.settings.storyBlueprintLibraries.splice(0,1);
 wait.resolve();assert.equal((await pending).status,'outcome_unknown');
 if(mutation==='edit')assert.equal(f.settings.storyBlueprintLibraries[0].exportData.storyBlueprint.blueprint.nodes[0].content.director_prompt,'concurrent');
 else assert.deepEqual(f.settings.storyBlueprintLibraries,[]);
});
test('Blueprint failed persistence reports unknown, preserves edits and never retries',async()=>{
 const f=fixture(async()=>{throw Error('offline');});const d=create(f);
 const result=await f.port.save(d);assert.equal(result.status,'outcome_unknown');assert.equal(result.persistence,'unknown');
 assert.equal(f.settings.storyBlueprintLibraries.length,1);await assert.rejects(f.port.save(d),/NAME_CONFLICT/);assert.equal(f.saves(),1);
});
test('Blueprint exact approval and v18 receipt omit private package content',async()=>{
 const f=fixture(),content=create(f),artifact={id:'a',revision:1,sessionId:'s',kind:'blueprint-library-draft',content};
 const actions=createBlueprintLibraryActions({getArtifact:()=>artifact,validate:()=>f.port.assertDraft(content),getTarget:()=>({kind:'global'}),writer:f.port});
 const pending=actions.prepare('a',1);assert.equal(f.saves(),0);const action=await actions.approve(pending.id);assert.throws(()=>actions.approve(pending.id),/STALE/);
 const receipt=actionReceipt(action);assert.equal(receipt.version,18);assert.doesNotMatch(receiptContext([receipt]),/PRIVATE_BODY|PRIVATE_TEMPLATE|Alice/);
 assert.throws(()=>validateReceipt({...receipt,body:'PRIVATE_BODY'}));
 const doc={createElement:tag=>({tag,children:[],append(e){this.children.push(e);}})},card=doc.createElement('div');
 renderBlueprintLibrarySave({doc,card,artifact,state:{canSaveBlueprintLibrary:true,blueprintLibraryActions:[pending]},controller:{},act:fn=>fn(),lang:'en'});
 assert.equal(card.children.find(e=>e.tag==='details').open,true);assert.ok(card.children.some(e=>e.tag==='button'&&e.textContent==='Confirm this operation'));
});
test('Blueprint cancelled approval and changed global target cannot execute',async()=>{
 const f=fixture(),content=create(f),artifact={id:'a',revision:1,sessionId:'s',kind:'blueprint-library-draft',content};let target={kind:'global',userKey:'a'};
 const actions=createBlueprintLibraryActions({getArtifact:()=>artifact,validate:()=>f.port.assertDraft(content),getTarget:()=>target,writer:f.port});
 const a=actions.prepare('a',1);actions.cancel(a.id);assert.throws(()=>actions.approve(a.id));assert.equal(f.saves(),0);
 const second=createBlueprintLibraryActions({getArtifact:()=>artifact,validate:()=>f.port.assertDraft(content),getTarget:()=>target,writer:f.port});
 const b=second.prepare('a',1);target={kind:'global',userKey:'b'};assert.throws(()=>second.approve(b.id));assert.equal(f.saves(),0);
});
test('Blueprint source paging consumes shared budget and obsolete candidate cannot publish',async()=>{
 const f=fixture();await f.port.save(create(f));const row=f.port.list().items[0],module=createBlueprintLibraryModule({port:f.port,charge:()=>false});
 assert.throws(()=>module.handlers['muyu.blueprint_libraries.export']({id:row.id,revision:row.revision},{runId:'r'}),/BUDGET/);
 const target={kind:'global'};module.bindRun({id:'r',taskId:'t',target});
 const candidate=module.handlers['muyu.blueprint_libraries.preview']({operation:'create',changesJson:JSON.stringify({name:'another',exportData:data()})},{runId:'r',target});
 assert.throws(()=>module.handlers['muyu.blueprint_libraries.preview']({operation:'create',changesJson:'{}'},{runId:'r',target}));
 assert.throws(()=>module.publishDraft({snapshot:()=>({runs:[]})},'r',candidate.candidateId),/CANDIDATE/);
 module.dispose();assert.throws(()=>module.handlers['muyu.blueprint_libraries.preview']({operation:'create',changesJson:'{}'},{runId:'r',target}),/BOUND/);
 assert.equal(configurationCoverage().find(r=>r.key==='storyBlueprintLibraries').status,'special-editor-supported');
});
