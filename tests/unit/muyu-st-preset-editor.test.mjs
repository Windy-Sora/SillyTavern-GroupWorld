import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createStPresetEditor } from '../../muyu/host/st-preset-editor.js';
import { createNativePresetApi } from '../../muyu/host/native-preset-api.js';
import { toolCapability } from '../../muyu/application/capabilities.js';
import { actionReceipt, validateReceipt, receiptContext, receiptText } from '../../muyu/actions/receipts.js';

function fixture(){
    let target={kind:'global',userKey:'page:test'},selected='Alpha',busy=false,editing=false,writes=0,selections=0,onSave,onSelect;
    const original={temperature:1,top_p:0.9,frequency_penalty:0,presence_penalty:0,openai_max_tokens:1000,openai_max_context:32000,prompts:[{identifier:'main',name:'主提示词',role:'system',content:'OLD {{macro}}',extension:'PRIVATE_PROMPT_EXTENSION'}],prompt_order:[{character_id:100001,order:[{identifier:'main',enabled:true}]}],proxy_password:'PRIVATE_SECRET',custom_url:'PRIVATE_URL',extensions:{unknown:'PRIVATE_EXTENSION'}};
    let live=structuredClone(original);live.temperature=0.7;
    const names=['Alpha','Beta'],saved={Alpha:structuredClone(original),Beta:structuredClone(original)};
    saved.Beta.temperature=1.2;
    const manager={getAllPresets:()=>names,getSelectedPresetName:()=>selected,getCompletionPresetByName:name=>saved[name]};
    const ctx={mainApi:'openai',chatCompletionSettings:{bind_preset_to_connection:false},getPresetManager:()=>manager};
    const port=createStPresetEditor({getTarget:()=>target,getContext:()=>ctx,getLive:()=>live,isBusy:()=>busy,isEditing:()=>editing,
        save:async(name,value)=>{writes++;if(onSave)return onSave(name,value);saved[name]=value;if(!names.includes(name))names.push(name);},
        select:async name=>{selections++;if(onSelect)return onSelect(name);selected=name;live=structuredClone(saved[name]);}});
    const read=(selector='preset:0')=>port.read(target,selector,port.list(target).revision,0);
    const draft=(operation='update',extra={})=>{const selector=operation==='save_current'?'current':'preset:0',revision=read(selector).revision;return port.preview(target,{selector,revision,operation,changes:operation==='update'?{parameters:{temperature:1.5}}:{},...extra});};
    return {port,ctx,names,saved,read,draft,target,live:()=>live,selected:()=>selected,writes:()=>writes,selections:()=>selections,setBusy:v=>busy=v,setEditing:v=>editing=v,setSave:v=>onSave=v,setSelect:v=>onSelect=v,setSelected:v=>selected=v,setLive:v=>live=v,setTarget:v=>target=v};
}

