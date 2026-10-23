import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlueprintNodeEditorPort} from '../../muyu/host/blueprint-node-editor.js';
import {projectStoryBlueprintProgress} from '../../systems/story-blueprint-system.js';
import {actionReceipt,receiptSources} from '../../muyu/actions/receipts.js';
const node=(id,children=[])=>({id,type:'chapter',title:id,content:{text:'PRIVATE_'+id},children,custom:'KEEP'});
function fixture(save=async()=>{}) {
 const target={kind:'chat',userKey:'u',chatKey:'A'},settings={storyBlueprintProgressionMode:'leaf',storyBlueprintProgressionLevel:0,storyBlueprintCompletionVariable:'done'};
 const signal=(id,i)=>({nodeId:id,stepIndex:i,chatLength:1,time:1,source:'manual',custom:'signal'});
 const metadata={gd:{storyBlueprint:{blueprint:{version:1,title:'PRIVATE_TREE',meta:{keep:true},nodes:[node('parent',[node('a'),node('b')]),node('c')]},activeProgressKey:'leaf',
  doneSignals:[signal('a',0),signal('b',1)],progressTracks:{leaf:{doneSignals:[signal('a',0),signal('b',1)],completeNoticeKey:'old'},all:{doneSignals:[signal('parent',0),signal('a',1)],completeNoticeKey:'old'},'level:0':{doneSignals:[signal('parent',0)],completeNoticeKey:'old'}},legacyDoneSignals:[signal('a',0),signal('b',1)],completeNoticeKey:'old',lastGeneratedAt:1,custom:'state'},
  variables:{defs:[{id:'done',type:'boolean',scope:'global',defaultValue:false,owner:'group-director-story-blueprint'}],values:{global:{done:true,other:5},character:{}}},other:'keep'}};
 let current=target,meta=metadata,config=settings,length=5,busy=false,saves=0;
 const port=createBlueprintNodeEditorPort({getTarget:()=>current,getMetadata:()=>meta,getSettings:()=>config,getChatLength:()=>length,extensionKey:'gd',isBusy:()=>busy,
  saveChatConfirmed:async()=>{saves++;await save();},saveStructureConfirmed:async()=>{saves++;await save();}});
 const draft=(operation='create',changes={parentId:'',index:2,node:{id:'new',type:'chapter',title:'New',content:{text:'new'}}})=>port.structurePreview(target,{operation,changes,revision:port.structureRead(target,0).revision});
 return {target,settings,metadata,port,draft,get saves(){return saves;},setTarget:v=>current=v,setMeta:v=>meta=v,setConfig:v=>config=v,setLength:v=>length=v,setBusy:v=>busy=v};
}
test('Create preview pure; root insertion preserves metadata and resets only compatible completion',async()=>{
 const f=fixture(),before=structuredClone(f.metadata),d=f.draft();assert.deepEqual(f.metadata,before);assert.equal(f.saves,0);
 const r=await f.port.apply(d);assert.equal(r.status,'applied_confirmed');assert.equal(f.saves,1);assert.equal(f.metadata.gd.storyBlueprint.blueprint.nodes[2].id,'new');
 assert.deepEqual(f.metadata.gd.storyBlueprint.blueprint.meta,before.gd.storyBlueprint.blueprint.meta);assert.equal(f.metadata.gd.storyBlueprint.custom,'state');assert.equal(f.metadata.gd.storyBlueprint.lastGeneratedAt,1);
 assert.equal(f.metadata.gd.variables.values.global.done,false);assert.equal(f.metadata.gd.variables.values.global.other,5);assert.deepEqual(f.metadata.gd.variables.defs,before.gd.variables.defs);await assert.rejects(f.port.apply(d),/STALE/);
});
test('Insert before completed prefix explicitly prunes later completion signals in every scope',async()=>{
 const f=fixture(),d=f.draft('create',{parentId:'parent',index:0,node:{id:'new',type:'scene',title:'New',content:{}}});
 assert.deepEqual(d.after.doneSignals,[]);assert.deepEqual(d.after.progressTracks.leaf.doneSignals,[]);assert.deepEqual(d.after.progressTracks.all.doneSignals.map(s=>s.nodeId),['parent']);
 assert.deepEqual(d.after.progressTracks['level:0'].doneSignals.map(s=>s.nodeId),['parent']);assert.equal(d.after.progressTracks.all.completeNoticeKey,'');await f.port.apply(d);
});
test('Delete subtree removes dangling signals including legacy archive; remaining prefix follows runtime',async()=>{
 const f=fixture(),d=f.draft('delete',{nodeId:'parent'});assert.deepEqual(d.affected,['parent','a','b']);assert.deepEqual(d.after.blueprint.nodes.map(n=>n.id),['c']);
 for(const t of Object.values(d.after.progressTracks))assert.deepEqual(t.doneSignals,[]);assert.deepEqual(d.after.legacyDoneSignals,[]);await f.port.apply(d);assert.equal(f.saves,1);
});
test('Delete completed leaf recomputes indices but preserves signal custom metadata',async()=>{
 const f=fixture(),d=f.draft('delete',{nodeId:'a'});assert.deepEqual(d.after.doneSignals.map(s=>s.nodeId),['b']);assert.equal(d.after.doneSignals[0].stepIndex,0);assert.equal(d.after.doneSignals[0].custom,'signal');
 const projected=projectStoryBlueprintProgress({blueprint:d.after.blueprint,progressTracks:d.after.progressTracks,chatLength:5,mode:'leaf'});assert.deepEqual(projected.activeSignalIds,['b']);
});
test('Move is after-removal insertion, keeps subtree IDs/custom fields and reconciles all scopes',async()=>{
 const f=fixture(),d=f.draft('move',{nodeId:'parent',parentId:'',index:1});assert.deepEqual(d.after.blueprint.nodes.map(n=>n.id),['c','parent']);assert.equal(d.after.blueprint.nodes[1].children[0].id,'a');assert.equal(d.after.blueprint.nodes[1].custom,'KEEP');assert.deepEqual(d.after.doneSignals,[]);await f.port.apply(d);
});
test('Reparent existing subtree without rewriting IDs',async()=>{const f=fixture(),d=f.draft('move',{nodeId:'c',parentId:'parent',index:2});assert.deepEqual(d.after.blueprint.nodes.map(n=>n.id),['parent']);assert.deepEqual(d.after.blueprint.nodes[0].children.map(n=>n.id),['a','b','c']);await f.port.apply(d);});
test('Last-node deletion leaves valid empty tree without generation or implicit replacement',async()=>{
 const f=fixture();f.metadata.gd.storyBlueprint.blueprint.nodes=[node('only')];const d=f.draft('delete',{nodeId:'only'});assert.deepEqual(d.after.blueprint.nodes,[]);await f.port.apply(d);
});
for(const [operation,changes]of [
 ['create',{parentId:'',index:0,node:{id:'a',type:'scene',title:'Dup',content:{}}}],['create',{parentId:'missing',index:0,node:{id:'new',type:'scene',title:'New',content:{}}}],
 ['create',{parentId:'',index:8,node:{id:'new',type:'scene',title:'New',content:{}}}],['create',{parentId:'',index:0,node:{id:' new ',type:'scene',title:'New',content:{}}}],
 ['create',{parentId:'',index:0,node:{id:'new',type:'scene',title:'New',content:{},children:[]}}],
 ['delete',{nodeId:'missing'}],['delete',{nodeId:'a',extra:true}],['move',{nodeId:'parent',parentId:'a',index:0}],['move',{nodeId:'a',parentId:'a',index:0}],
 ['move',{nodeId:'a',parentId:'',index:-1}],['move',{nodeId:'c',parentId:'missing',index:0}],['delete',JSON.parse('{"__proto__":true}')],
 ])test('Invalid structural request rejects '+operation+' '+JSON.stringify(changes),()=>{const f=fixture();assert.throws(()=>f.draft(operation,changes));assert.equal(f.saves,0);});
