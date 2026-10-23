import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createStoryBlueprintLibrarySystem} from '../../systems/story-blueprint-library-system.js';
import {createStoryBlueprintSystem} from '../../systems/story-blueprint-system.js';
import {createBlueprintLibraryPort} from '../../muyu/host/blueprint-libraries.js';
import {createBlueprintLibraryChatPort} from '../../muyu/host/blueprint-library-chat.js';
import {createBlueprintLibraryChatActions} from '../../muyu/actions/blueprint-library-chat.js';
import {actionReceipt,receiptContext,validateReceipt} from '../../muyu/actions/receipts.js';
import {renderBlueprintLibraryChat} from '../../muyu/ui/blueprint-library-chat-view.js';
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const blueprint=()=>({version:1,title:'PRIVATE_TITLE',meta:{},nodes:[{id:'root',type:'chapter',title:'Act',content:{},children:[
 {id:'a',type:'scene',title:'PRIVATE_NODE',content:{text:'PRIVATE_BODY'},children:[]},
 {id:'b',type:'scene',title:'B',content:{},children:[]}]}]});
const signal=id=>({nodeId:id,stepIndex:0,chatLength:100,time:1,source:'import'});
const data=()=>({type:'group-director-story-blueprint',version:1,storyBlueprint:{blueprint:blueprint(),doneSignals:[signal('a')],progressTracks:{
 leaf:{doneSignals:[signal('a'),signal('b')]},all:{doneSignals:[signal('root'),signal('b')]},'level:0':{doneSignals:[signal('root')]}},activeProgressKey:'leaf'}});
