import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterCardPort, CHARACTER_TEXT_FIELDS } from '../../muyu/host/character-cards.js';
import { createNativeCharacterApi } from '../../muyu/host/native-character-api.js';
import { toolCapability } from '../../muyu/application/capabilities.js';
import { actionReceipt, receiptText, receiptContext, validateReceipt } from '../../muyu/actions/receipts.js';

function fixture() {
    let target={kind:'global',userKey:'page:test'}, editing=false,busy=false,writes=0,copies=0,onSave=null,onCopy=null,onLoad=null,known=0,creates=0,removes=0,onCreate=null,onRemove=null;
    const rows=[{name:'Alice',avatar:'Alice.png'}],saved={spec:'chara_card_v2',spec_version:'2.0',name:'Alice',description:'OLD',personality:'calm',scenario:'tavern',first_mes:'hello',mes_example:'example',system_prompt:'',post_history_instructions:'',creator_notes:'note',data:{name:'Alice',...Object.fromEntries(Object.keys(CHARACTER_TEXT_FIELDS).map(k=>[k,k==='description'?'OLD':''])),extensions:{world:'Atlas',unknown:'PRIVATE_EXTENSION'}}};
    const cards={'Alice.png':saved},cache=[];
    const load=async avatar=>{if(onLoad)await onLoad(avatar);const card=cards[avatar];return {...structuredClone(card),avatar,json_data:JSON.stringify(card),date_last_chat:Date.now()};};
    const port=createCharacterCardPort({getTarget:()=>target,getDirectory:()=>rows,load,isEditing:()=>editing,isBusy:()=>busy,getReferences:()=>known===null?null:{known},
        create:async values=>{creates++;if(onCreate)return onCreate(values);cards['new.png']={...values,data:{...values,extensions:{world:''}}};return 'new.png';},
        remove:async avatar=>{removes++;if(onRemove)return onRemove(avatar);delete cards[avatar];},exists:async avatar=>Object.hasOwn(cards,avatar),
        save:async(avatar,changes)=>{writes++;if(onSave)return onSave(avatar,changes);Object.assign(cards[avatar],changes);Object.assign(cards[avatar].data,changes);},
        duplicate:async avatar=>{copies++;if(onCopy)return onCopy(avatar);cards['Alice_1.png']=structuredClone(cards[avatar]);return 'Alice_1.png';},
        syncCache:(...args)=>cache.push(args)});
    const read=async()=>port.read(target,'card:0',port.list(target).revision,0);
    const draft=async(changes={description:'NEW'},operation='update')=>{const r=await read();return port.preview(target,{selector:'card:0',revision:r.revision,operation,changes});};
    return {port,rows,cards,cache,read,draft,target,writes:()=>writes,copies:()=>copies,creates:()=>creates,removes:()=>removes,setKnown:v=>known=v,setCreate:fn=>onCreate=fn,setRemove:fn=>onRemove=fn,setEditing:v=>editing=v,setBusy:v=>busy=v,setSave:fn=>onSave=fn,setCopy:fn=>onCopy=fn,setLoad:fn=>onLoad=fn,setTarget:v=>target=v};
}

