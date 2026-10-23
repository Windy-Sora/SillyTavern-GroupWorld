import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfileLibrarySystem } from '../../systems/profile-library-system.js';
import { createProfileLibraryPort } from '../../muyu/host/profile-libraries.js';
import { createProfileLibraryChatPort } from '../../muyu/host/profile-library-chat.js';
import { createProfileLibraryChatActions } from '../../muyu/actions/profile-library-chat.js';
import { actionReceipt, receiptContext } from '../../muyu/actions/receipts.js';
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function fixture({chatSave=()=>{},settingsSave=()=>{}}={}) {
 const settings={},metadata={};let target={kind:'chat',chatKey:'a',userKey:'u'},busy=false,chatSaves=0,settingsSaves=0;
 const group={id:1,name:'group',members:['a.png','b.png'],disabled_members:['b.png']};
 const system=createProfileLibrarySystem({settings,EXT_KEY:'gd',extension_settings:{},saveSettings:()=>{settingsSaves++;return settingsSave();},
 getProfiles:()=>{throw Error('no impure getter');},getCurrentGroup:()=>group,getCharacters:()=>[{avatar:'a.png',name:'Alice'},{avatar:'b.png',name:'Bob'}],
 hashChar:()=> 'h',getDefaultProfileGeneratorPrompt:()=> 'default',getDefaultProfileSchema:()=> '{}',getDefaultProfileRenderTemplate:()=> '{{name}}',log(){}});
 const library=createProfileLibraryPort({getSettings:()=>settings,system});
 const port=createProfileLibraryChatPort({getSettings:()=>settings,getMetadata:()=>metadata,getTarget:()=>target,system,libraryPort:library,
 isBusy:()=>busy,saveChatConfirmed:async m=>{assert.equal(m,metadata);chatSaves++;await chatSave();}});
 const data={version:1,type:'profile-export',template:{generatorPrompt:'new',jsonSchema:'{}',renderTemplate:'new'},profiles:[{avatar:'a.png',name:'Alice',hash:'h',profile:{note:'PRIVATE_BODY'}}]};
 const seed=async()=>{await library.save(library.preview({operation:'create',changes:{name:'pack',exportData:data}}));return library.list().items[0];};
 const preview=async options=>{const row=await seed();return port.prepareApply({...row,...options},target);};
 return {settings,metadata,group,port,library,system,seed,preview,target:()=>target,switchChat:()=>target={...target,chatKey:'b'},busy:()=>busy=true,chatSaves:()=>chatSaves,settingsSaves:()=>settingsSaves};
}
test('Chat library preview is pure and confirmed application preserves unrelated metadata',async()=>{
 const f=fixture(),draft=await f.preview();assert.deepEqual(f.metadata,{});f.metadata.other='keep';
 const result=await f.port.save(draft);assert.equal(result.status,'applied_confirmed');assert.equal(f.chatSaves(),1);assert.equal(f.settingsSaves(),1);
 assert.equal(f.metadata.other,'keep');assert.equal(f.metadata.gd.characterProfiles['a.png'].profile.note,'PRIVATE_BODY');
 await assert.rejects(f.port.save(draft),/STALE/);
});
test('Capture includes enabled ready members only and never writes chat or active templates',async()=>{
 const f=fixture();f.metadata.gd={characterProfiles:{'a.png':{state:'ready',hash:'h',profile:{note:'PRIVATE_BODY'}},'b.png':{state:'ready',profile:{note:'excluded'}}}};
 const draft=f.port.capture({name:'saved'},f.target());assert.equal(f.settings.profileLibraries,undefined);assert.equal(draft.count,1);
 assert.equal((await f.port.save(draft)).status,'saved_unconfirmed');assert.equal(f.chatSaves(),0);assert.equal(f.settings.profileGeneratorPrompt,undefined);
 assert.equal(f.settings.profileLibraries[0].profileCount,1);
});
test('Existing incomplete or manually edited profiles need explicit overwrite',async()=>{
 const f=fixture();f.metadata.gd={characterProfiles:{'a.png':{state:'error',manualEdited:true,profile:{note:'before'}}}};
 const row=await f.seed();assert.throws(()=>f.port.prepareApply(row,f.target()),/NO_CHANGES/);
 const d=f.port.prepareApply({...row,overwriteExisting:true},f.target());assert.equal(d.changes[0].before.profile.note,'before');
 await f.port.save(d);assert.equal(f.metadata.gd.characterProfiles['a.png'].manualEdited,true);
});
for(const change of ['chat','profile','library','busy','template']) test('Stale chat library plan rejects before effects: '+change,async()=>{
 const f=fixture(),d=await f.preview();
 if(change==='chat')f.switchChat();if(change==='profile')f.metadata.gd={characterProfiles:{x:{profile:{note:'edit'}}}};
 if(change==='library')f.settings.profileLibraries[0].name='changed';if(change==='busy')f.busy();if(change==='template')f.settings.profileGeneratorPrompt='changed';
 await assert.rejects(f.port.save(d));assert.equal(f.chatSaves(),0);assert.equal(f.settingsSaves(),1);
});
test('Failed async chat save never attempts global template save or retry',async()=>{
 const f=fixture({chatSave:async()=>{throw Error('offline');}}),d=await f.preview({importTemplate:true});
 const r=await f.port.save(d);assert.equal(r.status,'outcome_unknown');assert.equal(r.chatSave,'unknown');assert.equal(r.settingsSave,'not_started');
 assert.equal(f.settings.profileGeneratorPrompt,undefined);assert.equal(f.settingsSaves(),1);await assert.rejects(f.port.save(d));
});
for(const change of ['chat','profile','template']) test('During chat save concurrent '+change+' prevents global template write',async()=>{
 const started=gate(),wait=gate();const f=fixture({chatSave:()=>{started.resolve();return wait.promise;}}),d=await f.preview({importTemplate:true});
 const pending=f.port.save(d);await started.promise;
 if(change==='chat')f.switchChat();if(change==='profile')f.metadata.gd.characterProfiles['a.png'].profile.note='concurrent';
 if(change==='template')f.settings.profileGeneratorPrompt='concurrent';
 wait.resolve();const r=await pending;assert.equal(r.status,'partial');assert.equal(r.chatSave,'confirmed');assert.equal(r.settingsSave,'not_started');
 assert.equal(f.settingsSaves(),1);if(change==='profile')assert.equal(f.metadata.gd.characterProfiles['a.png'].profile.note,'concurrent');
});
test('Optional global save waits, reports partial failure, and preserves confirmed chat',async()=>{
 let fail=false;const f=fixture({settingsSave:async()=>{if(fail)throw Error('offline');}}),d=await f.preview({importTemplate:true});fail=true;
 const r=await f.port.save(d);assert.equal(r.status,'partial');assert.equal(r.chatSave,'confirmed');assert.equal(r.settingsSave,'unknown');assert.equal(f.chatSaves(),1);
});
test('Successful two-domain apply and exact coordinator receipt contain no profile bodies',async()=>{
 const f=fixture(),content=await f.preview({importTemplate:true}),artifact={id:'a',revision:1,sessionId:'s',kind:'profile-library-chat-draft',content};
 const actions=createProfileLibraryChatActions({getArtifact:()=>artifact,validate:()=>f.port.assertFresh(content),getTarget:f.target,writer:f.port});
 const pending=actions.prepare('a',1);await actions.approve(pending.id);const r=actionReceipt(actions.list()[0]);
 assert.equal(r.version,15);assert.equal(r.status,'applied_unconfirmed');assert.equal(r.chatSave,'confirmed');assert.equal(r.settingsSave,'unconfirmed');
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE_BODY|Alice|generatorPrompt/);assert.equal(f.settings.profileGeneratorPrompt,'new');
});
test('Disposal invalidates unpublished plans',async()=>{const f=fixture(),d=await f.preview();f.port.clearPlans();await assert.rejects(f.port.save(d),/STALE/);});

