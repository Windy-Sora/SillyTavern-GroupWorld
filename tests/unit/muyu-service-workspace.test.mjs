import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceWriter} from '../../muyu/services/workspace.js';
import {createApprovedActions} from '../../muyu/actions/coordinator.js';
import {createWorkspaceActions} from '../../muyu/actions/workspace.js';
import {actionReceipt,validateReceipt} from '../../muyu/actions/receipts.js';
import {createServicesPort} from '../../muyu/host/services.js';
import {createServiceWorkspaceModule} from '../../muyu/modules/service-workspace/index.js';
function fixture({failure=null,mutate=x=>x}={}) {
    let enabled=true,calls=[],applies=0;
    const capture={allows:()=>enabled,unavailable:()=>{enabled=false;}};
    const port=createWorkspaceWriter({request:async(op,args)=>{
        calls.push(op);
        if(op==='preview')return mutate({version:1,status:'preview',previewId:'11111111-1111-4111-8111-111111111111',path:args.path,expectedRevision:args.expectedRevision,revision:'1'.repeat(64),bytes:new TextEncoder().encode(args.text).length,expiresAt:Date.now()+300000,operation:args.expectedRevision===null?'create':'update',beforeText:args.expectedRevision===null?'':'old'});
        if(op==='apply'){applies++;if(failure)throw Error(failure);return{version:1,status:'written',path:'notes.md',revision:'1'.repeat(64),backupId:null,persistence:'file_synced'};}
        return {version:1,valid:true,reason:'SYNTAX_ONLY'};
    }});
    const preview=()=>port.preview({path:'notes.md',expectedRevision:'',text:'new'},{kind:'global',userKey:'account'},capture,new AbortController().signal);
    return {port,capture,calls,preview,disable:()=>{enabled=false;},enable:()=>{enabled=true;},applies:()=>applies};
}
test('Private workspace tickets bind full content and one-use approval; altered and revoked proposals never dispatch',async()=>{
    const f=fixture(),content=await f.preview();
    assert.throws(()=>f.port.assertFresh({...content,after:'injected'}),/STALE/);
    f.disable();await assert.rejects(f.port.apply(content),/STALE/);assert.equal(f.applies(),0);
    f.enable();assert.equal((await f.port.apply(content)).status,'saved_confirmed');
    await assert.rejects(f.port.apply(content),/STALE/);assert.equal(f.applies(),1);
});
test('Closed preview projections reject injected fields, root paths, false old versions and unsupported sizes',async()=>{
    for(const mutate of [x=>({...x,secret:'PRIVATE'}),x=>({...x,path:'../secret'}),x=>({...x,expectedRevision:'2'.repeat(64)}),x=>({...x,beforeText:'unexpected'}),x=>({...x,bytes:999}),x=>({...x,expiresAt:0})]){
        const f=fixture({mutate});await assert.rejects(f.preview(),/INCOMPATIBLE/);assert.equal(f.applies(),0);
    }
});
test('Unknown dispatch outcomes consume the exact ticket and never auto-retry; domain conflicts mean not executed',async()=>{
    for(const failure of ['SERVICE_UNAVAILABLE','WORKSPACE_CONFLICT']){
        const f=fixture({failure}),content=await f.preview(),artifact={id:'a',revision:1,kind:'workspace-draft',sessionId:'s',content};
        const action=createWorkspaceActions({getArtifact:()=>artifact,validate:()=>f.port.assertFresh(content),getTarget:()=>content.target,writer:{workspaceWriter:f.port}});
        const prepared=action.prepare('a',1);const result=await action.approve(prepared.id);
        assert.equal(result.status,failure==='WORKSPACE_CONFLICT'?'not_executed':'outcome_unknown');
        assert.equal(f.applies(),1);assert.throws(()=>action.approve(prepared.id),/STALE/);
        const receipt=actionReceipt(result);assert.equal(receipt.version,35);assert.doesNotMatch(JSON.stringify(receipt),/notes.md|new|11111111/);validateReceipt(receipt);
    }
});
test('Feature detection and independent preferences do not grant writes; missing service and cancel leave tools closed',async()=>{
    let prefs={},network=0;
    const port=createServicesPort({getEnabled:()=>prefs,saveEnabled:async p=>{prefs=p;},fetcher:async()=>{network++;return new Response(JSON.stringify({version:1,serviceVersion:'0.6.0',capabilities:{},toolProtocols:{workspaceWrite:1,jsonValidate:1},limits:{records:64,recordBytes:1000,totalBytes:10000,messages:4096}}),{headers:{'content-type':'application/json'}});}});
    assert.equal(port.captureTools().allows('workspaceWrite'),false);assert.equal(network,0);
    await port.setWorkspaceEnabled(true);const capture=port.captureTools();assert.equal(capture.allows('workspaceWrite'),true);assert.equal(capture.allows('jsonValidate'),false);
    await port.setJsonEnabled(true);assert.equal(capture.allows('workspaceWrite'),false);
    const fresh=port.captureTools();assert.equal(fresh.allows('jsonValidate'),true);
    port.cancel();assert.equal(fresh.allows('jsonValidate'),false);
});
test('JSON checking is no-file syntax only and run disposal rejects late workspace previews',async()=>{
    const f=fixture();assert.deepEqual(await f.port.validate({text:'{}'},f.capture,new AbortController().signal),{version:1,valid:true,reason:'SYNTAX_ONLY'});
    assert.deepEqual(f.calls,['validate']);
    let resolve,released=0;
    const module=createServiceWorkspaceModule({port:{workspaceWriter:{preview:()=>new Promise(r=>{resolve=r;}),release:()=>{released++;}}},charge:()=>true});
    module.bindRun({id:'r',taskId:'t',target:{kind:'global',userKey:'account'}},{serviceTools:f.capture});
    const pending=module.handlers['muyu.service.write_file']({path:'notes.md',expectedRevision:'',text:'x'},{runId:'r',target:{kind:'global',userKey:'account'},signal:new AbortController().signal});
    module.dispose();resolve({module:'service-workspace',path:'notes.md'});await assert.rejects(pending,/STALE/);assert.equal(released,1);
});