test('Create pure draft and host-assigned resource preserve every existing card',async()=>{
    const f=fixture(),original=structuredClone(f.cards),c=await f.port.preview(f.target,{operation:'create',selector:'',revision:f.port.list(f.target).revision,changes:{name:'新角色',description:'新描述'}});
    assert.deepEqual(f.cards,original);assert.equal(c.after.personality,'');assert.match(JSON.stringify(c.warnings),/默认头像/);
    assert.equal((await f.port.apply(c)).status,'applied_unconfirmed');assert.equal(f.creates(),1);assert.deepEqual(f.cards['Alice.png'],original['Alice.png']);assert.equal(f.cards['new.png'].description,'新描述');assert.equal(f.cache[0][2],true);
});
for(const name of ['Alice',' alice','Ａｌｉｃｅ','../bad','CON','a.','', 'x'.repeat(81)])test('Create refuses unsafe or cached-conflicting display name '+name,async()=>{
    const f=fixture();await assert.rejects(()=>f.port.preview(f.target,{operation:'create',selector:'',revision:f.port.list(f.target).revision,changes:{name}}),/NAME/);assert.equal(f.creates(),0);
});
test('Create rejects unknown fields, stale directory and partial response without retry',async()=>{
    const f=fixture(),revision=f.port.list(f.target).revision;await assert.rejects(()=>f.port.preview(f.target,{operation:'create',selector:'',revision,changes:{name:'Bob',world:'hidden'}}),/INVALID/);
    const c=await f.port.preview(f.target,{operation:'create',selector:'',revision,changes:{name:'Bob'}});f.rows.push({name:'Carol',avatar:'Carol.png'});await assert.rejects(()=>f.port.apply(c),/STALE/);assert.equal(f.creates(),0);
    const g=fixture(),d=await g.port.preview(g.target,{operation:'create',selector:'',revision:g.port.list(g.target).revision,changes:{name:'Bob'}});g.setCreate(()=>{g.cards['new.png']={name:'WRONG',data:{}};return 'new.png';});assert.equal((await g.port.apply(d)).status,'outcome_unknown');assert.equal(g.creates(),1);assert.equal(g.cache.length,0);
});
test('Rename only merges display name and preserves filename, chats, body and unknown metadata',async()=>{
    const f=fixture(),old=structuredClone(f.cards['Alice.png']);const c=await f.draft({name:'New Alice'},'rename');assert.deepEqual(c.before,{name:'Alice'});assert.deepEqual(c.after,{name:'New Alice'});
    assert.equal((await f.port.apply(c)).status,'applied_unconfirmed');assert.equal(f.cards['Alice.png'].name,'New Alice');assert.deepEqual(f.cards['Alice.png'].data.extensions,old.data.extensions);assert.equal(f.cards['Alice.png'].description,old.description);assert.equal(f.rows[0].avatar,'Alice.png');assert.equal(f.writes(),1);
});
test('Rename refuses noop and extra text mutation in the same operation',async()=>{
    const f=fixture();await assert.rejects(()=>f.draft({name:'Alice'},'rename'),/EMPTY/);await assert.rejects(()=>f.draft({name:'Bob',description:'hidden'},'rename'),/INVALID/);
});
test('Delete requires separate reference authorization and previews the complete saved old card',async()=>{
    assert.deepEqual(toolCapability('muyu.character_card.preview').sources({operation:'delete'}),['source:stCharacterCardState','source:stCharacterCardReferences']);
    const f=fixture(),c=await f.draft({},'delete');assert.match(JSON.stringify(c.before),/PRIVATE_EXTENSION/);assert.equal(c.after,null);assert.equal(f.removes(),0);
    assert.equal((await f.port.apply(c)).status,'applied_unconfirmed');assert.equal(f.removes(),1);assert.equal(f.port.list(f.target).cards.length,0);assert.equal(f.rows.length,1);assert.equal(f.cache.length,0);
    f.port.clear();assert.equal(f.port.list(f.target).cards.length,0);
    f.rows[0]={name:'Restored',avatar:'Alice.png'};assert.equal(f.port.list(f.target).cards.length,1);
});
for(const known of [1,null])test('Known references and unavailable reference checks prevent deletion '+known,async()=>{
    const f=fixture(),c=await f.draft({},'delete');f.setKnown(known);await assert.rejects(()=>f.port.apply(c),/REFERENC/);assert.equal(f.removes(),0);await assert.rejects(()=>f.draft({},'delete'),/REFERENC/);
});
test('Concurrent references during delete and HTTP-success-but-still-present report unknown, never retry',async()=>{
    for(const mode of ['referenced','still-present']){const f=fixture(),c=await f.draft({},'delete');f.setRemove(avatar=>{if(mode==='referenced'){delete f.cards[avatar];f.setKnown(1);}});assert.equal((await f.port.apply(c)).status,'outcome_unknown');assert.equal(f.removes(),1);}
});
test('Delete failure preserves concurrent data and does not roll back or retry',async()=>{
    const f=fixture(),c=await f.draft({},'delete');f.setRemove(()=>{f.cards['Alice.png'].description='CONCURRENT';throw Error('save');});assert.equal((await f.port.apply(c)).status,'outcome_unknown');assert.equal(f.cards['Alice.png'].description,'CONCURRENT');assert.equal(f.removes(),1);
});
test('Native create refuses external paths, delete always keeps chats, exists trusts only 404',async()=>{
    const calls=[],api=createNativeCharacterApi({getHeaders:()=>({}),fetch:async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return {ok:true,status:200,text:async()=>path.endsWith('create')?'new.png':''};}});
    await api.create({name:'Bob',description:'d'});await api.remove('a.png');assert.equal(await api.exists('a.png'),true);
    assert.match(calls[0].body.file_name,/^muyu-[0-9a-f-]{36}$/);assert.equal(calls[0].body.ch_name,'Bob');assert.equal(calls[0].body.world,'');assert.deepEqual(calls[1].body,{avatar_url:'a.png',delete_chats:false});
    const absent=createNativeCharacterApi({getHeaders:()=>({}),fetch:async()=>({ok:false,status:404})});assert.equal(await absent.exists('a.png'),false);
    const unknown=createNativeCharacterApi({getHeaders:()=>({}),fetch:async()=>({ok:false,status:500})});await assert.rejects(()=>unknown.exists('a.png'),/REJECTED/);
});