test('Preset permissions separate directory and body, and reads never expose unlisted fields',()=>{
    assert.deepEqual(toolCapability('muyu.st_preset.list').sources({}),['source:stPresets']);
    for(const tool of ['read','preview'])assert.deepEqual(toolCapability('muyu.st_preset.'+tool).sources({}),['source:stPresetContent']);
    const f=fixture();assert.equal(f.port.list(f.target).presets[0].selector,'preset:0');assert.match(f.read().text,/温度|OLD/);assert.doesNotMatch(f.read().text,/PRIVATE/);assert.equal(f.writes(),0);
});
for(const operation of ['copy','save_current','update'])test('Preset '+operation+' preserves private unknown data and never activates or edits live settings',async()=>{
    const f=fixture(),oldLive=structuredClone(f.live()),oldSaved=structuredClone(f.saved.Alpha),c=f.draft(operation,operation==='update'?{}:{name:'New preset'});
    assert.equal(f.writes(),0);assert.doesNotMatch(JSON.stringify(c),/PRIVATE_SECRET|PRIVATE_URL|PRIVATE_EXTENSION|PRIVATE_PROMPT_EXTENSION/);
    assert.equal((await f.port.apply(c)).status,'applied_unconfirmed');assert.equal(f.writes(),1);assert.equal(f.selections(),0);assert.equal(f.selected(),'Alpha');assert.deepEqual(f.live(),oldLive);
    const result=f.saved[operation==='update'?'Alpha':'New preset'];assert.equal(result.proxy_password,'PRIVATE_SECRET');assert.equal(result.extensions.unknown,'PRIVATE_EXTENSION');
    assert.equal(result.temperature,operation==='update'?1.5:operation==='save_current'?0.7:1);
    if(operation!=='update')assert.deepEqual(f.saved.Alpha,oldSaved);
});
test('Preset prompt-body update retains role, order, unknown metadata and omitted numeric fields',async()=>{
    const f=fixture(),c=f.draft('update',{changes:{prompt:{identifier:'main',content:'NEW {{macro}}'}}});
    assert.equal((await f.port.apply(c)).status,'applied_unconfirmed');assert.equal(f.saved.Alpha.prompts[0].content,'NEW {{macro}}');assert.equal(f.saved.Alpha.prompts[0].role,'system');assert.equal(f.saved.Alpha.prompts[0].extension,'PRIVATE_PROMPT_EXTENSION');assert.equal(f.saved.Alpha.temperature,1);assert.deepEqual(f.saved.Alpha.prompt_order,f.saved.Beta.prompt_order);
});
for(const changes of [{parameters:{temperature:3}},{parameters:{top_p:-1}},{parameters:{openai_max_tokens:1.5}},{parameters:{proxy_password:0}},{parameters:{missing:1}},{prompt:{identifier:'main',content:'new',role:'user'}},{prompt:{identifier:'missing',content:'new'}},{prompt:{identifier:'main',content:'x'.repeat(12001)}},{order:[]},{}])test('Preset strict edit contract rejects '+JSON.stringify(changes).slice(0,80),()=>{
    const f=fixture();assert.throws(()=>f.draft('update',{changes}),/INVALID_PRESET/);assert.equal(f.writes(),0);
});
test('Preset rejects no-op, missing numeric baseline, markers and duplicate identifiers',()=>{
    const f=fixture();assert.throws(()=>f.draft('update',{changes:{parameters:{temperature:1}}}),/EMPTY_CHANGES/);
    delete f.saved.Alpha.top_p;assert.throws(()=>f.draft('update',{changes:{parameters:{top_p:0.5}}}),/INVALID/);
    f.saved.Alpha.prompts[0].marker=true;assert.throws(()=>f.draft('update',{changes:{prompt:{identifier:'main',content:'new'}}}),/INVALID/);
    f.saved.Alpha.prompts.push(structuredClone(f.saved.Alpha.prompts[0]));assert.throws(()=>f.read(),/UNSUPPORTED/);
});
for(const name of ['Alpha','Ａｌｐｈａ','../bad','CON','trailing.','', 'x'.repeat(81)])test('Preset new name refuses unsafe/conflicting name '+name,()=>{const f=fixture();assert.throws(()=>f.draft('copy',{name}),/NAME_CONFLICT/);assert.equal(f.writes(),0);});
test('Preset selection requires explicit live replacement and verifies actual projected runtime, not just dropdown name',async()=>{
    const f=fixture();assert.throws(()=>f.draft('select'),/REPLACE_REQUIRED/);const c=f.draft('select',{replaceCurrent:true});assert.equal(c.before.projection.parameters[0].value,0.7);assert.equal(c.after.projection.parameters[0].value,1);
    assert.equal((await f.port.apply(c)).status,'applied_unconfirmed');assert.equal(f.selections(),1);assert.equal(f.writes(),0);assert.equal(f.live().temperature,1);
    const g=fixture(),d=g.draft('select',{replaceCurrent:true});g.setSelect(name=>g.setSelected(name));assert.equal((await g.port.apply(d)).status,'outcome_unknown');assert.equal(g.selections(),1);
});
test('Preset selection guards editor, connection binding and legacy auto-migration before writes',async()=>{
    for(const mode of ['editor','bound','missing-bind','legacy']){const f=fixture(),c=f.draft('select',{replaceCurrent:true});if(mode==='editor')f.setEditing(true);if(mode==='bound')f.ctx.chatCompletionSettings.bind_preset_to_connection=true;if(mode==='missing-bind')delete f.ctx.chatCompletionSettings.bind_preset_to_connection;if(mode==='legacy')f.saved.Alpha.main_prompt='legacy';await assert.rejects(()=>f.port.apply(c),/PRESET_|STALE/);assert.equal(f.selections(),0);}
    const f=fixture();f.saved.Alpha.main_prompt='legacy';assert.throws(()=>f.draft('select',{replaceCurrent:true}),/MIGRATION/);
});
test('Preset stale saved values, names, target, live state and cleared tickets block before execution',async()=>{
    for(const mode of ['saved','directory','target','clear','live']){const f=fixture(),c=f.draft(mode==='live'?'select':'update',mode==='live'?{replaceCurrent:true}:{});if(mode==='saved')f.saved.Alpha.temperature=0.2;if(mode==='directory')f.names.push('Other');if(mode==='target')f.setTarget({kind:'global',userKey:'other'});if(mode==='clear')f.port.clear();if(mode==='live')f.live().temperature=0.2;await assert.rejects(()=>f.port.apply(c),/STALE|TARGET/);assert.equal(f.writes()+f.selections(),0);}
});
test('Preset busy and unsupported API fail closed; save failure consumes ticket without retry or rollback',async()=>{
    const f=fixture(),c=f.draft();f.setBusy(true);await assert.rejects(()=>f.port.apply(c),/BUSY/);f.setBusy(false);f.ctx.mainApi='textgenerationwebui';assert.throws(()=>f.read(),/UNSUPPORTED/);f.ctx.mainApi='openai';f.setSave(()=>{f.saved.Alpha.temperature=1.5;throw Error('network');});assert.equal((await f.port.apply(c)).status,'outcome_unknown');assert.equal(f.saved.Alpha.temperature,1.5);await assert.rejects(()=>f.port.apply(c),/STALE/);assert.equal(f.writes(),1);
});
test('Preset clears during write and host-side selection changes return unknown without reverting',async()=>{
    for(const mode of ['clear','selection']){const f=fixture(),c=f.draft();f.setSave((name,value)=>{f.saved[name]=value;mode==='clear'?f.port.clear():f.setSelected('Beta');});assert.equal((await f.port.apply(c)).status,'outcome_unknown');assert.equal(f.writes(),1);assert.equal(f.saved.Alpha.temperature,1.5);}
});
test('Preset directory pages, Unicode body offsets and complete draft capacity are bounded',()=>{
    const f=fixture();for(let i=0;i<30;i++)f.names.push('Name '+i);assert.equal(f.port.list(f.target).presets.length,20);assert.equal(f.port.list(f.target).nextOffset,20);assert.equal(f.port.list(f.target,20).presets[0].selector,'preset:20');assert.throws(()=>f.port.list(f.target,-1),/INVALID/);
    f.saved.Alpha.prompts[0].content='😀'.repeat(3500);const r=f.read();assert.equal(r.text.charCodeAt(r.text.length-1)>=0xD800&&r.text.charCodeAt(r.text.length-1)<=0xDBFF,false);assert.ok(r.nextOffset>0);assert.ok(f.port.read(f.target,'preset:0',r.revision,r.nextOffset).text);
    f.saved.Alpha.prompts[0].content='长'.repeat(11000);assert.throws(()=>f.draft('copy',{name:'New'}),/limit|TOO_LARGE/);assert.equal(f.writes(),0);
});