test('Queued capture rechecks source after unrelated library save releases',async()=>{
 const started=gate(),wait=gate();let hold=false;
 const f=fixture({settingsSave:()=>{if(hold){started.resolve();return wait.promise;}}});
 f.metadata.gd={characterProfiles:{'a.png':{state:'ready',profile:{note:'before'}}}};
 const draft=f.port.capture({name:'saved'},f.target());hold=true;
 const blocking=f.system.updateAutoLoadSettings({enabled:false});await started.promise;
 const saving=f.port.save(draft);f.switchChat();wait.resolve();await blocking;await assert.rejects(saving);
 assert.equal(f.settings.profileLibraries?.length||0,0);
});
test('Concurrent global template edit during save survives and is reported partial',async()=>{
 const started=gate(),wait=gate();let hold=false;
 const f=fixture({settingsSave:()=>{if(hold){started.resolve();return wait.promise;}}}),d=await f.preview({importTemplate:true});hold=true;
 const saving=f.port.save(d);await started.promise;f.settings.profileGeneratorPrompt='concurrent';wait.resolve();
 const r=await saving;assert.equal(r.status,'partial');assert.equal(f.settings.profileGeneratorPrompt,'concurrent');assert.equal(r.chatSave,'confirmed');
});
test('Chat library approval UI keeps complete details collapsible and uses exact action',async()=>{
 const {renderProfileLibraryChat}=await import('../../muyu/ui/profile-library-chat-view.js');
 const f=fixture(),content=await f.preview({importTemplate:true}),artifact={id:'a',revision:1,content};
 const doc={createElement:tag=>({tag,children:[],append(e){this.children.push(e);}})},card=doc.createElement('div');let approved='';
 renderProfileLibraryChat({doc,card,artifact,state:{canSaveProfileLibraryChat:true,profileLibraryChatActions:[{artifactId:'a',revision:1,status:'pending',id:'exact'}]},
 controller:{approveProfileLibraryChat:id=>approved=id},act:fn=>fn(),lang:'en'});
 assert.equal(card.children.find(e=>e.tag==='details').open,true);card.children.find(e=>e.tag==='button').onclick();assert.equal(approved,'exact');
});
