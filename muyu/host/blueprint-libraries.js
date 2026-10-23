import { randomUUID } from '../runtime/crypto.js';
import { copyJson, jsonKey } from '../core/json-contract.js';
import { validateBlueprintLibraryDefinition } from '../../systems/blueprint-library-validation.js';
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const entryKeys = ['id','name','description','createdAt','updatedAt','sourceGroupName','blueprintTitle','nodeCount','stepCount','includeProgress','exportData'];
export function createBlueprintLibraryPort({ getSettings, system }) {
    const versions = new Map();
    const rows = () => {
        const list = getSettings()?.storyBlueprintLibraries ?? [];
        if (!Array.isArray(list) || list.length>256 || list.some(row=>!record(row)||typeof row.id!=='string'||!row.id||row.id.length>100)
            || new Set(list.map(row=>row.id)).size!==list.length) throw Error('LIBRARY_STORE_UNAVAILABLE');
        return list;
    };
    function revision(row) {
        const fingerprint=JSON.stringify(row), old=versions.get(row.id);
        if(!old || old.row!==row || old.fingerprint!==fingerprint) versions.set(row.id,{row,fingerprint,revision:randomUUID()});
        return versions.get(row.id).revision;
    }
    function existing(id, expected) {
        const row=rows().find(row=>row.id===id);
        if(!row || revision(row)!==expected) throw Error('STALE_LIBRARY_ASSET');
        return row;
    }
    function definition(input) {
        const value=copyJson(input);
        value.name=typeof value.name==='string'?value.name.trim():value.name;
        if(value.exportData && !value.exportData.type && Array.isArray(value.exportData.nodes)) {
            value.exportData={type:'group-director-story-blueprint',version:1,storyBlueprint:{blueprint:value.exportData}};
        }
        validateBlueprintLibraryDefinition(value);
        value.exportData.libraryMeta={...value.exportData.libraryMeta,name:value.name,description:value.description};
        return value;
    }
    function preview({operation,id='',revision:expected='',changes={}}) {
        if(!['create','update','delete'].includes(operation)||!record(changes)||Object.keys(changes).some(key=>!['name','description','exportData'].includes(key))
            ||operation==='create'&&(id||expected)||operation==='delete'&&Object.keys(changes).length) throw Error('INVALID_LIBRARY_DRAFT');
        if(!system?.mutateApproved) throw Error('WRITE_UNAVAILABLE');
        const previous=operation==='create'?null:copyJson(existing(id,expected));
        if(previous&&Object.keys(previous).some(key=>!entryKeys.includes(key))) throw Error('LIBRARY_ASSET_UNSUPPORTED');
        const base=previous?{name:previous.name,description:previous.description||'',exportData:previous.exportData}:{description:''};
        const next=operation==='delete'?null:definition({...base,...changes});
        if(next&&rows().some(row=>row.id!==id&&row.name===next.name)) throw Error('LIBRARY_NAME_CONFLICT');
        if(operation==='create'&&rows().length>=256) throw Error('LIBRARY_STORE_UNAVAILABLE');
        const content={module:'blueprint-library',operation,id,baseRevision:expected,previous,next,
            warnings:['仅修改全局蓝图库，不读取或应用当前聊天蓝图、进度、完成变量，不调用模型或启用功能。',
                '包内进度仅作为资源保存，不证明任何聊天实际完成了节点；旧库条目删除不清除已应用的聊天蓝图。',
                '节点与引用校验不证明剧情合理；保存异常可能保留内存修改，未知结果不自动重试。']};
        if(new TextEncoder().encode(JSON.stringify(content)).length>24000) throw Error('LIBRARY_DRAFT_TOO_LARGE');
        return copyJson(content);
    }
    function assertDraft(content) {
        const rebuilt=preview({operation:content.operation,id:content.id,revision:content.baseRevision,changes:content.next||{}});
        if(jsonKey(rebuilt)!==jsonKey(content)) throw Error('INVALID_LIBRARY_DRAFT');
    }
    return Object.freeze({
        list(offset=0) {
            if(!Number.isInteger(offset)||offset<0||offset>256) throw Error('INVALID_LIBRARY_ARGUMENTS');
            const list=rows();for(const id of versions.keys())if(!list.some(row=>row.id===id))versions.delete(id);
            return {items:list.slice(offset,offset+24).map(row=>({id:row.id,name:String(row.name).slice(0,80),revision:revision(row)})),nextOffset:offset+24<list.length?offset+24:-1};
        },
        read(id,expected,offset=0) {
            const row=existing(id,expected),text=JSON.stringify(Object.fromEntries(entryKeys.filter(key=>row[key]!==undefined).map(key=>[key,row[key]])));
            if(text.length>1048576||!Number.isInteger(offset)||offset<0||offset>text.length)throw Error('LIBRARY_ASSET_UNSUPPORTED');
            return {id,revision:expected,text:text.slice(offset,offset+6000),nextOffset:offset+6000<text.length?offset+6000:-1,format:'json',untrusted:true};
        },
        exportEntry(id,expected) {
            const row=existing(id,expected),value=definition({name:row.name,description:row.description||'',exportData:row.exportData}).exportData;
            if(new TextEncoder().encode(JSON.stringify(value)).length>20000)throw Error('LIBRARY_EXPORT_TOO_LARGE');
            return value;
        },
        preview,assertDraft,
        async save(content, { beforeApply = () => {} } = {}) {
            assertDraft(content);const settings=getSettings();
            const result=await system.mutateApproved({operation:content.operation,id:content.id,definition:content.next,expectedSettings:settings,
                validate:()=>{if(getSettings()!==settings)throw Error('STALE_LIBRARY_ASSET');assertDraft(content);beforeApply();}});
            return settings===getSettings()?result:{...result,status:'outcome_unknown',persistence:'unknown'};
        },
    });
}