function nativeFixture(){const events=new EventEmitter(),presets=[{temperature:1}],preset_names={Alpha:0};let selected='0',requests=[],onRequest,onSelect;
    const select={value:'0',ownerDocument:{createElement:()=>({})},options:[],append(option){this.options.push(option);this.value=option.value;}};
    const manager={getPresetList:()=>({presets,preset_names}),findPreset:name=>Object.hasOwn(preset_names,name)?String(preset_names[name]):undefined,selectPreset:value=>{selected=value;onSelect?.(value);}};
    const ctx={getPresetManager:()=>manager,eventTypes:{PRESET_CHANGED:'preset'},eventSource:events};
    const api=createNativePresetApi({getContext:()=>ctx,getHeaders:()=>({'x-csrf':'token'}),getSelect:()=>select,timeoutMs:15,fetch:async(url,request)=>{requests.push({url,...request});return onRequest?onRequest():{ok:true,json:async()=>({name:JSON.parse(request.body).name})};}});
    return{api,ctx,events,presets,preset_names,select,requests,selected:()=>selected,setRequest:v=>onRequest=v,setSelect:v=>onSelect=v};
}
test('Native preset save uses official route and cache only; append never selects or emits change',async()=>{
    const f=nativeFixture();await f.api.save('New',{temperature:1.2});assert.equal(f.select.value,'0');assert.equal(f.selected(),'0');assert.equal(f.preset_names.New,1);assert.equal(f.select.options[0].textContent,'New');assert.deepEqual(JSON.parse(f.requests[0].body),{apiId:'openai',name:'New',preset:{temperature:1.2}});assert.equal(f.requests[0].url,'/api/presets/save');assert.equal(f.requests[0].headers['x-csrf'],'token');
    await f.api.save('Alpha',{temperature:0.5});assert.equal(f.presets[0].temperature,0.5);assert.equal(f.select.options.length,1);
});
test('Native preset late response never overwrites concurrently changed local cache',async()=>{
    const f=nativeFixture();f.setRequest(()=>{f.presets[0].temperature=0.2;return{ok:true,json:async()=>({name:'Alpha'})};});await assert.rejects(()=>f.api.save('Alpha',{temperature:1.5}),/CACHE_CHANGED/);assert.equal(f.presets[0].temperature,0.2);assert.equal(f.requests.length,1);
});
test('Native preset failed/nonmatching save response never claims cache success',async()=>{
    for(const result of [{ok:false},{ok:true,json:async()=>({name:'Other'})}]){const f=nativeFixture();f.setRequest(()=>result);await assert.rejects(()=>f.api.save('New',{}),/UNKNOWN/);assert.equal(f.presets.length,1);assert.equal(f.requests.length,1);}
});
test('Native preset selection waits for matching official after event and cleans listener',async()=>{
    const f=nativeFixture();f.setSelect(value=>{assert.equal(value,'0');f.events.emit('preset',{apiId:'openai',name:'Other'});setTimeout(()=>f.events.emit('preset',{apiId:'openai',name:'Alpha'}),2);});await f.api.select('Alpha');assert.equal(f.events.listenerCount('preset'),0);
    const g=nativeFixture();await assert.rejects(()=>g.api.select('Alpha'),/UNKNOWN/);assert.equal(g.events.listenerCount('preset'),0);assert.throws(()=>g.api.select('Missing'),/UNAVAILABLE/);
});
test('Preset receipts restore without names, secrets, Prompt or changes; selectors remain operation-specific',()=>{
    const receipt=actionReceipt({id:'st-preset:x',artifactId:'a',revision:1,status:'applied_unconfirmed',content:{module:'st-preset-editor',selector:'preset:1',operation:'select',name:'PRIVATE_NAME',after:{password:'PRIVATE_SECRET'}},result:{resourceSave:'unconfirmed'}});
    assert.equal(receipt.version,34);assert.deepEqual(validateReceipt(receipt),receipt);assert.match(receiptContext([receipt]),/historical/i);assert.match(receiptText(receipt,'zh'),/预设/);assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE|name|after/);assert.throws(()=>validateReceipt({...receipt,selector:'current'}),/INVALID/);assert.equal(validateReceipt({...receipt,selector:'current',operation:'save_current'}).selector,'current');
});
