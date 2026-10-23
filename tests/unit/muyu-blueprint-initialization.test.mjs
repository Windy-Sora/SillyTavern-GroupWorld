import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlueprintNodeEditorPort } from '../../muyu/host/blueprint-node-editor.js';
import { createBlueprintNodeEditorModule } from '../../muyu/modules/blueprint-node-editor/index.js';
import { createStoryBlueprintSystem } from '../../systems/story-blueprint-system.js';
import { actionReceipt, receiptSources, receiptText, validateReceipt } from '../../muyu/actions/receipts.js';
import { renderBlueprintNodeEditor } from '../../muyu/ui/blueprint-node-editor-view.js';
function fixture(initial={},save=async()=>{}) {
    const target={kind:'chat',chatKey:'A'},metadata=structuredClone(initial);
    let current=target,meta=metadata,settings={lang:'zh',storyBlueprintEnabled:false,storyBlueprintProgressionMode:'leaf',storyBlueprintProgressionLevel:0,storyBlueprintCompletionVariable:'done'},length=5,busy=false,saves=0;
    const port=createBlueprintNodeEditorPort({getTarget:()=>current,getMetadata:()=>meta,getSettings:()=>settings,getChatLength:()=>length,extensionKey:'gd',isBusy:()=>busy,saveStructureConfirmed:async()=>{saves++;await save();},saveChatConfirmed:async()=>{throw Error('wrong saver');}});
    const draft=(changes={})=>port.initializePreview(target,{revision:port.initializeRead(target).revision,changes});
    return{port,target,metadata,draft,get settings(){return settings;},get saves(){return saves;},setMeta:v=>meta=v,setSettings:v=>settings=v,setLength:v=>length=v,setTarget:v=>current=v,setBusy:v=>busy=v};
}
const variableStore=()=>({defs:[{id:'done',type:'boolean',scope:'global',defaultValue:false,owner:'group-director-story-blueprint'},{id:'other',type:'number',scope:'global'}],values:{global:{done:true,other:9},character:{}}});
for(const initial of [{},{gd:{}},{gd:{storyBlueprint:{blueprint:null}}}])test('First Blueprint read/preview pure, approved blank initialization '+JSON.stringify(initial),async()=>{
    const f=fixture(initial),before=structuredClone(f.metadata),r=f.port.initializeRead(f.target),d=f.draft();
    assert.equal(JSON.parse(r.text).canInitialize,true);assert.deepEqual(f.metadata,before);assert.equal(f.saves,0);assert.equal(d.operation,'initialize');assert.equal(d.after.blueprint.nodes[0].id,'node_001');assert.equal(d.after.blueprint.nodes[0].content.purpose,'');
    assert.equal((await f.port.apply(d)).status,'applied_confirmed');assert.equal(f.saves,1);assert.equal(f.settings.storyBlueprintEnabled,false);assert.equal(Object.hasOwn(f.metadata.gd,'variables'),false);await assert.rejects(f.port.apply(d),/STALE/);
});
test('Legacy empty state reset matches real UI blank creation without host side effects',async()=>{
    const state={blueprint:null,doneSignals:[{nodeId:'old',chatLength:1}],progressTracks:{leaf:{doneSignals:[{nodeId:'old'}],completeNoticeKey:'notice'},all:{doneSignals:[{nodeId:'old'}],completeNoticeKey:'other'}},activeProgressKey:'leaf',legacyDoneSignals:[{nodeId:'archived'}],completeNoticeKey:'old',lastGeneratedAt:4,lastError:'error',continuePending:false,custom:'KEEP'};
    const f=fixture({gd:{storyBlueprint:state,variables:variableStore(),unrelated:{keep:true}}}),before=structuredClone(f.metadata),d=f.draft();
    const isolated={gd:{storyBlueprint:structuredClone(state)}};let isolatedSaves=0;
    const real=createStoryBlueprintSystem({settings:f.settings,EXT_KEY:'gd',getChatMetadata:()=>isolated,getChat:()=>({length:5}),saveChatConditional:()=>{isolatedSaves++;},log(){}});real.createBlankBlueprint();
    const expected=structuredClone(isolated.gd.storyBlueprint);expected.lastGeneratedAt=d.after.lastGeneratedAt;
    assert.deepEqual(d.after,expected);assert.deepEqual(f.metadata,before);assert.equal(f.saves,0);assert.ok(isolatedSaves>0);assert.deepEqual(d.after.doneSignals,[]);assert.deepEqual(Object.keys(d.after.progressTracks),['leaf']);assert.equal(d.after.legacyDoneSignals,undefined);assert.equal(d.after.custom,'KEEP');assert.equal(d.completion.after.value,false);
    await f.port.apply(d);assert.deepEqual(f.metadata.gd.variables.defs,before.gd.variables.defs);assert.equal(f.metadata.gd.variables.values.global.done,false);assert.equal(f.metadata.gd.variables.values.global.other,9);assert.deepEqual(f.metadata.gd.unrelated,before.gd.unrelated);
});
for(const mode of ['leaf','all','level'])test('Creation uses current progress mode '+mode,async()=>{const f=fixture();f.settings.storyBlueprintProgressionMode=mode;f.settings.storyBlueprintProgressionLevel=2;const d=f.draft();assert.equal(d.after.activeProgressKey,mode==='level'?'level:2':mode);await f.port.apply(d);});
test('English blank labels reuse original language behavior',()=>{const f=fixture();f.settings.lang='en';const d=f.draft();assert.equal(d.after.blueprint.title,'User Story Blueprint');assert.equal(d.after.blueprint.nodes[0].title,'Chapter 1');});
for(const nodes of [[],[{id:'old',type:'chapter',title:'Old',content:{},children:[]}]])test('Existing tree never overwritten even empty / '+nodes.length,()=>{
    const f=fixture({gd:{storyBlueprint:{blueprint:{version:1,title:'Existing',meta:{},nodes}}}}),before=structuredClone(f.metadata);assert.equal(JSON.parse(f.port.initializeRead(f.target).text).canInitialize,false);assert.throws(()=>f.draft(),/ALREADY_EXISTS/);assert.deepEqual(f.metadata,before);assert.equal(f.saves,0);
});
for(const [name,mutate]of [
    ['chat switch',f=>f.setTarget({kind:'chat',chatKey:'B'})],['metadata replace',f=>f.setMeta(structuredClone(f.metadata))],['root replace',f=>f.metadata.gd={...f.metadata.gd}],['state replace',f=>f.metadata.gd.storyBlueprint={...f.metadata.gd.storyBlueprint}],
    ['new tree elsewhere',f=>f.metadata.gd.storyBlueprint.blueprint={version:1,title:'Other',nodes:[]}],['old progress changed',f=>f.metadata.gd.storyBlueprint.doneSignals.push({nodeId:'x'})],['completion changed',f=>f.metadata.gd.variables.values.global.done=false],['definition locked',f=>f.metadata.gd.variables.defs[0].locked=true],
    ['variable store replaced',f=>f.metadata.gd.variables=structuredClone(f.metadata.gd.variables)],['settings replace',f=>f.setSettings({...f.settings})],['progress mode',f=>f.settings.storyBlueprintProgressionMode='all'],['language',f=>f.settings.lang='en'],['messages',f=>f.setLength(6)],['busy',f=>f.setBusy(true)],
])test('Creation exact approval invalidates '+name,async()=>{
    const f=fixture({gd:{storyBlueprint:{blueprint:null,doneSignals:[]},variables:variableStore()}}),d=f.draft();mutate(f);await assert.rejects(f.port.apply(d));assert.equal(f.saves,0);
});
test('Unrelated variable edits do not invalidate or get replaced',async()=>{
    const f=fixture({gd:{variables:variableStore()}}),d=f.draft();f.metadata.gd.variables.values.global.other=99;await f.port.apply(d);assert.equal(f.metadata.gd.variables.values.global.other,99);
});
for(const mutate of [v=>v.defs[0].owner='foreign',v=>v.defs[0].type='number',v=>v.values.global.done='yes',v=>v.defs=[]])test('Incompatible completion cannot be reset or bypassed',()=>{const f=fixture({gd:{variables:variableStore()}});mutate(f.metadata.gd.variables);assert.throws(()=>f.draft(),/CONFLICT/);assert.equal(f.saves,0);assert.equal(f.metadata.gd.storyBlueprint,undefined);});
test('Missing completion value is created only for its existing compatible definition',async()=>{const f=fixture({gd:{variables:variableStore()}});delete f.metadata.gd.variables.values.global.done;const d=f.draft();assert.equal(d.completion.before.stored,false);await f.port.apply(d);assert.equal(f.metadata.gd.variables.values.global.done,false);});
for(const changes of [{title:'hidden'},{nodes:[]},[],null,JSON.parse('{"__proto__":{}}')])test('Initialize closed changes object rejects '+JSON.stringify(changes),()=>{const f=fixture();assert.throws(()=>f.draft(changes));assert.deepEqual(f.metadata,{});});
test('Whole diff overflow rejects without truncation or writing',()=>{const f=fixture({gd:{storyBlueprint:{blueprint:null,custom:'猫'.repeat(5000)}}});assert.throws(()=>f.draft(),/TOO_LARGE/);assert.equal(f.saves,0);});
test('Tampering and wrong revision cannot write',async()=>{const f=fixture(),r=f.port.initializeRead(f.target);assert.throws(()=>f.port.initializePreview(f.target,{revision:r.revision+'bad',changes:{}}),/STALE/);const d=f.draft();d.after.blueprint.title='Tampered';await assert.rejects(f.port.apply(d),/STALE/);assert.equal(f.saves,0);});
test('Rejecting save keeps concurrent data, is unknown and does not retry',async()=>{
    const f=fixture({},async()=>{f.metadata.gd.extra='concurrent';f.metadata.gd.storyBlueprint.blueprint.title='concurrent';throw Error('offline');}),d=f.draft();const result=await f.port.apply(d);
    assert.equal(result.status,'outcome_unknown');assert.equal(result.chatSave,'unknown');assert.equal(f.metadata.gd.extra,'concurrent');assert.equal(f.metadata.gd.storyBlueprint.blueprint.title,'concurrent');await assert.rejects(f.port.apply(d));assert.equal(f.saves,1);
});
test('Confirmed save followed by state update reports partial',async()=>{const f=fixture({},async()=>f.metadata.gd.storyBlueprint.blueprint.title='later');assert.equal((await f.port.apply(f.draft())).status,'partial');});
test('Missing saver does not initialize any container',async()=>{const target={kind:'chat',chatKey:'A'},metadata={},settings={},port=createBlueprintNodeEditorPort({getTarget:()=>target,getMetadata:()=>metadata,getSettings:()=>settings,getChatLength:()=>0,extensionKey:'gd'});const d=port.initializePreview(target,{revision:port.initializeRead(target).revision,changes:{}});await assert.rejects(port.apply(d),/WRITE_UNAVAILABLE/);assert.deepEqual(metadata,{});});
test('Read pagination and shared budget are enforced without side effects',()=>{
    const f=fixture({gd:{storyBlueprint:{blueprint:null,custom:'x'.repeat(7000)}}}),r=f.port.initializeRead(f.target);assert.ok(r.nextOffset>0);const tail=f.port.initializeRead(f.target,r.nextOffset);assert.equal(tail.revision,r.revision);assert.equal(tail.nextOffset,-1);
    const m=createBlueprintNodeEditorModule({port:f.port,charge:()=>false});assert.throws(()=>m.handlers['muyu.blueprint_node_editor.initialize_read']({offset:0},{target:f.target,runId:'r'}),/BUDGET/);assert.equal(f.saves,0);
});
test('Initialization v29 receipt is text-free and old structure v27 cannot accept it',()=>{
    const f=fixture(),content=f.draft(),r=actionReceipt({id:'op',artifactId:'draft',revision:1,status:'applied_confirmed',content,result:{chatSave:'confirmed'}});
    assert.equal(r.version,29);assert.deepEqual(receiptSources(r),[]);assert.doesNotMatch(JSON.stringify(r),/node_001|用户自建|Story Blueprint/);assert.match(receiptText(r,'zh'),/历史/);assert.match(receiptText(r,'en'),/Historical/);assert.throws(()=>validateReceipt({...r,version:27}));
});
for(const lang of ['zh','en'])test('Initialization view handles null before and localized labels '+lang,()=>{
    const elements=[],doc={createElement(tag){const e={tag,textContent:'',children:[],append(x){this.children.push(x);},setAttribute(){}};elements.push(e);return e;}};
    renderBlueprintNodeEditor({doc,card:doc.createElement('article'),artifact:{id:'a',revision:1,content:fixture().draft()},state:{canApplyBlueprintNodeEdit:true},controller:{},act(){},lang});
    const text=elements.map(e=>e.textContent).join('\n');assert.match(text,lang==='zh'?/新建空白蓝图/:/Create blank Blueprint/);assert.match(text,/"before": null/);assert.ok(elements.some(e=>e.tag==='details'));
});
test('Initialization view shows removed nonactive progress scopes',()=>{
    const f=fixture({gd:{storyBlueprint:{blueprint:null,doneSignals:[],activeProgressKey:'leaf',progressTracks:{leaf:{doneSignals:[]},all:{doneSignals:[{nodeId:'old'}]}}}}}),elements=[],doc={createElement(tag){const e={tag,textContent:'',append(){},setAttribute(){}};elements.push(e);return e;}};
    renderBlueprintNodeEditor({doc,card:doc.createElement('article'),artifact:{id:'a',revision:1,content:f.draft()},state:{},controller:{},act(){},lang:'zh'});assert.match(elements.map(e=>e.textContent).join('\n'),/全部节点.*1 → 0/);
});
test('Clearing the port invalidates private initialization plans without writing',async()=>{const f=fixture(),d=f.draft();f.port.clear();await assert.rejects(f.port.apply(d),/STALE/);assert.deepEqual(f.metadata,{});});
test('Pending old UI continuation blocks first creation without clearing its flag',()=>{const f=fixture({gd:{storyBlueprint:{blueprint:null,continuePending:true}}});assert.throws(()=>f.port.initializeRead(f.target),/BUSY/);assert.equal(f.metadata.gd.storyBlueprint.continuePending,true);assert.equal(f.saves,0);});
for(const lang of ['zh','en'])test('Initialization approval has creation-specific buttons and no generation promise '+lang,()=>{
    const elements=[],doc={createElement(tag){const e={tag,textContent:'',append(){},setAttribute(){}};elements.push(e);return e;}},content=fixture().draft();
    renderBlueprintNodeEditor({doc,card:doc.createElement('article'),artifact:{id:'a',revision:1,content},state:{canApplyBlueprintNodeEdit:true,blueprintNodeEditActions:[{id:'approval',artifactId:'a',revision:1,status:'pending'}]},controller:{},act(){},lang});
    const text=elements.map(e=>e.textContent).join('\n');assert.match(text,lang==='zh'?/创建这份空白蓝图/:/Create this blank Blueprint/);assert.match(text,lang==='zh'?/清空旧进度/:/Clear old progress/);assert.match(text,lang==='zh'?/不生成剧情/:/no replacement, story generation or enabling/);
});
