import { randomUUID } from '../runtime/crypto.js';
/** Narrow official HTTP adapter. No form submission, Slash command or full UI reload. */
export function createNativeCharacterApi({fetch:request=globalThis.fetch,getHeaders}) {
    async function post(path,body,json=false) {
        const response=await request(path,{method:'POST',headers:getHeaders(),body:JSON.stringify(body),cache:'no-cache'});
        if(!response.ok)throw Error('CHARACTER_HOST_REJECTED');
        if(!json)return true;
        const text=await response.text();if(text.length>1048576)throw Error('CHARACTER_TOO_LARGE');return JSON.parse(text);
    }
    return Object.freeze({
        load:avatar=>post('/api/characters/get',{avatar_url:avatar},true),
        save:(avatar,changes)=>post('/api/characters/merge-attributes',{avatar,...changes,data:{...changes}}),
        duplicate:async avatar=>{const value=await post('/api/characters/duplicate',{avatar_url:avatar},true);if(typeof value?.path!=='string'||value.error)throw Error('CHARACTER_COPY_UNKNOWN');return value.path;},
        create:async fields=>{const response=await request('/api/characters/create',{method:'POST',headers:getHeaders(),cache:'no-cache',body:JSON.stringify({ch_name:fields.name,...Object.fromEntries(Object.entries(fields).filter(([key])=>key!=='name')),file_name:'muyu-'+randomUUID(),fav:'false',world:'',tags:[],alternate_greetings:[]})});if(!response.ok)throw Error('CHARACTER_CREATE_UNKNOWN');const avatar=await response.text();if(avatar.length>200)throw Error('CHARACTER_CREATE_UNKNOWN');return avatar;},
        remove:avatar=>post('/api/characters/delete',{avatar_url:avatar,delete_chats:false}),
        exists:async avatar=>{const response=await request('/api/characters/get',{method:'POST',headers:getHeaders(),cache:'no-cache',body:JSON.stringify({avatar_url:avatar})});if(response.status===404)return false;if(!response.ok)throw Error('CHARACTER_HOST_REJECTED');return true;},
    });
}
