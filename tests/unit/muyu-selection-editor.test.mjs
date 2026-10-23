import test from 'node:test';
test('Large legacy library stays selectable without sending its body to model',()=>{const f=fixture();f.settings.profileLibraries[0].exportData.text='PRIVATE_BODY'.repeat(10000);const r=f.port.read(f.target,'profile-autoload');assert.ok(JSON.stringify(r).length<6000);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_BODY/);assert.ok(f.draft('profile-autoload'));});
import assert from 'node:assert/strict';
import {createSelectionEditorPort} from '../../muyu/host/selection-editor.js';
import {createSelectionEditorModule} from '../../muyu/modules/selection-editor/index.js';
import {createProfileLibrarySystem} from '../../systems/profile-library-system.js';
import {actionReceipt,receiptSources,receiptText} from '../../muyu/actions/receipts.js';
function fixture(save=async()=>({confirmed:true})) {
 const target={kind:'global',userKey:'u'},settings={worldBookSourceMode:'st',worldBookSelection:{Old:true},profileLibraryAutoLoad:{enabled:false,mode:'best',fixedId:'',matchHash:true,matchAvatarName:true,matchNameOnly:true,overwriteExisting:false,importTemplate:false,extra:'preserved'},profileLibraries:[{id:'p1',name:'PRIVATE_NAME',exportData:{text:'PRIVATE_BODY'}}]};
 let root=settings,current=target,names=['Old','New'],busy=false,saves=0,caches=0;
 const system=createProfileLibrarySystem({settings,extension_settings:{},EXT_KEY:'gd',saveSettings:async()=>{saves++;return save();},saveChatConditional:()=>{throw Error('chat forbidden');},applyImport:()=>{throw Error('import forbidden');},log(){}});
 const port=createSelectionEditorPort({getTarget:()=>current,getSettings:()=>root,getWorldNames:()=>names,profileLibrarySystem:system,worldBookScanner:{clearCache(){caches++;}},saveSettings:async()=>{saves++;return save();},isBusy:()=>busy});
 const draft=(kind='worldbooks',changes=kind==='worldbooks'?{sourceMode:'manual',selectedNames:['New']}:{mode:'fixed',fixedId:'p1'})=>port.preview(target,{kind,revision:port.read(target,kind).revision,changes});
 return{target,settings,system,port,draft,get saves(){return saves;},get caches(){return caches;},setRoot:v=>root=v,setTarget:v=>current=v,setNames:v=>names=v,setBusy:v=>busy=v};
}
for(const kind of ['worldbooks','profile-autoload'])test('Selection '+kind+' read/preview pure, save exactly once, no immediate load',async()=>{
 const f=fixture(),before=structuredClone(f.settings),d=f.draft(kind);assert.deepEqual(f.settings,before);assert.equal(f.saves,0);
 const r=await f.port.apply(d);assert.equal(r.status,kind==='worldbooks'?'applied_confirmed':'applied_unconfirmed');assert.equal(f.saves,1);assert.equal(f.caches,kind==='worldbooks'?1:0);
 assert.deepEqual(f.settings.profileLibraries,before.profileLibraries);assert.equal(f.settings.profileLibraryAutoLoad.matchNameOnly,true);assert.equal(f.settings.profileLibraryAutoLoad.extra,'preserved');await assert.rejects(f.port.apply(d),/STALE/);
});
test('Read does not expose library bodies or initialize stores',()=>{
 const f=fixture();const r=f.port.read(f.target,'profile-autoload');assert.doesNotMatch(JSON.stringify(r),/PRIVATE_BODY|exportData/);assert.equal(r.persistence,'unknown');assert.equal(r.untrusted,true);
 delete f.settings.profileLibraries;f.port.read(f.target,'profile-autoload');assert.equal(Object.hasOwn(f.settings,'profileLibraries'),false);
 delete f.settings.worldBookSelection;f.port.read(f.target,'worldbooks');assert.equal(Object.hasOwn(f.settings,'worldBookSelection'),false);
});
test('World selection requires explicit manual mode; switching back preserves manual list',async()=>{
 const f=fixture();assert.throws(()=>f.draft('worldbooks',{selectedNames:['New']}),/MANUAL_MODE/);
 await f.port.apply(f.draft());await f.port.apply(f.draft('worldbooks',{sourceMode:'st'}));assert.deepEqual(f.settings.worldBookSelection,{New:true});assert.equal(f.settings.worldBookSourceMode,'st');
});
for(const changes of [{selectedNames:['Missing'],sourceMode:'manual'},{selectedNames:['New','New'],sourceMode:'manual'},{selectedNames:1},{sourceMode:'other'},{worldBookSelection:{}},{selectedNames:[1]},JSON.parse('{"__proto__":true}')])
 test('Invalid world selection rejects '+JSON.stringify(changes),()=>{const f=fixture();assert.throws(()=>f.draft('worldbooks',changes));assert.equal(f.saves,0);});
for(const changes of [{mode:'fixed'},{fixedId:'missing'},{mode:'other'},{matchNameOnly:false},{matchHash:1},{importTemplate:'true'},{x:1}])
 test('Invalid profile policy rejects '+JSON.stringify(changes),()=>{const f=fixture();assert.throws(()=>f.draft('profile-autoload',changes));assert.equal(f.saves,0);});