test('No-op move does not prune progress silently',()=>{const f=fixture();assert.throws(()=>f.draft('move',{nodeId:'a',parentId:'parent',index:0}),/EMPTY/);assert.equal(f.saves,0);});
for(const [label,mutate]of [
 ['any node text',f=>f.metadata.gd.storyBlueprint.blueprint.nodes[1].title='changed'],['tree replace',f=>f.metadata.gd.storyBlueprint.blueprint=structuredClone(f.metadata.gd.storyBlueprint.blueprint)],
 ['node replace',f=>f.metadata.gd.storyBlueprint.blueprint.nodes[1]=structuredClone(f.metadata.gd.storyBlueprint.blueprint.nodes[1])],
 ['state replace',f=>f.metadata.gd.storyBlueprint=structuredClone(f.metadata.gd.storyBlueprint)],['root replace',f=>f.metadata.gd={...f.metadata.gd}],
 ['progress',f=>f.metadata.gd.storyBlueprint.progressTracks.all.doneSignals=[]],['completion',f=>f.metadata.gd.variables.values.global.done=false],
 ['definition',f=>f.metadata.gd.variables.defs[0].locked=true],['mode',f=>f.settings.storyBlueprintProgressionMode='all'],['settings replace',f=>f.setConfig({...f.settings})],
 ['metadata',f=>f.setMeta(structuredClone(f.metadata))],['length',f=>f.setLength(6)],['chat',f=>f.setTarget({...f.target,chatKey:'B'})],['busy',f=>f.setBusy(true)],
 ])test('Exact structural baseline invalidated by '+label,async()=>{const f=fixture(),d=f.draft();mutate(f);await assert.rejects(f.port.apply(d));assert.equal(f.saves,0);});
