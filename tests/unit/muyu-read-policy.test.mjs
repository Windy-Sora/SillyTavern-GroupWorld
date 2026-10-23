import test from 'node:test';
import assert from 'node:assert/strict';
import { createPermissions } from '../../muyu/application/permissions.js';
import { requestableSources, executionSource } from '../../muyu/permissions/contract.js';
import { readSourceAllowed, validatePermissionConfig } from '../../muyu/permissions/read-policy.js';
import { createPermissionConfigStore } from '../../muyu/host/permission-config.js';
import { sanitizeImportedSettings } from '../../systems/config-profile-validation.js';
const A = {kind:'chat',userKey:'u',chatKey:'A'}, B = {...A,chatKey:'B'}, G={kind:'global',userKey:'u'};
test('Read mode permits only explicitly classified data sources and never code or dynamic executions', () => {
    let all = true; const p = createPermissions({readAccess:()=>all});
    for (const spec of requestableSources) {
        const source='source:'+spec.id;
        assert.equal(p.allows(source,A,'t'),readSourceAllowed(source),spec.id);
        if(spec.permission==='code') assert.equal(p.allows(source,A,'t'),false);
        assert.equal(p.allows(source,G,'t'),spec.scope==='global' && readSourceAllowed(source));
    }
    assert.equal(p.allows('source:unknown',A,'t'),false);
    assert.equal(p.allows(executionSource('example','a'.repeat(64)+'-0'),A,'t'),false);
    assert.equal(p.allowsExecution(A,'t','example','a'.repeat(64)+'-0'),false);
    assert.equal(p.allows('source:recentMessages',B,'t'),true);
    assert.equal(p.snapshot(A).chat,true); assert.equal(p.snapshot(A).diagnostics,true);
    all=false; assert.equal(p.allows('source:recentMessages',A,'t'),false);
    assert.equal(p.snapshot(A).chat,false); assert.equal(p.snapshot(A).diagnostics,false);
    assert.deepEqual(p.sourceGrants(A),[]);
});
test('Explicit task denial still blocks a source in read mode; existing grants remain independent', () => {
    let all=true; const p=createPermissions({readAccess:()=>all});
    p.decide({source:'recentMessages',reason:'test',target:A,taskId:'t'},'deny',()=>{});
    assert.equal(p.allows('source:recentMessages',A,'t'),false);
    assert.equal(p.denied('source:recentMessages',A,'t'),true);
    p.grantSource('source:memoryConfig',G); all=false;
    assert.equal(p.allows('source:memoryConfig',G,'t'),true);
    assert.equal(p.allows('source:recentMessages',A,'other'),false);
});
test('Only read preferences persist; corrupt configs fall back closed and save failure rolls back', async () => {
    const settings={muyuPermissionConfig:{readAccess:'full'}}; let fail=false;
    const store=createPermissionConfigStore({getSettings:()=>settings,saveSettings:async()=>{if(fail)throw Error('fail');}});
    assert.deepEqual(store.read(),{readAccess:'ask'});
    assert.throws(()=>validatePermissionConfig({readAccess:'all',fullAccess:true}),/INVALID/);
    await store.save({readAccess:'all'}); assert.deepEqual(store.read(),{readAccess:'all'});
    fail=true; await assert.rejects(store.save({readAccess:'ask'}),/SAVE_FAILED/);
    assert.deepEqual(store.read(),{readAccess:'all'});
    assert.equal(Object.hasOwn(settings,'fullAccess'),false);
});
test('Imported story profiles cannot change the personal read policy',()=>{
    const result=sanitizeImportedSettings({muyuPermissionConfig:{readAccess:'all'},mode:'llm'});
    assert.equal(Object.hasOwn(result,'muyuPermissionConfig'),false); assert.equal(result.mode,'llm');
});

test('Permission save does not roll back a concurrent preference change',async()=>{
    const settings={muyuPermissionConfig:{readAccess:'ask'}};
    const store=createPermissionConfigStore({getSettings:()=>settings,saveSettings:async()=>{settings.muyuPermissionConfig.readAccess='ask';throw Error('fail');}});
    await assert.rejects(store.save({readAccess:'all'}),/SAVE_FAILED/);
    assert.equal(settings.muyuPermissionConfig.readAccess,'ask');
});