test('Card directory is not body authorization and saved detail is a whitelisted projection',async()=>{
    assert.deepEqual(toolCapability('muyu.character_card.list').sources({}),['source:stCharacters']);
    for(const id of ['read','preview'])assert.deepEqual(toolCapability('muyu.character_card.'+id).sources({}),['source:stCharacterCardState']);
    const f=fixture(),dir=f.port.list(f.target);assert.doesNotMatch(JSON.stringify(dir),/OLD|PRIVATE_EXTENSION|Alice.png/);
    const r=await f.read(),v=JSON.parse(r.text);assert.equal(v.fields.description.value,'OLD');assert.equal(v.fields.description.label,'角色描述');assert.equal(v.worldBook,'Atlas');assert.doesNotMatch(r.text,/PRIVATE_EXTENSION|json_data"|Alice.png/);
});
test('Metadata projection rejects arbitrary objects instead of sending nested private fields',async()=>{
    const f=fixture();f.cards['Alice.png'].data.tags={api_key:'PRIVATE'};await assert.rejects(()=>f.read(),/UNSUPPORTED/);
});
test('Large Unicode card text uses stable card revision and exact continuation offsets',async()=>{
    const f=fixture();f.cards['Alice.png'].data.description='猫🦉'.repeat(5000);const a=await f.read();let text=a.text,offset=a.nextOffset;
    while(offset!==-1){const b=await f.port.read(f.target,'card:0',a.revision,offset);text+=b.text;offset=b.nextOffset;}
    assert.equal(JSON.parse(text).fields.description.value,'猫🦉'.repeat(5000));assert.doesNotMatch(text,/\uFFFD/);
    await assert.rejects(()=>f.port.read(f.target,'card:0','stale',0),/STALE/);
});
test('World-book metadata receipt also remains explainable without a diff array',()=>{
    const r=actionReceipt({id:'op',artifactId:'a',revision:1,status:'applied_unconfirmed',content:{module:'worldbook-editor',selector:'book:0',operation:'copy_book'},result:{resourceSave:'unconfirmed'}});assert.match(receiptContext([r]),/historical/i);
});
test('Pure text preview and narrow update preserve unknown fields and consume ticket exactly once',async()=>{
    const f=fixture(),original=structuredClone(f.cards),c=await f.draft();assert.deepEqual(f.cards,original);assert.equal(f.writes(),0);
    assert.doesNotMatch(JSON.stringify(c),/PRIVATE_EXTENSION/);assert.equal((await f.port.apply(c)).status,'applied_unconfirmed');assert.equal(f.writes(),1);
    assert.deepEqual(f.cards['Alice.png'].data.extensions,original['Alice.png'].data.extensions);assert.equal(f.cards['Alice.png'].name,'Alice');assert.equal(f.cache.length,1);
    await assert.rejects(()=>f.port.apply(c),/STALE/);
});
test('Copy duplicates exact saved metadata and not selection, directory or source',async()=>{
    const f=fixture(),c=await f.draft({},'copy');assert.match(JSON.stringify(c.after),/PRIVATE_EXTENSION/);const old=structuredClone(f.cards['Alice.png']);
    assert.equal((await f.port.apply(c)).status,'applied_unconfirmed');assert.deepEqual(f.cards['Alice_1.png'],old);assert.deepEqual(f.cards['Alice.png'],old);assert.equal(f.rows.length,1);assert.equal(f.cache[0][2],true);assert.equal(f.writes(),0);
});
test('Copy response with changed content is unknown and never cached or retried',async()=>{
    const f=fixture(),c=await f.draft({},'copy');f.setCopy(()=>{f.cards['Alice_1.png']={...f.cards['Alice.png'],name:'WRONG'};return 'Alice_1.png';});
    assert.equal((await f.port.apply(c)).status,'outcome_unknown');assert.equal(f.copies(),1);assert.equal(f.cache.length,0);
});
for(const changes of [{name:'new'},{avatar:'x.png'},{extensions:{}},{description:null},{description:'a'.repeat(12001)},{}])test('Card edits reject unsupported or oversized field set '+Object.keys(changes),async()=>{
    const f=fixture();await assert.rejects(()=>f.draft(changes),/INVALID|EMPTY|limit/);assert.equal(f.writes(),0);
});
test('Whole-card server changes after preview prevent dispatch, including unrelated extension changes',async()=>{
    const f=fixture(),c=await f.draft();f.cards['Alice.png'].data.extensions.unknown='CONCURRENT';await assert.rejects(()=>f.port.apply(c),/STALE/);assert.equal(f.writes(),0);
});
test('Runtime statistics are excluded from saved-card revision',async()=>{
    const f=fixture(),a=await f.read(),b=await f.read();assert.equal(a.revision,b.revision);
});
test('Directory reorder/removal, target switch and cleanup invalidate private tickets',async()=>{
    for(const mutate of [f=>f.rows.push({name:'Bob',avatar:'Bob.png'}),f=>f.rows.splice(0),f=>f.setTarget({kind:'global',userKey:'other'}),f=>f.port.clear()]){
        const f=fixture(),c=await f.draft();mutate(f);await assert.rejects(()=>f.port.apply(c),/STALE|TARGET|INVALID/);assert.equal(f.writes(),0);
    }
});
test('Selected editor and generation block preview and approved dispatch without touching drafts',async()=>{
    for(const guard of ['editing','busy']){const f=fixture(),c=await f.draft();guard==='editing'?f.setEditing(true):f.setBusy(true);await assert.rejects(()=>f.port.apply(c),/EDITOR_OPEN|BUSY/);assert.equal(f.writes(),0);await assert.rejects(()=>f.draft(),/EDITOR_OPEN|BUSY/);}
});
test('Save rejection reports unknown without rollback, retry or cache mutation',async()=>{
    const f=fixture(),c=await f.draft();f.setSave(()=>{f.cards['Alice.png'].scenario='CONCURRENT';throw Error('failure');});
    assert.equal((await f.port.apply(c)).status,'outcome_unknown');assert.equal(f.writes(),1);assert.equal(f.cards['Alice.png'].scenario,'CONCURRENT');assert.equal(f.cache.length,0);
});
test('Unverified HTTP save and late cleanup cannot publish success or cache old data',async()=>{
    for(const mode of ['no-change','clear']){const f=fixture(),c=await f.draft();f.setSave(()=>{if(mode==='clear'){f.cards['Alice.png'].data.description='NEW';f.port.clear();}});assert.equal((await f.port.apply(c)).status,'outcome_unknown');assert.equal(f.cache.length,0);}
});
test('Source loads finishing after cleanup fail closed',async()=>{
    const f=fixture();f.setLoad(()=>f.port.clear());await assert.rejects(()=>f.read(),/STALE/);
});
test('Whole copy preview is refused rather than truncated when saved card is too large',async()=>{
    const f=fixture();f.cards['Alice.png'].data.extensions.unknown='x'.repeat(25000);await assert.rejects(()=>f.draft({},'copy'),/TOO_LARGE|limit/);assert.equal(f.copies(),0);
});
test('Avatar selectors cannot become server paths',()=>{
    for(const avatar of ['../x.png','a\\x.png','x:bad.png','a?.png']){const f=fixture();f.rows[0].avatar=avatar;assert.throws(()=>f.port.list(f.target),/UNSUPPORTED/);}
});
test('Native adapter uses official narrow endpoints and pointed merge fields only',async()=>{
    const calls=[],api=createNativeCharacterApi({getHeaders:()=>({'Content-Type':'application/json','X-CSRF-Token':'synthetic'}),fetch:async(path,options)=>{calls.push({path,options});return {ok:true,text:async()=>JSON.stringify(path.endsWith('duplicate')?{path:'new.png'}:{name:'Alice'})};}});
    await api.load('Alice.png');await api.save('Alice.png',{description:'new'});assert.equal(await api.duplicate('Alice.png'),'new.png');
    assert.deepEqual(calls.map(c=>c.path),['/api/characters/get','/api/characters/merge-attributes','/api/characters/duplicate']);assert.deepEqual(JSON.parse(calls[1].options.body),{avatar:'Alice.png',description:'new',data:{description:'new'}});assert.ok(calls.every(c=>c.options.method==='POST'));
});
test('Native HTTP rejection, malformed JSON and duplicate error fail closed',async()=>{
    const api=response=>createNativeCharacterApi({getHeaders:()=>({}),fetch:async()=>response});
    await assert.rejects(()=>api({ok:false}).load('a.png'),/HOST_REJECTED/);await assert.rejects(()=>api({ok:true,text:async()=>'{'}).load('a.png'));
    await assert.rejects(()=>api({ok:true,text:async()=>'{"error":true}'}).duplicate('a.png'),/COPY_UNKNOWN/);
});
test('Character receipt has no names, paths or text and supports restored explanation',()=>{
    const r=actionReceipt({id:'op',artifactId:'a',revision:1,status:'applied_unconfirmed',content:{module:'character-card',selector:'card:0',operation:'copy',name:'PRIVATE'},result:{resourceSave:'unconfirmed'}});
    assert.equal(r.version,33);assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);assert.match(receiptText(r,'zh'),/共享酒馆角色卡/);assert.match(receiptContext([r]),/Historical|历史|historical/);
    assert.throws(()=>validateReceipt({...r,selector:'../x.png'}),/INVALID/);
});

