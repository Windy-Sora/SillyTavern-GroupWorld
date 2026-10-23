import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldBookControls } from '../../muyu/host/worldbook-controls.js';
import { createWorldBookEditorPort } from '../../muyu/host/worldbook-editor.js';
import { toolCapability } from '../../muyu/application/capabilities.js';
import { actionReceipt } from '../../muyu/actions/receipts.js';
function fixture(){
 const target={kind:'global',userKey:'u'},state={names:['Atlas','Boreal'],global:[],chat:''},books={Atlas:{entries:{1:{uid:1,content:'PRIVATE'}}},Boreal:{entries:{}}};
 let chatTarget={kind:'chat',userKey:'u',chatKey:'A'},writes=0,extra=0,onWrite=()=>{},onRefresh=()=>{},removed=true;
 const controls=createWorldBookControls({getTarget:()=>target,getChatTarget:()=>chatTarget,getState:()=>state,getReferences:name=>({known:extra+state.global.filter(n=>n===name).length+Number(state.chat===name)}),load:async name=>structuredClone(books[name]),refresh:async()=>onRefresh(),setGlobal:async names=>{writes++;state.global=names;await onWrite();},setChat:async name=>{writes++;state.chat=name;await onWrite();},remove:async name=>{writes++;if(!removed)return false;delete books[name];state.names=state.names.filter(n=>n!==name);await onWrite();return true;}});
 const editor=createWorldBookEditorPort({getTarget:()=>target,getState:()=>state,load:async name=>structuredClone(books[name]),controls});
 const preview=async operation=>{let revision=controls.read(target).revision;if(operation==='delete_book'){const root=editor.list(target);revision=(await editor.read(target,'book:0',root.revision,0)).revision;}return editor.preview(target,{operation,selector:operation==='delete_book'?'book:0':'',revision,changes:operation==='set_global_binding'?{names:['Atlas']}:operation==='set_chat_binding'?{name:'Atlas'}:{}});};
 return {target,state,books,controls,editor,preview,writes:()=>writes,extra:v=>extra=v,write:fn=>onWrite=fn,refresh:fn=>onRefresh=fn,noAck:()=>removed=false,switch:()=>chatTarget={...chatTarget,chatKey:'B'},noChat:()=>chatTarget=null};
}
for(const operation of ['set_global_binding','set_chat_binding','delete_book'])test('ST '+operation+' previews pure full diff and executes exactly once',async()=>{
 const f=fixture(),before=structuredClone(f.state),d=await f.preview(operation);assert.equal(f.writes(),0);assert.deepEqual(f.state,before);
 const result=await f.editor.apply(d);assert.equal(result.status,'applied_unconfirmed');assert.equal(f.writes(),1);assert.ok(f.books.Boreal);
 if(operation==='delete_book'){assert.equal(f.books.Atlas,undefined);assert.equal(d.before.entries[1].content,'PRIVATE');}else assert.ok(f.books.Atlas);
 const receipt=actionReceipt({id:'o',artifactId:'a',revision:1,status:result.status,content:d,result});assert.equal(receipt.operation,operation);assert.doesNotMatch(JSON.stringify(receipt),/Atlas|PRIVATE/);
 await assert.rejects(()=>f.editor.apply(d),/STALE/);
});
test('Bindings reject unknown names, duplicate activation, wrong revisions, absent chats and hidden keys',async()=>{
 const f=fixture(),revision=f.controls.read(f.target).revision;
 for(const changes of [1,true,'text',[],null])await assert.rejects(()=>f.controls.preview(f.target,{operation:'delete_book',selector:'book:0',revision,changes}),/INVALID/);
 for(const [operation,changes] of [['set_global_binding',{names:['Missing']}],['set_global_binding',{names:['Atlas','Atlas']}],['set_chat_binding',{name:'Missing'}],['set_chat_binding',{name:'Atlas',hidden:true}]])await assert.rejects(()=>f.editor.preview(f.target,{operation,selector:'',revision,changes}),/INVALID/);
 f.noChat();await assert.rejects(()=>f.preview('set_chat_binding'),/TARGET/);assert.equal(f.writes(),0);
});
test('Chat switches and binding changes invalidate pending operations before writes',async()=>{
 for(const operation of ['set_global_binding','set_chat_binding','delete_book']){const f=fixture(),d=await f.preview(operation);f.switch();await assert.rejects(()=>f.editor.apply(d),/STALE/);assert.equal(f.writes(),0);}
 const f=fixture(),d=await f.preview('set_global_binding');f.state.global=['Boreal'];await assert.rejects(()=>f.editor.apply(d),/STALE/);assert.equal(f.writes(),0);
});
test('Deletion rejects known references before preview and rechecks new references/content before dispatch',async()=>{
 const bound=fixture();bound.extra(1);await assert.rejects(()=>bound.preview('delete_book'),/STILL_BOUND/);assert.equal(bound.writes(),0);
 const f=fixture(),d=await f.preview('delete_book');f.extra(1);await assert.rejects(()=>f.editor.apply(d),/STALE/);assert.equal(f.writes(),0);
 const g=fixture(),e=await g.preview('delete_book');g.books.Atlas.entries[1].content='CHANGED';await assert.rejects(()=>g.editor.apply(e),/STALE/);assert.equal(g.writes(),0);
});
test('Deletion clear during refresh fails closed and does not dispatch',async()=>{
 const f=fixture(),d=await f.preview('delete_book');f.refresh(()=>f.editor.clear());await assert.rejects(()=>f.editor.apply(d),/STALE/);assert.equal(f.writes(),0);
});
for(const operation of ['set_global_binding','set_chat_binding','delete_book'])test('Unknown '+operation+' result never retries or rolls back concurrent edits',async()=>{
 const f=fixture(),d=await f.preview(operation);f.write(()=>{f.state.global=['Boreal'];throw Error('failed');});const result=await f.editor.apply(d);assert.equal(result.status,'outcome_unknown');assert.equal(f.writes(),1);assert.deepEqual(f.state.global,['Boreal']);
});
test('Deletion false response is not success and source authority cannot bypass independent binding permission',async()=>{
 const f=fixture(),d=await f.preview('delete_book');f.noAck();assert.equal((await f.editor.apply(d)).status,'outcome_unknown');assert.ok(f.books.Atlas);
 assert.deepEqual(toolCapability('muyu.worldbook_editor.bindings').sources({}),['source:stWorldBooks']);
 assert.deepEqual(toolCapability('muyu.worldbook_editor.preview').sources({operation:'set_chat_binding'}),['source:stWorldBooks']);
 assert.deepEqual(toolCapability('muyu.worldbook_editor.preview').sources({operation:'delete_book'}),['source:stWorldBookEntries','source:stWorldBooks']);
});