function fixture({chatSave=()=>{},settingsSave=()=>{}}={}){
 const settings={storyBlueprintProgressionMode:'leaf',storyBlueprintCompletionVariable:'done',storyBlueprintEnabled:false};
 let metadata={},target={kind:'chat',chatKey:'A',userKey:'u'},busy=false,chatSaves=0,settingsSaves=0,length=5,current=settings;
 const forbidden=()=>{throw Error('must not access live importer or generate');};
 const system=createStoryBlueprintLibrarySystem({settings,EXT_KEY:'gd',extension_settings:{},saveSettings:()=>{settingsSaves++;return settingsSave();},
 getCurrentGroup:forbidden,storyBlueprintSystem:new Proxy({}, {get:()=>forbidden}),log(){}});
 const library=createBlueprintLibraryPort({getSettings:()=>current,system});
 const port=createBlueprintLibraryChatPort({getSettings:()=>current,getMetadata:()=>metadata,getTarget:()=>target,getChatLength:()=>length,extensionKey:'gd',system,libraryPort:library,
 isBusy:()=>busy,saveChatConfirmed:async m=>{assert.equal(m,metadata);chatSaves++;await chatSave();}});
 const seed=async()=>{await library.save(library.preview({operation:'create',changes:{name:'pack',exportData:data()}}));return library.list().items[0];};
 const preview=async options=>{const row=await seed();return port.prepareApply({...row,...options},target);};
 const completion=()=>{metadata.gd={...metadata.gd,variables:{defs:[{id:'done',type:'boolean',scope:'global',defaultValue:false}],values:{global:{done:true,other:'keep'},character:{}}}};};
 return {settings,get metadata(){return metadata;},system,library,port,seed,preview,completion,target:()=>target,switchChat:()=>target={...target,chatKey:'B'},
 replace:()=>metadata=structuredClone(metadata),replaceSettings:()=>current={...settings},grow:()=>length++,busy:()=>busy=true,chatSaves:()=>chatSaves,settingsSaves:()=>settingsSaves};
}
test('Blueprint preview stays pure; default apply resets all progress without enabling or creating variables',async()=>{
 const f=fixture(),d=await f.preview();assert.deepEqual(f.metadata,{});assert.equal(f.chatSaves(),0);
 const r=await f.port.save(d);assert.equal(r.status,'applied_confirmed');assert.equal(f.chatSaves(),1);
 assert.deepEqual(f.metadata.gd.storyBlueprint.progressTracks,{leaf:{doneSignals:[],completeNoticeKey:''}});
 assert.equal(f.metadata.gd.variables,undefined);assert.equal(f.settings.storyBlueprintEnabled,false);assert.equal(f.settingsSaves(),1);
 await assert.rejects(f.port.save(d),/STALE/);
});
test('Blueprint application resets only existing compatible signal and preserves unrelated state',async()=>{
 const f=fixture();f.completion();f.metadata.gd.npcs=[{name:'keep'}];const d=await f.preview();
 assert.equal(d.completion.value,true);await f.port.save(d);
 assert.equal(f.metadata.gd.variables.values.global.done,false);assert.equal(f.metadata.gd.variables.values.global.other,'keep');
 assert.deepEqual(f.metadata.gd.variables.defs,[{id:'done',type:'boolean',scope:'global',defaultValue:false}]);
 assert.equal(f.metadata.gd.npcs[0].name,'keep');
});
for(const mode of ['leaf','all','level'])test('Blueprint imported progress follows real importer for '+mode,async()=>{
 const f=fixture();f.settings.storyBlueprintProgressionMode=mode;f.settings.storyBlueprintProgressionLevel=0;
 const d=await f.preview({includeProgress:true}),isolated={};
 const real=createStoryBlueprintSystem({settings:f.settings,EXT_KEY:'gd',getChatMetadata:()=>isolated,getChat:()=>({length:5}),saveChatConditional(){},log(){}});
 assert.equal(real.applyImportText(JSON.stringify(data()),{persist:false,includeProgress:true}).ok,true);
 assert.deepEqual(d.after.progressTracks,isolated.gd.storyBlueprint.progressTracks);
 assert.equal(d.after.activeProgressKey,isolated.gd.storyBlueprint.activeProgressKey);
 assert.equal(d.after.progressTracks.all.doneSignals.length,1);assert.equal(d.after.progressTracks.leaf.doneSignals[0].chatLength,5);
 await f.port.save(d);assert.deepEqual(f.metadata.gd.storyBlueprint,d.after);
});
for(const includeProgress of [false,true])test('Blueprint capture copies without chat mutation; progress='+includeProgress,async()=>{
 const f=fixture();f.metadata.gd={storyBlueprint:data().storyBlueprint};
 const before=structuredClone(f.metadata),d=f.port.capture({name:'saved',includeProgress},f.target());
 assert.equal(f.settings.storyBlueprintLibraries,undefined);
 assert.equal(d.draft.next.exportData.storyBlueprint.doneSignals.length,includeProgress?1:0);
 const r=await f.port.save(d);assert.equal(r.status,'saved_unconfirmed');assert.deepEqual(f.metadata,before);assert.equal(f.chatSaves(),0);
});
for(const cause of ['chat','state','signal','library','mode','length','busy','metadata','settings'])test('Blueprint stale '+cause+' cannot write',async()=>{
 const f=fixture();f.completion();const d=await f.preview();
 if(cause==='chat')f.switchChat();if(cause==='state')f.metadata.gd.storyBlueprint={blueprint:null};
 if(cause==='signal')f.metadata.gd.variables.values.global.done=false;if(cause==='library')f.settings.storyBlueprintLibraries[0].name='changed';
 if(cause==='mode')f.settings.storyBlueprintProgressionMode='all';if(cause==='length')f.grow();if(cause==='busy')f.busy();
 if(cause==='metadata')f.replace();if(cause==='settings')f.replaceSettings();
 await assert.rejects(f.port.save(d));assert.equal(f.chatSaves(),0);
});
for(const change of ['locked','type','owner','duplicate','orphan'])test('Blueprint completion '+change+' fails closed',async()=>{
 const f=fixture();f.completion();const vars=f.metadata.gd.variables,def=vars.defs[0];
 if(change==='locked')def.locked=true;if(change==='type')def.type='number';if(change==='owner')def.owner='other';
 if(change==='duplicate')vars.defs.push({...def});if(change==='orphan')vars.defs=[];
 await assert.rejects(f.preview());assert.equal(f.chatSaves(),0);
});
test('Blueprint unknown save leaves concurrent edits and consumes plan without retry',async()=>{
 const wait=gate(),started=gate(),f=fixture({chatSave:()=>{started.resolve();return wait.promise;}});f.completion();const d=await f.preview();
 const pending=f.port.save(d);await started.promise;f.metadata.gd.storyBlueprint.blueprint.title='concurrent';
 f.metadata.gd.variables.values.global.other='new';wait.reject(Error('offline'));
 assert.equal((await pending).status,'outcome_unknown');assert.equal(f.metadata.gd.storyBlueprint.blueprint.title,'concurrent');
 assert.equal(f.metadata.gd.variables.values.global.other,'new');await assert.rejects(f.port.save(d));assert.equal(f.chatSaves(),1);
});
for(const change of ['chat','signal','state'])test('Blueprint concurrent '+change+' reports partial after confirmed save',async()=>{
 const wait=gate(),started=gate(),f=fixture({chatSave:()=>{started.resolve();return wait.promise;}});f.completion();const d=await f.preview();
 const pending=f.port.save(d);await started.promise;
 if(change==='chat')f.switchChat();if(change==='signal')f.metadata.gd.variables.values.global.done=true;
 if(change==='state')f.metadata.gd.storyBlueprint.blueprint.title='concurrent';
 wait.resolve();const r=await pending;assert.equal(r.status,'partial');assert.equal(r.chatSave,'confirmed');assert.equal(f.settingsSaves(),1);
});
test('Blueprint queued apply rechecks source after another library save',async()=>{
 const wait=gate(),started=gate();let hold=false;
 const f=fixture({settingsSave:()=>{if(hold){started.resolve();return wait.promise;}}}),d=await f.preview();
 hold=true;const saving=f.library.save(f.library.preview({operation:'create',changes:{name:'another',exportData:data()}}));await started.promise;
 const applying=f.port.save(d);f.grow();wait.resolve();await saving;await assert.rejects(applying);assert.equal(f.chatSaves(),0);
});
test('Blueprint v19 receipts are metadata only and UI shows whole replacement and signal',async()=>{
 const f=fixture();f.completion();const content=await f.preview(),artifact={id:'a',revision:1,sessionId:'s',kind:'blueprint-library-chat-draft',content};
 const actions=createBlueprintLibraryChatActions({getArtifact:()=>artifact,validate:()=>f.port.assertFresh(content),getTarget:f.target,writer:f.port});
 const pending=actions.prepare('a',1),doc={createElement:tag=>({tag,children:[],append(e){this.children.push(e);}})},card=doc.createElement('div');
 renderBlueprintLibraryChat({doc,card,artifact,state:{canSaveBlueprintLibraryChat:true,blueprintLibraryChatActions:[pending]},controller:{},act:fn=>fn(),lang:'en'});
 assert.equal(card.children.find(e=>e.tag==='details').open,true);assert.match(JSON.stringify(card),/PRIVATE_BODY|completionSignal/);
 const r=actionReceipt(await actions.approve(pending.id));assert.equal(r.version,19);assert.doesNotMatch(receiptContext([r]),/PRIVATE_BODY|PRIVATE_NODE|PRIVATE_TITLE/);
 assert.throws(()=>validateReceipt({...r,body:'secret'}));
});
test('Blueprint production confirmation includes blueprint and variables',async()=>{
 const source=await readFile(new URL('../../index.js',import.meta.url),'utf8'),ui=await readFile(new URL('../../ui/sections/muyu.js',import.meta.url),'utf8');
 assert.match(source,/const saveBlueprintLibraryChatConfirmed = createConfirmedChatMetadataSave\([\s\S]*?blueprint:[\s\S]*?variables:/);
 assert.match(ui,/saveChatConfirmed: ctx.saveBlueprintLibraryChatConfirmed/);
});
