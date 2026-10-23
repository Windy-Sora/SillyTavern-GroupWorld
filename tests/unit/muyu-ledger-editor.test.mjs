import test from 'node:test';
import assert from 'node:assert/strict';
import {createLedgerEditorPort} from '../../muyu/host/ledger-editor.js';
import {createLedgerEditorModule} from '../../muyu/modules/ledger-editor/index.js';
import {actionReceipt,receiptSources,receiptText} from '../../muyu/actions/receipts.js';
import {createHistorySystem} from '../../systems/history-system.js';
function fixture(save=async()=>{}) {
 const target={kind:'chat',chatKey:'A'},entry={speakers:['Alice'],names:['Alice'],reason:'PRIVATE_OLD',scripts:{Alice:'act'},loreAssignments:{Alice:['Book']},extra:{keep:true},_anchorDate:'PRIVATE_ANCHOR',_chatLength:1,_custom:'protected'};
 const metadata={gd:{directorHistory:[entry,{reason:'other',speakers:['Bob'],_anchorDate:'B',_chatLength:2}],historyMeta:{scriptPrompt:'unchanged'}}};
 let current=target,meta=metadata,busy=false,saves=0,notifications=[];
 const port=createLedgerEditorPort({getTarget:()=>current,getMetadata:()=>meta,extensionKey:'gd',isBusy:()=>busy,saveChatConfirmed:async m=>{saves++;await save(m);},changed:i=>notifications.push(i)});
 const draft=(changes={reason:'PRIVATE_NEW'},operation='update',index=0)=>{const r=port.list(target).items[index];return port.preview(target,{...r,operation,changes});};
 return{target,metadata,entry,port,draft,notifications,get saves(){return saves;},setTarget:t=>current=t,setMeta:m=>meta=m,setBusy:v=>busy=v};
}
test('Ledger preview is pure and update preserves anchors/custom fields/history metadata',async()=>{
 const f=fixture(),before=structuredClone(f.metadata),d=f.draft({reason:'New reason',scripts:{Alice:'new'}});
 assert.deepEqual(f.metadata,before);assert.equal(f.saves,0);assert.equal(Object.hasOwn(d.before,'_anchorDate'),false);
 const result=await f.port.apply(d);assert.equal(result.status,'applied_confirmed');assert.equal(f.saves,1);
 assert.equal(f.metadata.gd.directorHistory[0],f.entry);assert.equal(f.entry._anchorDate,'PRIVATE_ANCHOR');assert.equal(f.entry._custom,'protected');
 assert.deepEqual(f.entry.extra,before.gd.directorHistory[0].extra);assert.deepEqual(f.metadata.gd.historyMeta,before.gd.historyMeta);assert.deepEqual(f.notifications,[0]);
 await assert.rejects(f.port.apply(d),/STALE/);
});

test('Aliased entry objects reject so one edit cannot mutate two rounds',()=>{const f=fixture();f.metadata.gd.directorHistory.push(f.entry);assert.throws(()=>f.port.list(f.target),/UNSUPPORTED/);assert.equal(f.saves,0);});
test('Speakers synchronize only an existing names alias, fully visible in diff',async()=>{
 const f=fixture(),d=f.draft({speakers:['Bob','Alice']});assert.deepEqual(d.after.names,['Bob','Alice']);await f.port.apply(d);assert.deepEqual(f.entry.names,f.entry.speakers);
 delete f.entry.names;const d2=f.draft({speakers:['Alice']});assert.equal(Object.hasOwn(d2.after,'names'),false);await f.port.apply(d2);assert.equal(Object.hasOwn(f.entry,'names'),false);
});
test('Scripts and lore assignment maps replace whole fields, not implicit merge',async()=>{
 const f=fixture();await f.port.apply(f.draft({scripts:{Bob:'new'},loreAssignments:{Bob:[]}}));assert.deepEqual(f.entry.scripts,{Bob:'new'});assert.deepEqual(f.entry.loreAssignments,{Bob:[]});
});
test('Clear keeps index and internal anchors but removes public/custom fields; no deletion/archive',async()=>{
 const f=fixture(),d=f.draft({},'clear');assert.deepEqual(d.after,{});await f.port.apply(d);
 assert.equal(f.metadata.gd.directorHistory.length,2);assert.equal(f.metadata.gd.directorHistory[0],f.entry);assert.deepEqual(f.entry,{_anchorDate:'PRIVATE_ANCHOR',_chatLength:1,_custom:'protected'});
 assert.equal(f.port.list(f.target).items[0].cleared,true);assert.throws(()=>f.draft({},'clear'),/EMPTY/);
});
test('Cleared slot can be edited again without inventing a new round or anchor',async()=>{
 const f=fixture();await f.port.apply(f.draft({},'clear'));await f.port.apply(f.draft({reason:'restored',speakers:['Alice']}));assert.equal(f.entry.reason,'restored');assert.equal(f.entry._anchorDate,'PRIVATE_ANCHOR');assert.equal(f.metadata.gd.directorHistory.length,2);
});
for(const [name,mutate]of [
 ['selected',f=>f.entry.reason='concurrent'],['anchor',f=>f.entry._anchorDate='different'],
 ['append',f=>f.metadata.gd.directorHistory.push({reason:'new'})],['prune',f=>f.metadata.gd.directorHistory.splice(0,1)],
 ['reorder',f=>f.metadata.gd.directorHistory.reverse()],['replace entry',f=>f.metadata.gd.directorHistory[0]=structuredClone(f.entry)],
 ['replace list',f=>f.metadata.gd.directorHistory=f.metadata.gd.directorHistory.slice()],['replace root',f=>f.metadata.gd={...f.metadata.gd}],
 ['metadata',f=>f.setMeta(structuredClone(f.metadata))],['chat',f=>f.setTarget({kind:'chat',chatKey:'B'})],['busy',f=>f.setBusy(true)]
])test('Stale exact approval rejects '+name,async()=>{const f=fixture(),d=f.draft();mutate(f);await assert.rejects(f.port.apply(d));assert.equal(f.saves,0);});
test('Unrelated in-place ledger edits survive, selected entry only is modified',async()=>{
 const f=fixture(),d=f.draft();f.metadata.gd.directorHistory[1].reason='concurrent';await f.port.apply(d);assert.equal(f.metadata.gd.directorHistory[1].reason,'concurrent');
});
test('Async save failure never rolls back concurrent data or retries',async()=>{
 const f=fixture(async()=>{f.metadata.gd.directorHistory[1].reason='concurrent';throw Error('rejected');}),d=f.draft();
 const r=await f.port.apply(d);assert.equal(r.status,'outcome_unknown');assert.equal(r.chatSave,'unknown');assert.equal(f.entry.reason,'PRIVATE_NEW');assert.equal(f.metadata.gd.directorHistory[1].reason,'concurrent');assert.equal(f.saves,1);await assert.rejects(f.port.apply(d),/STALE/);
});
for(const change of ['selected','append','chat'])test('Confirmed save remains partial after '+change,async()=>{
 const f=fixture(async()=>{if(change==='selected')f.entry.reason='later';if(change==='append')f.metadata.gd.directorHistory.push({});if(change==='chat')f.setTarget({kind:'chat',chatKey:'B'});});
 assert.equal((await f.port.apply(f.draft())).status,'partial');
});
for(const changes of [{reason:1},{speakers:'Alice'},{speakers:[1]},{speakers:[' ']},{scripts:[]},{scripts:{Alice:1}},{scripts:{' ':''}},{loreAssignments:{Alice:'Book'}},{loreAssignments:{Alice:[1]}},{_anchorDate:'x'},{_chatLength:2},{names:['Bob']},{extra:{}},JSON.parse('{"__proto__":{}}')])
 test('Invalid/hidden edits reject '+JSON.stringify(changes),()=>{const f=fixture();assert.throws(()=>f.draft(changes));assert.equal(f.saves,0);});
