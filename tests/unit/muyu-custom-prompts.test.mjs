import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomPromptsSystem } from '../../systems/custom-prompts-system.js';
import { createCustomPromptPort } from '../../muyu/host/custom-prompts.js';
import { createCustomPromptModule } from '../../muyu/modules/custom-prompts/index.js';
import { createCustomPromptActions } from '../../muyu/actions/custom-prompt-save.js';
import { actionReceipt, receiptContext, validateReceipt } from '../../muyu/actions/receipts.js';
import { requiredSources } from '../../muyu/application/capabilities.js';
import { renderCustomPromptSave } from '../../muyu/ui/custom-prompt-save-view.js';
const gate = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
function fixture(saveSettings = async () => {}) {
    const settings = {}, providers = new Map();
    const system = createCustomPromptsSystem({ settings, saveSettings, log() {}, getProviders: () => [...providers.values()],
        registerProvider: p => providers.set(p.id,p), unregisterProvider: (id, options) => { const p=providers.get(id); if(p?._gdOwner === options.owner && p?._gdOwnerId === options.ownerId) providers.delete(id); } });
    const port=createCustomPromptPort({getSettings:()=>settings,system});
    return {settings,providers,system,port};
}
const def={name:'coins_prompt',content:'PRIVATE_PROMPT {{other}}',dataJson:'{"gold":10}',scope:'character'};
const create = f => f.port.preview({operation:'create',changes:def});
const change = (f,changes,operation='update') => {const r=f.port.list().items[0];return f.port.preview({operation,id:r.id,revision:r.revision,changes});};
test('Prompt preview is read-only, defaults disabled, validates closed fields and metadata scope',()=>{
    const f=fixture();assert.deepEqual(f.port.list().items,[]);const d=create(f);assert.equal(d.next.enabled,false);assert.deepEqual(f.settings,{});
    assert.match(d.warnings.join(''),/不隔离/);assert.deepEqual(requiredSources('muyu.prompts.preview'),['source:customPromptAssets']);
    for(const changes of [null,[],{...def,id:'forged'},{...def,apiKey:'secret'},{...def,enabled:'true'},{...def,dataJson:'3'},{...def,scope:'private'},{...def,name:'a b'}])
        assert.throws(()=>f.port.preview({operation:'create',changes}));
    assert.throws(()=>f.port.preview({operation:'create',changes:{...def,content:'中'.repeat(10000)}}),/TOO_LARGE/);
    assert.throws(()=>f.port.preview({operation:'create',changes:{...def,name:'char'}}),/CONFLICT/);
});
test('Prompt CRUD enables owned Provider, preserves omitted fields, renames and deletes without changing master',async()=>{
    const f=fixture();await f.port.save(create(f));assert.equal(f.providers.size,0);
    await f.port.save(change(f,{enabled:true}));assert.equal(f.providers.get(def.name)._gdOwner,'group-director/custom-prompt');
    assert.equal(f.settings.customPrompts[0].content,def.content);
    await f.port.save(change(f,{name:'renamed'}));assert.equal(f.providers.has(def.name),false);assert.ok(f.providers.has('renamed'));
    f.settings.customPromptsEnabled=false;
    await f.port.save(change(f,{content:'changed'}));assert.equal(f.providers.size,0);assert.equal(f.settings.customPromptsEnabled,false);
    await f.port.save(change(f,{},'delete'));assert.equal(f.settings.customPrompts.length,0);
});
test('Prompt rejects system Provider collisions including disabled entries and later collisions',async()=>{
    const f=fixture(),draft=create(f); f.providers.set(def.name,{id:def.name,_gdOwner:'builtin'});
    await assert.rejects(f.port.save(draft),/CONFLICT/);assert.deepEqual(f.settings,{});
    f.providers.clear();await f.port.save(draft);assert.throws(()=>create(f),/CONFLICT/);
});
test('Prompt revision reads paginate; in-place and same-content replacement invalidate',async()=>{
    const f=fixture();await f.system.add(def.name,'x'.repeat(20000),false);
    let row=f.port.list().items[0];assert.equal(f.port.read(row.id,row.revision).nextOffset,8000);
    assert.throws(()=>change(f,{enabled:true}),/UNSUPPORTED/);
    f.settings.customPrompts[0].content='short';assert.throws(()=>f.port.read(row.id,row.revision),/STALE/);
    row=f.port.list().items[0];f.settings.customPrompts[0]={...f.settings.customPrompts[0]};assert.throws(()=>f.port.read(row.id,row.revision),/STALE/);
    assert.throws(()=>f.port.list(-1),/ARGUMENTS/);
});
test('Prompt approval revalidates inside business queue after a GUI mutation',async()=>{
    const wait=gate(),started=gate();let hold=false;const f=fixture(()=>{if(hold){started.resolve();return wait.promise;}});
    await f.port.save(create(f));hold=true;
    const blocking=f.system.add('other','',false);await started.promise;
    const saving=f.port.save(change(f,{content:'proposal'}));f.settings.customPrompts[0].content='concurrent';
    wait.resolve();await blocking;await assert.rejects(saving,/STALE/);assert.equal(f.settings.customPrompts[0].content,'concurrent');
});
test('Prompt save failure retains concurrent edits and reports uncertainty',async()=>{
    const wait=gate(),started=gate();let hold=false;const f=fixture(()=>{if(hold){started.resolve();return wait.promise;}});
    await f.port.save(create(f));hold=true;const saving=f.port.save(change(f,{content:'proposal',enabled:true}));
    await started.promise;f.settings.customPrompts[0].content='concurrent';wait.reject(Error('failed'));
    assert.equal((await saving).status,'outcome_unknown');assert.equal(f.settings.customPrompts[0].content,'concurrent');assert.equal(f.settings.customPrompts[0].enabled,false);assert.equal(f.providers.size,0);
});
test('Prompt concurrent successful save and replaced settings do not claim current success',async()=>{
    const wait=gate(),started=gate();let hold=false;const f=fixture(()=>{if(hold){started.resolve();return wait.promise;}});
    await f.port.save(create(f));hold=true;const saving=f.port.save(change(f,{content:'proposal'}));await started.promise;
    f.settings.customPrompts[0].content='concurrent';wait.resolve();assert.equal((await saving).status,'outcome_unknown');
    const replacement={},port=createCustomPromptPort({getSettings:()=>replacement,system:f.system});
    await assert.rejects(port.save(port.preview({operation:'create',changes:{name:'new'}})),/STALE/);
});
test('Prompt approval is exact and one-shot; receipt omits content/data',async()=>{
    const f=fixture(),content=create(f),artifact={id:'a',revision:1,sessionId:'s',kind:'custom-prompt-draft',content};
    const actions=createCustomPromptActions({getArtifact:()=>artifact,validate:()=>f.port.assertDraft(content),getTarget:()=>({kind:'global'}),writer:f.port});
    const a=actions.prepare('a',1);assert.deepEqual(f.settings,{});
    const result=await actions.approve(a.id);assert.equal(result.status,'saved_unconfirmed');assert.throws(()=>actions.approve(a.id),/STALE/);
    const receipt=actionReceipt(result);assert.equal(receipt.version,12);assert.deepEqual(validateReceipt(receipt),receipt);assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE_PROMPT|gold/);assert.match(receiptContext([receipt]),/Custom Prompt/);
});
test('Prompt module charges reads, clears failed candidates and binds exact task',()=>{
    const f=fixture(),module=createCustomPromptModule({port:f.port,charge:()=>false}),target={kind:'global'};
    assert.throws(()=>module.handlers['muyu.prompts.list']({}, {runId:'r'}),/BUDGET/);
    module.bindRun({id:'r',taskId:'t',target});const draft=module.handlers['muyu.prompts.preview']({operation:'create',changesJson:JSON.stringify(def)},{runId:'r',target});
    assert.throws(()=>module.transferRun('r',{id:'r2',taskId:'other',target}),/TRANSFER/);
    module.transferRun('r',{id:'r2',taskId:'t',target});
    assert.throws(()=>module.handlers['muyu.prompts.preview']({operation:'create',changesJson:'{}'},{runId:'r2',target}));
    assert.throws(()=>module.publishDraft({snapshot:()=>({runs:[]})},'r2',draft.candidateId),/CANDIDATE/);
});
test('Prompt confirmation uses text nodes and never renders content',()=>{
    const f=fixture(),content=f.port.preview({operation:'create',changes:{...def,content:'<script>unsafe</script>'}});
    const doc={createElement:tag=>({tag,children:[],append(e){this.children.push(e);}})},card=doc.createElement('div');let approved=0;
    renderCustomPromptSave({doc,card,artifact:{id:'a',revision:1,content},state:{canSaveCustomPrompt:true,customPromptActions:[{id:'b',artifactId:'a',revision:1,status:'pending'}]},controller:{approveCustomPromptSave(){approved++;}},act:fn=>fn(),lang:'en'});
    assert.equal(approved,0);card.children.find(e=>e.textContent==='Confirm this operation').onclick();assert.equal(approved,1);
});
