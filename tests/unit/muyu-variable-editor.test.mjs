import test from 'node:test';
import assert from 'node:assert/strict';
import {createVariableEditorPort} from '../../muyu/host/variable-editor.js';
import {createVariableWriter} from '../../muyu/host/variable-write.js';
import {createVariableActions} from '../../muyu/actions/variable-apply.js';
import {createVariableSystem} from '../../systems/variable-system.js';
import {createVariableEditorModule} from '../../muyu/modules/variable-editor/index.js';
import {actionReceipt,receiptContext,validateReceipt} from '../../muyu/actions/receipts.js';
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function fixture(save=()=>{}) {
 let metadata={},settings={},target={kind:'chat',chatKey:'A'},busy=false,saves=0;
 let chars=[{avatar:'a.png',name:'Alice'},{avatar:'b.png',name:'Bob'}],group={members:['a.png','b.png'],disabled_members:[]};
 const port=createVariableEditorPort({getTarget:()=>target,getMetadata:()=>metadata,getSettings:()=>settings,getCharacters:()=>chars,getGroup:()=>group,extensionKey:'gd',
 isBusy:()=>busy,saveChatConfirmed:async m=>{assert.equal(m,metadata);saves++;await save();}});
 const preview=(operation,changes={},character='')=>{const row=port.list(target).items.find(r=>r.id==='x');return port.preview(target,{operation,id:'x',revision:operation==='create'?'':row?.revision,changes,character});};
 const create=async(type='number',scope='global',value=0,extra={})=>{const d=preview('create',{label:'GUI label',type,scope,defaultValue:value,...extra});await port.apply(d);return d;};
 return {port,preview,create,target:()=>target,get metadata(){return metadata;},get settings(){return settings;},get chars(){return chars;},group,
 switchChat:()=>target={...target,chatKey:'B'},replace:()=>metadata=structuredClone(metadata),replaceSettings:()=>settings={...settings},busy:()=>busy=true,saves:()=>saves};
}
for(const [type,value]of [['number',0],['boolean',false],['string','hello'],['enum','red'],['array',['a']],['object',{a:1}]])test('Variable editor '+type+' CRUD keeps typed values and current-chat scope',async()=>{
 const f=fixture(),extra=type==='enum'?{enumValues:['red','blue']}:{};
 const draft=f.preview('create',{label:'GUI label',type,scope:'global',defaultValue:value,...extra});
 assert.deepEqual(f.metadata,{});assert.equal(f.saves(),0);await f.port.apply(draft);
 assert.deepEqual(f.metadata.gd.variables.values.global.x,value);
 const update=f.preview('update',{label:'renamed',rule:'PRIVATE_RULE'});await f.port.apply(update);
 assert.equal(f.metadata.gd.variables.defs[0].label,'renamed');
 const row=f.port.list(f.target()).items[0];assert.equal(JSON.parse(f.port.read(f.target(),row.id,row.revision).text).variable.definition.rule,'PRIVATE_RULE');
 await f.port.apply(f.preview('delete'));assert.deepEqual(f.metadata.gd.variables.defs,[]);assert.equal(f.metadata.gd.variables.values.global.x,undefined);
});
test('Variable editor exact replacement and explicit delta/append/merge follow real setValue',async()=>{
 for(const [type,initial,value,mode,expected]of [['number',20,3,'replace',3],['number',20,-3,'delta',17],['array',['a'],['b'],'append',['a','b']],['object',{a:1},{b:2},'merge',{a:1,b:2}],['string','a','b','append','a\nb']]){
  const f=fixture();await f.create(type,'global',initial,type==='number'?{min:0}:{});const d=f.preview('set_value',{value,updateMode:mode});
  const m={gd:{variables:structuredClone(f.metadata.gd.variables)}};const real=createVariableSystem({getChatMetadata:()=>m,EXT_KEY:'gd',saveChatConditional(){},getChat:()=>[]});
  assert.equal(real.setValue('x',value,{updateMode:mode}).ok,true);
  assert.deepEqual(d.after.global.value,m.gd.variables.values.global.x);await f.port.apply(d);
  assert.deepEqual(f.metadata.gd.variables.values.global.x,expected);assert.equal(f.metadata.gd.variables.log.at(-1).source,'manual');
 }
});
test('Variable editor finite large numbers use business constraints instead of legacy preview caps',async()=>{
 const f=fixture();await f.create('number','global',1e12,{min:0,max:1e15});
 await f.port.apply(f.preview('set_value',{value:2e12}));assert.equal(f.metadata.gd.variables.values.global.x,2e12);
});
test('Variable editor character selectors bind exact available identity and preserve other roles',async()=>{
 const f=fixture();await f.create('array','character',[]);await f.port.apply(f.preview('set_value',{value:['Alice']},'character:0'));
 await f.port.apply(f.preview('set_value',{value:['Bob']},'character:1'));
 assert.deepEqual(f.metadata.gd.variables.values.character.x,{'a.png':['Alice'],'b.png':['Bob']});
 f.group.disabled_members=['b.png'];assert.throws(()=>f.preview('set_value',{value:[]},'character:1'),/UNAVAILABLE/);
 assert.throws(()=>f.preview('set_value',{value:[]}),/REQUIRED/);
});
test('Variable editor type change refuses incompatible values until explicit reset; scope loss is visible',async()=>{
 const f=fixture();await f.create('number','global',42);
 assert.throws(()=>f.preview('update',{type:'boolean',defaultValue:false}),/INCOMPATIBLE/);
 const d=f.preview('update',{type:'boolean',defaultValue:false,resetValues:true});assert.equal(d.before.global.value,42);assert.equal(d.after.global.value,false);await f.port.apply(d);
 const c=f.preview('update',{scope:'character'});assert.equal(c.after.global.present,false);await f.port.apply(c);
 assert.equal(f.metadata.gd.variables.values.global.x,undefined);
 await f.port.apply(f.preview('set_value',{value:true},'character:0'));
 const back=f.preview('update',{scope:'global'});assert.equal(back.before.characters['a.png'],true);assert.equal(back.after.characters,null);assert.equal(back.after.global.value,false);
});
test('Variable editor omitted definition fields and unrelated variables survive operations and deletion cleans target log',async()=>{
 const f=fixture();await f.create();const vars=f.metadata.gd.variables;
 vars.defs[0].extra='KEEP';vars.defs.push({id:'other'});vars.values.global.other=99;vars.log=[{id:'x',text:'private'},{id:'other'}];
 await f.port.apply(f.preview('update',{label:'changed'}));assert.equal(vars.defs[0].extra,'KEEP');assert.equal(vars.defs[0].autoUpdate,true);
 await f.port.apply(f.preview('delete'));assert.deepEqual(vars.defs,[{id:'other'}]);assert.equal(vars.values.global.other,99);assert.deepEqual(vars.log,[{id:'other'}]);
});
test('Variable editor rejects prototype keys, implicit coercion, mismatched modes and incomplete enums',async()=>{
 const f=fixture();
 for(const changes of [
  {label:'x',type:'number',scope:'global',defaultValue:'3'},
  {label:'x',type:'enum',scope:'global',defaultValue:'a'},
  {label:'x',type:'boolean',scope:'global',defaultValue:false,updateMode:'delta'},
  {label:'x',type:'number',scope:'global',defaultValue:2,min:5,max:1},
  JSON.parse('{"label":"x","type":"object","scope":"global","defaultValue":{"__proto__":{}}}'),
 ])assert.throws(()=>f.preview('create',changes));
 assert.equal(f.saves(),0);assert.deepEqual(f.metadata,{});
});
test('Variable editor system owner and Blueprint completion signal require dedicated editor',async()=>{
 const f=fixture();f.settings.storyBlueprintCompletionVariable='x';
 assert.throws(()=>f.preview('create',{label:'x',type:'boolean',scope:'global',defaultValue:false}),/SPECIAL/);
 delete f.settings.storyBlueprintCompletionVariable;await f.create();f.metadata.gd.variables.defs[0].owner='system';
 assert.equal(f.port.list(f.target()).items[0].editable,false);assert.throws(()=>f.preview('delete'),/SPECIAL/);
});
for(const cause of ['chat','metadata','settings','value','definition','role','busy','log'])test('Variable editor stale '+cause+' rejects before write',async()=>{
 const f=fixture();await f.create();const d=f.preview('update',{label:'next'});
 if(cause==='chat')f.switchChat();if(cause==='metadata')f.replace();if(cause==='settings')f.replaceSettings();
 if(cause==='value')f.metadata.gd.variables.values.global.x=1;if(cause==='definition')f.metadata.gd.variables.defs[0].rule='new';
 if(cause==='role')f.chars[0].avatar='new.png';if(cause==='busy')f.busy();if(cause==='log')f.metadata.gd.variables.log.push({id:'x'});
 await assert.rejects(f.port.apply(d));assert.equal(f.saves(),1);
});
test('Variable editor private plan is immutable against preview caller tampering',async()=>{
 const f=fixture();await f.create();const d=f.preview('set_value',{value:5});d.after.global.value=999;
 await assert.rejects(f.port.apply(d),/STALE/);assert.equal(f.metadata.gd.variables.values.global.x,0);
});
test('Variable editor asynchronous save failure preserves concurrent edits and consumes approval plan',async()=>{
 const wait=gate(),started=gate();let hold=false;const f=fixture(()=>{if(hold){started.resolve();return wait.promise;}});await f.create('array','global',['before']);hold=true;
 const d=f.preview('set_value',{value:['imported']}),pending=f.port.apply(d);await started.promise;
 f.metadata.gd.variables.values.global.x.push('concurrent');f.metadata.gd.variables.values.global.other=7;wait.reject(Error('offline'));
 assert.equal((await pending).status,'outcome_unknown');assert.deepEqual(f.metadata.gd.variables.values.global.x,['imported','concurrent']);
 assert.equal(f.metadata.gd.variables.values.global.other,7);await assert.rejects(f.port.apply(d));assert.equal(f.saves(),2);
});
test('Variable editor confirmed save followed by selected target changes is partial; other values survive',async()=>{
 const wait=gate(),started=gate();let hold=false;const f=fixture(()=>{if(hold){started.resolve();return wait.promise;}});await f.create();hold=true;
 const d=f.preview('delete'),pending=f.port.apply(d);await started.promise;
 f.metadata.gd.variables.defs.push({id:'x',label:'concurrent'});wait.resolve();assert.equal((await pending).status,'partial');assert.equal(f.metadata.gd.variables.defs[0].label,'concurrent');
});
test('Variable editor uses existing approval coordinator and v20 metadata-only receipt exactly once',async()=>{
 const f=fixture();await f.create('string','global','PRIVATE_VALUE');const content=f.preview('delete'),artifact={id:'a',revision:1,sessionId:'s',kind:'variable-editor-draft',content};
 const writer=createVariableWriter({editorPort:f.port}),actions=createVariableActions({getArtifact:()=>artifact,validate:()=>f.port.assertFresh(content),getTarget:f.target,writer});
 const p=actions.prepare('a',1);assert.equal(f.saves(),1);const r=actionReceipt(await actions.approve(p.id));assert.equal(r.version,20);
 assert.doesNotMatch(receiptContext([r]),/PRIVATE_VALUE/);assert.throws(()=>validateReceipt({...r,value:'PRIVATE_VALUE'}));
 assert.throws(()=>actions.approve(p.id));assert.equal(f.saves(),2);
});
test('Variable editor shared byte budget and full-diff bound fail closed',async()=>{
 const f=fixture();await f.create();const module=createVariableEditorModule({port:f.port,charge:()=>false});
 assert.throws(()=>module.handlers['muyu.variable_editor.list']({}, {runId:'r',target:f.target()}),/BUDGET/);
 module.dispose();
 const g=fixture();assert.throws(()=>g.preview('create',{label:'x',type:'string',scope:'global',defaultValue:'字'.repeat(9000)}));
 assert.equal(g.saves(),0);
});
