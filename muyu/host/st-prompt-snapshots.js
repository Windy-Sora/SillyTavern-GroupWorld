import { randomUUID } from '../runtime/crypto.js';
import { createBudgetConfigStore } from './budget-config.js';
import { jsonKey } from '../core/json-contract.js';

const MAX_CHARS=100000, MAX_BLOCKS=128, BLOCK_CHARS=16000, AGE_MS=30*60*1000;
const own=(value,key)=>{if(!value||typeof value!=='object')return undefined;const d=Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
const numeric=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const notice='官方事件监听时的构建快照，不是最终请求／服务器接收／生成成功证明；其他订阅者后续可能修改。目标仅观察时当前聊天，生产者与请求起源未知；不按时间配对世界书事件。注册注入项不证明采用、过滤结果、排序或实际注入；消息与注册项分别复制，不保证消息已合并或未合并注入，缺席原因未知。不执行filter、宏或Provider。入口：暮羽齿轮→资料与权限→酒馆提示词构建快照。开启只能采集之后的新构建，不能追溯旧请求；available=false时停止正文读取，不猜选择器或另查聊天来补证据，不主动生成。chars是原始字符数，retainedChars是保留正文字符数，不含JSON包装；分页读尽不代表原文完整。仅保存文字投影，工具调用、消息name、附件和未知对象不采集；注册项名称仅正文提供。正文仍可能含私人资料或用户写入的秘密，需独立授权。';
function validate(value){if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.enabled!=='boolean'||Object.keys(value).some(k=>k!=='enabled'))throw Error('PROMPT_CAPTURE_CONFIG_INVALID');return{enabled:value.enabled};}

