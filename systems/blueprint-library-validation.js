const record=v=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const closed=(v,keys)=>record(v)&&Object.keys(v).every(k=>keys.includes(k));
const text=(v,max)=>typeof v==='string'&&v.length<=max;
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const scope=k=>k==='leaf'||k==='all'||/^level:(0|[1-9]\d*)$/.test(k)&&Number.isSafeInteger(Number(k.slice(6)));
const fail=()=>{throw Error('INVALID_LIBRARY_DRAFT');};
/** Strict portable library contract; no chat initialization or normalization with ID rewriting. */
export function validateBlueprintLibraryDefinition(value){
    if(!closed(value,['name','description','exportData'])||!text(value.name,80)||!value.name.trim()||!text(value.description,1000))fail();
    const data=value.exportData;
    if(!closed(data,['type','version','exportedAt','source','libraryMeta','storyBlueprint'])||data.type!=='group-director-story-blueprint'||data.version!==1)fail();
    if(data.exportedAt!==undefined&&!text(data.exportedAt,100))fail();
    if(data.source!==undefined&&(!closed(data.source,['groupName','groupNote'])||Object.values(data.source).some(v=>!text(v,1000))))fail();
    const meta=data.libraryMeta;
    if(meta!==undefined&&(!closed(meta,['name','description','createdAt','updatedAt','includeProgress'])
        ||['name','description'].some(k=>meta[k]!==undefined&&!text(meta[k],1000))
        ||['createdAt','updatedAt'].some(k=>meta[k]!==undefined&&!integer(meta[k]))
        ||meta.includeProgress!==undefined&&typeof meta.includeProgress!=='boolean'))fail();
    const state=data.storyBlueprint;
    if(!closed(state,['blueprint','doneSignals','progressTracks','activeProgressKey','legacyDoneSignals','lastGeneratedAt','lastError','completeNoticeKey','continuePending']))fail();
    const blueprint=state.blueprint,ids=new Set();let nodeCount=0;
    if(!closed(blueprint,['version','title','meta','nodes'])||blueprint.version!==1||!text(blueprint.title,256)||!blueprint.title.trim()
        ||blueprint.meta!==undefined&&!record(blueprint.meta)||!Array.isArray(blueprint.nodes)||!blueprint.nodes.length)fail();
    function visit(nodes,depth){
        if(depth>8||!Array.isArray(nodes))fail();
        for(const node of nodes){
            if(++nodeCount>256||!closed(node,['id','type','title','content','children'])||!text(node.id,128)||!node.id.trim()||node.id!==node.id.trim()||ids.has(node.id)
                ||!text(node.type,80)||!node.type||!text(node.title,256)||!node.title||!record(node.content))fail();
            ids.add(node.id);if(node.children!==undefined)visit(node.children,depth+1);
        }
    }
    visit(blueprint.nodes,1);
    function signals(rows,legacy=false){
        if(!Array.isArray(rows)||rows.length>256)fail();
        const seen=new Set();
        for(const row of rows){
            if(!closed(row,['nodeId','stepIndex','chatLength','time','source'])||!text(row.nodeId,128)||!row.nodeId||!legacy&&!ids.has(row.nodeId)||seen.has(row.nodeId)
                ||['stepIndex','chatLength','time'].some(k=>row[k]!==undefined&&!integer(row[k]))||row.source!==undefined&&!text(row.source,100))fail();
            seen.add(row.nodeId);
        }
    }
    if(state.doneSignals!==undefined)signals(state.doneSignals);
    if(state.legacyDoneSignals!==undefined)signals(state.legacyDoneSignals,true);
    if(state.progressTracks!==undefined){
        if(!record(state.progressTracks)||Object.keys(state.progressTracks).length>32)fail();
        for(const [key,track]of Object.entries(state.progressTracks)){
            if(!scope(key)||!closed(track,['doneSignals','completeNoticeKey'])||track.completeNoticeKey!==undefined&&!text(track.completeNoticeKey,1000))fail();
            signals(track.doneSignals);
        }
    }
    if(state.activeProgressKey!==undefined&&!scope(state.activeProgressKey))fail();
    if(state.lastGeneratedAt!==undefined&&!integer(state.lastGeneratedAt)||state.continuePending!==undefined&&typeof state.continuePending!=='boolean'
        ||['lastError','completeNoticeKey'].some(k=>state[k]!==undefined&&!text(state[k],1000)))fail();
    const hasProgress=!!(state.doneSignals?.length||state.legacyDoneSignals?.length||Object.values(state.progressTracks||{}).some(t=>t.doneSignals.length));
    if(meta?.includeProgress===false&&hasProgress)fail();
    return {nodeCount,blueprintTitle:blueprint.title,stepCount:0,includeProgress:meta?.includeProgress??hasProgress};
}
