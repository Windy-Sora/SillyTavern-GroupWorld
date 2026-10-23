import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfileLibrarySystem } from '../../systems/profile-library-system.js';
import { createProfileLibraryPort } from '../../muyu/host/profile-libraries.js';
import { createProfileLibraryModule } from '../../muyu/modules/profile-libraries/index.js';
import { createProfileLibraryActions } from '../../muyu/actions/profile-library-save.js';
import { actionReceipt,receiptContext } from '../../muyu/actions/receipts.js';
import { renderProfileLibrarySave } from '../../muyu/ui/profile-library-save-view.js';
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function fixture(save=()=>{}) {
 const settings={},ext={};let saves=0;
 const system=createProfileLibrarySystem({settings,extension_settings:ext,EXT_KEY:'gd',saveSettings:()=>{saves++;return save();},
 getProfiles:()=>{throw Error('must not read current chat');},applyImport:()=>{throw Error('must not apply');},log(){}});
 const port=createProfileLibraryPort({getSettings:()=>settings,system});
 return {settings,system,port,saves:()=>saves,ext};
}
const data=()=>({type:'profile-export',version:1,template:{generatorPrompt:'',jsonSchema:'{}',renderTemplate:''},profiles:[{avatar:'a.png',name:'Alice',hash:'h',profile:{note:'PRIVATE_BODY'}}]});
const create=f=>f.port.preview({operation:'create',changes:{name:'pack',exportData:data()}});
const change=(f,changes={},operation='update')=>{const r=f.port.list().items[0];return f.port.preview({operation,id:r.id,revision:r.revision,changes});};
test('Library previews stay pure and validate bounded package structure, not chat state',()=>{
 const f=fixture();assert.deepEqual(f.port.list().items,[]);const draft=create(f);assert.deepEqual(f.settings,{});
 assert.match(draft.warnings.join(''),/后续自动加载/);
 for(const exportData of [{...data(),version:2},{...data(),profiles:[]},{...data(),profiles:[...data().profiles,...data().profiles]},{...data(),secret:'x'}])
 assert.throws(()=>f.port.preview({operation:'create',changes:{name:'pack',exportData}}),/INVALID/);
 assert.throws(()=>f.port.preview({operation:'create',changes:{name:'pack',exportData:data(),apiKey:'x'}}),/INVALID/);
});
test('Library create, rename, package replacement, export and delete are library-only',async()=>{
 const f=fixture();assert.equal((await f.port.save(create(f))).status,'saved_unconfirmed');const id=f.settings.profileLibraries[0].id;
 await f.port.save(change(f,{name:'renamed'}));assert.equal(f.settings.profileLibraries[0].id,id);assert.equal(f.settings.profileLibraries[0].profileCount,1);
 const row=f.port.list().items[0];assert.equal(f.port.exportEntry(row.id,row.revision).profiles[0].profile.note,'PRIVATE_BODY');
 assert.equal(f.port.exportEntry(row.id,row.revision).libraryMeta.name,'renamed');
 assert.equal(JSON.parse(f.port.read(row.id,row.revision).text).name,'renamed');
 await f.port.save(change(f,{},'delete'));assert.equal(f.settings.profileLibraries.length,0);assert.equal(f.saves(),3);
});
test('Library delete fixed package previews and executes auto-load reset; changed auto config invalidates',async()=>{
 const f=fixture();await f.port.save(create(f));const id=f.settings.profileLibraries[0].id;
 f.settings.profileLibraryAutoLoad={enabled:true,mode:'fixed',fixedId:id};
 let draft=change(f,{},'delete');assert.equal(draft.autoAfter.enabled,false);assert.match(draft.warnings.join(''),/固定加载目标/);
 f.settings.profileLibraryAutoLoad.enabled=false;await assert.rejects(f.port.save(draft),/INVALID/);assert.equal(f.saves(),1);
 draft=change(f,{},'delete');assert.equal((await f.port.save(draft)).status,'saved_unconfirmed');assert.equal(f.settings.profileLibraryAutoLoad.fixedId,'');
});
test('Library queue guards stale package and stale settings object before writing',async()=>{
 const wait=gate(),started=gate();let hold=false;const f=fixture(()=>{if(hold){started.resolve();return wait.promise;}});
 await f.port.save(create(f));hold=true;const blocking=f.system.updateAutoLoadSettings({enabled:false});await started.promise;
 const saving=f.port.save(change(f,{description:'proposal'}));f.settings.profileLibraries[0].description='concurrent';
 wait.resolve();await blocking;await assert.rejects(saving,/STALE/);
 const port=createProfileLibraryPort({getSettings:()=>({}),system:f.system});await assert.rejects(port.save(port.preview({operation:'create',changes:{name:'another',exportData:data()}})),/STALE/);
});
test('Library failed update restores unchanged proposal fields and preserves concurrent edits',async()=>{
 const wait=gate(),started=gate();let hold=false;const f=fixture(()=>{if(hold){started.resolve();return wait.promise;}});
 await f.port.save(create(f));hold=true;const d=data();d.profiles[0].profile.note='proposal';
 const pending=f.port.save(change(f,{description:'proposal',exportData:d}));await started.promise;
 f.settings.profileLibraries[0].description='concurrent';f.settings.other='keep';wait.reject(Error('failed'));
 assert.equal((await pending).status,'outcome_unknown');assert.equal(f.settings.profileLibraries[0].description,'concurrent');
 assert.equal(f.settings.profileLibraries[0].exportData.profiles[0].profile.note,'PRIVATE_BODY');assert.equal(f.settings.other,'keep');
});
test('Library replacement during save is unknown and never overwritten',async()=>{
 const wait=gate(),started=gate();const f=fixture(()=>{started.resolve();return wait.promise;});
 const pending=f.port.save(create(f));await started.promise;const replacement=[];f.settings.profileLibraries=replacement;wait.reject(Error('failed'));
 assert.equal((await pending).status,'outcome_unknown');assert.equal(f.settings.profileLibraries,replacement);
});
test('Library exact approval yields v14 metadata-only receipt and cannot repeat',async()=>{
 const f=fixture(),content=create(f),artifact={id:'a',revision:1,sessionId:'s',kind:'profile-library-draft',content};
 const actions=createProfileLibraryActions({getArtifact:()=>artifact,validate:()=>f.port.assertDraft(content),getTarget:()=>({kind:'global'}),writer:f.port});
 const a=actions.prepare('a',1);assert.equal(f.saves(),0);const result=await actions.approve(a.id);assert.throws(()=>actions.approve(a.id),/STALE/);
 const receipt=actionReceipt(result);assert.equal(receipt.version,14);assert.doesNotMatch(receiptContext([receipt]),/PRIVATE_BODY|Alice/);
 const doc={createElement:tag=>({tag,children:[],append(e){this.children.push(e);}})},card=doc.createElement('div');
 renderProfileLibrarySave({doc,card,artifact,state:{},controller:{},act:fn=>fn(),lang:'en'});assert.ok(card.children.some(e=>e.tag==='details'));
});
test('Library read/export use shared budget and obsolete candidates cannot publish',async()=>{
 const f=fixture();await f.port.save(create(f));const r=f.port.list().items[0],module=createProfileLibraryModule({port:f.port,charge:()=>false});
 assert.throws(()=>module.handlers['muyu.libraries.export']({id:r.id,revision:r.revision},{runId:'r'}),/BUDGET/);
 const target={kind:'global'};module.bindRun({id:'r',taskId:'t',target});
 const candidate=module.handlers['muyu.libraries.preview']({operation:'create',changesJson:JSON.stringify({name:'other',exportData:data()})},{runId:'r',target});
 assert.throws(()=>module.handlers['muyu.libraries.preview']({operation:'create',changesJson:'{}'},{runId:'r',target}));
 assert.throws(()=>module.publishDraft({snapshot:()=>({runs:[]})},'r',candidate.candidateId),/CANDIDATE/);
});