test('Clear with changes, unknown operation and no-op reject',()=>{const f=fixture();assert.throws(()=>f.draft({reason:'x'},'clear'));assert.throws(()=>f.draft({},'delete'));assert.throws(()=>f.draft({}),/EMPTY/);});
test('Read hides anchors and consumes shared byte budget; revision and tampering rejected',async()=>{
 const f=fixture(),r=f.port.list(f.target).items[0],read=f.port.read(f.target,r.selector,r.revision,0);assert.doesNotMatch(read.text,/PRIVATE_ANCHOR|_chatLength|_custom/);assert.equal(read.untrusted,true);
 const m=createLedgerEditorModule({port:f.port,charge:()=>false});assert.throws(()=>m.handlers['muyu.ledger_editor.read']({...r,offset:0},{target:f.target,runId:'r'}),/BUDGET/);
 const d=f.draft();d.after.reason='tamper';await assert.rejects(f.port.apply(d),/STALE/);f.entry.reason='changed';assert.throws(()=>f.port.read(f.target,r.selector,r.revision,0),/STALE/);
});
test('Empty history reads do not initialize metadata; malformed stores reject',()=>{
 const f=fixture(),empty={},p=createLedgerEditorPort({getTarget:()=>f.target,getMetadata:()=>empty,extensionKey:'gd'});assert.deepEqual(p.list(f.target).items,[]);assert.deepEqual(empty,{});
 for(const bad of [null,{},[null],Array.from({length:513},()=>({}))]){f.metadata.gd.directorHistory=bad;assert.throws(()=>f.port.list(f.target),/UNSUPPORTED/);}
});
test('Large multibyte complete diff rejects instead of truncating approval',()=>{const f=fixture();f.entry.reason='猫'.repeat(4000);assert.throws(()=>f.draft({reason:'猫'.repeat(4001)}),/TOO_LARGE/);});
test('Ledger receipt is metadata only, not source permission or current execution evidence',()=>{
 const f=fixture(),content=f.draft(),r=actionReceipt({id:'op',artifactId:'draft',revision:1,status:'applied_confirmed',content,result:{chatSave:'confirmed'}});
 assert.equal(r.version,25);assert.deepEqual(receiptSources(r),[]);assert.doesNotMatch(JSON.stringify(r),/Alice|PRIVATE|protected/);assert.match(receiptText(r,'zh'),/账本/);assert.match(receiptText(r,'en'),/ledger/);
});
test('Edited and cleared anchors retain original pruning behavior in real history system',async()=>{
 const f=fixture();await f.port.apply(f.draft({},'clear'));let chat=[{send_date:'PRIVATE_ANCHOR'},{send_date:'B'}];
 const system=createHistorySystem({getChatMetadata:()=>f.metadata,getChat:()=>chat,EXT_KEY:'gd',saveChatConditional:async()=>{},settings:{},log(){}});
 await system.pruneDirectorHistory();assert.equal(f.metadata.gd.directorHistory.length,2);chat=[{send_date:'B'}];await system.pruneDirectorHistory();assert.equal(f.metadata.gd.directorHistory.length,1);assert.equal(f.metadata.gd.directorHistory[0].reason,'other');
});
