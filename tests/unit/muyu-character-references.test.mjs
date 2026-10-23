import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as rawReadFile } from 'node:fs/promises';
const readFile = async (...args) => { const data = await rawReadFile(...args); return typeof data === 'string' ? data.replace(/\r\n/g, '\n') : data; };
import { createCharacterCardPort } from '../../muyu/host/character-cards.js';

// Exercise the production assembly closure without importing ST's browser modules.
const source=await readFile(new URL('../../index.js',import.meta.url),'utf8');
const closure=source.split('getMuyuCharacterReferences: ')[1].split(',\n        getMuyuWorldBookReferences:')[0];
function fixture(tags){
    const avatar='Alice.png',target={kind:'global',userKey:'page:references'},context={groups:[],tagMap:tags,characters:[{name:'Alice',avatar}],characterId:undefined};
    const getReferences=Function('getContext','extension_settings','world_info','getChatMetadata','EXT_KEY',`return (${closure});`)(()=>context,{}, {},()=>({}),'group_director');
    let removes=0;
    const saved={name:'Alice',description:'Unreferenced'};
    const port=createCharacterCardPort({getTarget:()=>target,getDirectory:()=>context.characters,load:async()=>({...saved,avatar,json_data:JSON.stringify(saved)}),getReferences,isEditing:()=>false,remove:async()=>{removes++;},exists:async()=>false});
    const draft=async()=>{const r=await port.read(target,'card:0',port.list(target).revision);return port.preview(target,{operation:'delete',selector:'card:0',revision:r.revision,changes:{}});};
    return {context,getReferences,port,draft,removes:()=>removes,avatar};
}
test('Empty or absent ST tag bookkeeping is not an actual character reference',async()=>{
    for(const tags of [{},{'Alice.png':[]}]){const f=fixture(tags);assert.equal(f.getReferences(f.avatar).known,0);const c=await f.draft();assert.equal(f.removes(),0);assert.equal((await f.port.apply(c)).status,'applied_unconfirmed');assert.equal(f.removes(),1);assert.deepEqual(f.context.tagMap,tags);}
});
test('Actual tags still block deletion and newly assigned tags invalidate approval',async()=>{
    const f=fixture({'Alice.png':['tag-id']});assert.equal(f.getReferences(f.avatar).known,1);await assert.rejects(()=>f.draft(),/CHARACTER_REFERENCED/);assert.equal(f.removes(),0);
    const g=fixture({'Alice.png':[]}),c=await g.draft();g.context.tagMap[g.avatar].push('new-tag');await assert.rejects(()=>g.port.apply(c),/CHARACTER_REFERENCED/);assert.equal(g.removes(),0);
});
test('Malformed tag mappings fail closed rather than approving an unverified deletion',async()=>{
    for(const value of [null,undefined,{},'tag-id',[null],[1],['']]){const f=fixture({'Alice.png':value});assert.equal(f.getReferences(f.avatar),null);await assert.rejects(()=>f.draft(),/CHARACTER_REFERENCES_UNAVAILABLE/);assert.equal(f.removes(),0);}
});
test('No tags does not bypass current-character or group references',async()=>{
    for(const mutate of [f=>f.context.characterId=0,f=>f.context.groups=[{members:[f.avatar]}],f=>f.context.groups=[{members:[],disabled_members:[f.avatar]}]]){const f=fixture({'Alice.png':[]});mutate(f);assert.equal(f.getReferences(f.avatar).known,1);await assert.rejects(()=>f.draft(),/CHARACTER_REFERENCED/);assert.equal(f.removes(),0);}
});
