import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomPromptsSystem } from '../../systems/custom-prompts-system.js';
import { createCustomPromptPort } from '../../muyu/host/custom-prompts.js';
import { createCustomPromptModule } from '../../muyu/modules/custom-prompts/index.js';
import { createCustomPromptActions } from '../../muyu/actions/custom-prompt-save.js';
import { actionReceipt, receiptContext, validateReceipt } from '../../muyu/actions/receipts.js';
import { validateCustomPromptExport } from '../../systems/custom-prompt-validation.js';
import { renderCustomPromptSave } from '../../muyu/ui/custom-prompt-save-view.js';
const gate = () => { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; };
function fixture(save=()=>{}) {
 const settings={},registry=new Map();let saves=0;
 const system=createCustomPromptsSystem({settings,saveSettings:()=>{saves++;return save();},getProviders:()=>[...registry.values()],registerProvider:p=>registry.set(p.id,p),unregisterProvider:id=>registry.delete(id),log(){}});
 const port=createCustomPromptPort({getSettings:()=>settings,system});
 return {settings,system,port,registry,saves:()=>saves};
}
const create=(name,extra={})=>({operation:'create',changes:{name,content:'PRIVATE_'+name,...extra}});
const requests=f=>f.port.list().items.map(r=>({operation:'update',id:r.id,revision:r.revision,changes:{content:'new_'+r.name}}));
test('Prompt batch creates once, updates omitted fields, deletes and rejects duplicate targets/names',async()=>{
 const f=fixture(),draft=f.port.previewBatch([create('a'),create('b',{enabled:true})]);assert.deepEqual(f.settings,{});
 assert.equal((await f.port.save(draft)).status,'saved_unconfirmed');assert.equal(f.saves(),1);assert.equal(f.registry.size,1);
 const req=requests(f);assert.throws(()=>f.port.previewBatch([req[0],req[0]]),/BATCH/);
 assert.throws(()=>f.port.previewBatch([create('z'),create('z')]),/BATCH/);
 assert.throws(()=>f.port.previewBatch([{...req[0],changes:{name:'b'}}]),/CONFLICT/);
 await f.port.save(f.port.previewBatch([req[0],{...req[1],operation:'delete',changes:{}},create('c')]));
 assert.equal(f.saves(),2);assert.deepEqual(f.settings.customPrompts.map(r=>r.name),['a','c']);assert.equal(f.registry.size,0);
});
test('Prompt import is closed, bounded, conflict explicit and replacement disabled with stable ID',async()=>{
 const f=fixture();await f.system.add('a','old',true);const id=f.settings.customPrompts[0].id;
 const data={type:'custom-prompt-export',version:1,prompts:[{name:'a',content:'new',enabled:true},{name:'b',enabled:true}]};
 assert.throws(()=>f.port.previewImport(data),/EXISTS/);
 const skipped=f.port.previewImport(data,'skip');assert.deepEqual(skipped.skipped,['a']);assert.equal(skipped.entries.length,1);
 const draft=f.port.previewImport(data,'replace');assert.ok(draft.entries.every(e=>!e.next.enabled));
 await f.port.save(draft);assert.equal(f.settings.customPrompts[0].id,id);assert.equal(f.registry.size,0);assert.equal(f.saves(),2);
 assert.throws(()=>f.port.previewImport(data,'skip'),/NO_CHANGES/);
 for(const bad of [{...data,version:2},{...data,prompts:[{name:'a',id:'forged'}]},{...data,prompts:Array(7).fill({name:'a'})}])assert.throws(()=>f.port.previewImport(bad));
 assert.throws(()=>f.port.previewBatch([create('x',{content:'中'.repeat(5000)}),create('y',{content:'中'.repeat(5000)})]));
});
test('Prompt batch rechecks version and names inside queue before mutation',async()=>{
 const wait=gate(),started=gate();let hold=false;const f=fixture(()=>{if(hold){started.resolve();return wait.promise;}});
 await f.port.save(f.port.previewBatch([create('a'),create('b')]));hold=true;
 const blocking=f.system.add('other','',false);await started.promise;
 const saving=f.port.save(f.port.previewBatch(requests(f).slice(0,2)));f.settings.customPrompts[1].content='concurrent';
 wait.resolve();await blocking;await assert.rejects(saving,/STALE/);assert.equal(f.settings.customPrompts[0].content,'PRIVATE_a');
});
test('Prompt rejected batch save restores own changes but preserves concurrent edits and deletion order',async()=>{
 const wait=gate(),started=gate();let hold=false;const f=fixture(()=>{if(hold){started.resolve();return wait.promise;}});
 await f.port.save(f.port.previewBatch(['a','b','c','d'].map(n=>create(n))));const r=requests(f);
 hold=true;const saving=f.port.save(f.port.previewBatch([{...r[0],operation:'delete',changes:{}},{...r[1],operation:'delete',changes:{}},r[2],create('e')]));
 await started.promise;f.settings.customPrompts.find(e=>e.name==='c').content='concurrent';f.settings.customPrompts.find(e=>e.name==='d').content='unrelated';
 wait.reject(Error('failure'));assert.equal((await saving).status,'outcome_unknown');
 assert.deepEqual(f.settings.customPrompts.map(e=>e.name),['a','b','c','d']);assert.equal(f.settings.customPrompts[2].content,'concurrent');assert.equal(f.settings.customPrompts[3].content,'unrelated');
});
test('Prompt batch successful save with concurrent mutation is not exact success',async()=>{
 const wait=gate(),started=gate();const f=fixture(()=>{started.resolve();return wait.promise;});
 const saving=f.port.save(f.port.previewBatch([create('a')]));await started.promise;f.settings.customPrompts[0].content='later';wait.resolve();
 assert.equal((await saving).status,'outcome_unknown');
});
test('Prompt exports exact saved definitions without IDs; rejects stale, duplicate and oversized exports',async()=>{
 const f=fixture();await f.port.save(f.port.previewBatch([create('a',{dataJson:'{"v":1}'}),create('b')]));
 const targets=f.port.list().items.map(({id,revision})=>({id,revision})),before=f.saves(),data=f.port.exportEntries(targets);
 assert.equal(validateCustomPromptExport(data).length,2);assert.equal(f.saves(),before);assert.equal(data.prompts[0].id,undefined);
 assert.throws(()=>f.port.exportEntries([targets[0],targets[0]]),/EXPORT/);
 f.settings.customPrompts[0].content='changed';assert.throws(()=>f.port.exportEntries(targets),/STALE/);
 const target=f.port.list().items[0];f.settings.customPrompts[0].content='中'.repeat(8000);const fresh=f.port.list().items[0];
 assert.throws(()=>f.port.exportEntries([{id:fresh.id,revision:fresh.revision}]),/TOO_LARGE/);
 const module=createCustomPromptModule({port:f.port,charge:()=>false});
 assert.throws(()=>module.handlers['muyu.prompts.export']({targets:[targets[1]]},{runId:'r'}),/BUDGET/);
});
test('Prompt batch v13 exact approval and UI show every item, receipt excludes private content',async()=>{
 const f=fixture(),content=f.port.previewBatch([create('a'),create('b')]),artifact={id:'a',revision:1,sessionId:'s',kind:'custom-prompt-draft',content};
 const actions=createCustomPromptActions({getArtifact:()=>artifact,validate:()=>f.port.assertDraft(content),getTarget:()=>({kind:'global'}),writer:f.port});
 const approval=actions.prepare('a',1),result=await actions.approve(approval.id);assert.equal(f.saves(),1);assert.throws(()=>actions.approve(approval.id),/STALE/);
 const receipt=actionReceipt(result);assert.equal(receipt.version,13);assert.deepEqual(validateReceipt(receipt),receipt);assert.equal(receipt.items.length,2);assert.doesNotMatch(receiptContext([receipt]),/PRIVATE_/);
 const doc={createElement:tag=>({tag,children:[],append(e){this.children.push(e);}})},card=doc.createElement('div');
 renderCustomPromptSave({doc,card,artifact,state:{},controller:{},act:fn=>fn(),lang:'en'});assert.equal(card.children.filter(e=>e.tag==='details').length,2);
});
test('Prompt skipped import clears prior candidate without requesting save',async()=>{
 const f=fixture();await f.system.add('a','',false);
 const module=createCustomPromptModule({port:f.port}),target={kind:'global'},ctx={runId:'r',target};module.bindRun({id:'r',taskId:'t',target});
 const first=module.handlers['muyu.prompts.batch_preview']({requestsJson:JSON.stringify([create('b')])},ctx);
 const out=module.handlers['muyu.prompts.import_preview']({exportJson:JSON.stringify({type:'custom-prompt-export',version:1,prompts:[{name:'a'}]}),conflict:'skip',apply:true},ctx);
 assert.equal(JSON.parse(out.text).state,'no_changes');assert.equal(out.applyRequested,undefined);
 assert.throws(()=>module.publishDraft({snapshot:()=>({runs:[]})},'r',first.candidateId),/CANDIDATE/);
});