/** Latest bounded event-time projection only. Never intercept transport or initiate a dry run. */
export function createStPromptSnapshots({getContext,getTarget,getSettings,saveSettings,now=()=>Date.now()}){
    const store=createBudgetConfigStore({getSettings,saveSettings,key:'muyuPromptCaptureConfig',versionKey:'muyuPromptCaptureConfigVersion',defaults:{enabled:false},validate,legacy:()=>false,errorCode:'PROMPT_CAPTURE_SAVE_FAILED'});
    let config=store.read(),latest=null,epoch=0,closed=false,saving=false,expiryTimer=null;const detach=[];
    const target=()=>{try{return jsonKey(getTarget?.()||null);}catch{return 'null';}};
    const clear=()=>{clearTimeout(expiryTimer);expiryTimer=null;latest=null;epoch++;};
    function capture(data,stage){
        if(closed||!config.enabled)return;
        // Do not read arbitrary request objects or traverse multimodal / tool payloads.
        try{
            const owner=target();if(owner==='null'){clear();return;}
            const messages=own(data,'chat'),prompt=own(data,'prompt'),dryRun=own(data,'dryRun');
            if(stage==='chat-built'&&!Array.isArray(messages)||stage==='text-combined'&&typeof prompt!=='string'){clear();return;}
            const blocks=[];let remaining=MAX_CHARS,omitted=0,cut=false;
            const push=(text,meta)=>{if(typeof text!=='string'){omitted++;return;}if(blocks.length>=MAX_BLOCKS||remaining===0){omitted++;cut=true;return;}let end=Math.min(text.length,remaining,BLOCK_CHARS);if(end<text.length&&end>0&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;const body=text.slice(0,end);remaining-=body.length;const truncated=end<text.length;cut ||= truncated;blocks.push({...meta,chars:text.length,text:body,truncated});};
            if(stage==='chat-built'){const limit=Math.min(messages.length,MAX_BLOCKS);for(let i=0;i<limit;i++){const row=own(messages,String(i)),role=own(row,'role');push(own(row,'content'),{index:i,role:['system','user','assistant','tool'].includes(role)?role:'unknown',toolPayloadOmitted:own(row,'tool_calls')!==undefined||own(row,'tool_call_id')!==undefined});}if(messages.length>limit){omitted+=messages.length-limit;cut=true;}}
            else push(prompt,{index:0,role:'combined'});
            // Snapshot registered extension text independently, not proof it is part of the event prompt.
            const injections=[],registered=getContext()?.extensionPrompts;
            if(registered&&typeof registered==='object'&&!Array.isArray(registered)){
                const keys=Object.keys(registered);for(const key of keys.slice(0,MAX_BLOCKS)){
                    const row=own(registered,key),value=own(row,'value');if(typeof value!=='string'){omitted++;continue;}
                    const index=injections.length;let end=Math.min(value.length,remaining,BLOCK_CHARS);if(end<value.length&&end>0&&/[\uD800-\uDBFF]/.test(value[end-1]))end--;const text=value.slice(0,end);remaining-=text.length;const truncated=end<value.length;cut ||= truncated;
                    injections.push({index,key:key.slice(0,120),text,chars:value.length,truncated,position:numeric(own(row,'position')),depth:numeric(own(row,'depth')),role:numeric(own(row,'role')),scan:typeof own(row,'scan')==='boolean'?own(row,'scan'):null,hasFilter:typeof own(row,'filter')==='function'});
                }if(keys.length>MAX_BLOCKS){omitted+=keys.length-MAX_BLOCKS;cut=true;}
            }
            latest={id:randomUUID(),owner,time:now(),stage,dryRun:typeof dryRun==='boolean'?dryRun:null,blocks,injections,omitted,truncated:cut};epoch++;
            clearTimeout(expiryTimer);expiryTimer=setTimeout(clear,AGE_MS);expiryTimer.unref?.();
        }catch{clear();} // Observer failures must not break or leak into generation.
    }
    const ctx=getContext?.(),events=ctx?.eventSource;
    if(events?.on&&events?.removeListener){
        for(const [name,stage]of [['CHAT_COMPLETION_PROMPT_READY','chat-built'],['GENERATE_AFTER_COMBINE_PROMPTS','text-combined']]){const type=ctx.eventTypes?.[name];if(!type)continue;const listener=data=>capture(data,stage);events.on(type,listener);detach.push(()=>events.removeListener(type,listener));}
        for(const name of ['CHAT_CHANGED','MAIN_API_CHANGED','CHATCOMPLETION_SOURCE_CHANGED','CHATCOMPLETION_MODEL_CHANGED']){const type=ctx.eventTypes?.[name];if(!type)continue;events.on(type,clear);detach.push(()=>events.removeListener(type,clear));}
    }
    const current=()=>{if(latest&&(latest.owner!==target()||now()-latest.time>=AGE_MS))clear();return latest;};
    function overview(){const row=current();return{config:{...config},available:!!row,capacityChars:MAX_CHARS,capacityBlocks:MAX_BLOCKS,blockChars:BLOCK_CHARS,retentionMinutes:30,...(row?{id:row.id,time:row.time,stage:row.stage,dryRun:row.dryRun,producer:'unknown',targetAttribution:'observed-current-chat',truncated:row.truncated,omitted:row.omitted,blocks:row.blocks.map(({index,role,chars,truncated,toolPayloadOmitted})=>({index,role,chars,truncated,...(toolPayloadOmitted!==undefined?{toolPayloadOmitted}:{})})),registeredInjections:row.injections.map(({index,chars,truncated,position,depth,role,scan,hasFilter})=>({index,chars,truncated,position,depth,role,scan,hasFilter}))}:{}),notice};}
    return Object.freeze({
        snapshot:overview,
        async save(value){if(closed||saving)throw Error('NOT_READY');saving=true;try{config=await store.save(value);if(closed)throw Error('NOT_READY');if(!config.enabled)clear();return overview();}finally{saving=false;}},
        clear,
        read(selector='',body=false){if(closed||!config.enabled)throw Error('SOURCE_DISABLED');const row=current();let value;
            if(!selector)value={...overview(),selectors:body?'message:N; injection:N (registered, not adopted)':'empty (metadata only)'};
            else{if(!body)throw Error('INVALID_SELECTOR');const match=/^(message|injection):(0|[1-9]\d{0,2})$/.exec(selector);if(!match||!row)throw Error('INVALID_SELECTOR');const item=(match[1]==='message'?row.blocks:row.injections).find(x=>x.index===Number(match[2]));if(!item)throw Error('INVALID_SELECTOR');value={id:row.id,time:row.time,stage:row.stage,dryRun:row.dryRun,kind:match[1],...item,notice};}
            if(selector)value.retainedChars=value.text.length;
            const text=JSON.stringify(value);if(text.length>131072)throw Error('SOURCE_TOO_LARGE');return{text,limited:!!row?.truncated||!!row?.omitted,identity:{epoch,id:row?.id||null}};
        },
        dispose(){if(closed)return;closed=true;for(const off of detach)off();detach.length=0;clear();},
    });
}
