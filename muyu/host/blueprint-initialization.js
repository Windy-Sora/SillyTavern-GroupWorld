import { randomUUID } from '../runtime/crypto.js';
import { copyJson, jsonKey } from '../core/json-contract.js';
import { inspectBlueprintCompletion } from './blueprint-completion.js';
import { projectBlankBlueprintCreation, applyApprovedBlueprintLibraryChat } from '../../systems/blueprint-library-chat.js';
const record = v => v && typeof v === 'object' && !Array.isArray(v);
/** First blank Blueprint only; never reuse this tool to replace an existing tree. */
export function createBlueprintInitializationPort({ getTarget, getMetadata, getSettings, getChatLength, extensionKey, saveStructureConfirmed, isBusy = () => false, changed }) {
    const versions = new Map(), plans = new Map();
    function context(target) {
        if (target?.kind !== 'chat' || jsonKey(target) !== jsonKey(getTarget())) throw Error('TARGET_UNAVAILABLE');
        if (isBusy()) throw Error('BLUEPRINT_BUSY');
        const metadata = getMetadata(), root = metadata?.[extensionKey], state = root?.storyBlueprint, settings = getSettings?.(), length = getChatLength?.();
        if (!record(metadata) || root !== undefined && !record(root) || state !== undefined && !record(state) || !record(settings) || !Number.isSafeInteger(length) || length < 0) throw Error('UNSUPPORTED_BLUEPRINT_STORE');
        if (state?.continuePending) throw Error('BLUEPRINT_BUSY');
        if (state?.blueprint != null && !record(state.blueprint)) throw Error('UNSUPPORTED_BLUEPRINT_STORE');
        const config = copyJson(Object.fromEntries(['lang','storyBlueprintProgressionMode','storyBlueprintProgressionLevel','storyBlueprintCompletionVariable','storyBlueprintCompletionVariableGuard'].filter(k => settings[k] !== undefined).map(k => [k,settings[k]])));
        if (config.lang !== undefined && !['zh','en'].includes(config.lang) || config.storyBlueprintProgressionMode !== undefined && !['leaf','all','level'].includes(config.storyBlueprintProgressionMode) || config.storyBlueprintProgressionLevel !== undefined && (!Number.isSafeInteger(config.storyBlueprintProgressionLevel) || config.storyBlueprintProgressionLevel < 0)) throw Error('UNSUPPORTED_BLUEPRINT_STORE');
        const { vars, completion } = inspectBlueprintCompletion(settings, root);
        const snapshot = copyJson({ state: state ?? null, config, length, completion });
        if (metadata !== getMetadata() || jsonKey(target) !== jsonKey(getTarget())) throw Error('TARGET_UNAVAILABLE');
        return { metadata, root, state, settings, vars, globalValues: vars?.values.global, snapshot };
    }
    const sameRefs = (a,b) => a.metadata === b.metadata && a.root === b.root && a.state === b.state && a.settings === b.settings && a.vars === b.vars && a.globalValues === b.globalValues;
    function revision(live,target) {
        const key = jsonKey(target), fp = jsonKey(live.snapshot), old = versions.get(key);
        if (!old || !sameRefs(live,old.live) || old.fp !== fp) versions.set(key,{live,fp,revision:randomUUID()});
        if (versions.size > 64) versions.delete(versions.keys().next().value);
        return versions.get(key).revision;
    }
    function read(target,offset = 0) {
        const live = context(target), text = JSON.stringify({ canInitialize: live.state?.blueprint == null, ...live.snapshot, persistence:'unknown', untrusted:true,
            notice:'First blank Blueprint only; existing trees (even empty) cannot be overwritten. Old stored progress resets; existing compatible completion resets false, missing variable not created. No feature enabling or generation.' });
        if (!Number.isInteger(offset) || offset < 0 || offset > text.length) throw Error('INVALID_BLUEPRINT_INITIALIZATION');
        return { revision:revision(live,target), text:text.slice(offset,offset+6000), nextOffset:offset+6000<text.length?offset+6000:-1, untrusted:true };
    }
    function preview(target,args) {
        const live = context(target);
        if (live.state?.blueprint != null) throw Error('BLUEPRINT_ALREADY_EXISTS');
        if (revision(live,target) !== args.revision) throw Error('STALE_BLUEPRINT_NODE_EDIT');
        const changes = copyJson(args.changes);
        if (!record(changes) || Object.keys(changes).length) throw Error('INVALID_BLUEPRINT_INITIALIZATION');
        const before = live.snapshot.state, after = copyJson(projectBlankBlueprintCreation({ before, settings:live.snapshot.config, chatLength:live.snapshot.length })), completion = live.snapshot.completion;
        const content = copyJson({ module:'blueprint-node-editor', operation:'initialize', ticket:'blueprint-initialize:'+randomUUID(), target, selector:'blueprint-new', name:after.blueprint.title,
            before, after, affected:['node_001'], completion:{before:completion,after:completion.exists?{...completion,stored:true,value:false}:completion},
            warnings:['首次创建当前聊天的空白蓝图和默认章节；不覆盖已有蓝图、修改资源库、开启功能或调用生成模型。 / Create the first blank Blueprint and default chapter in this chat; no replacement, library edit, enabling or generation.',
                '按旧界面新建规则清空各模式／层级进度及旧完成提示；完整差异显示被清除的记录。 / Reset all progress scopes and notices using the existing blank-creation rules; inspect removed records in the full diff.',
                completion.exists?'已有兼容完成值重置为false；不修改变量定义。 / Reset the existing compatible completion value to false; definition unchanged.':'没有完成变量，不创建变量。 / No completion variable is created.',
                '保存未知不自动重试或整仓回滚；空白蓝图不是已生成的剧情。 / Unknown saving never auto-retries or restores the store; a blank Blueprint is not generated story content.'] });
        if (new TextEncoder().encode(JSON.stringify(content)).length > 24000) throw Error('BLUEPRINT_NODE_DRAFT_TOO_LARGE');
        if (plans.size >= 64) throw Error('BLUEPRINT_NODE_PLAN_CAPACITY');
        plans.set(content.ticket,{live,content:copyJson(content)});
        return content;
    }
    function assertFresh(content) {
        const plan = plans.get(content?.ticket);
        if (!plan || jsonKey(plan.content) !== jsonKey(content)) throw Error('STALE_BLUEPRINT_NODE_EDIT');
        const live = context(content.target);
        if (live.state?.blueprint != null || !sameRefs(live,plan.live) || jsonKey(live.snapshot) !== jsonKey(plan.live.snapshot)) throw Error('STALE_BLUEPRINT_NODE_EDIT');
        return plan;
    }
    return Object.freeze({read,preview,assertFresh,release:content=>plans.delete(content?.ticket),clear(){versions.clear();plans.clear();},async apply(content){
        const plan = assertFresh(content);
        try {
            const result = await applyApprovedBlueprintLibraryChat({ metadata:plan.live.metadata,extensionKey,after:content.after,completion:content.completion.before,validate:()=>assertFresh(content),saveChatConfirmed:saveStructureConfirmed,
                isCurrent:()=>{const live=context(content.target);return live.metadata===plan.live.metadata && live.settings===plan.live.settings && live.vars===plan.live.vars && live.globalValues===plan.live.globalValues && jsonKey(live.snapshot.state)===jsonKey(content.after) && jsonKey(live.snapshot.completion)===jsonKey(content.completion.after) && jsonKey(live.snapshot.config)===jsonKey(plan.live.snapshot.config) && live.snapshot.length===plan.live.snapshot.length;}});
            try { if (getMetadata() === plan.live.metadata && jsonKey(getTarget()) === jsonKey(content.target)) changed?.(); } catch { /* View observers cannot alter the save result. */ }
            return result;
        } finally {plans.delete(content.ticket);}
    }});
}
