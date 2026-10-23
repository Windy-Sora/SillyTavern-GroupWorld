import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createNpcLibrarySystem} from '../../systems/npc-library-system.js';
import {createNpcLibraryPort} from '../../muyu/host/npc-libraries.js';
import {createNpcLibraryChatPort} from '../../muyu/host/npc-library-chat.js';
import {createNpcLibraryChatActions} from '../../muyu/actions/npc-library-chat.js';
import {actionReceipt,receiptContext} from '../../muyu/actions/receipts.js';
import {renderNpcLibraryChat} from '../../muyu/ui/npc-library-chat-view.js';
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function fixture({chatSave=()=>{},settingsSave=()=>{}}={}){
 const settings={},metadata={};let target={kind:'chat',chatKey:'A',userKey:'u'},busy=false,chatSaves=0,settingsSaves=0;
 const forbidden=()=>{throw Error('no impure chat getter or legacy application');};
 const system=createNpcLibrarySystem({settings,EXT_KEY:'gd',extension_settings:{},saveSettings:()=>{settingsSaves++;return settingsSave();},
 getCurrentGroup:()=>null,npcSystem:{getNpcs:forbidden},parseNpcImportFile:forbidden,applyNpcImport:forbidden,getDefaultNpcPrompt:()=> 'default',log(){}});
 const library=createNpcLibraryPort({getSettings:()=>settings,system});
 const port=createNpcLibraryChatPort({getSettings:()=>settings,getMetadata:()=>metadata,getTarget:()=>target,system,libraryPort:library,
 isBusy:()=>busy,saveChatConfirmed:async m=>{assert.equal(m,metadata);chatSaves++;await chatSave();}});
 const seed=async()=>{await library.save(library.preview({operation:'create',changes:{name:'pack',exportData:{type:'npc-export',version:1,template:{npcPrompt:'new'},npcs:[{name:'Alice',description:'PRIVATE_BODY'},{name:'Bob'}]}}}));return library.list().items[0];};
 const preview=async options=>{const row=await seed();return port.prepareApply({...row,...options},target);};
 return {settings,metadata,system,library,port,seed,preview,target:()=>target,switchChat:()=>target={...target,chatKey:'B'},busy:()=>busy=true,chatSaves:()=>chatSaves,settingsSaves:()=>settingsSaves};
}
test('NPC chat preview is pure, append preserves unrelated data and never imports cards',async()=>{
 const f=fixture(),d=await f.preview();assert.deepEqual(f.metadata,{});f.metadata.other='keep';
 const r=await f.port.save(d);assert.equal(r.status,'applied_confirmed');assert.equal(f.chatSaves(),1);assert.equal(f.settingsSaves(),1);
 assert.equal(f.metadata.other,'keep');assert.equal(f.metadata.gd.npcs.length,2);assert.equal(f.metadata.gd.npcs[0].imported,false);assert.equal(f.metadata.gd.npcs[0].importedAvatar,null);
 assert.equal(f.settings.npcPrompt,undefined);await assert.rejects(f.port.save(d),/STALE/);
});
test('NPC capture strips tracking and saves a pure resource without chat writes',async()=>{
 const f=fixture();f.metadata.gd={npcs:[{name:'Alice',description:'PRIVATE_BODY',imported:true,importedAvatar:'PRIVATE_AVATAR',createdAt:123}]};
 const d=f.port.capture({name:'saved'},f.target());assert.equal(f.settings.npcLibraries,undefined);
 assert.equal(d.draft.next.exportData.npcs[0].imported,undefined);assert.equal(d.draft.next.exportData.template.npcPrompt,'default');
 const r=await f.port.save(d);assert.equal(r.status,'saved_unconfirmed');assert.equal(f.chatSaves(),0);assert.equal(f.metadata.gd.npcs[0].imported,true);
});
test('NPC defaults preserve same-name entries case-insensitively; overwrite preserves tracking and extra fields',async()=>{
 const f=fixture();f.metadata.gd={npcs:[{name:'ALICE',description:'before',imported:true,importedAvatar:'card.png',createdAt:123,extra:'keep'},{name:'Other'}]};
 const row=await f.seed(),d=f.port.prepareApply(row,f.target());assert.deepEqual(d.skipped,['ALICE']);assert.equal(d.count,1);
 await f.port.save(d);assert.equal(f.metadata.gd.npcs[0].description,'before');
 const overwrite=f.port.prepareApply({...row,overwriteExisting:true},f.target());await f.port.save(overwrite);
 assert.equal(f.metadata.gd.npcs[0].description,'PRIVATE_BODY');assert.equal(f.metadata.gd.npcs[0].importedAvatar,'card.png');assert.equal(f.metadata.gd.npcs[0].createdAt,123);assert.equal(f.metadata.gd.npcs[0].extra,'keep');assert.equal(f.metadata.gd.npcs[1].name,'Other');
});
test('NPC all-skipped application cannot write Prompt alone, duplicate existing names fail closed',async()=>{
 const f=fixture();f.metadata.gd={npcs:[{name:'alice'},{name:'bob'}]};const row=await f.seed();
 assert.throws(()=>f.port.prepareApply({...row,importTemplate:true},f.target()),/NO_CHANGES/);
 f.metadata.gd.npcs.push({name:'Alice'});assert.throws(()=>f.port.capture({name:'x'},f.target()),/INVALID_LIBRARY_CHAT/);
 assert.equal(f.chatSaves(),0);assert.equal(f.settings.npcPrompt,undefined);
});
for(const change of ['chat','npc','library','busy','prompt'])test('NPC stale '+change+' rejects before write',async()=>{
 const f=fixture(),d=await f.preview();
 if(change==='chat')f.switchChat();if(change==='npc')f.metadata.gd={npcs:[{name:'concurrent'}]};
 if(change==='library')f.settings.npcLibraries[0].name='changed';if(change==='busy')f.busy();if(change==='prompt')f.settings.npcPrompt='changed';
 await assert.rejects(f.port.save(d));assert.equal(f.chatSaves(),0);assert.equal(f.settingsSaves(),1);
});
test('NPC chat async rejection stops optional Prompt and cannot replay',async()=>{
 const f=fixture({chatSave:async()=>{throw Error('offline');}}),d=await f.preview({importTemplate:true});
 const r=await f.port.save(d);assert.equal(r.status,'outcome_unknown');assert.equal(r.chatSave,'unknown');assert.equal(r.settingsSave,'not_started');
 assert.equal(f.settings.npcPrompt,undefined);await assert.rejects(f.port.save(d));
});
for(const change of ['chat','npc','prompt'])test('NPC concurrent '+change+' while saving stops global Prompt',async()=>{
 const started=gate(),wait=gate(),f=fixture({chatSave:()=>{started.resolve();return wait.promise;}}),d=await f.preview({importTemplate:true});
 const pending=f.port.save(d);await started.promise;
 if(change==='chat')f.switchChat();if(change==='npc')f.metadata.gd.npcs[0].description='concurrent';if(change==='prompt')f.settings.npcPrompt='concurrent';
 wait.resolve();const r=await pending;assert.equal(r.status,'partial');assert.equal(r.chatSave,'confirmed');assert.equal(r.settingsSave,'not_started');
 assert.equal(f.settingsSaves(),1);if(change==='npc')assert.equal(f.metadata.gd.npcs[0].description,'concurrent');
});
test('NPC Prompt save failure leaves confirmed chat and reports separate unknown result',async()=>{
 let fail=false;const f=fixture({settingsSave:()=>{if(fail)throw Error('offline');}}),d=await f.preview({importTemplate:true});fail=true;
 const r=await f.port.save(d);assert.equal(r.status,'partial');assert.equal(r.chatSave,'confirmed');assert.equal(r.settingsSave,'unknown');
 assert.equal(f.metadata.gd.npcs.length,2);
});
test('NPC queued capture checks source after earlier library save; disposal invalidates',async()=>{
 const started=gate(),wait=gate();let hold=false;const f=fixture({settingsSave:()=>{if(hold){started.resolve();return wait.promise;}}});
 const row=await f.seed();f.metadata.gd={npcs:[{name:'Alice'}]};const d=f.port.capture({name:'captured'},f.target());hold=true;
 const blocking=f.system.deleteLibrary(row.id);await started.promise;const pending=f.port.save(d);f.switchChat();wait.resolve();await blocking;
 await assert.rejects(pending);assert.equal(f.settings.npcLibraries.length,0);
 f.port.clearPlans();assert.throws(()=>f.port.assertFresh(d));
});
test('NPC exact approval produces metadata-only v17 receipt and collapsible UI',async()=>{
 const f=fixture(),content=await f.preview({importTemplate:true}),artifact={id:'a',revision:1,sessionId:'s',kind:'npc-library-chat-draft',content};
 const actions=createNpcLibraryChatActions({getArtifact:()=>artifact,validate:()=>f.port.assertFresh(content),getTarget:f.target,writer:f.port});
 const p=actions.prepare('a',1);const doc={createElement:tag=>({tag,children:[],append(e){this.children.push(e);}})},card=doc.createElement('div');let called='';
 renderNpcLibraryChat({doc,card,artifact,state:{canSaveNpcLibraryChat:true,npcLibraryChatActions:[p]},controller:{approveNpcLibraryChat:id=>called=id},act:fn=>fn(),lang:'en'});
 assert.equal(card.children.find(e=>e.tag==='details').open,true);card.children.find(e=>e.tag==='button').onclick();assert.equal(called,p.id);
 const action=await actions.approve(p.id),r=actionReceipt(action);assert.equal(r.version,17);assert.equal(r.chatSave,'confirmed');assert.equal(r.settingsSave,'unconfirmed');
 assert.doesNotMatch(receiptContext([r]),/PRIVATE_BODY|Alice|npcPrompt/);assert.throws(()=>actions.approve(p.id));
});
test('Production library ports use their own persistence slice, never variable-only verification',async()=>{
 const index=await readFile(new URL('../../index.js',import.meta.url),'utf8'),ui=await readFile(new URL('../../ui/sections/muyu.js',import.meta.url),'utf8');
 assert.match(index,/const saveProfilesChatConfirmed = createConfirmedChatMetadataSave\([\s\S]*?selectValue: metadata => metadata\[EXT_KEY\]\?\.characterProfiles/);
 assert.match(index,/saveVariablesChatConfirmed, saveProfilesChatConfirmed, saveNpcChatConfirmed, saveSettings/);
 assert.match(ui,/system: ctx\.npcLibrarySystem, libraryPort: npcLibraries, saveChatConfirmed: ctx\.saveNpcChatConfirmed/);
 assert.match(ui,/system: ctx\.profileLibrarySystem, libraryPort: profileLibraries, saveChatConfirmed: ctx\.saveProfilesChatConfirmed/);
});
