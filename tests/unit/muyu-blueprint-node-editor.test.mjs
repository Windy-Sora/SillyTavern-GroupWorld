import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlueprintNodeEditorPort} from '../../muyu/host/blueprint-node-editor.js';
import {createBlueprintNodeEditorModule} from '../../muyu/modules/blueprint-node-editor/index.js';
import {actionReceipt,receiptSources,receiptText} from '../../muyu/actions/receipts.js';
function fixture(save=async()=>{}){
 const target={kind:'chat',chatKey:'A'},node={id:'chapter',type:'chapter',title:'PRIVATE_TITLE',content:{text:'PRIVATE_OLD',count:2,done:false,tags:['a'],data:{old:1},nullable:null,completion_rule:'finish'},custom:'KEEP',children:[{id:'scene',type:'scene',title:'Scene',content:{text:'child'},children:[]}]};
 const metadata={gd:{storyBlueprint:{blueprint:{version:1,title:'Story',meta:{premise:'keep'},nodes:[node,{id:'other',type:'chapter',title:'Other',content:{text:'other'},children:[]}]},doneSignals:[{nodeId:'scene',time:1}],progressTracks:{leaf:{doneSignals:[{nodeId:'scene',time:1}]}},activeProgressKey:'leaf',completeNoticeKey:'keep',lastGeneratedAt:10,continuePending:false},variables:{values:{global:{gd_story_chapter_done:true}}}}};
 let current=target,meta=metadata,busy=false,saves=0;
 const port=createBlueprintNodeEditorPort({getTarget:()=>current,getMetadata:()=>meta,extensionKey:'gd',isBusy:()=>busy,saveChatConfirmed:async(m)=>{saves++;await save(m);}});
 const draft=(changes={content:{text:'PRIVATE_NEW'}},offset=0)=>{const r=port.list(target).items[offset];return port.preview(target,{...r,changes});};
 return{target,metadata,node,port,draft,get saves(){return saves;},setTarget:t=>current=t,setMeta:m=>meta=m,setBusy:v=>busy=v};
}
test('Blueprint node preview is pure; apply preserves descendants, IDs, custom fields, progress and completion variable',async()=>{
 const f=fixture(),before=structuredClone(f.metadata),children=f.node.children,d=f.draft({title:' New title ',content:{text:'PRIVATE_NEW'}});
 assert.deepEqual(f.metadata,before);assert.equal(f.saves,0);assert.equal(Object.hasOwn(d.before,'children'),false);assert.equal(d.after.title,'New title');
 assert.equal((await f.port.apply(d)).status,'applied_confirmed');assert.equal(f.saves,1);assert.equal(f.node.children,children);assert.equal(f.node.id,'chapter');assert.equal(f.node.type,'chapter');assert.equal(f.node.custom,'KEEP');assert.equal(f.node.content.count,2);
 const {blueprint,...state}=f.metadata.gd.storyBlueprint,{blueprint:old,...oldState}=before.gd.storyBlueprint;
 assert.deepEqual(state,oldState);assert.deepEqual(f.metadata.gd.variables,before.gd.variables);assert.deepEqual(blueprint.nodes[1],old.nodes[1]);assert.deepEqual(blueprint.meta,old.meta);await assert.rejects(f.port.apply(d),/STALE/);
});
for(const [key,value]of [['text','text'],['count',15],['done',true],['tags',['b','c']],['data',{new:2}],['nullable',null]])test('Node field supports JSON kind '+key,async()=>{const f=fixture(),changes={content:{[key]:value},...(key==='nullable'?{title:'Changed'}:{})};await f.port.apply(f.draft(changes));assert.deepEqual(f.node.content[key],value);});
test('Object and array fields explicitly replace, not silently merge or append',()=>{const f=fixture(),d=f.draft({content:{data:{new:2},tags:['b']}});assert.deepEqual(d.after.content.data,{new:2});assert.deepEqual(d.after.content.tags,['b']);assert.deepEqual(f.node.content.data,{old:1});});
test('All levels can be selected without changing current progress',async()=>{const f=fixture(),rows=f.port.list(f.target).items;assert.deepEqual(rows.map(r=>r.path),[[0],[0,0],[1]]);await f.port.apply(f.draft({title:'Nested edited'},1));assert.equal(f.node.children[0].title,'Nested edited');assert.equal(f.metadata.gd.storyBlueprint.activeProgressKey,'leaf');});
for(const [label,mutate]of [
 ['selected text',f=>f.node.content.text='concurrent'],
 ['node ID',f=>f.node.id='renamed'],
 ['node type',f=>f.node.type='new'],
 ['tree reorder',f=>f.metadata.gd.storyBlueprint.blueprint.nodes.reverse()],
 ['child added',f=>f.node.children.push({id:'new',type:'scene',title:'New',content:{},children:[]})],
 ['selected ref',f=>f.metadata.gd.storyBlueprint.blueprint.nodes[0]=structuredClone(f.node)],
 ['blueprint replacement',f=>f.metadata.gd.storyBlueprint.blueprint=structuredClone(f.metadata.gd.storyBlueprint.blueprint)],
 ['state replacement',f=>f.metadata.gd.storyBlueprint=structuredClone(f.metadata.gd.storyBlueprint)],
 ['progress signal',f=>f.metadata.gd.storyBlueprint.doneSignals.push({nodeId:'chapter'})],
 ['progress track',f=>f.metadata.gd.storyBlueprint.progressTracks.all={doneSignals:[]}],
 ['metadata replacement',f=>f.setMeta(structuredClone(f.metadata))],
 ['chat switch',f=>f.setTarget({kind:'chat',chatKey:'B'})],
 ['busy',f=>f.setBusy(true)],
 ['continue pending',f=>f.metadata.gd.storyBlueprint.continuePending=true]
])test('Stale Blueprint approval blocks '+label,async()=>{const f=fixture(),d=f.draft();mutate(f);await assert.rejects(f.port.apply(d));assert.equal(f.saves,0);});
test('Other node content updates are preserved and do not invalidate exact selected text',async()=>{const f=fixture(),d=f.draft();f.metadata.gd.storyBlueprint.blueprint.nodes[1].content.text='concurrent';await f.port.apply(d);assert.equal(f.metadata.gd.storyBlueprint.blueprint.nodes[1].content.text,'concurrent');});
test('Save rejection retains concurrent data and reports unknown without retry',async()=>{const f=fixture(async()=>{f.metadata.gd.storyBlueprint.blueprint.nodes[1].content.text='concurrent';f.metadata.gd.storyBlueprint.doneSignals.push({nodeId:'chapter'});throw Error('rejected');});const d=f.draft(),r=await f.port.apply(d);assert.equal(r.status,'outcome_unknown');assert.equal(r.chatSave,'unknown');assert.equal(f.node.content.text,'PRIVATE_NEW');assert.equal(f.metadata.gd.storyBlueprint.blueprint.nodes[1].content.text,'concurrent');assert.equal(f.metadata.gd.storyBlueprint.doneSignals.length,2);assert.equal(f.saves,1);await assert.rejects(f.port.apply(d),/STALE/);});
for(const mutation of ['node','progress','chat'])test('Confirmed save reports partial after '+mutation,async()=>{const f=fixture(async()=>{if(mutation==='node')f.node.content.text='later';if(mutation==='progress')f.metadata.gd.storyBlueprint.doneSignals=[];if(mutation==='chat')f.setTarget({kind:'chat',chatKey:'B'});});assert.equal((await f.port.apply(f.draft())).status,'partial');});
for(const changes of [{title:''},{title:' '},{title:2},{id:'new'},{type:'new'},{children:[]},{meta:{}},{doneSignals:[]},{content:{missing:'x'}},{content:{count:'2'}},{content:{done:1}},{content:{tags:{}}},{content:{data:[]}},{content:{nullable:'x'}},{content:null},JSON.parse('{"__proto__":{}}')])test('Node edits reject structural, hidden or wrong-type changes '+JSON.stringify(changes),()=>{const f=fixture();assert.throws(()=>f.draft(changes));assert.equal(f.saves,0);});
test('Empty node changes reject; empty Blueprint does not initialize metadata',()=>{const f=fixture();assert.throws(()=>f.draft({}),/EMPTY/);const empty={};const port=createBlueprintNodeEditorPort({getTarget:()=>f.target,getMetadata:()=>empty,extensionKey:'gd'});assert.deepEqual(port.list(f.target).items,[]);assert.deepEqual(empty,{});});
test('Duplicate IDs and cyclic nodes reject instead of ambiguous selection',()=>{const f=fixture();f.node.children[0].id='chapter';assert.throws(()=>f.port.list(f.target),/UNSUPPORTED/);f.node.children[0].id='scene';f.node.children.push(f.node);assert.throws(()=>f.port.list(f.target),/UNSUPPORTED/);});
test('Read revisions, shared budget and draft tampering are enforced',async()=>{const f=fixture(),r=f.port.list(f.target).items[0],m=createBlueprintNodeEditorModule({port:f.port,charge:()=>false});assert.equal(f.port.read(f.target,r.selector,r.revision,0).untrusted,true);assert.throws(()=>f.port.read(f.target,'chapter',r.revision,0));assert.throws(()=>m.handlers['muyu.blueprint_node_editor.read']({...r,offset:0},{target:f.target,runId:'run'}),/BUDGET/);const d=f.draft();d.after.title='tamper';await assert.rejects(f.port.apply(d),/STALE/);f.node.content.text='changed';assert.throws(()=>f.port.read(f.target,r.selector,r.revision,0),/STALE/);});
test('Oversize complete multibyte diff rejects; no truncated approval',()=>{const f=fixture();f.node.content.text='猫'.repeat(4000);assert.throws(()=>f.draft({content:{text:'猫'.repeat(4001)}}),/TOO_LARGE/);});
test('Node receipt does not persist titles, content, node ID or progress',()=>{const f=fixture(),content=f.draft(),r=actionReceipt({id:'op',artifactId:'draft',revision:1,status:'applied_confirmed',content,result:{chatSave:'confirmed'}});assert.equal(r.version,24);assert.deepEqual(receiptSources(r),[]);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|chapter|scene|KEEP/);assert.match(receiptText(r,'zh'),/蓝图节点/);});