test('Best mode can retain valid fixed ID and disable all matching without hidden changes',async()=>{
 const f=fixture(),d=f.draft('profile-autoload',{fixedId:'p1',matchHash:false,matchAvatarName:false});await f.port.apply(d);assert.equal(f.settings.profileLibraryAutoLoad.mode,'best');assert.equal(f.settings.profileLibraryAutoLoad.enabled,false);
});
for(const [kind,mutate]of [
 ['worldbooks',f=>f.setNames(['Old'])],['worldbooks',f=>f.settings.worldBookSelection.Old=false],
 ['profile-autoload',f=>f.settings.profileLibraries[0].exportData.text='new'],['profile-autoload',f=>f.settings.profileLibraries[0]=structuredClone(f.settings.profileLibraries[0])],
 ['profile-autoload',f=>f.settings.profileLibraryAutoLoad.enabled=true],['profile-autoload',f=>f.settings.profileLibraries=[]],
 ['worldbooks',f=>f.setRoot(structuredClone(f.settings))],['worldbooks',f=>f.setTarget({kind:'global',userKey:'other'})],['worldbooks',f=>f.setBusy(true)],
 ])test('Stale selection rejects '+kind+' / '+String(mutate),async()=>{const f=fixture(),d=f.draft(kind);mutate(f);await assert.rejects(f.port.apply(d));assert.equal(f.saves,0);});
test('Queued profile mutation rechecks baseline before any assignment',async()=>{
 let release;const pending=new Promise(r=>release=r),f=fixture(()=>pending);
 const d=f.draft('profile-autoload'),first=f.system.updateAutoLoadSettings({enabled:true}),later=f.port.apply(d);
 release();await first;await assert.rejects(later,/STALE/);assert.equal(f.saves,1);assert.equal(f.settings.profileLibraryAutoLoad.mode,'best');
});
test('Profile save failure preserves concurrent policy edit, does not rollback whole settings',async()=>{
 const f=fixture(async()=>{f.settings.profileLibraryAutoLoad.mode='concurrent';f.settings.other='keep';throw Error('save');});
 const r=await f.port.apply(f.draft('profile-autoload'));assert.equal(r.status,'outcome_unknown');assert.equal(r.settingsSave,'unknown');assert.equal(f.settings.profileLibraryAutoLoad.mode,'concurrent');assert.equal(f.settings.profileLibraryAutoLoad.fixedId,'');assert.equal(f.settings.other,'keep');assert.equal(f.saves,1);
});
test('World save failure retains concurrent selection; unknown result never retries',async()=>{
 const f=fixture(async()=>{f.settings.worldBookSelection.New=false;f.settings.other='keep';throw Error('save');});const d=f.draft(),r=await f.port.apply(d);
 assert.equal(r.status,'outcome_unknown');assert.equal(f.settings.worldBookSelection.New,false);assert.equal(f.settings.other,'keep');assert.equal(f.saves,1);await assert.rejects(f.port.apply(d),/STALE/);
});
test('World unconfirmed save is not fabricated as confirmed',async()=>{const f=fixture(async()=>{});assert.equal((await f.port.apply(f.draft())).status,'applied_unconfirmed');});
for(const kind of ['worldbooks','profile-autoload'])test('Concurrent state after save yields partial '+kind,async()=>{
 const f=fixture(async()=>{if(kind==='worldbooks')f.settings.worldBookSelection.New=false;else f.settings.profileLibraries[0].name='Changed';return{confirmed:true};});
 assert.equal((await f.port.apply(f.draft(kind))).status,'partial');assert.equal(f.saves,1);
});
test('Tampered exact draft and no-op reject without saving',async()=>{const f=fixture(),d=f.draft();d.after.sourceMode='st';await assert.rejects(f.port.apply(d),/STALE/);assert.throws(()=>f.draft('worldbooks',{}),/EMPTY/);assert.equal(f.saves,0);});
test('Shared byte budget gates selection reads and source requires selectionState',()=>{
 const f=fixture(),m=createSelectionEditorModule({port:f.port,charge:()=>false});
 assert.throws(()=>m.handlers['muyu.selection.read']({kind:'worldbooks'},{target:f.target,runId:'r'}),/BUDGET/);
 assert.equal(m.registry.list().length,2);
});
test('Receipt contains only selection metadata, no library identity or bodies',()=>{
 const f=fixture(),content=f.draft('profile-autoload'),r=actionReceipt({id:'op',artifactId:'draft',revision:1,status:'applied_unconfirmed',content,result:{settingsSave:'unconfirmed'}});
 assert.equal(r.version,26);assert.deepEqual(receiptSources(r),[]);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|p1|fixedId|after/);assert.match(receiptText(r,'zh'),/档案库/);assert.match(receiptText(r,'en'),/Profile/);
});
test('Missing cache writer fails before mutation; throwing cache still attempts save and reports unknown',async()=>{
 const f=fixture(),make=cache=>createSelectionEditorPort({getTarget:()=>f.target,getSettings:()=>f.settings,getWorldNames:()=>['Old','New'],worldBookScanner:cache,saveSettings:async()=>({confirmed:true})});
 const p=make({}),d=p.preview(f.target,{kind:'worldbooks',revision:p.read(f.target,'worldbooks').revision,changes:{sourceMode:'manual'}});await assert.rejects(p.apply(d),/WRITE_UNAVAILABLE/);assert.equal(f.settings.worldBookSourceMode,'st');
 const q=make({clearCache(){throw Error('cache');}}),c=q.preview(f.target,{kind:'worldbooks',revision:q.read(f.target,'worldbooks').revision,changes:{sourceMode:'manual'}});
 const r=await q.apply(c);assert.equal(r.status,'outcome_unknown');assert.equal(r.settingsSave,'confirmed');
});
