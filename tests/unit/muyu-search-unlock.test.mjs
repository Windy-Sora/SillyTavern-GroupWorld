import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mountMuyuPanel } from '../../muyu/ui/panel.js';
import { createConfigWriter } from '../../muyu/host/config-write.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createMuyuController } from '../../muyu/application/controller.js';
import { scriptedModel, text, done, flush } from './helpers/muyu-subject.mjs';
class Element {
 constructor(tag,doc) { Object.assign(this,{tag,ownerDocument:doc,children:[],attrs:{},events:{},value:'',checked:false,classList:{add(){},remove(){}}}); }
 append(el){ if(el.parent)el.remove(); this.children.push(el);el.parent=this; }
 insertBefore(el,reference){if(el===reference)return;if(el.parent)el.remove();this.children.splice(reference?this.children.indexOf(reference):this.children.length,0,el);el.parent=this;}
 get attributes(){return Object.entries(this.attrs).map(([name,value])=>({name,value}));}
 removeAttribute(name){delete this.attrs[name];}
 replaceChildren(){this.children=[];}
 setAttribute(k,v){this.attrs[k]=v;} getAttribute(k){return this.attrs[k];}
 focus(){this.ownerDocument.activeElement=this;}
 addEventListener(k,fn){const old=this.events[k];this.events[k]=e=>{old?.(e);fn(e);};}
 remove(){this.parent.children=this.parent.children.filter(e=>e!==this);}
 get options(){return this.children.filter(e=>e.tag==='option');}
 click(){if(!this.disabled)return this.onclick?.();}
}
test('BUG-246-01: search form unlocks after automatic apply and receipt check without another emit', async t => {
const events=new EventEmitter(), ctx={groupId:'g',chatId:'A',groups:[{id:'g',members:[]}],chat:[],chatMetadata:{},eventSource:events,eventTypes:{CHAT_CHANGED:'chat'}};
const settings={topN:1}; const configWriter=createConfigWriter({getSettings:()=>settings,saveSettings:async()=>({confirmed:true}),isBusy:()=>false});
const host=createHostBridge({getContext:()=>ctx,getSettings:()=>settings,configWriter,extensionKey:'gd',pageId:'ui-probe'});
const model=scriptedModel([[{type:'tool_call_complete',call:{toolId:'muyu.settings.preview',callId:'preview',version:1,args:{changes:{topN:2},apply:true}}},done],[text('Done.'),done]]);
const controller=createMuyuController({host,createModel:()=>model});
await controller.configure({endpoint:'https://example.invalid/chat/completions',apiKey:'SYNTHETIC',model:'fake',thinking:false});
controller.setFullAccess(true);
const doc={createElement:tag=>new Element(tag,doc)},root=doc.createElement('div');
mountMuyuPanel(root,controller,{lang:'en',standalone:true});
t.after(async () => { root.__gdMuyuDispose(); await controller.dispose(); });
const all=(e=root)=>[e,...e.children.flatMap(all)];
const button=label=>all().find(e=>e.tag==='button'&&e.textContent===label);
controller.setInput('请将发言人数改为2');
// Use actual UI send entry, which performs its normal post-action render too.
const input=all().find(e=>e.tag==='textarea'&&e.parent.textContent==='Message to Muyu'); input.value='请将发言人数改为2';
await button('Send').click();
for(let i=0;i<20;i++)await flush();
const result={busy:controller.snapshot().busy,status:controller.snapshot().runs.at(-1)?.status,saveSearch:button('Update search key').disabled,checks:controller.snapshot().configChecks};
assert.equal(result.busy,false);assert.equal(result.status,'succeeded');
assert.equal(settings.topN, 2);
assert.ok(Object.values(result.checks).some(check => check.state === 'matched'));
// Entering settings does not request a render; attempt to edit the search budget.
await button('⚙').click();
const field=all().find(e=>e.tag==='input'&&e.parent.textContent==='Search attempts per task');field.value='2';field.events.input();
const searchKey=all().find(e=>e.tag==='input'&&e.parent.textContent==='Brave Search API key');searchKey.value='SYNTHETIC_BRAVE_KEY';searchKey.events.input();
assert.equal(button('Update search key').disabled,false);
});

test('Real controller permission continuation renders one task group without extra calls or grants', async t => {
    const events = new EventEmitter(), ctx = { groupId: 'g', chatId: 'A', groups: [{ id: 'g', members: [] }], chat: [], chatMetadata: {}, eventSource: events, eventTypes: { CHAT_CHANGED: 'chat' } };
    const host = createHostBridge({ getContext: () => ctx, getSettings: () => ({}), extensionKey: 'gd', pageId: 'group-probe' });
    const model = scriptedModel([
        [{ type: 'tool_call_complete', call: { toolId: 'muyu.permission.request', callId: 'read', version: 1, args: { source: 'memoryConfig', reason: 'Synthetic read request' } } }, done],
        [text('Synthetic continuation finished.'), done],
    ]);
    const controller = createMuyuController({ host, createModel: () => model });
    const doc = { createElement: tag => new Element(tag, doc) }, root = doc.createElement('div');
    t.after(async () => { root.__gdMuyuDispose?.(); await controller.dispose(); });
    await controller.configure({ endpoint: 'https://example.invalid/chat/completions', apiKey: 'SYNTHETIC', model: 'fake', thinking: false });
    controller.setMode('assistant'); mountMuyuPanel(root, controller, { lang: 'en', standalone: true });
    const all = (e = root) => [e, ...e.children.flatMap(all)], group = () => all().find(e => e.className === 'gd-muyu-process-group');
    controller.setInput('Read memory settings'); controller.send(); for (let i = 0; i < 20; i++) await flush();
    const request = controller.snapshot().interaction; assert.equal(request.kind, 'permission'); assert.equal(group(), undefined);
    controller.answerPermission(request.id, 'task'); for (let i = 0; i < 20; i++) await flush();
    const state = controller.snapshot(), before = JSON.stringify(state.runs), grouped = group(); assert.ok(grouped);
    assert.equal(state.runs.length, 2); assert.equal(state.runs[0].sessionId, state.runs[1].sessionId); assert.equal(state.runs[0].taskId, state.runs[1].taskId);
    assert.match(grouped.children[0].textContent, /Answer completed.*2 segments/); assert.equal(grouped.children[2].children.length, 2);
    assert.equal(state.taskUsage.modelCalls, 2); assert.equal(model.requests.length, 2);
    grouped.open = true; controller.setInput('Unsent draft'); assert.equal(group(), grouped); assert.equal(grouped.open, true);
    assert.equal(JSON.stringify(controller.snapshot().runs), before); assert.equal(model.requests.length, 2);
    assert.doesNotMatch(controller.exportHistory(), /Task total:|gd-muyu-process-group/);
});
