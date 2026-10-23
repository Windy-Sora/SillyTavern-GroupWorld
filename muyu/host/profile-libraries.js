import { randomUUID } from '../runtime/crypto.js';
import { copyJson, jsonKey } from '../core/json-contract.js';
import { validateProfileLibraryDefinition } from '../../systems/profile-library-validation.js';
const record=v=>v && typeof v==='object' && !Array.isArray(v);
const entryKeys=['id','name','description','createdAt','updatedAt','sourceGroupName','profileCount','exportData'];
export function createProfileLibraryPort({ getSettings, system }) {
    const versions=new Map();
    const rows=()=>{
        const list=getSettings()?.profileLibraries ?? [];
        if (!Array.isArray(list) || list.length>256 || list.some(r=>!record(r)||typeof r.id!=='string'||!r.id||r.id.length>100)) throw Error('LIBRARY_STORE_UNAVAILABLE');
        return list;
    };
    function revision(row) {
        const fingerprint=JSON.stringify(row),old=versions.get(row.id);
        if(!old||old.row!==row||old.fingerprint!==fingerprint) versions.set(row.id,{row,fingerprint,revision:randomUUID()});
        return versions.get(row.id).revision;
    }
    function existing(id,expected) {
        const found=rows().filter(r=>r.id===id);
        if(found.length!==1||revision(found[0])!==expected) throw Error('STALE_LIBRARY_ASSET');
        return found[0];
    }
    function definition(input) {
        const result=copyJson(input);
        result.name=typeof result.name==='string'?result.name.trim():result.name;
        validateProfileLibraryDefinition(result);
        result.exportData.libraryMeta={version:1,...result.exportData.libraryMeta,name:result.name,description:result.description};
        return result;
    }
    function autoSnapshot() { return copyJson(getSettings()?.profileLibraryAutoLoad ?? null); }
    function preview({operation,id='',revision:expected='',changes={}}) {
        if(!['create','update','delete'].includes(operation)||!record(changes)||Object.keys(changes).some(k=>!['name','description','exportData'].includes(k))
            ||operation==='create'&&(id||expected)||operation==='delete'&&Object.keys(changes).length) throw Error('INVALID_LIBRARY_DRAFT');
        if(!system?.mutateApproved) throw Error('WRITE_UNAVAILABLE');
        if(system.isAutoLoading?.()) throw Error('LIBRARY_BUSY');
        const previous=operation==='create'?null:copyJson(existing(id,expected));
        if(previous&&Object.keys(previous).some(k=>!entryKeys.includes(k))) throw Error('LIBRARY_ASSET_UNSUPPORTED');
        const base=previous?{name:previous.name,description:previous.description||'',exportData:previous.exportData}:{description:''};
        const next=operation==='delete'?null:definition({...base,...changes});
        if(next&&rows().some(r=>r.id!==id&&r.name===next.name)) throw Error('LIBRARY_NAME_CONFLICT');
        if(operation==='create'&&rows().length>=256) throw Error('LIBRARY_STORE_UNAVAILABLE');
        const autoBefore=autoSnapshot(), resetFixed=operation==='delete'&&autoBefore?.fixedId===id;
        const content={module:'profile-library',operation,id,baseRevision:expected,previous,next,autoBefore,
            autoAfter:operation==='delete'?{enabled:false,mode:'best',fixedId:'',matchHash:true,matchAvatarName:true,matchNameOnly:false,overwriteExisting:false,importTemplate:false,...autoBefore,...resetFixed&&{fixedId:'',mode:'best',enabled:false}}:autoBefore,
            warnings:['仅修改全局角色档案库，不读取或立即替换当前聊天档案，不应用全局档案模板，不调用模型。',
                '保存的包可能被后续自动加载选中；包内模板仅保存为资源，本次不应用。格式校验不代表内容与模板语义匹配。',
                resetFixed?'此包是固定加载目标：删除会同时清除固定选择、切回最佳匹配并关闭自动加载。':'本操作不修改自动加载配置。']};
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
            const list=rows(); for(const id of versions.keys()) if(!list.some(r=>r.id===id)) versions.delete(id);
            return {items:list.slice(offset,offset+24).map(r=>({id:r.id,name:String(r.name).slice(0,80),profileCount:Array.isArray(r.exportData?.profiles)?r.exportData.profiles.length:0,revision:revision(r)})),
                nextOffset:offset+24<list.length?offset+24:-1};
        },
        read(id,expected,offset=0) {
            const row=existing(id,expected),text=JSON.stringify(Object.fromEntries(entryKeys.filter(k=>row[k]!==undefined).map(k=>[k,row[k]])));
            if(text.length>1048576||!Number.isInteger(offset)||offset<0||offset>text.length) throw Error('LIBRARY_ASSET_UNSUPPORTED');
            return {id,revision:expected,text:text.slice(offset,offset+6000),nextOffset:offset+6000<text.length?offset+6000:-1,format:'json',untrusted:true};
        },
        exportEntry(id,expected) {
            const row=existing(id,expected);
            const value=definition({name:row.name,description:row.description||'',exportData:row.exportData}).exportData;
            if(new TextEncoder().encode(JSON.stringify(value)).length>20000) throw Error('LIBRARY_EXPORT_TOO_LARGE');
            return value;
        },
        preview,assertDraft,
        async save(content, { beforeApply = () => {} } = {}) {
            assertDraft(content);const settings=getSettings();
            const result=await system.mutateApproved({operation:content.operation,id:content.id,definition:content.next,expectedSettings:settings,
                validate:()=>{if(getSettings()!==settings)throw Error('STALE_LIBRARY_ASSET');assertDraft(content); beforeApply();}});
            const sameAuto=jsonKey(autoSnapshot())===jsonKey(content.autoAfter);
            return settings===getSettings()&&sameAuto?result:{...result,status:'outcome_unknown',persistence:'unknown'};
        },
    });
}