test('Legacy V1 saved format refuses three non-persisting fields despite a converted V2 read view',async()=>{
    const target={kind:'global',userKey:'page:legacy'},original={name:'Legacy',description:'OLD',personality:'calm',scenario:'tavern',first_mes:'hello',mes_example:'example',creatorcomment:'old notes',private:'preserve'};
    let saved=structuredClone(original),writes=0;
    const api=createNativeCharacterApi({getHeaders:()=>({}),fetch:async(path,options)=>{
        if(path.endsWith('/merge-attributes')){writes++;const {avatar,...changes}=JSON.parse(options.body);saved={...saved,...changes,data:{...saved.data,...changes.data}};return {ok:true};}
        // ST exposes a V2 view but retains the original saved V1 JSON in json_data.
        const data={...saved,creator_notes:saved.creatorcomment,system_prompt:'',post_history_instructions:''};
        return {ok:true,text:async()=>JSON.stringify({...saved,spec:'chara_card_v2',data,avatar:'Legacy.png',json_data:JSON.stringify(saved)})};
    }});
    const port=createCharacterCardPort({getTarget:()=>target,getDirectory:()=>[{name:'Legacy',avatar:'Legacy.png'}],load:api.load,save:api.save,isEditing:()=>false});
    const read=async()=>port.read(target,'card:0',port.list(target).revision),r=await read(),projection=JSON.parse(r.text);
    assert.deepEqual(projection.unsupportedUpdateFields,['creator_notes','system_prompt','post_history_instructions']);assert.equal(projection.fields.creator_notes.value,'old notes');
    for(const field of projection.unsupportedUpdateFields)for(const changes of [{[field]:'NEW'},{description:'NEW',[field]:'NEW'}]){
        await assert.rejects(()=>port.preview(target,{operation:'update',selector:'card:0',revision:r.revision,changes}),/UNSUPPORTED_CHARACTER/);
    }
    assert.equal(writes,0);assert.deepEqual(saved,original);
    for(const field of ['description','personality','scenario','first_mes','mes_example']){
        const current=await read(),draft=await port.preview(target,{operation:'update',selector:'card:0',revision:current.revision,changes:{[field]:'NEW'}});
        assert.equal((await port.apply(draft)).status,'applied_unconfirmed');assert.equal(saved[field],'NEW');
    }
    assert.equal(writes,5);assert.equal(saved.spec,undefined);assert.equal(saved.private,'preserve');assert.equal(saved.creatorcomment,'old notes');
});
test('V2 cards permit all eight text fields and format changes invalidate approved drafts',async()=>{
    const f=fixture();assert.deepEqual(JSON.parse((await f.read()).text).unsupportedUpdateFields,[]);
    for(const field of Object.keys(CHARACTER_TEXT_FIELDS)){const c=await f.draft({[field]:'NEW'});assert.equal((await f.port.apply(c)).status,'applied_unconfirmed');assert.equal(f.cards['Alice.png'].data[field],'NEW');}
    const c=await f.draft({system_prompt:'NEXT'});delete f.cards['Alice.png'].spec;
    await assert.rejects(()=>f.port.apply(c),/STALE/);assert.equal(f.writes(),8);
});