test('Missing completion store stays missing; legacy progress migrated in full preview',async()=>{
 const f=fixture();delete f.metadata.gd.variables;delete f.metadata.gd.storyBlueprint.progressTracks;delete f.metadata.gd.storyBlueprint.activeProgressKey;
 const d=f.draft();assert.equal(d.completion.before.exists,false);assert.deepEqual(d.after.progressTracks.leaf.doneSignals.map(s=>s.nodeId),['a','b']);await f.port.apply(d);assert.equal(Object.hasOwn(f.metadata.gd,'variables'),false);
});
test('Completion conflict refuses preview rather than modifying foreign variables',()=>{
 const f=fixture();f.metadata.gd.variables.defs[0].owner='foreign';assert.throws(()=>f.draft(),/CONFLICT/);assert.equal(f.saves,0);
});
test('Other variable edits do not invalidate or get overwritten',async()=>{
 const f=fixture(),d=f.draft();f.metadata.gd.variables.values.global.other=99;await f.port.apply(d);assert.equal(f.metadata.gd.variables.values.global.other,99);
});
test('Save rejection keeps concurrent data, consumes ticket and never retries',async()=>{
 const f=fixture(async()=>{f.metadata.gd.storyBlueprint.blueprint.nodes[0].title='CONCURRENT';f.metadata.gd.variables.values.global.other=99;throw Error('save');}),d=f.draft();
 const r=await f.port.apply(d);assert.equal(r.status,'outcome_unknown');assert.equal(r.chatSave,'unknown');assert.equal(f.metadata.gd.storyBlueprint.blueprint.nodes[0].title,'CONCURRENT');assert.equal(f.metadata.gd.variables.values.global.other,99);assert.equal(f.saves,1);await assert.rejects(f.port.apply(d),/STALE/);
});
test('Concurrent completion after confirmed save is partial, never overwritten',async()=>{
 const f=fixture(async()=>{f.metadata.gd.variables.values.global.done=true;});const r=await f.port.apply(f.draft());assert.equal(r.status,'partial');assert.equal(f.metadata.gd.variables.values.global.done,true);
});
test('Read paginates full state without initialization and stale revisions reject',()=>{
 const f=fixture(),before=structuredClone(f.metadata),r=f.port.structureRead(f.target,0);assert.deepEqual(f.metadata,before);assert.equal(r.untrusted,true);f.settings.storyBlueprintProgressionMode='all';assert.throws(()=>f.port.structurePreview(f.target,{operation:'delete',revision:r.revision,changes:{nodeId:'a'}}),/STALE/);
});
test('Oversize diff rejects rather than truncate approval',()=>{const f=fixture();f.metadata.gd.storyBlueprint.blueprint.nodes[1].content.text='猫'.repeat(5000);assert.throws(()=>f.draft(),/TOO_LARGE|byte limit/);assert.equal(f.saves,0);});
test('Node count and depth limits reject without assigning or normalizing IDs',()=>{
 const f=fixture();f.metadata.gd.storyBlueprint.blueprint.nodes=Array.from({length:256},(_,i)=>node('n'+i));assert.throws(()=>f.draft());
 const g=fixture();let child=node('d8');for(let i=7;i>=1;i--)child=node('d'+i,[child]);g.metadata.gd.storyBlueprint.blueprint.nodes=[child];assert.throws(()=>g.draft('create',{parentId:'d8',index:0,node:{id:'new',type:'scene',title:'New',content:{}}}));assert.equal(g.saves,0);
});
test('Structural receipt never contains tree, signals, identities or replayable payload',()=>{
 const f=fixture(),content=f.draft(),r=actionReceipt({id:'op',artifactId:'a',revision:1,status:'applied_confirmed',content,result:{chatSave:'confirmed'}});
 assert.equal(r.version,27);assert.deepEqual(receiptSources(r),[]);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|parent|nodeId|definition|before|after/);
});
