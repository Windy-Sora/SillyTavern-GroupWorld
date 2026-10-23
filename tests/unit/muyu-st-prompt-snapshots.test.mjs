import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createStPromptSnapshots } from '../../muyu/host/st-prompt-snapshots.js';
import { createProviderPort } from '../../muyu/host/providers.js';
import { createProviderModule } from '../../muyu/modules/providers/index.js';
import { createPermissions } from '../../muyu/application/permissions.js';
import { assistantToolAccess } from '../../muyu/application/capabilities.js';
import { createStPromptSnapshotsView } from '../../muyu/ui/st-prompt-snapshots-view.js';

function fixture(){let time=1000,target={kind:'chat',userKey:'u',chatKey:'PRIVATE_CHAT'},fail=false;const settings={},events=new EventEmitter();
    const types=['CHAT_COMPLETION_PROMPT_READY','GENERATE_AFTER_COMBINE_PROMPTS','CHAT_CHANGED','MAIN_API_CHANGED','CHATCOMPLETION_SOURCE_CHANGED','CHATCOMPLETION_MODEL_CHANGED'];
    const ctx={eventSource:events,eventTypes:Object.fromEntries(types.map(x=>[x,x])),extensionPrompts:{PRIVATE_KEY:{value:'PRIVATE_INJECTION',position:1,depth:2,scan:true,role:0,filter:()=>{throw Error('must not execute');},headers:{Authorization:'PRIVATE_AUTH'}}}};
    const service=createStPromptSnapshots({getContext:()=>ctx,getTarget:()=>target,getSettings:()=>settings,saveSettings:async()=>{if(fail)throw Error('SECRET');},now:()=>time});
    const port=createProviderPort({getContext:()=>ctx,stPromptSnapshots:service}),module=createProviderModule({providerPort:port,currentTarget:()=>target});
    const read=(id='stPromptText',selector='',revision='',offset=0)=>module.handlers['muyu.provider.read']({id,selector,revision,offset},{runId:'r',target});
    const emit=(chat=[{role:'system',content:'PRIVATE_BODY'}],dryRun=false)=>events.emit('CHAT_COMPLETION_PROMPT_READY',{chat,dryRun,headers:{Authorization:'PRIVATE_AUTH'}});
    return{service,port,module,events,ctx,settings,read,emit,target:()=>target,switch:()=>target={...target,chatKey:'OTHER_CHAT'},restore:()=>target={...target,chatKey:'PRIVATE_CHAT'},noTarget:()=>target=null,advance:ms=>time+=ms,fail:()=>fail=true,close:()=>{service.dispose();module.dispose();}};
}

test('Empty captured prompt directories stop body reads without suggesting nonexistent selectors',async()=>{
    const f=fixture();await f.service.save({enabled:true});
    for(const id of ['stPromptOverview','stPromptText']){
        const root=f.read(id);assert.equal(root.status,'ok');assert.equal(JSON.parse(root.text).available,false);
        assert.equal(root.readHint.recovery,'stop');assert.equal(root.readHint.exampleSelector,'');assert.equal(root.readHint.error.retryable,false);assert.equal(root.readHint.nextRead,undefined);
    }
    f.emit();assert.equal(f.read().readHint.recovery,'none');f.close();
});

test('Snapshot body lengths distinguish original text from retained text and JSON wrapping',async()=>{
    const f=fixture();await f.service.save({enabled:true});f.emit([{role:'system',content:'长'.repeat(20000)}]);
    for(const selector of ['message:0','injection:0']){
        const body=JSON.parse(f.service.read(selector,true).text);assert.equal(body.retainedChars,body.text.length);
        assert.ok(JSON.stringify(body).length>body.retainedChars);
        if(selector==='message:0'){assert.equal(body.chars,20000);assert.equal(body.retainedChars,16000);assert.equal(body.truncated,true);}
    }
    assert.match(f.service.read().text,/不能追溯旧请求/);assert.match(f.service.read().text,/缺席原因未知/);f.close();
});

