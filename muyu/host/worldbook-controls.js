import { randomUUID } from '../runtime/crypto.js';
import { copyJson, jsonKey } from '../core/json-contract.js';
import { visibleWorldBookState, isInternalWorldBook } from '../../systems/internal-world-books.js';

/** Native binding/delete workflows; never delegates to arbitrary Slash commands. */
export function createWorldBookControls({ getTarget, getChatTarget, getState, getReferences, load, refresh, setGlobal, setChat, remove, isBusy = () => false }) {
    const plans = new Map(); let version = null, busy = false, epoch = 0;
    function snapshot(target) {
        if (busy || isBusy()) throw Error('WORLD_BOOK_BUSY');
        const actual = getTarget(), state = visibleWorldBookState(getState());
        if (!actual || actual.userKey !== target?.userKey || !['global','chat'].includes(target.kind)) throw Error('TARGET_UNAVAILABLE');
        if (!Array.isArray(state?.names) || !Array.isArray(state?.global) || state.names.length > 512 || state.global.length > 512 || new Set(state.names).size !== state.names.length || state.names.some(n => typeof n !== 'string' || !n.trim() || n.length > 200) || state.global.some(n => typeof n !== 'string')) throw Error('UNSUPPORTED_WORLD_BOOK');
        return copyJson({target:actual,chatTarget:getChatTarget?.() || null,names:state.names,global:state.global,chat:typeof state.chat === 'string' ? state.chat : ''});
    }
    function revision(state) { const key = jsonKey(state); if (version?.key !== key) version = {key,id:randomUUID()}; return version.id; }
    function refs(name) {
        const value = getReferences?.(name);
        if (!value || !Number.isSafeInteger(value.known) || value.known < 0) throw Error('WORLD_BOOK_REFERENCES_UNKNOWN');
        return copyJson(value);
    }
    const equal = (a,b) => jsonKey(a) === jsonKey(b);
    return Object.freeze({
        read(target) { const state=snapshot(target); return {revision:revision(state),global:state.global,chat:state.chat,hasChat:!!state.chatTarget,scope:'global-activation-and-current-chat-binding',unloadedChatReferences:'unknown'}; },
        async preview(target,args) {
            const state=snapshot(target), expectedEpoch=epoch;
            if (args.name !== undefined || !args.changes || typeof args.changes!=='object' || Array.isArray(args.changes)) throw Error('INVALID_WORLD_BOOK_EDIT');
            let before,after,name='',references=null,bookData=null;
            if (args.operation==='delete_book') {
                if (!/^book:(0|[1-9]\d{0,2})$/.test(args.selector) || Object.keys(args.changes).length || typeof refresh !== 'function' || typeof remove !== 'function') throw Error('INVALID_WORLD_BOOK_EDIT');
                const index=Number(args.selector.slice(5));name=state.names[index];if (!name) throw Error('INVALID_WORLD_BOOK_EDIT');
                references=refs(name);if(references.known)throw Error('WORLD_BOOK_STILL_BOUND');
                bookData=await load(name);if(isInternalWorldBook(name,bookData))throw Error('INVALID_WORLD_BOOK_EDIT');before=copyJson(bookData);after=null;
                // Editor passes the exact existing book revision only after capturing the whole book.
                if (JSON.stringify(bookData)!==args.bookBaseline) throw Error('STALE_WORLD_BOOK_EDIT');
            } else {
                if (args.selector!=='' || args.revision!==revision(state)) throw Error('STALE_WORLD_BOOK_EDIT');
                if(args.operation==='set_global_binding') {
                    if(typeof setGlobal!=='function' || Object.keys(args.changes).join()!=='names' || !Array.isArray(args.changes.names) || args.changes.names.length>512 || new Set(args.changes.names).size!==args.changes.names.length || args.changes.names.some(n=>!state.names.includes(n)))throw Error('INVALID_WORLD_BOOK_EDIT');
                    before=state.global;after=copyJson(args.changes.names);
                } else if(args.operation==='set_chat_binding') {
                    if(!state.chatTarget)throw Error('TARGET_UNAVAILABLE');
                    if(typeof setChat!=='function' || Object.keys(args.changes).join()!=='name' || typeof args.changes.name!=='string' || args.changes.name && !state.names.includes(args.changes.name))throw Error('INVALID_WORLD_BOOK_EDIT');
                    before=state.chat;after=args.changes.name;
                } else throw Error('INVALID_WORLD_BOOK_EDIT');
                if(equal(before,after))throw Error('EMPTY_CHANGES');
                // A manually renamed archive still carries its data marker.
                if(typeof load==='function')for(const selected of (Array.isArray(after)?after:after?[after]:[])){
                    if(isInternalWorldBook(selected,await load(selected)))throw Error('INVALID_WORLD_BOOK_EDIT');
                }
            }
            if(epoch!==expectedEpoch || !equal(snapshot(target),state))throw Error('STALE_WORLD_BOOK_EDIT');
            const content=copyJson({module:'worldbook-editor',ticket:'worldbook-control:'+randomUUID(),target:state.target,name:name||'World-book binding',selector:args.selector,operation:args.operation,before,after,warnings:[
                args.operation==='set_chat_binding' ? '仅替换当前聊天的单本世界书绑定；空名解绑。 / Replaces this chat binding only; empty name unbinds.' : args.operation==='set_global_binding' ? '整项替换酒馆全局激活列表，影响所有聊天。 / Replaces the entire ST global activation list for all chats.' : '永久删除整本共享资源，不提供撤销。已知引用必须先解绑；未加载聊天的引用未知，可能失去资源。 / Permanently deletes a shared book. Unbind known references first; references in unloaded chats are unknown.',
                '绑定或激活不证明实际注入，不修改GroupWorld的世界书选择策略，不调用生成。 / Binding/activation does not prove injection. GroupWorld selection policy unchanged; no generation.',
                '结果未知不自动重试或回滚；保存不证明持久化。删除会由酒馆刷新编辑器，请先保存／放弃其草稿。 / No retries or rollback on unknown outcome. Persistence unconfirmed. Deletion refreshes the ST editor; save/discard its drafts first.'
            ]});
            if(new TextEncoder().encode(JSON.stringify(content)).length>24000)throw Error('WORLD_BOOK_DRAFT_TOO_LARGE');
            if(plans.size>=64)throw Error('WORLD_BOOK_PLAN_CAPACITY');
            plans.set(content.ticket,{content:copyJson(content),state,references,bookData:bookData ? JSON.stringify(bookData) : null,epoch});return content;
        },
        assertFresh(content) { const plan=plans.get(content?.ticket);if(!plan || !equal(content,plan.content) || !equal(snapshot(content.target),plan.state))throw Error('STALE_WORLD_BOOK_EDIT');if(plan.references && !equal(refs(content.name),plan.references))throw Error('STALE_WORLD_BOOK_EDIT');return plan; },
        release:content=>plans.delete(content?.ticket),clear(){plans.clear();version=null;epoch++;},
        async apply(content) {
            const plan=this.assertFresh(content);
            if(content.operation==='delete_book') {
                await refresh();this.assertFresh(content);const data=await load(content.name);
                if(JSON.stringify(data)!==plan.bookData)throw Error('STALE_WORLD_BOOK_EDIT');this.assertFresh(content);
            }
            busy=true;
            try {
                if(content.operation==='delete_book') {
                    const acknowledged=await remove(content.name);
                    if(acknowledged!==true)return {status:'outcome_unknown',resourceSave:'unknown'};
                    await refresh();
                    return {status:equal(getTarget(),content.target)&&!getState()?.names?.includes(content.name)?'applied_unconfirmed':'outcome_unknown',resourceSave:'unconfirmed'};
                }
                if(content.operation==='set_global_binding')await setGlobal(copyJson(content.after));
                else await setChat(content.after,copyJson(plan.state.chatTarget));
                const state=visibleWorldBookState(getState()),sameTarget=equal(getTarget(),content.target),sameChat=equal(getChatTarget?.()||null,plan.state.chatTarget);
                const sameValue=content.operation==='set_global_binding'?equal(state.global,content.after):sameChat&&(state.chat||'')===content.after;
                return {status:sameTarget&&sameValue?'applied_unconfirmed':'outcome_unknown',resourceSave:'unconfirmed'};
            } catch {return {status:'outcome_unknown',resourceSave:'unknown'};}
            finally {busy=false;plans.delete(content.ticket);version=null;}
        }
    });
}