test('Prompt snapshot capture defaults off and stores only control settings, not private text',async()=>{
    const f=fixture();f.emit();assert.equal(f.service.snapshot().available,false);assert.equal(f.read().status,'SOURCE_DISABLED');
    await f.service.save({enabled:true});assert.equal(f.service.snapshot().available,false);f.emit();assert.equal(f.service.snapshot().available,true);assert.doesNotMatch(JSON.stringify(f.settings),/PRIVATE|blocks|injections/);
    const overview=JSON.stringify(f.service.snapshot());assert.doesNotMatch(overview,/PRIVATE|text|content|headers/);assert.match(overview,/unknown|observed-current-chat/);f.close();
});
test('Metadata and text are independently authorized; presets, messages and diagnostics grants do not expand',async()=>{
    const f=fixture(),permissions=createPermissions();await f.service.save({enabled:true});f.emit();
    for(const source of ['stPresetContent','stDiagnostics','recentMessages','stPromptOverview'])permissions.decide({source,reason:'read',taskId:'t',target:f.target()},'task',()=>{});
    const access=id=>assistantToolAccess({id:'muyu.provider.read',effect:'read'},{id},f.target(),'t',permissions,f.port);
    assert.equal(access('stPromptOverview').decision,true);assert.deepEqual(access('stPromptText').missingSources,['source:stPromptText']);
    permissions.decide({source:'stPromptText',reason:'read',taskId:'t',target:f.target()},'task',()=>{});assert.equal(access('stPromptText').decision,true);
    permissions.forgetTask(f.target(),'t');assert.deepEqual(access('stPromptText').missingSources,['source:stPromptText']);f.close();
});
test('Read overview does not leak slot names, message names, tool calls, attachments or arbitrary event fields',async()=>{
    const f=fixture();await f.service.save({enabled:true});f.emit([{role:'system',content:'PRIVATE_BODY',name:'PRIVATE_NAME',tool_calls:[{function:{arguments:'PRIVATE_ARGUMENTS'}}]},{role:'user',content:[{type:'image_url',image_url:{url:'PRIVATE_URL'}}]}]);
    const root=f.read();assert.equal(root.status,'ok');const data=JSON.parse(f.service.read('',true).text);assert.equal(data.omitted,1);assert.equal(data.blocks[0].toolPayloadOmitted,true);assert.doesNotMatch(root.text,/PRIVATE/);
    const body=f.read('stPromptText','message:0',root.revision);assert.match(body.text,/PRIVATE_BODY/);assert.doesNotMatch(body.text,/PRIVATE_NAME|PRIVATE_ARGUMENTS|PRIVATE_URL|PRIVATE_AUTH/);assert.equal(body.truncated,true);f.close();
});
test('Registered injection is frozen text with filter/position metadata, never filter execution or actual adoption proof',async()=>{
    const f=fixture();await f.service.save({enabled:true});f.emit();const root=f.read();f.ctx.extensionPrompts.PRIVATE_KEY.value='CHANGED';const body=f.read('stPromptText','injection:0',root.revision);
    assert.equal(body.status,'ok');const data=JSON.parse(f.service.read('injection:0',true).text);assert.equal(data.text,'PRIVATE_INJECTION');assert.equal(data.hasFilter,true);assert.equal(data.depth,2);assert.doesNotMatch(JSON.stringify(data),/PRIVATE_AUTH/);assert.match(data.notice,/不证明采用/);f.close();
});
test('Dry run and unknown event origin stay explicit, and text-completion replaces latest snapshot',async()=>{
    const f=fixture();await f.service.save({enabled:true});f.emit(undefined,true);assert.equal(f.service.snapshot().dryRun,true);assert.equal(f.service.snapshot().producer,'unknown');
    f.events.emit('GENERATE_AFTER_COMBINE_PROMPTS',{prompt:'TEXT_PROMPT',dryRun:false});assert.equal(f.service.snapshot().stage,'text-combined');assert.equal(JSON.parse(f.service.read('message:0',true).text).text,'TEXT_PROMPT');assert.equal(f.events.listenerCount('GENERATE_AFTER_DATA'),0);f.close();
});
test('A new event invalidates prior source revision, even if prompt body is unchanged',async()=>{
    const f=fixture();await f.service.save({enabled:true});f.emit();const root=f.read();const old=f.read('stPromptText','message:0',root.revision);f.emit();assert.equal(f.read('stPromptText','message:0',old.revision).status,'STALE_SOURCE');f.close();
});
for(const name of ['CHAT_CHANGED','MAIN_API_CHANGED','CHATCOMPLETION_SOURCE_CHANGED','CHATCOMPLETION_MODEL_CHANGED'])test('Prompt snapshot clears on '+name,async()=>{
    const f=fixture();await f.service.save({enabled:true});f.emit();f.events.emit(name);assert.equal(f.service.snapshot().available,false);f.close();
});
test('Target mismatch, missing chat and retention expiry remove private evidence rather than restoring it',async()=>{
    const f=fixture();await f.service.save({enabled:true});f.emit();f.switch();assert.equal(f.service.snapshot().available,false);f.restore();assert.equal(f.service.snapshot().available,false);f.emit();f.advance(1800000);assert.equal(f.service.snapshot().available,false);f.noTarget();f.emit();assert.equal(f.service.snapshot().available,false);f.close();
});
test('Capture is bounded, declares Unicode-safe truncation and skips unsupported fields without invoking getters',async()=>{
    const f=fixture();await f.service.save({enabled:true});const row={role:'system'};Object.defineProperty(row,'content',{get(){throw Error('must not read getter');}});f.emit([row]);assert.equal(f.service.snapshot().omitted,1);
    f.emit(Array.from({length:150},()=>({role:'user',content:'😀'.repeat(12000)})));const overview=f.service.snapshot();assert.ok(overview.blocks.length<=128);assert.equal(overview.truncated,true);assert.ok(overview.omitted>0);
    const data=JSON.parse(f.service.read('message:0',true).text);assert.ok(data.text.length<=16000);assert.equal(data.text.endsWith('😀'),true);assert.equal(data.chars,24000);assert.equal(data.truncated,true);f.close();
});
test('Invalid payload clears latest evidence; listener never throws into host generation',async()=>{
    const f=fixture();await f.service.save({enabled:true});f.emit();assert.doesNotThrow(()=>f.events.emit('CHAT_COMPLETION_PROMPT_READY',{chat:'not array'}));assert.equal(f.service.snapshot().available,false);f.emit();assert.throws(()=>f.service.read('message:0',false),/INVALID_SELECTOR/);assert.throws(()=>f.service.read('headers:0',true),/INVALID_SELECTOR/);f.close();
});
test('Byte budget, model page continuation and clear invalidation follow existing Provider protocol',async()=>{
    const f=fixture();await f.service.save({enabled:true});f.emit([{role:'user',content:'长'.repeat(5000)}]);const root=f.read();let page=f.read('stPromptText','message:0',root.revision);assert.equal(page.status,'ok');assert.ok(page.nextOffset>0);assert.equal(f.read('stPromptText','message:0',page.revision,page.nextOffset).status,'ok');
    f.service.clear();assert.equal(f.read('stPromptText','message:0',page.revision).status,'INVALID_SELECTOR');f.emit([{role:'user',content:'长'.repeat(5000)}]);f.module.bindRun('tiny',6000);const result=f.module.handlers['muyu.provider.read']({id:'stPromptText'},{runId:'tiny',target:f.target()});assert.equal(result.status,'ok');const args={id:'stPromptText',selector:'message:0',revision:result.revision,offset:0};const first=f.module.handlers['muyu.provider.read'](args,{runId:'tiny',target:f.target()});assert.equal(first.status,'BUDGET_EXCEEDED');assert.equal(f.module.handlers['muyu.provider.read']({id:'stPromptOverview'},{runId:'tiny',target:f.target()}).status,'BUDGET_EXCEEDED');f.close();
});
for(const lang of ['zh','en'])test('Prompt snapshot GUI '+lang+' folds controls, preserves dirty choice and exposes only local overview',async()=>{
    const f=fixture(),doc={createElement:tag=>({tag,children:[],append(...items){this.children.push(...items);}})},settings=doc.createElement('section');
    const view=createStPromptSnapshotsView({doc,settings,lang,act:fn=>fn(),controller:{savePromptCaptureConfig:value=>f.service.save(value),promptCaptureSnapshot:()=>f.service.snapshot(),clearPromptCapture:()=>f.service.clear()}});
    const all=node=>[node,...node.children.flatMap(all)],nodes=all(settings),input=nodes.find(n=>n.tag==='input'),pre=nodes.find(n=>n.tag==='pre');assert.ok(!nodes.find(n=>n.tag==='details').open);
    view.render({promptCapture:f.service.snapshot()});assert.equal(input.checked,false);input.checked=true;input.onchange();view.render({promptCapture:f.service.snapshot()});assert.equal(input.checked,true);
    await nodes.find(n=>n.textContent===(lang==='en'?'Save capture settings':'保存快照采集设置')).onclick();f.emit();await nodes.find(n=>n.textContent===(lang==='en'?'View latest overview':'查看最近概况')).onclick();assert.equal(pre.hidden,false);assert.match(pre.textContent,/chat-built/);assert.doesNotMatch(pre.textContent,/PRIVATE/);
    await nodes.find(n=>n.textContent===(lang==='en'?'Clear snapshot':'清空快照')).onclick();assert.equal(pre.hidden,true);assert.equal(pre.textContent,'');assert.equal(f.service.snapshot().available,false);f.close();
});
test('Turning off removes content; failed configuration keeps previous capture controls and dispose detaches once',async()=>{
    const f=fixture();await f.service.save({enabled:true});f.emit();f.fail();await assert.rejects(()=>f.service.save({enabled:false}),/SAVE_FAILED/);assert.equal(f.service.snapshot().config.enabled,true);assert.equal(f.service.snapshot().available,true);assert.equal(f.events.listenerCount('CHAT_COMPLETION_PROMPT_READY'),1);f.close();f.close();assert.equal(f.events.listenerCount('CHAT_COMPLETION_PROMPT_READY'),0);assert.throws(()=>f.service.read(),/SOURCE_DISABLED/);
    const g=fixture();await g.service.save({enabled:true});g.emit();await g.service.save({enabled:false});assert.equal(g.service.snapshot().available,false);g.close();
});
