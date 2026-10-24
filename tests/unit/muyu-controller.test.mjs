for(const operation of ['copy','save_current','update','select'])for(const access of ['normal','deny','full','preview'])test('ST preset controller / '+operation+' / '+access+' separates read and exact write approval',async()=>{
    const {createStPresetEditor}=await import('../../muyu/host/st-preset-editor.js');let f,writes=0,selected='PRIVATE_NAME';
    const names=['PRIVATE_NAME'],saved={PRIVATE_NAME:{temperature:1,prompts:[{identifier:'main',content:'PRIVATE_PROMPT',role:'system'}],prompt_order:[],proxy_password:'PRIVATE_SECRET'}};let live=structuredClone(saved.PRIVATE_NAME);
    const manager={getAllPresets:()=>names,getSelectedPresetName:()=>selected,getCompletionPresetByName:name=>saved[name]};
    const stPresetEditor=createStPresetEditor({getTarget:()=>f.host.globalTarget,getContext:()=>({mainApi:'openai',chatCompletionSettings:{bind_preset_to_connection:false},getPresetManager:()=>manager}),getLive:()=>live,isEditing:()=>false,
        save:async(name,value)=>{writes++;saved[name]=value;if(!names.includes(name))names.push(name);},select:async name=>{writes++;selected=name;live=structuredClone(saved[name]);}});
    const args={operation,selector:operation==='save_current'?'current':'preset:0',revision:'pending',changesJson:operation==='update'?'{"parameters":{"temperature":1.5}}':'{}',...(['copy','save_current'].includes(operation)?{name:'New preset'}:{}),...(operation==='select'?{replaceCurrent:true}:{}),...(access==='full'?{apply:true}:{})};
    f=fixture([[tool('muyu.st_preset.preview',args),done],[text('Prepared'),done]],{stPresetEditor});await f.enable();f.controller.setMode('assistant');
    if(['full','preview'].includes(access))f.controller.setFullAccess(true,{confirmed:true});
    args.revision=stPresetEditor.read(f.host.globalTarget,args.selector,stPresetEditor.list(f.host.globalTarget).revision,0).revision;
    f.controller.setInput('Preview or apply this preset');f.controller.send();await settle();
    if(['normal','deny'].includes(access)){const request=f.controller.snapshot().interaction;assert.equal(request.source,'stPresetContent');assert.equal(writes,0);f.controller.answerPermission(request.id,access==='deny'?'deny':'task');await settle();}
    const artifact=f.controller.snapshot().artifacts.find(a=>a.kind==='st-preset-draft');
    if(access==='normal'){assert.ok(artifact,JSON.stringify(f.controller.snapshot().runs));assert.equal(writes,0);const action=f.controller.prepareStPresetApply(artifact.id,artifact.revision);await f.controller.approveStPresetApply(action.id);assert.throws(()=>f.controller.approveStPresetApply(action.id),/STALE/);}
    assert.equal(writes,['deny','preview'].includes(access)?0:1);
    if(access==='deny')assert.equal(artifact,undefined);else{assert.ok(artifact);const history=JSON.parse(f.controller.exportHistory());assert.ok(history.required.includes('source:stPresetContent'));assert.doesNotMatch(JSON.stringify(artifact),/PRIVATE_SECRET/);assert.doesNotMatch(JSON.stringify(history.receipts),/PRIVATE_NAME|PRIVATE_PROMPT|PRIVATE_SECRET|New preset/);if(access!=='preview')assert.equal(history.receipts.at(-1).version,34);}
    await f.controller.dispose();
});
test('Display preferences save independently without starting a model run or granting access', async () => {
    let saved = null;
    const f = fixture([], { displayConfig: { read: () => ({ processDetail: 'compact' }), save: async value => { saved = value; } } });
    await f.controller.saveDisplayConfig({ processDetail: 'detailed' });
    assert.deepEqual(saved, { processDetail: 'detailed' }); assert.equal(f.controller.snapshot().displayConfig.processDetail, 'detailed');
    assert.equal(f.controller.snapshot().fullAccess, false); assert.equal(f.model.requests.length, 0);
    await assert.rejects(f.controller.saveDisplayConfig({ processDetail: 'invalid' }), /DISPLAY_CONFIG_INVALID/);
    await f.controller.dispose();
});
test('Task plan approval keeps loaded Skill revision after source Run settles and Skill is deleted', async () => {
    const { createSkillPort } = await import('../../muyu/host/skills.js');
    const { skillEditorPackage } = await import('../../muyu/skills/editor.js');
    const settings = {}, skills = createSkillPort({ getSettings: () => settings, saveSettings: async () => {}, loadBuiltins: async () => [] });
    await skills.ready(); await skills.save(skills.preview({ operation: 'create', expectedRevision: 0, enabled: true, package: skillEditorPackage({ name: 'example', description: 'Config review', body: 'FIXED_PLAN_GUIDE', resources: [{ path: 'references/rules.md', text: 'FIXED_PLAN_RESOURCE' }] }) }));
    const f = fixture([
        [tool('muyu.skills.load', { id: 'user:example', revision: '1', path: 'SKILL.md' }), done],
        [{ ...taskPlan(), call: { ...taskPlan().call, callId: 'plan' } }, done],
        [tool('muyu.skills.load', { id: 'user:example', revision: '1', path: 'references/rules.md' }, 'resource'), done],
        [text('Review complete'), done],
    ], { skills });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Review with a plan'); f.controller.send(); await settle();
    const plan = f.controller.snapshot().artifacts.find(a => a.kind === 'task-plan'); assert.ok(plan);
    await skills.save(skills.preview({ operation: 'delete', id: 'user:example', revision: 1, expectedRevision: 1 }));
    f.controller.approveTaskPlanReads(plan.id, plan.revision); await settle();
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
    assert.match(JSON.stringify(f.model.requests.at(-1).taskGuides), /FIXED_PLAN_GUIDE|FIXED_PLAN_RESOURCE/);
    assert.equal(f.controller.snapshot().runs.at(-1).skills[0].paths.length, 2);
    assert.doesNotMatch(f.controller.exportHistory(), /FIXED_PLAN_GUIDE|FIXED_PLAN_RESOURCE/); await f.controller.dispose();
});
test('Loaded Skill survives a real source-permission continuation and disable, but not a new question', async () => {
    const { createSkillPort } = await import('../../muyu/host/skills.js');
    const { skillEditorPackage } = await import('../../muyu/skills/editor.js');
    const settings = {}, skills = createSkillPort({ getSettings: () => settings, saveSettings: async () => {}, loadBuiltins: async () => [] });
    await skills.ready(); await skills.save(skills.preview({ operation: 'create', expectedRevision: 0, enabled: true, package: skillEditorPackage({ name: 'example', description: 'Config review', body: 'PRIVATE_SKILL_GUIDE', resources: [{ path: 'references/rules.md', text: 'PRIVATE_RESOURCE_GUIDE' }] }) }));
    const f = fixture([
        [tool('muyu.skills.load', { id: 'user:example', revision: '1', path: 'SKILL.md' }), done],
        [tool('muyu.settings.read', { fields: ['autoMemoryInterval'] }, 'read'), done],
        [tool('muyu.skills.load', { id: 'user:example', revision: '1', path: 'references/rules.md' }, 'resource'), done],
        [text('Read only complete'), done], [text('New topic'), done],
    ], { skills });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Review config'); f.controller.send(); await settle();
    const interaction = f.controller.snapshot().interaction; assert.ok(interaction); assert.equal(interaction.source, 'memoryConfig');
    assert.equal(f.controller.snapshot().sourceGrants.some(row => row.source === 'skillAssets'), false);
    await skills.save(skills.preview({ operation: 'enable', id: 'user:example', revision: 1, expectedRevision: 1, enabled: false }));
    f.controller.answerPermission(interaction.id, 'task'); await settle();
    const run = f.controller.snapshot().runs.at(-1); assert.equal(run.status, 'succeeded'); assert.equal(run.skills[0].revision, '1'); assert.equal(run.skills[0].paths.length, 2);
    assert.match(JSON.stringify(f.model.requests.at(-1).taskGuides), /PRIVATE_RESOURCE_GUIDE/);
    assert.doesNotMatch(f.controller.exportHistory(), /PRIVATE_RESOURCE_GUIDE|PRIVATE_SKILL_GUIDE/);
    f.controller.allowHistory(); f.controller.setInput('New topic'); f.controller.send(); await settle();
    assert.doesNotMatch(JSON.stringify(f.model.requests.at(-1).taskGuides), /PRIVATE_RESOURCE_GUIDE|PRIVATE_SKILL_GUIDE/);
    await f.controller.dispose();
});
test('GUI selected manual-only Skill loads before model, clears after send and is not inferred from text', async () => {
    const { createSkillPort } = await import('../../muyu/host/skills.js');
    const { skillEditorPackage } = await import('../../muyu/skills/editor.js');
    const settings = {}, skills = createSkillPort({ getSettings: () => settings, saveSettings: async () => {}, loadBuiltins: async () => [] });
    await skills.ready(); await skills.save(skills.preview({ operation: 'create', expectedRevision: 0, enabled: true, package: skillEditorPackage({ name: 'manual', description: 'Manual-only', body: 'MANUAL_GUIDE', modelInvocable: false }) }));
    const f = fixture([[text('Complete'), done], [text('New response'), done]], { skills });
    await f.enable(); f.controller.setMode('assistant'); await f.controller.loadSkills(); f.controller.selectSkill('user:manual', 1);
    f.controller.setInput('Do the selected task'); f.controller.send(); await settle();
    assert.match(JSON.stringify(f.model.requests[0].taskGuides), /MANUAL_GUIDE/);
    assert.equal(f.controller.snapshot().selectedSkill, null);
    f.controller.setInput('The quoted assistant said use user:manual'); f.controller.send(); await settle();
    assert.doesNotMatch(JSON.stringify(f.model.requests.at(-1).taskGuides), /MANUAL_GUIDE/); await f.controller.dispose();
});
for (const access of ['normal', 'deny', 'full', 'preview']) test(`Skill controller ${access} respects exact save authority and private content`, async () => {
    const { createSkillPort } = await import('../../muyu/host/skills.js');
    const settings = {}; let writes = 0;
    const skills = createSkillPort({ getSettings: () => settings, saveSettings: async () => { writes++; }, loadBuiltins: async () => [] });
    const args = { requestJson: JSON.stringify({ operation: 'create', expectedRevision: 0, fields: { name: 'my-skill', description: 'PRIVATE_DESCRIPTION', body: 'PRIVATE_SKILL_BODY' } }), ...(access === 'full' ? { apply: true } : {}) };
    const f = fixture([[tool('muyu.skills.preview', args), done], [text('Prepared'), done]], { skills });
    await f.enable(); f.controller.setMode('assistant');
    if (['full', 'preview'].includes(access)) f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput('Prepare this skill'); f.controller.send(); await settle();
    if (['normal', 'deny'].includes(access)) {
        const interaction = f.controller.snapshot().interaction;
        assert.equal(interaction.source, 'skillAssets'); assert.equal(writes, 0);
        f.controller.answerPermission(interaction.id, access === 'deny' ? 'deny' : 'task'); await settle();
    }
    const artifact = f.controller.snapshot().artifacts.find(row => row.kind === 'skill-draft');
    if (access === 'normal') {
        assert.ok(artifact); assert.equal(writes, 0);
        assert.match(JSON.stringify(f.controller.skillDraftDisplay(artifact.id, artifact.revision)), /PRIVATE_SKILL_BODY/);
        const approval = f.controller.prepareSkillSave(artifact.id, artifact.revision);
        await f.controller.approveSkillSave(approval.id);
    }
    assert.equal(writes, ['deny', 'preview'].includes(access) ? 0 : 1);
    if (access === 'deny') assert.equal(artifact, undefined);
    else {
        const history = JSON.parse(f.controller.exportHistory());
        assert.ok(history.required.includes('source:skillAssets'));
        assert.doesNotMatch(JSON.stringify(artifact), /PRIVATE_SKILL_BODY|PRIVATE_DESCRIPTION/);
        assert.doesNotMatch(JSON.stringify(history.receipts), /PRIVATE_SKILL_BODY|PRIVATE_DESCRIPTION/);
        if (access !== 'preview') {
            assert.equal(history.receipts.at(-1).version, 31);
            assert.equal(settings.muyuSkillData.skills[0].enabled, false);
        }
    }
    await f.controller.dispose();
});
for(const access of ['normal','deny','full','preview'])test('Blueprint library controller '+access+' preserves asset-only authority',async()=>{
 const {createStoryBlueprintLibrarySystem}=await import('../../systems/story-blueprint-library-system.js');
 const {createBlueprintLibraryPort}=await import('../../muyu/host/blueprint-libraries.js');
 const settings={};let saves=0;
 const forbidden=()=>{throw Error('chat or generation forbidden');};
 const system=createStoryBlueprintLibrarySystem({settings,extension_settings:{},EXT_KEY:'gd',saveSettings:()=>{saves++;},storyBlueprintSystem:new Proxy({}, {get:()=>forbidden}),getCurrentGroup:forbidden,saveChatConditional:forbidden,log(){}});
 const blueprintLibraries=createBlueprintLibraryPort({getSettings:()=>settings,system});
 const args={operation:'create',changesJson:JSON.stringify({name:'Blueprint pack',exportData:{version:1,type:'group-director-story-blueprint',storyBlueprint:{blueprint:{version:1,title:'PRIVATE_PROMPT',nodes:[{id:'one',type:'chapter',title:'Alice',content:{text:'PRIVATE_Blueprint'}}]}}}}),...(access==='full'?{apply:true}:{})};
 const f=fixture([[tool('muyu.blueprint_libraries.preview',args),done],[text('Prepared'),done]],{blueprintLibraries});
 await f.enable();f.controller.setMode('assistant');if(['full','preview'].includes(access))f.controller.setFullAccess(true,{confirmed:true});
 f.controller.setInput('Prepare the Blueprint package');f.controller.send();await settle();
 if(['normal','deny'].includes(access)){
  const request=f.controller.snapshot().interaction;assert.equal(request.source,'blueprintLibraryAssets');assert.equal(saves,0);
  f.controller.answerPermission(request.id,access==='deny'?'deny':'task');await settle();
 }
 const artifact=f.controller.snapshot().artifacts.find(a=>a.kind==='blueprint-library-draft');
 if(access==='normal'){assert.ok(artifact);assert.equal(saves,0);const a=f.controller.prepareBlueprintLibrarySave(artifact.id,artifact.revision);await f.controller.approveBlueprintLibrarySave(a.id);}
 assert.equal(saves,['deny','preview'].includes(access)?0:1);
 if(access==='deny')assert.equal(artifact,undefined);
 else{
  assert.ok(artifact);
  const history=JSON.parse(f.controller.exportHistory());assert.ok(history.required.includes('source:blueprintLibraryAssets'));
  assert.doesNotMatch(JSON.stringify(history.receipts),/PRIVATE_Blueprint|PRIVATE_PROMPT|Alice/);
  if(access!=='preview'){assert.equal(history.receipts.at(-1).version,18);assert.equal(settings.storyBlueprintLibraries[0].nodeCount,1);}
 }
 await f.controller.dispose();
});
for (const access of ['normal', 'deny', 'full']) test(`Custom Prompt real writer: ${access} keeps permission, save and history boundaries`, async () => {
    const { createCustomPromptsSystem } = await import('../../systems/custom-prompts-system.js');
    const { createCustomPromptPort } = await import('../../muyu/host/custom-prompts.js');
    const settings = {}, providers = new Map(); let saves = 0;
    const system = createCustomPromptsSystem({ settings, getProviders: () => [...providers.values()],
        registerProvider: p => providers.set(p.id, p), unregisterProvider: id => providers.delete(id), log() {}, saveSettings: () => { saves++; } });
    const customPrompts = createCustomPromptPort({ getSettings: () => settings, system });
    const args = { operation: 'create', changesJson: JSON.stringify({ name: 'story_tone', content: 'PRIVATE_PROMPT {{other}}', enabled: true }), ...(access === 'full' ? { apply: true } : {}) };
    const f = fixture([[tool('muyu.prompts.preview', args), done], [text('Result'), done]], { customPrompts });
    await f.enable(); f.controller.setMode('assistant');
    if (access === 'full') f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput('Create this custom Prompt'); f.controller.send(); await settle();
    if (access !== 'full') {
        const request = f.controller.snapshot().interaction; assert.equal(request.source, 'customPromptAssets'); assert.equal(saves, 0);
        f.controller.answerPermission(request.id, access === 'deny' ? 'deny' : 'task'); await settle();
    }
    const artifact = f.controller.snapshot().artifacts.find(row => row.kind === 'custom-prompt-draft');
    if (access === 'normal') {
        assert.ok(artifact); assert.equal(saves, 0);
        const approval = f.controller.prepareCustomPromptSave(artifact.id, artifact.revision);
        await f.controller.approveCustomPromptSave(approval.id);
    }
    if (access === 'deny') { assert.equal(artifact, undefined); assert.equal(saves, 0); }
    else {
        assert.equal(saves, 1); assert.equal(settings.customPrompts[0].enabled, true); assert.ok(providers.has('story_tone'));
        const exported = JSON.parse(f.controller.exportHistory()); assert.ok(exported.required.includes('source:customPromptAssets'));
        assert.equal(exported.receipts.at(-1).version, 12); assert.doesNotMatch(JSON.stringify(exported.receipts), /PRIVATE_PROMPT/);
    }
    await f.controller.dispose();
});
for (const operation of ['create', 'update', 'delete']) test(`Custom Prompt ${operation} pauses for source permission, then requires one exact save approval`, async () => {
    let writes = 0;
    const content = { module: 'custom-prompt', operation, id: operation === 'create' ? '' : 'se_user', baseRevision: '', previous: { name: 'user', providerName: 'user_agent', prompt: 'OLD_SOURCE' }, next: operation === 'delete' ? null : { name: 'user', providerName: 'user_agent', enabled: false, prompt: 'NEW_SOURCE' }, warnings: [] };
    const customPrompts = { preview: () => content, assertDraft() {}, save: async () => { writes++; return { status: 'saved_unconfirmed', id: 'se_user', enabled: false, persistence: 'unconfirmed' }; } };
    const f = fixture([[tool('muyu.prompts.preview', { operation, changesJson: '{}' }), done], [text('Only preview'), done]], { customPrompts });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Preview script'); f.controller.send(); await settle();
    const request = f.controller.snapshot().interaction; assert.equal(request.source, 'customPromptAssets'); assert.equal(writes, 0);
    f.controller.answerPermission(request.id, 'task'); await settle();
    const artifact = f.controller.snapshot().artifacts.find(row => row.kind === 'custom-prompt-draft'); assert.ok(artifact); assert.equal(writes, 0);
    const approval = f.controller.prepareCustomPromptSave(artifact.id, artifact.revision); await f.controller.approveCustomPromptSave(approval.id);
    assert.equal(writes, 1); const receipt = JSON.parse(f.controller.exportHistory()).receipts.find(row => row.version === 12);
    assert.equal(receipt.operation, operation); assert.doesNotMatch(JSON.stringify(receipt), /OLD_SOURCE|NEW_SOURCE/);
    assert.throws(() => f.controller.approveCustomPromptSave(approval.id), /STALE/); await f.controller.dispose();
});

test('Custom Prompt full access only saves explicitly requested apply candidates', async () => {
    let writes = 0;
    const customPrompts = { assertDraft() {}, preview: () => ({ module: 'custom-prompt', operation: 'create', id: '', baseRevision: '', previous: null, next: { name: 'user', providerName: 'user_agent', enabled: false }, warnings: [] }),
        save: async () => { writes++; return { status: 'saved_unconfirmed', id: 'se_user', enabled: false, persistence: 'unconfirmed' }; } };
    const args = { operation: 'create', changesJson: '{"name":"user"}' };
    const f = fixture([[tool('muyu.prompts.preview', args), done], [text('Preview'), done], [tool('muyu.prompts.preview', { ...args, apply: true }), done], [text('Save requested'), done]], { customPrompts });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput('Preview only'); f.controller.send(); await settle(); assert.equal(writes, 0);
    f.controller.setInput('Save it'); f.controller.send(); await settle(); assert.equal(writes, 1); assert.equal(f.controller.snapshot().receipts.at(-1).version, 12);
    await f.controller.dispose();
});
for (const kind of ['batch', 'import']) for (const access of ['normal', 'full', 'deny']) test(`Custom Prompt ${kind} preview ${access} uses the real queued writer and one global save`, async () => {
    const { createCustomPromptsSystem } = await import('../../systems/custom-prompts-system.js');
    const { createCustomPromptPort } = await import('../../muyu/host/custom-prompts.js');
    const settings = {}, registry = new Map(); let saves = 0;
    const getProviders = () => [...registry.values()];
    const system = createCustomPromptsSystem({ settings, getProviders, registerProvider: p => registry.set(p.id, p), unregisterProvider: id => registry.delete(id),
        log() {}, saveSettings: () => { saves++; }, getChatMetadata: () => { throw Error('no chat read'); }, getChat: () => [], EXT_KEY: 'gd' });
    const customPrompts = createCustomPromptPort({ getSettings: () => settings, getProviders, system });
    const definitions = ['a', 'b'].map(name => ({ name, content: 'PRIVATE_PROMPT_' + name }));
    const args = kind === 'batch' ? { requestsJson: JSON.stringify(definitions.map(changes => ({ operation: 'create', changes }))) }
        : { exportJson: JSON.stringify({ type: 'custom-prompt-export', version: 1, prompts: definitions }) };
    if (access === 'full') args.apply = true;
    const f = fixture([[tool('muyu.prompts.' + kind + '_preview', args), done], [text('Result'), done]], { customPrompts });
    await f.enable(); f.controller.setMode('assistant');
    if (access === 'full') f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput('Prepare both custom agents'); f.controller.send(); await settle();
    if (access !== 'full') {
        const request = f.controller.snapshot().interaction; assert.equal(request.source, 'customPromptAssets'); assert.equal(saves, 0);
        f.controller.answerPermission(request.id, access === 'deny' ? 'deny' : 'task'); await settle();
    }
    if (access === 'normal') {
        const artifact = f.controller.snapshot().artifacts.find(row => row.kind === 'custom-prompt-draft'); assert.ok(artifact); assert.equal(saves, 0);
        const approval = f.controller.prepareCustomPromptSave(artifact.id, artifact.revision); await f.controller.approveCustomPromptSave(approval.id);
    }
    assert.equal(saves, access === 'deny' ? 0 : 1);
    if (access !== 'deny') {
        assert.equal(settings.customPrompts.length, 2);
        const receipt = JSON.parse(f.controller.exportHistory()).receipts.at(-1); assert.equal(receipt.version, 13); assert.equal(receipt.items.length, 2);
        assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE_PROMPT/);
    } else assert.equal(f.controller.snapshot().artifacts.some(row => row.kind === 'custom-prompt-draft'), false);
    await f.controller.dispose();
});
for (const access of ['normal','deny','full']) test(`Profile library real writer ${access}: global assets only and exact approval`, async()=>{
 const {createProfileLibrarySystem}=await import('../../systems/profile-library-system.js');
 const {createProfileLibraryPort}=await import('../../muyu/host/profile-libraries.js');
 const settings={};let saves=0;
 const system=createProfileLibrarySystem({settings,extension_settings:{},EXT_KEY:'gd',saveSettings:()=>{saves++;},getProfiles:()=>{throw Error('chat read forbidden');},applyImport:()=>{throw Error('chat apply forbidden');},log(){}});
 const profileLibraries=createProfileLibraryPort({getSettings:()=>settings,system});
 const changes={name:'pack',exportData:{version:1,type:'profile-export',template:{generatorPrompt:'',jsonSchema:'{}',renderTemplate:''},profiles:[{avatar:'a.png',name:'Alice',profile:{note:'PRIVATE_LIBRARY'}}]}};
 const args={operation:'create',changesJson:JSON.stringify(changes),...(access==='full'?{apply:true}:{})};
 const f=fixture([[tool('muyu.libraries.preview',args),done],[text('Preview result'),done]],{profileLibraries});
 await f.enable();f.controller.setMode('assistant');if(access==='full')f.controller.setFullAccess(true,{confirmed:true});
 f.controller.setInput('Create the specified library package');f.controller.send();await settle();
 if(access!=='full'){const request=f.controller.snapshot().interaction;assert.equal(request.source,'profileLibraryAssets');assert.equal(saves,0);f.controller.answerPermission(request.id,access==='deny'?'deny':'task');await settle();}
 const artifact=f.controller.snapshot().artifacts.find(r=>r.kind==='profile-library-draft');
 if(access==='normal'){assert.ok(artifact);assert.equal(saves,0);const a=f.controller.prepareProfileLibrarySave(artifact.id,artifact.revision);await f.controller.approveProfileLibrarySave(a.id);}
 assert.equal(saves,access==='deny'?0:1);
 if(access!=='deny'){
  const history=JSON.parse(f.controller.exportHistory());assert.equal(history.receipts.at(-1).version,14);assert.ok(history.required.includes('source:profileLibraryAssets'));
  assert.doesNotMatch(JSON.stringify(history.receipts),/PRIVATE_LIBRARY|Alice/);assert.equal(settings.profileLibraries[0].name,'pack');
 }else assert.equal(artifact,undefined);
 await f.controller.dispose();
});
for (const operation of ['capture','apply']) for (const access of ['normal','deny','full']) test(`Profile chat library ${operation} / ${access} preserves two sources and exact action`, async()=>{
 const {createProfileLibrarySystem}=await import('../../systems/profile-library-system.js');
 const {createProfileLibraryPort}=await import('../../muyu/host/profile-libraries.js');
 const {createProfileLibraryChatPort}=await import('../../muyu/host/profile-library-chat.js');
 let f,settingsSaves=0,chatSaves=0;const settings={},metadata={gd:{characterProfiles:{'a.png':{state:'ready',hash:'h',profile:{note:'PRIVATE_CHAT'}}}}};
 const system=createProfileLibrarySystem({settings,EXT_KEY:'gd',extension_settings:{},saveSettings:()=>{settingsSaves++;},
 getCurrentGroup:()=>({id:1,name:'group',members:['a.png']}),getCharacters:()=>[{avatar:'a.png',name:'Alice'}],hashChar:()=> 'h',
 getProfiles:()=>{throw Error('impure getter');},getDefaultProfileGeneratorPrompt:()=>'',getDefaultProfileSchema:()=>'{}',getDefaultProfileRenderTemplate:()=>'',log(){}});
 const profileLibraries=createProfileLibraryPort({getSettings:()=>settings,system});
 const profileLibraryChat=createProfileLibraryChatPort({getSettings:()=>settings,getMetadata:()=>metadata,getTarget:()=>f.host.currentTarget(),
 system,libraryPort:profileLibraries,saveChatConfirmed:async()=>{chatSaves++;}});
 let args={name:'saved'};
 if(operation==='apply'){
  await profileLibraries.save(profileLibraries.preview({operation:'create',changes:{name:'pack',exportData:{version:1,type:'profile-export',template:{generatorPrompt:'',jsonSchema:'{}',renderTemplate:''},profiles:[{avatar:'a.png',name:'Alice',hash:'h',profile:{note:'PRIVATE_LIBRARY'}}]}}}));
  const row=profileLibraries.list().items[0];args={id:row.id,revision:row.revision,overwriteExisting:true};settingsSaves=0;
 }
 if(access==='full')args.apply=true;
 f=fixture([[tool('muyu.library_chat.'+(operation==='capture'?'capture_preview':'apply_preview'),args),done],[text('Prepared'),done]],{profileLibraries,profileLibraryChat});
 await f.enable();f.controller.setMode('assistant');if(access==='full')f.controller.setFullAccess(true,{confirmed:true});
 f.controller.setInput('Prepare the requested library operation');f.controller.send();await settle();
 const sources=[];
 if(access!=='full')for(let i=0;i<2;i++){
  const request=f.controller.snapshot().interaction;assert.ok(request,JSON.stringify(f.controller.snapshot().runs));sources.push(request.source);
  f.controller.answerPermission(request.id,access==='deny'?'deny':'task');await settle();if(access==='deny')break;
 }
 const artifact=f.controller.snapshot().artifacts.find(a=>a.kind==='profile-library-chat-draft');
 if(access==='normal'){
  assert.deepEqual(sources,['profileLibraryAssets','profileLibraryChat']);assert.ok(artifact);assert.equal(settingsSaves+chatSaves,0);
  const a=f.controller.prepareProfileLibraryChat(artifact.id,artifact.revision);await f.controller.approveProfileLibraryChat(a.id);
 }
 if(access==='deny'){assert.equal(artifact,undefined);assert.equal(settingsSaves+chatSaves,0);}
 else {
  assert.equal(settingsSaves,operation==='capture'?1:0);assert.equal(chatSaves,operation==='apply'?1:0);
  const exported=JSON.parse(f.controller.exportHistory());assert.equal(exported.receipts.at(-1).version,15);
  assert.ok(exported.required.includes('source:profileLibraryChat'));assert.ok(exported.required.includes('source:profileLibraryAssets'));
  assert.doesNotMatch(JSON.stringify(exported.receipts),/PRIVATE_CHAT|PRIVATE_LIBRARY|Alice/);
 }
 await f.controller.dispose();
});
for(const access of ['normal','deny','full','preview'])test('NPC library controller '+access+' preserves asset-only authority',async()=>{
 const {createNpcLibrarySystem}=await import('../../systems/npc-library-system.js');
 const {createNpcLibraryPort}=await import('../../muyu/host/npc-libraries.js');
 const settings={};let saves=0;
 const forbidden=()=>{throw Error('chat or generation forbidden');};
 const system=createNpcLibrarySystem({settings,extension_settings:{},EXT_KEY:'gd',saveSettings:()=>{saves++;},npcSystem:{getNpcs:forbidden},getCurrentGroup:forbidden,parseNpcImportFile:forbidden,applyNpcImport:forbidden,log(){}});
 const npcLibraries=createNpcLibraryPort({getSettings:()=>settings,system});
 const args={operation:'create',changesJson:JSON.stringify({name:'NPC pack',exportData:{version:1,type:'npc-export',template:{npcPrompt:'PRIVATE_PROMPT'},npcs:[{name:'Alice',description:'PRIVATE_NPC'}]}}),...(access==='full'?{apply:true}:{})};
 const f=fixture([[tool('muyu.npc_libraries.preview',args),done],[text('Prepared'),done]],{npcLibraries});
 await f.enable();f.controller.setMode('assistant');if(['full','preview'].includes(access))f.controller.setFullAccess(true,{confirmed:true});
 f.controller.setInput('Prepare the NPC package');f.controller.send();await settle();
 if(['normal','deny'].includes(access)){
  const request=f.controller.snapshot().interaction;assert.equal(request.source,'npcLibraryAssets');assert.equal(saves,0);
  f.controller.answerPermission(request.id,access==='deny'?'deny':'task');await settle();
 }
 const artifact=f.controller.snapshot().artifacts.find(a=>a.kind==='npc-library-draft');
 if(access==='normal'){assert.ok(artifact);assert.equal(saves,0);const a=f.controller.prepareNpcLibrarySave(artifact.id,artifact.revision);await f.controller.approveNpcLibrarySave(a.id);}
 assert.equal(saves,['deny','preview'].includes(access)?0:1);
 if(access==='deny')assert.equal(artifact,undefined);
 else{
  assert.ok(artifact);
  const history=JSON.parse(f.controller.exportHistory());assert.ok(history.required.includes('source:npcLibraryAssets'));
  assert.doesNotMatch(JSON.stringify(history.receipts),/PRIVATE_NPC|PRIVATE_PROMPT|Alice/);
  if(access!=='preview'){assert.equal(history.receipts.at(-1).version,16);assert.equal(settings.npcLibraries[0].npcCount,1);}
 }
 await f.controller.dispose();
});
for(const operation of ['capture','apply'])for(const access of ['normal','deny','full','preview'])test(`NPC chat library ${operation} / ${access} uses exact bound sources and one action`,async()=>{
 const {createNpcLibrarySystem}=await import('../../systems/npc-library-system.js');
 const {createNpcLibraryPort}=await import('../../muyu/host/npc-libraries.js');
 const {createNpcLibraryChatPort}=await import('../../muyu/host/npc-library-chat.js');
 let f,settingsSaves=0,chatSaves=0;const settings={},metadata={gd:{npcs:[{name:'Alice',description:'PRIVATE_CHAT',imported:true,importedAvatar:'card.png'}]}};
 const system=createNpcLibrarySystem({settings,EXT_KEY:'gd',extension_settings:{},saveSettings:()=>{settingsSaves++;},getCurrentGroup:()=>null,
 npcSystem:{getNpcs:()=>{throw Error('no impure getter');}},getDefaultNpcPrompt:()=>'',log(){}});
 const npcLibraries=createNpcLibraryPort({getSettings:()=>settings,system});
 const npcLibraryChat=createNpcLibraryChatPort({getSettings:()=>settings,getMetadata:()=>metadata,getTarget:()=>f.host.currentTarget(),
 system,libraryPort:npcLibraries,saveChatConfirmed:async()=>{chatSaves++;}});
 let args={name:'saved'};
 if(operation==='apply'){
  await npcLibraries.save(npcLibraries.preview({operation:'create',changes:{name:'pack',exportData:{type:'npc-export',version:1,template:{npcPrompt:''},npcs:[{name:'Alice',description:'PRIVATE_LIBRARY'}]}}}));
  const row=npcLibraries.list().items[0];args={id:row.id,revision:row.revision,overwriteExisting:true};settingsSaves=0;
 }
 if(access==='full')args.apply=true;
 f=fixture([[tool('muyu.npc_library_chat.'+(operation==='capture'?'capture_preview':'apply_preview'),args),done],[text('Prepared'),done]],{npcLibraries,npcLibraryChat});
 await f.enable();f.controller.setMode('assistant');if(['full','preview'].includes(access))f.controller.setFullAccess(true,{confirmed:true});
 f.controller.setInput('Prepare the specified NPC package operation');f.controller.send();await settle();
 const sources=[];
 if(['normal','deny'].includes(access))for(let i=0;i<2;i++){
  const r=f.controller.snapshot().interaction;assert.ok(r);sources.push(r.source);f.controller.answerPermission(r.id,access==='deny'?'deny':'task');await settle();if(access==='deny')break;
 }
 const artifact=f.controller.snapshot().artifacts.find(a=>a.kind==='npc-library-chat-draft');
 if(access==='normal'){
  assert.deepEqual(sources,['npcLibraryAssets','npcLibraryChat']);assert.ok(artifact);assert.equal(settingsSaves+chatSaves,0);
  const a=f.controller.prepareNpcLibraryChat(artifact.id,artifact.revision);await f.controller.approveNpcLibraryChat(a.id);
 }
 if(access==='deny'){assert.equal(artifact,undefined);assert.equal(settingsSaves+chatSaves,0);}
 else{
  assert.ok(artifact);assert.equal(settingsSaves,operation==='capture'&&access!=='preview'?1:0);assert.equal(chatSaves,operation==='apply'&&access!=='preview'?1:0);
  const history=JSON.parse(f.controller.exportHistory());assert.ok(history.required.includes('source:npcLibraryChat'));assert.ok(history.required.includes('source:npcLibraryAssets'));
  if(access!=='preview')assert.equal(history.receipts.at(-1).version,17);
  assert.doesNotMatch(JSON.stringify(history.receipts),/PRIVATE_CHAT|PRIVATE_LIBRARY|Alice|card.png/);
 }
 await f.controller.dispose();
});
import test from 'node:test';
for(const access of ['normal','deny','full','preview'])test('Workspace controller exact write consent / '+access,async()=>{
    const {createServiceToolGate}=await import('../../muyu/services/tool-gate.js');
    const {createWorkspaceWriter}=await import('../../muyu/services/workspace.js');
    let writes=0;
    const gate=createServiceToolGate({check:async()=>({status:'available',toolProtocols:{workspaceWrite:1,jsonValidate:1}}),getEnabled:()=>({workspaceWrite:true,jsonValidate:true})});
    const workspaceWriter=createWorkspaceWriter({request:async(operation,args)=>{
        if(operation==='preview')return{version:1,status:'preview',previewId:'11111111-1111-4111-8111-111111111111',path:args.path,expectedRevision:args.expectedRevision,revision:'1'.repeat(64),bytes:new TextEncoder().encode(args.text).length,expiresAt:Date.now()+300000,operation:'create',beforeText:''};
        if(operation==='apply'){writes++;return{version:1,status:'written',path:'notes.md',revision:'1'.repeat(64),backupId:null,persistence:'file_synced'};}
        throw Error('unexpected');
    }});
    const services={workspaceWriter,captureTools:()=>gate.capture(),cancel:()=>{gate.reset();workspaceWriter.clear();}};
    const args={path:'notes.md',expectedRevision:'',text:'PRIVATE_WORKSPACE_CONTENT',...(access==='full'?{apply:true}:{})};
    const f=fixture([[tool('muyu.tools.select',{groups:['service-workspace']}),done],[tool('muyu.service.write_file',args,'preview'),done],[text('Draft only'),done]],{services});
    await f.enable();f.controller.setMode('assistant');await gate.detect();
    if(['full','preview'].includes(access))f.controller.setFullAccess(true,{confirmed:true});
    f.controller.setInput(access==='full'?'Write notes.md now':'Only preview notes.md');f.controller.send();await settle();
    if(['normal','deny'].includes(access)){const request=f.controller.snapshot().interaction;assert.equal(request.source,'serviceDocuments');assert.equal(writes,0);f.controller.answerPermission(request.id,access==='deny'?'deny':'task');await settle();}
    const artifact=f.controller.snapshot().artifacts.find(a=>a.kind==='workspace-draft');
    if(access==='normal'){assert.ok(artifact,JSON.stringify(f.controller.snapshot().runs));assert.equal(writes,0);const action=f.controller.prepareWorkspaceApply(artifact.id,artifact.revision);await f.controller.approveWorkspaceApply(action.id);assert.throws(()=>f.controller.approveWorkspaceApply(action.id),/STALE/);}
    assert.equal(writes,['normal','full'].includes(access)?1:0,JSON.stringify(f.controller.snapshot().runs));
    if(['normal','full'].includes(access)){const receipts=JSON.parse(f.controller.exportHistory()).receipts;assert.equal(receipts.at(-1).version,35);assert.doesNotMatch(JSON.stringify(receipts),/PRIVATE_WORKSPACE_CONTENT|notes.md|11111111/);}
    if(access==='deny')assert.equal(artifact,undefined);
    await f.controller.dispose();
});

test('Service checks work without model setup or permissions and dispose cancels transport', async () => {
    let reads = 0, writes = 0, cancels = 0;
    const f = fixture([], { services: { check: async () => { reads++; return { status: 'legacy' }; }, checkStorage: async () => { writes++; return { status: 'ok' }; }, cancel: () => { cancels++; } } });
    f.controller.setInput('UNSENT');
    assert.deepEqual(await f.controller.checkServices(), { status: 'legacy' });
    assert.deepEqual(await f.controller.checkServiceStorage(), { status: 'ok' });
    assert.equal(reads, 1); assert.equal(writes, 1); assert.equal(f.controller.snapshot().input, 'UNSENT'); assert.equal(f.model.requests.length, 0);
    await f.controller.dispose(); assert.ok(cancels >= 1); await assert.rejects(f.controller.checkServices(), /DISPOSED/);
});
for(const kind of ['profile','npc'])for(const access of ['normal','deny','full','preview'])test('Manual '+kind+' creation controller / '+access,async()=>{
 const {createProfileEditorPort}=await import('../../muyu/host/profile-editor.js');const {createNpcEditorPort}=await import('../../muyu/host/npc-editor.js');const {createNpcSystem}=await import('../../systems/npc-system.js');
 let f,saves=0;const metadata={},deps={getTarget:()=>f.host.currentTarget(),getMetadata:()=>metadata,extensionKey:'gd',saveChatConfirmed:async()=>{saves++;}};
 const port=kind==='profile'?createProfileEditorPort({...deps,getCharacters:()=>[{avatar:'a.png',name:'PRIVATE_ROLE'}],getCreationContext:()=>({schemaHash:'hash',characters:[{avatar:'a.png',name:'PRIVATE_ROLE',hash:'character_hash'}]})}):createNpcEditorPort({...deps,system:createNpcSystem({settings:{npcMaxCount:10},EXT_KEY:'gd',getChatMetadata:()=>metadata,getCharacters:()=>[{name:'Known role'}],log(){}})});
 const field=kind==='profile'?'profileEditor':'npcEditor';
 f=fixture([()=>{const row=kind==='profile'?port.createTargets(f.host.currentTarget()).items[0]:port.createRead(f.host.currentTarget());return[tool('muyu.'+kind+'_editor.create_preview',{...(kind==='profile'?{character:row.character}:{}),revision:row.revision,changesJson:kind==='profile'?'{"summary":"PRIVATE_PROFILE"}':'{"name":"PRIVATE_NPC","description":"PRIVATE_BODY"}',...(access==='full'?{apply:true}:{})}),done];},[text('Prepared'),done]],{[field]:port});
 await f.enable();f.controller.setMode('assistant');if(['full','preview'].includes(access))f.controller.setFullAccess(true,{confirmed:true});f.controller.setInput('Prepare one new '+kind);f.controller.send();await settle();
 if(['normal','deny'].includes(access)){const r=f.controller.snapshot().interaction;assert.equal(r.source,kind+'CreateState');assert.equal(saves,0);f.controller.answerPermission(r.id,access==='deny'?'deny':'task');await settle();}
 const artifact=f.controller.snapshot().artifacts.find(a=>a.kind===kind+'-edit-draft');
 if(access==='normal'){assert.ok(artifact);assert.equal(saves,0);const a=f.controller[kind==='profile'?'prepareProfileEditApply':'prepareNpcEditApply'](artifact.id,artifact.revision);await f.controller[kind==='profile'?'approveProfileEditApply':'approveNpcEditApply'](a.id);assert.throws(()=>f.controller[kind==='profile'?'approveProfileEditApply':'approveNpcEditApply'](a.id),/STALE/);}
 assert.equal(saves,['deny','preview'].includes(access)?0:1);if(access==='deny'){assert.equal(artifact,undefined);assert.deepEqual(metadata,{});}else{assert.ok(artifact);const history=JSON.parse(f.controller.exportHistory());assert.ok(history.required.includes('source:'+kind+'CreateState'));assert.doesNotMatch(JSON.stringify(history.receipts),/PRIVATE_|a.png/);if(access!=='preview')assert.equal(history.receipts.at(-1).version,30);}
 await f.controller.dispose();
});
for(const kind of ['profile','npc'])test('Normal '+kind+' creation rejects model apply=true before source read',async()=>{
 let called=0;const port={createPreview(){called++;throw Error('must not run');},clear(){}};
 const args={...(kind==='profile'?{character:'profile-character:0'}:{}),revision:'bad',changesJson:'{}',apply:true};
 const f=fixture([[tool('muyu.'+kind+'_editor.create_preview',args),done],[text('Not applied'),done]],{[kind==='profile'?'profileEditor':'npcEditor']:port});await f.enable();f.controller.setMode('assistant');f.controller.setInput('Preview');f.controller.send();await settle();assert.equal(called,0);assert.equal(f.controller.snapshot().interaction,null);assert.equal(f.controller.snapshot().artifacts.filter(a=>a.kind===kind+'-edit-draft').length,0);await f.controller.dispose();
});
test('Normal mode rejects first Blueprint apply=true without reading or writing',async()=>{
 const metadata={},f=fixture([[tool('muyu.blueprint_node_editor.initialize_preview',{revision:'made-up',changesJson:'{}',apply:true}),done],[text('Not applied'),done]],{blueprintNodeEditor:{initializePreview(){throw Error('must not run');},clear(){}}});
 await f.enable();f.controller.setMode('assistant');f.controller.setInput('Preview only');f.controller.send();await settle();assert.equal(f.controller.snapshot().interaction,null);assert.equal(f.controller.snapshot().artifacts.filter(a=>a.kind==='blueprint-node-edit-draft').length,0);assert.deepEqual(metadata,{});await f.controller.dispose();
});
for(const access of ['normal','deny','full','preview'])test('First blank Blueprint controller / '+access,async()=>{
 const {createBlueprintNodeEditorPort}=await import('../../muyu/host/blueprint-node-editor.js');
 let f,saves=0;const metadata={};
 const settings={lang:'zh',storyBlueprintProgressionMode:'leaf'};
 // Stable settings object is part of the host snapshot contract.
 const stablePort=createBlueprintNodeEditorPort({getTarget:()=>f.host.currentTarget(),getMetadata:()=>metadata,getSettings:()=>settings,getChatLength:()=>5,extensionKey:'gd',saveStructureConfirmed:async()=>{saves++;}});
 f=fixture([()=>{const r=stablePort.initializeRead(f.host.currentTarget());return[tool('muyu.blueprint_node_editor.initialize_preview',{revision:r.revision,changesJson:'{}',...(access==='full'?{apply:true}:{})}),done];},[text('Prepared'),done]],{blueprintNodeEditor:stablePort});
 await f.enable();f.controller.setMode('assistant');if(['full','preview'].includes(access))f.controller.setFullAccess(true,{confirmed:true});
 f.controller.setInput('Create first blank Blueprint');f.controller.send();await settle();
 if(['normal','deny'].includes(access)){const r=f.controller.snapshot().interaction;assert.equal(r.source,'blueprintStructureState');assert.equal(saves,0);f.controller.answerPermission(r.id,access==='deny'?'deny':'task');await settle();}
 const artifact=f.controller.snapshot().artifacts.find(a=>a.kind==='blueprint-node-edit-draft');
 if(access==='normal'){assert.ok(artifact);assert.equal(saves,0);const a=f.controller.prepareBlueprintNodeEditApply(artifact.id,artifact.revision);await f.controller.approveBlueprintNodeEditApply(a.id);assert.throws(()=>f.controller.approveBlueprintNodeEditApply(a.id),/STALE/);}
 assert.equal(saves,['deny','preview'].includes(access)?0:1);
 if(access==='deny'){assert.equal(artifact,undefined);assert.deepEqual(metadata,{});}else{assert.ok(artifact);const history=JSON.parse(f.controller.exportHistory());assert.ok(history.required.includes('source:blueprintStructureState'));assert.doesNotMatch(JSON.stringify(history.receipts),/node_001|用户自建/);if(access!=='preview')assert.equal(history.receipts.at(-1).version,29);}
 await f.controller.dispose();
});
for(const access of ['normal','deny','full','preview'])test('Manual memory creation controller / '+access,async()=>{
 const {createMemoryEditorPort}=await import('../../muyu/host/memory-editor.js');
 let f,saves=0;const metadata={};
 const memoryEditor=createMemoryEditorPort({getTarget:()=>f.host.currentTarget(),getMetadata:()=>metadata,getCharacters:()=>[{avatar:'a.png',name:'PRIVATE_ROLE'}],getSettings:()=>({memoryMaxEntries:200}),getChatLength:()=>7,extensionKey:'gd',saveChatConfirmed:async()=>{saves++;}});
 f=fixture([()=>{const row=memoryEditor.createTargets(f.host.currentTarget()).items[0];return [tool('muyu.memory_editor.create_preview',{character:row.character,revision:row.revision,changesJson:'{"event":"PRIVATE_NEW"}',...(access==='full'?{apply:true}:{})}),done];},[text('Prepared'),done]],{memoryEditor});
 await f.enable();f.controller.setMode('assistant');if(['full','preview'].includes(access))f.controller.setFullAccess(true,{confirmed:true});
 f.controller.setInput('Append one memory');f.controller.send();await settle();
 if(['normal','deny'].includes(access)){const r=f.controller.snapshot().interaction;assert.equal(r.source,'memoryCreateState');assert.equal(saves,0);f.controller.answerPermission(r.id,access==='deny'?'deny':'task');await settle();}
 const artifact=f.controller.snapshot().artifacts.find(a=>a.kind==='memory-edit-draft');
 if(access==='normal'){assert.ok(artifact);assert.equal(saves,0);const a=f.controller.prepareMemoryEditApply(artifact.id,artifact.revision);await f.controller.approveMemoryEditApply(a.id);assert.throws(()=>f.controller.approveMemoryEditApply(a.id),/STALE/);}
 assert.equal(saves,['deny','preview'].includes(access)?0:1);
 if(access==='deny'){assert.equal(artifact,undefined);assert.deepEqual(metadata,{});}else{assert.ok(artifact);const history=JSON.parse(f.controller.exportHistory());assert.ok(history.required.includes('source:memoryCreateState'));assert.doesNotMatch(JSON.stringify(history.receipts),/PRIVATE_NEW|PRIVATE_ROLE|a.png/);if(access!=='preview')assert.equal(history.receipts.at(-1).version,28);}
 await f.controller.dispose();
});
for(const operation of ['create','delete','move'])for(const access of ['normal','deny','full','preview'])test('Blueprint structure controller '+operation+' / '+access+' exact approval',async()=>{
 const {createBlueprintNodeEditorPort}=await import('../../muyu/host/blueprint-node-editor.js');
 let f,saves=0;const settings={storyBlueprintProgressionMode:'leaf'},metadata={gd:{storyBlueprint:{blueprint:{version:1,title:'PRIVATE_TREE',nodes:[{id:'a',type:'chapter',title:'PRIVATE_A',content:{text:'PRIVATE_BODY'},children:[]},{id:'b',type:'chapter',title:'B',content:{},children:[]}]},doneSignals:[]}}};
 const blueprintNodeEditor=createBlueprintNodeEditorPort({getTarget:()=>f?.host.currentTarget(),getMetadata:()=>metadata,getSettings:()=>settings,getChatLength:()=>1,extensionKey:'gd',saveStructureConfirmed:async()=>{saves++;}});
 const changes=operation==='create'?{parentId:'',index:2,node:{id:'new',type:'chapter',title:'New',content:{}}}:operation==='delete'?{nodeId:'a'}:{nodeId:'a',parentId:'',index:1};
 f=fixture([()=>[tool('muyu.blueprint_node_editor.structure_preview',{operation,revision:blueprintNodeEditor.structureRead(f.host.currentTarget(),0).revision,changesJson:JSON.stringify(changes),...(access==='full'?{apply:true}:{})}),done],[text('Prepared'),done]],{blueprintNodeEditor});
 await f.enable();f.controller.setMode('assistant');if(['full','preview'].includes(access))f.controller.setFullAccess(true,{confirmed:true});
 f.controller.setInput('Prepare Blueprint structure change');f.controller.send();await settle();
 if(['normal','deny'].includes(access)){const r=f.controller.snapshot().interaction;assert.equal(r.source,'blueprintStructureState');assert.equal(saves,0);f.controller.answerPermission(r.id,access==='deny'?'deny':'task');await settle();}
 const artifact=f.controller.snapshot().artifacts.find(a=>a.kind==='blueprint-node-edit-draft');
 if(access==='normal'){assert.ok(artifact,JSON.stringify(f.controller.snapshot().runs));assert.equal(saves,0);const a=f.controller.prepareBlueprintNodeEditApply(artifact.id,artifact.revision);await f.controller.approveBlueprintNodeEditApply(a.id);assert.throws(()=>f.controller.approveBlueprintNodeEditApply(a.id),/STALE/);}
 assert.equal(saves,['deny','preview'].includes(access)?0:1);
 if(access==='deny')assert.equal(artifact,undefined);else{assert.ok(artifact);const h=JSON.parse(f.controller.exportHistory());assert.ok(h.required.includes('source:blueprintStructureState'));assert.doesNotMatch(JSON.stringify(h.receipts),/PRIVATE|nodeId|before|after/);if(access!=='preview')assert.equal(h.receipts.at(-1).version,27);}
 await f.controller.dispose();
});
for(const kind of ['worldbooks','profile-autoload'])for(const access of ['normal','deny','full','preview'])test('Selection controller '+kind+' / '+access+' exact global approval',async()=>{
 const {createSelectionEditorPort}=await import('../../muyu/host/selection-editor.js');
 const {createProfileLibrarySystem}=await import('../../systems/profile-library-system.js');
 const target={kind:'global',userKey:'page:test'},settings={worldBookSourceMode:'st',worldBookSelection:{},profileLibraryAutoLoad:{enabled:false,mode:'best',fixedId:'',matchHash:true,matchAvatarName:true,matchNameOnly:false,overwriteExisting:false,importTemplate:false},profileLibraries:[{id:'p1',name:'PRIVATE_PACK',exportData:{text:'PRIVATE_BODY'}}]};let saves=0;
 const system=createProfileLibrarySystem({settings,extension_settings:{},EXT_KEY:'gd',saveSettings:async()=>{saves++;},log(){}});
 const selectionEditor=createSelectionEditorPort({getTarget:()=>target,getSettings:()=>settings,getWorldNames:()=>['PRIVATE_BOOK'],worldBookScanner:{clearCache(){}},profileLibrarySystem:system,saveSettings:async()=>{saves++;return{confirmed:true};}});
 const row=selectionEditor.read(target,kind);
 const changes=kind==='worldbooks'?{sourceMode:'manual',selectedNames:['PRIVATE_BOOK']}:{mode:'fixed',fixedId:'p1'};
 const f=fixture([[tool('muyu.selection.preview',{kind,revision:row.revision,changesJson:JSON.stringify(changes),...(access==='full'?{apply:true}:{})}),done],[text('Prepared'),done]],{selectionEditor});
 await f.enable();f.controller.setMode('assistant');if(['full','preview'].includes(access))f.controller.setFullAccess(true,{confirmed:true});
 f.controller.setInput('Prepare selection policy');f.controller.send();await settle();
 if(['normal','deny'].includes(access)){const r=f.controller.snapshot().interaction;assert.equal(r.source,'selectionState');assert.equal(saves,0);f.controller.answerPermission(r.id,access==='deny'?'deny':'task');await settle();}
 const artifact=f.controller.snapshot().artifacts.find(a=>a.kind==='selection-draft');
 if(access==='normal'){assert.ok(artifact,JSON.stringify(f.controller.snapshot().runs));assert.equal(saves,0);const a=f.controller.prepareSelectionApply(artifact.id,artifact.revision);await f.controller.approveSelectionApply(a.id);assert.throws(()=>f.controller.approveSelectionApply(a.id),/STALE/);}
 assert.equal(saves,['deny','preview'].includes(access)?0:1);
 if(access==='deny')assert.equal(artifact,undefined);else{assert.ok(artifact);const history=JSON.parse(f.controller.exportHistory());assert.ok(history.required.includes('source:selectionState'));assert.doesNotMatch(JSON.stringify(history.receipts),/PRIVATE_PACK|PRIVATE_BOOK|PRIVATE_BODY/);if(access!=='preview')assert.equal(history.receipts.at(-1).version,26);}
 await f.controller.dispose();
});
for(const operation of ['update','clear'])for(const access of ['normal','deny','full','preview'])test('Ledger editor controller '+operation+' / '+access+' uses exact approval',async()=>{
 const {createLedgerEditorPort}=await import('../../muyu/host/ledger-editor.js');
 let f,saves=0;const metadata={gd:{directorHistory:[{reason:'PRIVATE_BODY',speakers:['PRIVATE_NAME'],scripts:{},_anchorDate:'PRIVATE_ANCHOR',_chatLength:1}]}};
 const ledgerEditor=createLedgerEditorPort({getTarget:()=>f.host.currentTarget(),getMetadata:()=>metadata,extensionKey:'gd',saveChatConfirmed:async()=>{saves++;}});
 f=fixture([],{ledgerEditor});const row=ledgerEditor.list(f.host.currentTarget()).items[0];await f.controller.dispose();
 f=fixture([[tool('muyu.ledger_editor.preview',{operation,selector:row.selector,revision:row.revision,changesJson:operation==='clear'?'{}':'{"reason":"NEW_REASON"}',...(access==='full'?{apply:true}:{})}),done],[text('Prepared'),done]],{ledgerEditor});
 await f.enable();f.controller.setMode('assistant');if(['full','preview'].includes(access))f.controller.setFullAccess(true,{confirmed:true});
 f.controller.setInput('Prepare node change');f.controller.send();await settle();
 if(['normal','deny'].includes(access)){const r=f.controller.snapshot().interaction;assert.equal(r.source,'ledgerEditState');assert.equal(saves,0);f.controller.answerPermission(r.id,access==='deny'?'deny':'task');await settle();}
 const artifact=f.controller.snapshot().artifacts.find(a=>a.kind==='ledger-edit-draft');
 if(access==='normal'){assert.ok(artifact,JSON.stringify(f.controller.snapshot().runs));assert.equal(saves,0);const a=f.controller.prepareLedgerEditApply(artifact.id,artifact.revision);await f.controller.approveLedgerEditApply(a.id);assert.throws(()=>f.controller.approveLedgerEditApply(a.id),/STALE/);}
 assert.equal(saves,['deny','preview'].includes(access)?0:1);
 if(access==='deny')assert.equal(artifact,undefined);else{assert.ok(artifact);const history=JSON.parse(f.controller.exportHistory());assert.ok(history.required.includes('source:ledgerEditState'));assert.doesNotMatch(JSON.stringify(history.receipts),/PRIVATE_NAME|PRIVATE_BODY|PRIVATE_ANCHOR|NEW_REASON/);if(access!=='preview')assert.equal(history.receipts.at(-1).version,25);}
 await f.controller.dispose();
});
for(const access of ['normal','deny','full','preview'])test('Blueprint node editor controller / '+access+' uses exact approval',async()=>{
 const {createBlueprintNodeEditorPort}=await import('../../muyu/host/blueprint-node-editor.js');
 let f,saves=0;const metadata={gd:{storyBlueprint:{blueprint:{version:1,title:'Story',nodes:[{id:'PRIVATE_ID',type:'chapter',title:'PRIVATE_TITLE',content:{text:'PRIVATE_BODY'},children:[]}]},doneSignals:[],progressTracks:{}}}};
 const blueprintNodeEditor=createBlueprintNodeEditorPort({getTarget:()=>f.host.currentTarget(),getMetadata:()=>metadata,extensionKey:'gd',saveChatConfirmed:async()=>{saves++;}});
 f=fixture([],{blueprintNodeEditor});const row=blueprintNodeEditor.list(f.host.currentTarget()).items[0];await f.controller.dispose();
 f=fixture([[tool('muyu.blueprint_node_editor.preview',{selector:row.selector,revision:row.revision,changesJson:'{"content":{"text":"NEW_NODE"}}',...(access==='full'?{apply:true}:{})}),done],[text('Prepared'),done]],{blueprintNodeEditor});
 await f.enable();f.controller.setMode('assistant');if(['full','preview'].includes(access))f.controller.setFullAccess(true,{confirmed:true});
 f.controller.setInput('Prepare node change');f.controller.send();await settle();
 if(['normal','deny'].includes(access)){const r=f.controller.snapshot().interaction;assert.equal(r.source,'blueprintNodeEditState');assert.equal(saves,0);f.controller.answerPermission(r.id,access==='deny'?'deny':'task');await settle();}
 const artifact=f.controller.snapshot().artifacts.find(a=>a.kind==='blueprint-node-edit-draft');
 if(access==='normal'){assert.ok(artifact,JSON.stringify(f.controller.snapshot().runs));assert.equal(saves,0);const a=f.controller.prepareBlueprintNodeEditApply(artifact.id,artifact.revision);await f.controller.approveBlueprintNodeEditApply(a.id);assert.throws(()=>f.controller.approveBlueprintNodeEditApply(a.id),/STALE/);}
 assert.equal(saves,['deny','preview'].includes(access)?0:1);
 if(access==='deny')assert.equal(artifact,undefined);else{assert.ok(artifact);const history=JSON.parse(f.controller.exportHistory());assert.ok(history.required.includes('source:blueprintNodeEditState'));assert.doesNotMatch(JSON.stringify(history.receipts),/PRIVATE_ID|PRIVATE_BODY|PRIVATE_TITLE|NEW_NODE/);if(access!=='preview')assert.equal(history.receipts.at(-1).version,24);}
 await f.controller.dispose();
});
for(const operation of ['update','delete'])for(const access of ['normal','deny','full','preview'])test('NPC editor controller '+operation+' / '+access+' uses exact approval',async()=>{
 const {createNpcEditorPort}=await import('../../muyu/host/npc-editor.js');const {createNpcSystem}=await import('../../systems/npc-system.js');
 let f,saves=0;const metadata={gd:{npcs:[{name:'PRIVATE_NPC',description:'PRIVATE_BODY',imported:true,importedAvatar:'PRIVATE_CARD',createdAt:1}]}};
 const system=createNpcSystem({settings:{},EXT_KEY:'gd',getChatMetadata:()=>metadata,getCharacters:()=>[],saveChatConditional:async()=>{},log(){}});
 const npcEditor=createNpcEditorPort({getTarget:()=>f.host.currentTarget(),getMetadata:()=>metadata,extensionKey:'gd',system,saveChatConfirmed:async()=>{saves++;}});
 f=fixture([],{npcEditor});const row=npcEditor.list(f.host.currentTarget()).items[0];await f.controller.dispose();
 f=fixture([[tool('muyu.npc_editor.preview',{operation,selector:row.selector,revision:row.revision,changesJson:operation==='delete'?'{}':'{"description":"NEW_NPC"}',...(access==='full'?{apply:true}:{})}),done],[text('Prepared'),done]],{npcEditor});
 await f.enable();f.controller.setMode('assistant');if(['full','preview'].includes(access))f.controller.setFullAccess(true,{confirmed:true});
 f.controller.setInput('Prepare NPC change');f.controller.send();await settle();
 if(['normal','deny'].includes(access)){const r=f.controller.snapshot().interaction;assert.equal(r.source,'npcEditState');assert.equal(saves,0);f.controller.answerPermission(r.id,access==='deny'?'deny':'task');await settle();}
 const artifact=f.controller.snapshot().artifacts.find(a=>a.kind==='npc-edit-draft');
 if(access==='normal'){assert.ok(artifact,JSON.stringify(f.controller.snapshot().runs));assert.equal(saves,0);const a=f.controller.prepareNpcEditApply(artifact.id,artifact.revision);await f.controller.approveNpcEditApply(a.id);assert.throws(()=>f.controller.approveNpcEditApply(a.id),/STALE/);}
 assert.equal(saves,['deny','preview'].includes(access)?0:1);
 if(access==='deny')assert.equal(artifact,undefined);else{assert.ok(artifact);const history=JSON.parse(f.controller.exportHistory());assert.ok(history.required.includes('source:npcEditState'));assert.doesNotMatch(JSON.stringify(history.receipts),/PRIVATE_NPC|PRIVATE_BODY|PRIVATE_CARD|NEW_NPC/);if(access!=='preview')assert.equal(history.receipts.at(-1).version,23);}
 await f.controller.dispose();
});
for(const operation of ['update','delete'])for(const access of ['normal','deny','full','preview'])test('Profile editor controller '+operation+' / '+access+' uses exact approval',async()=>{
 const {createProfileEditorPort}=await import('../../muyu/host/profile-editor.js');
 let f,saves=0;const metadata={gd:{characterProfiles:{'a.png':{profile:{summary:'PRIVATE_PROFILE',custom:'PRIVATE_CUSTOM'},state:'ready'}},archivedProfiles:{}}};
 const profileEditor=createProfileEditorPort({getTarget:()=>f.host.currentTarget(),getMetadata:()=>metadata,getCharacters:()=>[{avatar:'a.png',name:'PRIVATE_ROLE'}],extensionKey:'gd',saveChatConfirmed:async()=>{saves++;}});
 f=fixture([],{profileEditor});const row=profileEditor.list(f.host.currentTarget()).items[0];await f.controller.dispose();
 f=fixture([[tool('muyu.profile_editor.preview',{operation,character:row.character,revision:row.revision,changesJson:operation==='delete'?'{}':'{"summary":"NEW_PROFILE"}',...(access==='full'?{apply:true}:{})}),done],[text('Prepared'),done]],{profileEditor});
 await f.enable();f.controller.setMode('assistant');if(['full','preview'].includes(access))f.controller.setFullAccess(true,{confirmed:true});
 f.controller.setInput('Prepare profile change');f.controller.send();await settle();
 if(['normal','deny'].includes(access)){const r=f.controller.snapshot().interaction;assert.equal(r.source,'profileEditState');assert.equal(saves,0);f.controller.answerPermission(r.id,access==='deny'?'deny':'task');await settle();}
 const artifact=f.controller.snapshot().artifacts.find(a=>a.kind==='profile-edit-draft');
 if(access==='normal'){assert.ok(artifact,JSON.stringify(f.controller.snapshot().runs));assert.equal(saves,0);const a=f.controller.prepareProfileEditApply(artifact.id,artifact.revision);await f.controller.approveProfileEditApply(a.id);assert.throws(()=>f.controller.approveProfileEditApply(a.id),/STALE/);}
 assert.equal(saves,['deny','preview'].includes(access)?0:1);
 if(access==='deny')assert.equal(artifact,undefined);else{assert.ok(artifact);const history=JSON.parse(f.controller.exportHistory());assert.ok(history.required.includes('source:profileEditState'));assert.doesNotMatch(JSON.stringify(history.receipts),/PRIVATE_PROFILE|NEW_PROFILE|PRIVATE_CUSTOM|PRIVATE_ROLE|a.png/);if(access!=='preview'){assert.equal(history.receipts.at(-1).version,22);if(operation==='delete')assert.ok(metadata.gd.archivedProfiles['a.png']);}}
 await f.controller.dispose();
});
for(const operation of ['update','delete'])for(const access of ['normal','deny','full','preview'])test('Memory editor controller '+operation+' / '+access+' uses exact approval',async()=>{
 const {createMemoryEditorPort}=await import('../../muyu/host/memory-editor.js');
 let f,saves=0;const metadata={gd:{charMemories:{'a.png':[{event:'PRIVATE_MEMORY',mood:'neutral'}]}}};
 const memoryEditor=createMemoryEditorPort({getTarget:()=>f.host.currentTarget(),getMetadata:()=>metadata,getCharacters:()=>[{avatar:'a.png',name:'PRIVATE_ROLE'}],extensionKey:'gd',saveChatConfirmed:async()=>{saves++;}});
 f=fixture([],{memoryEditor});const row=memoryEditor.list(f.host.currentTarget()).items[0];await f.controller.dispose();
 f=fixture([[tool('muyu.memory_editor.preview',{operation,character:row.character,revision:row.revision,index:0,changesJson:operation==='delete'?'{}':'{"event":"NEW_MEMORY"}',...(access==='full'?{apply:true}:{})}),done],[text('Prepared'),done]],{memoryEditor});
 await f.enable();f.controller.setMode('assistant');if(['full','preview'].includes(access))f.controller.setFullAccess(true,{confirmed:true});
 f.controller.setInput('Prepare memory change');f.controller.send();await settle();
 if(['normal','deny'].includes(access)){const r=f.controller.snapshot().interaction;assert.equal(r.source,'memoryEditState');assert.equal(saves,0);f.controller.answerPermission(r.id,access==='deny'?'deny':'task');await settle();}
 const artifact=f.controller.snapshot().artifacts.find(a=>a.kind==='memory-edit-draft');
 if(access==='normal'){assert.ok(artifact,JSON.stringify(f.controller.snapshot().runs));assert.equal(saves,0);const a=f.controller.prepareMemoryEditApply(artifact.id,artifact.revision);await f.controller.approveMemoryEditApply(a.id);assert.throws(()=>f.controller.approveMemoryEditApply(a.id),/STALE/);}
 assert.equal(saves,['deny','preview'].includes(access)?0:1);
 if(access==='deny')assert.equal(artifact,undefined);else{assert.ok(artifact);const history=JSON.parse(f.controller.exportHistory());assert.ok(history.required.includes('source:memoryEditState'));assert.doesNotMatch(JSON.stringify(history.receipts),/PRIVATE_MEMORY|NEW_MEMORY|PRIVATE_ROLE|a.png/);if(access!=='preview')assert.equal(history.receipts.at(-1).version,21);}
 await f.controller.dispose();
});
for(const operation of ['create','set_value','delete'])for(const access of ['normal','deny','full','preview'])test('Variable editor controller '+operation+' / '+access+' uses one exact approval',async()=>{
 const {createVariableEditorPort}=await import('../../muyu/host/variable-editor.js');
 let f,saves=0;const metadata={},settings={};
 const variableEditor=createVariableEditorPort({getTarget:()=>f.host.currentTarget(),getMetadata:()=>metadata,getSettings:()=>settings,
 getCharacters:()=>[{avatar:'a.png',name:'Alice'}],getGroup:()=>null,extensionKey:'gd',saveChatConfirmed:async()=>{saves++;}});
 let args={operation,id:'coins',changesJson:JSON.stringify({label:'金币',type:'array',scope:'global',defaultValue:['PRIVATE_VALUE']})};
 f=fixture([],{variableEditor,variableSaveConfirmed:async()=>{}});
 if(operation!=='create'){
  await variableEditor.apply(variableEditor.preview(f.host.currentTarget(),{operation:'create',id:'coins',changes:{label:'金币',type:'array',scope:'global',defaultValue:['PRIVATE_VALUE']}}));
  saves=0;args={operation,id:'coins',revision:variableEditor.list(f.host.currentTarget()).items[0].revision,changesJson:operation==='delete'?'{}':JSON.stringify({value:['NEW_PRIVATE']})};
 }
 await f.controller.dispose();
 f=fixture([[tool('muyu.variable_editor.preview',{...args,...(access==='full'?{apply:true}:{})}),done],[text('Prepared'),done]],
 {variableEditor,variableSaveConfirmed:async()=>{}});
 await f.enable();f.controller.setMode('assistant');if(['full','preview'].includes(access))f.controller.setFullAccess(true,{confirmed:true});
 f.controller.setInput('Prepare variable change');f.controller.send();await settle();
 if(['normal','deny'].includes(access)){
  const request=f.controller.snapshot().interaction;assert.equal(request.source,'variableEditState');assert.equal(saves,0);
  f.controller.answerPermission(request.id,access==='deny'?'deny':'task');await settle();
 }
 const artifact=f.controller.snapshot().artifacts.find(a=>a.kind==='variable-editor-draft');
 if(access==='normal'){
  assert.ok(artifact,JSON.stringify(f.controller.snapshot().runs));assert.equal(saves,0);
  const a=f.controller.prepareVariableApply(artifact.id,artifact.revision);await f.controller.approveVariableApply(a.id);
 }
 assert.equal(saves,['deny','preview'].includes(access)?0:1);
 if(access==='deny')assert.equal(artifact,undefined);
 else{
  assert.ok(artifact);const history=JSON.parse(f.controller.exportHistory());assert.ok(history.required.includes('source:variableEditState'));
  assert.doesNotMatch(JSON.stringify(history.receipts),/PRIVATE_VALUE|NEW_PRIVATE|a.png/);
  if(access!=='preview')assert.equal(history.receipts.at(-1).version,20);
 }
 await f.controller.dispose();
});
for(const operation of ['capture','apply'])for(const access of ['normal','deny','full','preview'])test(`Blueprint chat library ${operation} / ${access} uses exact bound sources and one action`,async()=>{
 const {createStoryBlueprintLibrarySystem}=await import('../../systems/story-blueprint-library-system.js');
 const {createBlueprintLibraryPort}=await import('../../muyu/host/blueprint-libraries.js');
 const {createBlueprintLibraryChatPort}=await import('../../muyu/host/blueprint-library-chat.js');
 let f,settingsSaves=0,chatSaves=0;const settings={},blueprint={version:1,title:'PRIVATE_CHAT',nodes:[{id:'a',type:'scene',title:'Alice',content:{text:'PRIVATE_CHAT'}}]},metadata={gd:{storyBlueprint:{blueprint}}};
 const system=createStoryBlueprintLibrarySystem({settings,EXT_KEY:'gd',extension_settings:{},saveSettings:()=>{settingsSaves++;},getCurrentGroup:()=>null,
 storyBlueprintSystem:new Proxy({}, {get:()=>()=>{throw Error('no impure getter');}}),log(){}});
 const blueprintLibraries=createBlueprintLibraryPort({getSettings:()=>settings,system});
 const blueprintLibraryChat=createBlueprintLibraryChatPort({getSettings:()=>settings,getMetadata:()=>metadata,getTarget:()=>f.host.currentTarget(),
 extensionKey:'gd',getChatLength:()=>3,system,libraryPort:blueprintLibraries,saveChatConfirmed:async()=>{chatSaves++;}});
 let args={name:'saved'};
 if(operation==='apply'){
  await blueprintLibraries.save(blueprintLibraries.preview({operation:'create',changes:{name:'pack',exportData:{type:'group-director-story-blueprint',version:1,storyBlueprint:{blueprint}}}}));
  const row=blueprintLibraries.list().items[0];args={id:row.id,revision:row.revision};settingsSaves=0;
 }
 if(access==='full')args.apply=true;
 f=fixture([[tool('muyu.blueprint_library_chat.'+(operation==='capture'?'capture_preview':'apply_preview'),args),done],[text('Prepared'),done]],{blueprintLibraries,blueprintLibraryChat});
 await f.enable();f.controller.setMode('assistant');if(['full','preview'].includes(access))f.controller.setFullAccess(true,{confirmed:true});
 f.controller.setInput('Prepare the specified Blueprint package operation');f.controller.send();await settle();
 const sources=[];
 if(['normal','deny'].includes(access))for(let i=0;i<2;i++){
  const r=f.controller.snapshot().interaction;assert.ok(r);sources.push(r.source);f.controller.answerPermission(r.id,access==='deny'?'deny':'task');await settle();if(access==='deny')break;
 }
 const artifact=f.controller.snapshot().artifacts.find(a=>a.kind==='blueprint-library-chat-draft');
 if(access==='normal'){
  assert.deepEqual(sources,['blueprintLibraryAssets','blueprintLibraryChat']);assert.ok(artifact);assert.equal(settingsSaves+chatSaves,0);
  const a=f.controller.prepareBlueprintLibraryChat(artifact.id,artifact.revision);await f.controller.approveBlueprintLibraryChat(a.id);
 }
 if(access==='deny'){assert.equal(artifact,undefined);assert.equal(settingsSaves+chatSaves,0);}
 else{
  assert.ok(artifact);assert.equal(settingsSaves,operation==='capture'&&access!=='preview'?1:0);assert.equal(chatSaves,operation==='apply'&&access!=='preview'?1:0);
  const history=JSON.parse(f.controller.exportHistory());assert.ok(history.required.includes('source:blueprintLibraryChat'));assert.ok(history.required.includes('source:blueprintLibraryAssets'));
  if(access!=='preview')assert.equal(history.receipts.at(-1).version,19);
  assert.doesNotMatch(JSON.stringify(history.receipts),/PRIVATE_CHAT|PRIVATE_LIBRARY|Alice|card.png/);
 }
 await f.controller.dispose();
});
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createMuyuController } from '../../muyu/application/controller.js';
import { ExecutionError } from '../../muyu/core/execution.js';
import { createCredentialStore } from '../../muyu/host/credentials.js';

test('Credential storage retains protocol and reasoning options without exposing keys in descriptors', async () => {
    const settings = { agentConfigs: { 'muyu-assistant': { endpoint: 'https://example.test/chat/completions', model: 'legacy', apiKey: 'PRIVATE_TEST_KEY', autoConnect: true } } };
    const store = createCredentialStore({ getSettings: () => settings, saveSettings: async () => {} });
    assert.equal(store.describe().profile, 'deepseek'); assert.equal(store.describe().reasoningEffort, 'high');
    assert.equal(store.describe().thinking, true); assert.equal(store.describe().apiKey, undefined);
    await store.save({ endpoint: 'https://example.test/chat/completions', model: 'generic', apiKey: 'PRIVATE_TEST_KEY', profile: 'chat-completions', thinking: true, reasoningEffort: 'max', autoConnect: true });
    const reloaded = createCredentialStore({ getSettings: () => settings, saveSettings: async () => {} });
    assert.equal(reloaded.restoreAutoConnection().profile, 'chat-completions'); assert.equal(reloaded.restoreAutoConnection().thinking, false);
    assert.equal(reloaded.describe().reasoningEffort, 'max'); assert.equal(reloaded.describe().apiKey, undefined);
    await reloaded.setAutoConnect(false); assert.equal(reloaded.restoreAutoConnection(), null); assert.equal(reloaded.describe().profile, 'chat-completions');
    await store.save({ endpoint: 'https://example.test/chat/completions', model: 'thinking', apiKey: 'PRIVATE_TEST_KEY', profile: 'deepseek', thinking: true, reasoningEffort: 'low', autoConnect: true });
    assert.equal(reloaded.restoreAutoConnection().reasoningEffort, 'low'); assert.equal(reloaded.restoreAutoConnection().thinking, true);
});
import { createAgentMemoryPort } from '../../muyu/host/agent-memory.js';
import { RUN_DEFAULTS } from '../../muyu/core/budget.js';
import { CONTEXT_DEFAULTS } from '../../muyu/context/policy.js';
import { fingerprint } from '../../muyu/context/planner.js';
import { HISTORY_LIMITS, historyBytes, historyScope } from '../../muyu/sessions/contract.js';
import { createConfigWriter } from '../../muyu/host/config-write.js';
import { createProviderPort } from '../../muyu/host/providers.js';
import { createVariableDraftPort } from '../../muyu/host/variable-draft.js';
import { createVariableWriter } from '../../muyu/host/variable-write.js';
import { createTaskBundleDraftPort } from '../../muyu/host/task-bundle-draft.js';
import { createTaskBundleWriter } from '../../muyu/host/task-bundle-write.js';
import { createProfileWriter } from '../../muyu/host/profile-write.js';
import { createMemoryHistoryStore } from '../../muyu/sessions/memory-store.js';
import { openRecoveryStore } from '../../muyu/recovery/indexeddb-store.js';
import { historyIDB } from './helpers/history-idb.mjs';

test('Controller locally reviews and resumes an unexecuted config without another model call or restoring grants', async () => {
    const store = createMemoryHistoryStore(), indexedDB = historyIDB();
    const history = { enabled: () => true, open: async () => store, openRecovery: () => openRecoveryStore({ namespace: 'resume-controller', indexedDB }) };
    let writer, saves = 0;
    const f = fixture([[tool('muyu.config.preview', { changes: { autoMemoryInterval: 15 } }), done], [text('draft only'), done]], { history, configWriter: { apply: value => writer.apply(value) } });
    writer = createConfigWriter({ getSettings: () => f.settings, saveSettings: async () => { saves++; } });
    await f.enable(); f.controller.setMode('draft'); f.controller.setInput('Preview interval 15');
    f.controller.send({ consent: true, fields: ['autoMemoryInterval'] }); await settle(); await f.controller.refreshCheckpoints();
    indexedDB.failNextPut('checkpoints');
    const artifact = f.controller.snapshot().artifacts[0], action = f.controller.prepareConfigApply(artifact.id, artifact.revision);
    assert.equal((await f.controller.approveConfigApply(action.id)).status, 'not_executed'); assert.equal(saves, 0);
    const permissions = f.controller.snapshot().permissions, calls = f.model.requests.length;
    await f.controller.prepareCheckpointRecovery(action.id); assert.equal(saves, 0); assert.equal(f.controller.snapshot().checkpoints.preview.state, 'ready');
    const result = await f.controller.approveCheckpointRecovery(action.id);
    assert.equal(result.status, 'applied_unconfirmed'); assert.equal(saves, 1); assert.equal(f.settings.autoMemoryInterval, 15);
    assert.equal(f.model.requests.length, calls); assert.deepEqual(f.controller.snapshot().permissions, permissions);
    await assert.rejects(f.controller.approveCheckpointRecovery(action.id), /RECOVERY_STALE/); await f.controller.dispose();
});

test('Controller assembly persists configuration checkpoints and reloads facts without approval or dispatch', async () => {
    const store = createMemoryHistoryStore(), indexedDB = historyIDB();
    const history = { enabled: () => true, open: async () => store, openRecovery: () => openRecoveryStore({ namespace: 'controller', indexedDB }) };
    let writer, saves = 0;
    const f = fixture([[tool('muyu.config.preview', { changes: { autoMemoryInterval: 15 } }), done], [text('draft only'), done]], { history, configWriter: { apply: value => writer.apply(value) } });
    writer = createConfigWriter({ getSettings: () => f.settings, saveSettings: async () => { saves++; } });
    await f.enable(); f.controller.setMode('draft'); f.controller.setInput('Preview interval 15');
    f.controller.send({ consent: true, fields: ['autoMemoryInterval'] }); await settle();
    const artifact = f.controller.snapshot().artifacts[0], action = f.controller.prepareConfigApply(artifact.id, artifact.revision);
    await f.controller.approveConfigApply(action.id); await f.controller.flushHistory();
    const rows = f.controller.snapshot().checkpoints.records; assert.equal(rows.length, 1);
    assert.ok(rows[0].conversationId); assert.equal(rows[0].status, 'applied_unconfirmed'); assert.equal(saves, 1);
    await f.controller.dispose();
    const second = fixture([], { history }); await second.controller.ready; await second.controller.refreshCheckpoints();
    assert.equal(second.controller.snapshot().checkpoints.records[0].id, action.id);
    assert.equal(second.controller.snapshot().configActions.length, 0); assert.equal(second.model.requests.length, 0); assert.equal(saves, 1);
    await second.controller.dispose();
});
import { openSettingsHistoryStore } from '../../muyu/sessions/settings-store.js';
import { scriptedModel, text, done, deferred, flush } from './helpers/muyu-subject.mjs';

const tool = (toolId, args = {}, callId = 'c1') => ({ type: 'tool_call_complete', call: { toolId, callId, version: toolId.startsWith('muyu.provider.') && !['muyu.provider.assets', 'muyu.provider.source', 'muyu.provider.preview', 'muyu.provider.test', 'muyu.provider.update_preview', 'muyu.provider.remove_preview'].includes(toolId) ? 2 : 1, args } });

const ask = () => tool('muyu.interaction.ask', { question: 'Which part?', options: ['Frequency', 'Content'] });

async function profileExecutionControllerFixture(mode, { saveFails = false, budget = false, paused = false } = {}) {
    const { createProfileSystem } = await import('../../systems/profile-system.js');
    const { createProfileGenerationPort } = await import('../../muyu/host/profile-generation.js');
    let f, calls = 0, saves = 0, finish;
    const wait = new Promise(resolve => { finish = resolve; }), characters = [{ avatar: 'Alice.png', name: 'Alice', description: 'character' }];
    const settings = { profileEnabled: true, profileJsonSchema: '', agentConfigs: { profile: { useCustom: false } } };
    const system = createProfileSystem({ settings, EXT_KEY: 'gd', getChatMetadata: () => f.ctx.chatMetadata, getChat: () => f.ctx.chat,
        getCharacters: () => characters, getCurrentGroup: () => f.ctx.groups[0], getContext: () => f.ctx, isRoundActive: () => false,
        hashChar: (...values) => values.join('|'), djb2Hash: value => String(value.length),
        renderPrompt: async p => p, extractJsonObject: () => null, sanitizeJson: value => value,
        setExtensionPrompt() {}, inject_ids: { QUIET_PROMPT: 'quiet' }, extension_prompt_types: { IN_PROMPT: 0 },
        saveChatConditional: () => { throw Error('conditional fallback forbidden'); },
        createCaller: () => ({ generate: async () => { calls++; if (paused) await wait;
            return '{"summary":"PRIVATE_GENERATED_PROFILE","tags":["owl"],"motivation":"help","relationships":"team"}'; } }) });
    const profileGeneration = createProfileGenerationPort({ getTarget: () => f.host.currentTarget(), getContext: () => f.ctx,
        getSettings: () => settings, getCharacters: () => characters, getProviders: () => [], system,
        saveChatConfirmed: async () => { saves++; if (saveFails) throw Error('save failure'); } });
    const last = () => JSON.parse(f.model.requests.at(-1).messages.findLast(m => m.role === 'tool' && m.result?.data?.text)?.result.data.text);
    f = fixture([[tool('muyu.profile_generation.targets', {}), done],
        () => { const row = last().items[0]; return [tool('muyu.profile_generation.prepare', { character: row.character, revision: row.revision, mode }, 'profile-prepare'), done]; },
        () => [tool('muyu.profile_generation.execute', { executionId: last().executionId }, 'profile-extract'), done],
        [text('Historical result; no extra execution'), done]], { profileGeneration });
    await f.enable(); f.controller.setMode('assistant');
    if (budget) await f.controller.saveRunConfig({ ...RUN_DEFAULTS, providerBytes: 6000 });
    return { f, settings, system, finish, calls: () => calls, saves: () => saves };
}

for (const mode of ['trial', 'save']) for (const decision of ['task', 'deny', 'full']) test(`Profile generation ${mode}/${decision}: source read is not paid-write authority; resume exactly once`, async () => {
    const { f, settings, calls, saves } = await profileExecutionControllerFixture(mode);
    if (decision === 'full') f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput(mode === 'trial' ? 'Test Alice profile extraction without saving' : 'Extract and save Alice profile once'); f.controller.send(); await settle();
    if (decision !== 'full') {
        let r = f.controller.snapshot().interaction; assert.equal(r.source, 'profileGenerationTargets'); assert.equal(calls(), 0);
        f.controller.answerPermission(r.id, 'task'); await settle(); r = f.controller.snapshot().interaction;
        assert.equal(r.source, 'profileExecution'); assert.equal(calls(), 0); assert.equal(saves(), 0);
        assert.equal(f.controller.profileExecutionDetails(r.executionId).mode, mode);
        assert.throws(() => f.controller.answerPermission(r.id, 'chat'), /INVALID_PERMISSION_DECISION/);
        // Conversation storage is independent of the approved business context.
        settings.muyuHistoryAccount = { writes: 1 };
        f.controller.answerPermission(r.id, decision); await settle();
    }
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded'); assert.equal(calls(), decision === 'deny' ? 0 : 1);
    assert.equal(saves(), mode === 'save' && decision !== 'deny' ? 1 : 0);
    const saved = JSON.parse(f.controller.exportHistory());
    assert.ok(saved.required.some(source => source.startsWith('source:profileExecution:')) || decision === 'deny');
    if (mode === 'trial' || decision === 'deny') assert.deepEqual(f.ctx.chatMetadata, {});
    else assert.equal(f.ctx.chatMetadata.gd.characterProfiles['Alice.png'].profile.summary, 'PRIVATE_GENERATED_PROFILE');
    assert.equal(settings.profileEnabled, true); assert.equal(f.model.requests.length, 4);
    await f.controller.dispose();
});
test('profile generation refuses stale exact approval after business configuration changes', async () => {
    const { f, settings, calls } = await profileExecutionControllerFixture('save'); f.controller.setInput('Generate Alice profile'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'task'); await settle(); const r = f.controller.snapshot().interaction;
    settings.profileGeneratorPrompt = 'changed'; assert.throws(() => f.controller.answerPermission(r.id, 'task'), /INTERACTION_STALE/);
    assert.equal(calls(), 0); f.controller.cancelInteraction(r.id); await f.controller.dispose();
});
test('profile generation lacks result budget: consent does not start paid effects', async () => {
    const { f, calls, saves } = await profileExecutionControllerFixture('save', { budget: true }); f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput('Generate Alice profile'); f.controller.send(); await settle(); assert.equal(calls(), 0); assert.equal(saves(), 0);
    assert.match(JSON.stringify(f.model.requests.at(-1).messages), /RESULT_BUDGET_EXCEEDED/); await f.controller.dispose();
});
test('profile generation returns unknown saving as data without retry or conditional-save fallback', async () => {
    const { f, calls, saves } = await profileExecutionControllerFixture('save', { saveFails: true }); f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput('Generate and save Alice profile'); f.controller.send(); await settle(); assert.equal(calls(), 1); assert.equal(saves(), 1);
    assert.match(JSON.stringify(f.model.requests.at(-1).messages), /outcome_unknown/);
    assert.equal(f.ctx.chatMetadata.gd.characterProfiles['Alice.png'].state, 'ready'); await f.controller.dispose();
});
test('profile controller cancellation retains physical busy lease and blocks late generated writes', async () => {
    const { f, system, finish, calls, saves } = await profileExecutionControllerFixture('save', { paused: true }); f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput('Generate Alice profile'); f.controller.send(); await settle(); assert.equal(calls(), 1);
    f.controller.stop(); await settle(); assert.equal(system.isGenerating(), true); assert.equal(saves(), 0);
    finish(); await settle(); assert.equal(system.isGenerating(), false); assert.equal(saves(), 0); assert.deepEqual(f.ctx.chatMetadata, {});
    await f.controller.dispose();
});

async function npcExecutionControllerFixture(mode, { saveFails = false, budget = false, paused = false } = {}) {
    const { createNpcSystem } = await import('../../systems/npc-system.js');
    const { createNpcAgent } = await import('../../agents/npc.js');
    const { execute } = await import('../../systems/agent-runtime.js');
    const { createNpcGenerationPort } = await import('../../muyu/host/npc-generation.js');
    let f, calls = 0, saves = 0, finish;
    const wait = new Promise(resolve => { finish = resolve; }), characters = [{ avatar: 'Alice.png', name: 'Alice' }];
    const settings = { npcEnabled: true, npcMaxCount: 10, npcBatchSize: 3, npcGenerateFirstMes: false,
        agentConfigs: { npc: { call: { retries: 2, timeout: 1000 } } } };
    const agent = createNpcAgent({ renderPrompt: async p => p, extractJsonObject: () => null, log() {} });
    const system = createNpcSystem({ settings, EXT_KEY: 'gd', getChatMetadata: () => f.ctx.chatMetadata, getChat: () => f.ctx.chat,
        getCharacters: () => characters, getCurrentGroup: () => f.ctx.groups[0], getContext: () => f.ctx,
        AgentRegistry: { get: () => agent }, execute, log() {},
        saveChatConditional: () => { throw Error('conditional fallback forbidden'); },
        buildContextPool: ({ group, npcExistingList, npcBatchSize, npcGenerateFirstMes }) => ({ group: () => group,
            characters: () => characters, recentMessages: () => f.ctx.chat, npcExistingList, npcBatchSize, npcGenerateFirstMes }),
        createCaller: () => ({ supportsAbort: false, generate: async () => { calls++; if (paused) await wait;
            return '{"npcs":[{"name":"PRIVATE_GENERATED_NPC","description":"A merchant","personality":"Calm","scenario":"Tavern"}]}'; } }) });
    const npcGeneration = createNpcGenerationPort({ getTarget: () => f.host.currentTarget(), getContext: () => f.ctx,
        getSettings: () => settings, getProviders: () => [], system,
        saveChatConfirmed: async () => { saves++; if (saveFails) throw Error('save failure'); } });
    const last = () => JSON.parse(f.model.requests.at(-1).messages.findLast(m => m.role === 'tool' && m.result?.data?.text)?.result.data.text);
    f = fixture([[tool('muyu.npc_generation.state', {}), done],
        () => [tool('muyu.npc_generation.prepare', { revision: last().revision, mode, count: 2 }, 'npc-prepare'), done],
        () => [tool('muyu.npc_generation.execute', { executionId: last().executionId }, 'npc-generate'), done],
        [text('Historical NPC result; not a character-card import'), done]], { npcGeneration });
    await f.enable(); f.controller.setMode('assistant');
    if (budget) await f.controller.saveRunConfig({ ...RUN_DEFAULTS, providerBytes: 6000 });
    return { f, settings, system, finish, calls: () => calls, saves: () => saves };
}

for (const mode of ['trial', 'save']) for (const decision of ['task', 'deny', 'full']) test(`NPC generation ${mode}/${decision}: exact consent resumes original call with no extra model request`, async () => {
    const { f, settings, calls, saves } = await npcExecutionControllerFixture(mode);
    if (decision === 'full') f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput(mode === 'trial' ? 'Test NPC generation without saving' : 'Generate and save two NPC records, no card import');
    f.controller.send(); await settle();
    if (decision !== 'full') {
        let r = f.controller.snapshot().interaction; assert.equal(r.source, 'npcGenerationState'); assert.equal(calls(), 0);
        f.controller.answerPermission(r.id, 'task'); await settle(); r = f.controller.snapshot().interaction;
        assert.equal(r.source, 'npcExecution'); assert.equal(calls(), 0); assert.equal(saves(), 0);
        const details = f.controller.npcExecutionDetails(r.executionId); assert.equal(details.mode, mode); assert.equal(details.requested, 2);
        assert.throws(() => f.controller.answerPermission(r.id, 'chat'), /INVALID_PERMISSION_DECISION/);
        settings.muyuHistoryAccount = { writes: 1 }; f.controller.answerPermission(r.id, decision); await settle();
    }
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded'); assert.equal(calls(), decision === 'deny' ? 0 : 1);
    assert.equal(saves(), mode === 'save' && decision !== 'deny' ? 1 : 0);
    const saved = JSON.parse(f.controller.exportHistory());
    assert.ok(saved.required.some(source => source.startsWith('source:npcExecution:')) || decision === 'deny');
    if (mode === 'trial' || decision === 'deny') assert.deepEqual(f.ctx.chatMetadata, {});
    else { assert.equal(f.ctx.chatMetadata.gd.npcs[0].name, 'PRIVATE_GENERATED_NPC'); assert.equal(f.ctx.chatMetadata.gd.npcs[0].imported, false); }
    assert.equal(settings.npcEnabled, true); assert.equal(f.model.requests.length, 4); await f.controller.dispose();
});

test('NPC approval refuses stale business settings without model work', async () => {
    const { f, settings, calls } = await npcExecutionControllerFixture('save'); f.controller.setInput('Generate NPC records'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'task'); await settle(); const r = f.controller.snapshot().interaction;
    settings.npcBatchSize = 4; assert.throws(() => f.controller.answerPermission(r.id, 'task'), /INTERACTION_STALE/);
    assert.equal(calls(), 0); f.controller.cancelInteraction(r.id); await f.controller.dispose();
});

test('NPC insufficient result budget prevents all paid/write effects even in full access', async () => {
    const { f, calls, saves } = await npcExecutionControllerFixture('save', { budget: true }); f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput('Generate NPC records'); f.controller.send(); await settle(); assert.equal(calls(), 0); assert.equal(saves(), 0);
    assert.match(JSON.stringify(f.model.requests.at(-1).messages), /RESULT_BUDGET_EXCEEDED/); await f.controller.dispose();
});

test('NPC unknown save is historical data, not a retry or rollback', async () => {
    const { f, calls, saves } = await npcExecutionControllerFixture('save', { saveFails: true }); f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput('Generate NPC records'); f.controller.send(); await settle(); assert.equal(calls(), 1); assert.equal(saves(), 1);
    assert.match(JSON.stringify(f.model.requests.at(-1).messages), /outcome_unknown/); assert.equal(f.ctx.chatMetadata.gd.npcs.length, 1);
    await f.controller.dispose();
});

test('NPC controller stop keeps the native physical lease and prevents late writes', async () => {
    const { f, system, finish, calls, saves } = await npcExecutionControllerFixture('save', { paused: true }); f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput('Generate NPC records'); f.controller.send(); await settle(); assert.equal(calls(), 1);
    f.controller.stop(); await settle(); assert.equal(system.isGenerating(), true); assert.equal(saves(), 0);
    finish(); await settle(); assert.equal(system.isGenerating(), false); assert.equal(saves(), 0); assert.deepEqual(f.ctx.chatMetadata, {});
    await f.controller.dispose();
});

async function memoryExecutionControllerFixture(mode, { saveFails = false, budget = false, paused = false } = {}) {
    const { createMemorySystem } = await import('../../systems/memory-system.js');
    const { createMemoryAgent } = await import('../../agents/memory.js');
    const { execute } = await import('../../systems/agent-runtime.js');
    const { createMemoryGenerationPort } = await import('../../muyu/host/memory-generation.js');
    let f, calls = 0, saves = 0, finish;
    const wait = new Promise(resolve => { finish = resolve; }), characters = [{ avatar: 'Alice.png', name: 'Alice', description: 'character' }];
    const settings = { memoryMaxEntries: 3, llmContextDepth: 10, agentConfigs: { memory: { call: { retries: 2, timeout: 1000 } } } };
    const agent = createMemoryAgent({ renderPrompt: async p => p, extractJsonObject: () => null, log() {} });
    const system = createMemorySystem({ settings, EXT_KEY: 'gd', getChatMetadata: () => f.ctx.chatMetadata, getChat: () => f.ctx.chat,
        getCharacters: () => characters, AgentRegistry: { get: () => agent }, execute, getCurrentGroup: () => f.ctx.groups[0],
        getContext: () => f.ctx, log() {}, saveChatConditional: () => { throw Error('conditional fallback forbidden'); },
        buildContextPool: ({ memoryCharacter, memoryExistingList }) => ({ chat: () => f.ctx.chat, memoryCharacter: () => memoryCharacter, memoryExistingList, recentMessages: () => f.ctx.chat }),
        createCaller: () => ({ supportsAbort: false, generate: async () => { calls++; if (paused) await wait; return '{"memories":[{"event":"PRIVATE_GENERATED_MEMORY","mood":"happy"}]}'; } }) });
    const memoryGeneration = createMemoryGenerationPort({ getTarget: () => f.host.currentTarget(), getContext: () => f.ctx,
        getSettings: () => settings, getCharacters: () => characters, getProviders: () => [], system,
        saveChatConfirmed: async () => { saves++; if (saveFails) throw Error('save failure'); } });
    const last = () => JSON.parse(f.model.requests.at(-1).messages.findLast(m => m.role === 'tool' && m.result?.data?.text)?.result.data.text);
    f = fixture([[tool('muyu.memory_generation.targets', {}), done],
        () => { const row = last().items[0]; return [tool('muyu.memory_generation.prepare', { character: row.character, revision: row.revision, mode }, 'prepare'), done]; },
        () => [tool('muyu.memory_generation.execute', { executionId: last().executionId }, 'extract'), done], [text('Historical result; no extra execution'), done]], { memoryGeneration });
    await f.enable(); f.controller.setMode('assistant');
    if (budget) await f.controller.saveRunConfig({ ...RUN_DEFAULTS, providerBytes: 6000 });
    return { f, settings, system, finish, calls: () => calls, saves: () => saves };
}
for (const mode of ['trial', 'save']) for (const decision of ['task', 'deny', 'full']) test(`Memory generation ${mode}/${decision}: source read is not paid-write authority; resume exactly once`, async () => {
    const { f, settings, calls, saves } = await memoryExecutionControllerFixture(mode);
    if (decision === 'full') f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput(mode === 'trial' ? 'Test Alice memory extraction without saving' : 'Extract and save Alice memory once'); f.controller.send(); await settle();
    if (decision !== 'full') {
        let r = f.controller.snapshot().interaction; assert.equal(r.source, 'memoryGenerationTargets'); assert.equal(calls(), 0);
        f.controller.answerPermission(r.id, 'task'); await settle(); r = f.controller.snapshot().interaction;
        assert.equal(r.source, 'memoryExecution'); assert.equal(calls(), 0); assert.equal(saves(), 0);
        assert.equal(f.controller.memoryExecutionDetails(r.executionId).mode, mode);
        assert.throws(() => f.controller.answerPermission(r.id, 'chat'), /INVALID_PERMISSION_DECISION/);
        // Conversation storage is independent of the approved business context.
        settings.muyuHistoryAccount = { writes: 1 };
        f.controller.answerPermission(r.id, decision); await settle();
    }
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded'); assert.equal(calls(), decision === 'deny' ? 0 : 1);
    assert.equal(saves(), mode === 'save' && decision !== 'deny' ? 1 : 0);
    const saved = JSON.parse(f.controller.exportHistory());
    assert.ok(saved.required.some(source => source.startsWith('source:memoryExecution:')) || decision === 'deny');
    if (mode === 'trial' || decision === 'deny') assert.deepEqual(f.ctx.chatMetadata, {});
    else assert.equal(f.ctx.chatMetadata.gd.charMemories['Alice.png'][0].event, 'PRIVATE_GENERATED_MEMORY');
    assert.equal(settings.memoryEnabled, undefined); await f.controller.dispose();
});
test('memory generation refuses stale exact approval after business configuration changes', async () => {
    const { f, settings, calls } = await memoryExecutionControllerFixture('save'); f.controller.setInput('Generate Alice memory'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'task'); await settle(); const r = f.controller.snapshot().interaction;
    settings.memoryMaxEntries++; assert.throws(() => f.controller.answerPermission(r.id, 'task'), /INTERACTION_STALE/);
    assert.equal(calls(), 0); f.controller.cancelInteraction(r.id); await f.controller.dispose();
});
test('memory generation lacks result budget: consent does not start paid effects', async () => {
    const { f, calls, saves } = await memoryExecutionControllerFixture('save', { budget: true }); f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput('Generate Alice memory'); f.controller.send(); await settle(); assert.equal(calls(), 0); assert.equal(saves(), 0);
    assert.match(JSON.stringify(f.model.requests.at(-1).messages), /RESULT_BUDGET_EXCEEDED/); await f.controller.dispose();
});
test('memory generation returns unknown saving as data without retry or conditional-save fallback', async () => {
    const { f, calls, saves } = await memoryExecutionControllerFixture('save', { saveFails: true }); f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput('Generate and save Alice memory'); f.controller.send(); await settle(); assert.equal(calls(), 1); assert.equal(saves(), 1);
    assert.match(JSON.stringify(f.model.requests.at(-1).messages), /outcome_unknown/);
    assert.equal(f.ctx.chatMetadata.gd.charMemories['Alice.png'].length, 1); await f.controller.dispose();
});
test('controller cancellation retains physical busy lease and blocks late generated writes', async () => {
    const { f, system, finish, calls, saves } = await memoryExecutionControllerFixture('save', { paused: true }); f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput('Generate Alice memory'); f.controller.send(); await settle(); assert.equal(calls(), 1);
    f.controller.stop(); await settle(); assert.equal(system.isGenerating(), true); assert.equal(saves(), 0);
    finish(); await settle(); assert.equal(system.isGenerating(), false); assert.equal(saves(), 0); assert.deepEqual(f.ctx.chatMetadata, {});
    await f.controller.dispose();
});

for (const mode of ['trial', 'save']) for (const decision of ['task', 'deny', 'full']) test(`Custom Agent real ${mode} execution ${decision} consent resumes once and keeps result scope`, async () => {
    const { createCustomAgentSystem } = await import('../../systems/custom-agent-system.js');
    const { createCustomAgentPort } = await import('../../muyu/host/custom-agents.js');
    let f, modelCalls = 0, chatSaves = 0; const settings = {};
    const system = createCustomAgentSystem({ settings, getChatMetadata: () => f.ctx.chatMetadata, getChat: () => f.ctx.chat, EXT_KEY: 'gd',
        getProviders: () => [], registerProvider() {}, unregisterProvider() {}, saveSettings() {}, renderPrompt: async p => p,
        createCaller: () => ({ generate: async () => { modelCalls++; return 'business reply'; } }), saveChatConditional: async () => { chatSaves++; } });
    const row = await system.add({ name: 'manual', providerName: 'manual', prompt: 'test', enabled: false });
    const customAgents = createCustomAgentPort({ getSettings: () => settings, getContext: () => f.ctx, getTarget: () => f.host.currentTarget(), getProviders: () => [], system });
    const revision = customAgents.list().items[0].revision;
    const execute = () => {
        const output = f.model.requests.at(-1).messages.findLast(row => row.role === 'tool' && row.result?.data?.text)?.result.data.text;
        return [tool('muyu.agents.execute', { executionId: JSON.parse(output).executionId }, 'execute'), done];
    };
    f = fixture([[tool('muyu.agents.prepare_execution', { id: row.id, revision, mode }), done], execute, [text('Historical execution result'), done]], { customAgents });
    await f.enable(); f.controller.setMode('assistant'); if (decision === 'full') f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput('Run the specified custom agent once'); f.controller.send(); await settle();
    if (decision !== 'full') {
        let request = f.controller.snapshot().interaction; assert.equal(request.source, 'customAgentAssets');
        f.controller.answerPermission(request.id, 'task'); await settle(); request = f.controller.snapshot().interaction;
        assert.equal(request.source, 'agentExecution'); assert.equal(modelCalls, 0); assert.equal(f.controller.agentExecutionDetails(request.executionId).mode, mode);
        assert.throws(() => f.controller.answerPermission(request.id, 'chat'), /INVALID_PERMISSION_DECISION/);
        f.controller.answerPermission(request.id, decision); await settle();
    }
    assert.equal(modelCalls, decision === 'deny' ? 0 : 1); assert.equal(chatSaves, decision !== 'deny' && mode === 'save' ? 1 : 0);
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded'); assert.equal(settings.customAgents[0].enabled, false);
    if (chatSaves) assert.equal(f.ctx.chatMetadata.gd._caData[row.id].content, 'business reply');
    const exported = JSON.parse(f.controller.exportHistory());
    assert.ok(exported.required.some(source => source.startsWith('source:agentExecution:')) || decision === 'deny');
    await f.controller.dispose();
});

for (const kind of ['batch', 'import']) for (const access of ['normal', 'full', 'deny']) test(`Custom Agent ${kind} preview ${access} uses the real queued writer and one global save`, async () => {
    const { createCustomAgentSystem } = await import('../../systems/custom-agent-system.js');
    const { createCustomAgentPort } = await import('../../muyu/host/custom-agents.js');
    const settings = {}, registry = new Map(); let saves = 0;
    const getProviders = () => [...registry.values()];
    const system = createCustomAgentSystem({ settings, getProviders, registerProvider: p => registry.set(p.id, p), unregisterProvider: id => registry.delete(id),
        saveSettings: () => { saves++; }, getChatMetadata: () => { throw Error('no chat read'); }, getChat: () => [], EXT_KEY: 'gd' });
    const customAgents = createCustomAgentPort({ getSettings: () => settings, getProviders, system });
    const definitions = ['a', 'b'].map(name => ({ name, providerName: name, prompt: 'PRIVATE_PROMPT_' + name }));
    const args = kind === 'batch' ? { requestsJson: JSON.stringify(definitions.map(changes => ({ operation: 'create', changes }))) }
        : { exportJson: JSON.stringify({ type: 'custom-agent-export', version: 1, agents: definitions }) };
    if (access === 'full') args.apply = true;
    const f = fixture([[tool('muyu.agents.' + kind + '_preview', args), done], [text('Result'), done]], { customAgents });
    await f.enable(); f.controller.setMode('assistant');
    if (access === 'full') f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput('Prepare both custom agents'); f.controller.send(); await settle();
    if (access !== 'full') {
        const request = f.controller.snapshot().interaction; assert.equal(request.source, 'customAgentAssets'); assert.equal(saves, 0);
        f.controller.answerPermission(request.id, access === 'deny' ? 'deny' : 'task'); await settle();
    }
    if (access === 'normal') {
        const artifact = f.controller.snapshot().artifacts.find(row => row.kind === 'custom-agent-draft'); assert.ok(artifact); assert.equal(saves, 0);
        const approval = f.controller.prepareCustomAgentSave(artifact.id, artifact.revision); await f.controller.approveCustomAgentSave(approval.id);
    }
    assert.equal(saves, access === 'deny' ? 0 : 1);
    if (access !== 'deny') {
        assert.equal(settings.customAgents.length, 2);
        const receipt = JSON.parse(f.controller.exportHistory()).receipts.at(-1); assert.equal(receipt.version, 11); assert.equal(receipt.items.length, 2);
        assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE_PROMPT/);
    } else assert.equal(f.controller.snapshot().artifacts.some(row => row.kind === 'custom-agent-draft'), false);
    await f.controller.dispose();
});

for (const operation of ['create', 'update', 'delete']) test(`Custom Agent ${operation} pauses for source permission, then requires one exact save approval`, async () => {
    let writes = 0;
    const content = { module: 'custom-agent', operation, id: operation === 'create' ? '' : 'se_user', baseRevision: '', previous: { name: 'user', providerName: 'user_agent', prompt: 'OLD_SOURCE' }, next: operation === 'delete' ? null : { name: 'user', providerName: 'user_agent', enabled: false, prompt: 'NEW_SOURCE' }, warnings: [] };
    const customAgents = { preview: () => content, assertDraft() {}, save: async () => { writes++; return { status: 'saved_unconfirmed', id: 'se_user', enabled: false, persistence: 'unconfirmed' }; } };
    const f = fixture([[tool('muyu.agents.preview', { operation, changesJson: '{}' }), done], [text('Only preview'), done]], { customAgents });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Preview script'); f.controller.send(); await settle();
    const request = f.controller.snapshot().interaction; assert.equal(request.source, 'customAgentAssets'); assert.equal(writes, 0);
    f.controller.answerPermission(request.id, 'task'); await settle();
    const artifact = f.controller.snapshot().artifacts.find(row => row.kind === 'custom-agent-draft'); assert.ok(artifact); assert.equal(writes, 0);
    const approval = f.controller.prepareCustomAgentSave(artifact.id, artifact.revision); await f.controller.approveCustomAgentSave(approval.id);
    assert.equal(writes, 1); const receipt = JSON.parse(f.controller.exportHistory()).receipts.find(row => row.version === 10);
    assert.equal(receipt.operation, operation); assert.doesNotMatch(JSON.stringify(receipt), /OLD_SOURCE|NEW_SOURCE/);
    assert.throws(() => f.controller.approveCustomAgentSave(approval.id), /STALE/); await f.controller.dispose();
});

test('Custom Agent full access only saves explicitly requested apply candidates', async () => {
    let writes = 0;
    const customAgents = { assertDraft() {}, preview: () => ({ module: 'custom-agent', operation: 'create', id: '', baseRevision: '', previous: null, next: { name: 'user', providerName: 'user_agent', enabled: false }, warnings: [] }),
        save: async () => { writes++; return { status: 'saved_unconfirmed', id: 'se_user', enabled: false, persistence: 'unconfirmed' }; } };
    const args = { operation: 'create', changesJson: '{"name":"user"}' };
    const f = fixture([[tool('muyu.agents.preview', args), done], [text('Preview'), done], [tool('muyu.agents.preview', { ...args, apply: true }), done], [text('Save requested'), done]], { customAgents });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput('Preview only'); f.controller.send(); await settle(); assert.equal(writes, 0);
    f.controller.setInput('Save it'); f.controller.send(); await settle(); assert.equal(writes, 1); assert.equal(f.controller.snapshot().receipts.at(-1).version, 10);
    await f.controller.dispose();
});

for (const decision of ['task', 'deny', 'full']) test(`Real script execution ${decision} consent resumes once with an exact ticket`, async () => {
    const { createScriptExecutorSystem } = await import('../../systems/script-executor-system.js');
    const { createScriptExecutorPort } = await import('../../muyu/host/script-executors.js');
    const { normalizeScriptExecutor } = await import('../../systems/script-executor-validation.js');
    let f;
    const settings = { scriptExecutors: [{ id: 'se_manual', ...normalizeScriptExecutor({ name: 'manual', triggerOn: 'round', enabled: false, code: 'ctx.settings.runs=(ctx.settings.runs||0)+1; return "done";' }) }] };
    const scriptExecutors = createScriptExecutorPort({ getSettings: () => settings, getContext: () => f.ctx, getTarget: () => f.host.currentTarget(), system: createScriptExecutorSystem({ settings, saveSettings() {} }) });
    const revision = scriptExecutors.list().items[0].revision;
    const execute = () => {
        const output = f.model.requests.at(-1).messages.findLast(row => row.role === 'tool' && row.result?.data?.text)?.result.data.text;
        return [tool('muyu.scripts.execute', { executionId: JSON.parse(output).executionId }, 'execute'), done];
    };
    f = fixture([[tool('muyu.scripts.prepare_execution', { id: 'se_manual', revision, stage: 'round' }), done], execute, [text('Result recorded'), done]], { scriptExecutors });
    await f.enable(); f.controller.setMode('assistant');
    if (decision === 'full') f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput('Run this script once'); f.controller.send(); await settle();
    if (decision !== 'full') {
        let request = f.controller.snapshot().interaction; assert.equal(request.source, 'scriptAssets');
        f.controller.answerPermission(request.id, 'task'); await settle();
        request = f.controller.snapshot().interaction; assert.equal(request.source, 'scriptExecution'); assert.equal(settings.runs, undefined);
        assert.equal(f.controller.scriptExecutionDetails(request.executionId).definition.name, 'manual');
        assert.throws(() => f.controller.answerPermission(request.id, 'chat'), /INVALID_PERMISSION_DECISION/);
        f.controller.answerPermission(request.id, decision); await settle();
    }
    assert.equal(settings.runs || 0, decision === 'deny' ? 0 : 1);
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
    assert.equal(f.controller.snapshot().interaction?.status === 'pending', false);
    const exported = JSON.parse(f.controller.exportHistory()); assert.ok(exported.required.some(source => source.startsWith('source:scriptExecution:')) || decision === 'deny');
    await f.controller.dispose();
});

test('Script synthetic test pauses for task-only code consent, resumes exact call and never saves', async () => {
    let tested=0,saved=0,f;
    const scriptExecutors={assertDraft(){},preview:()=>({module:'script-executor',operation:'create',id:'',baseRevision:'',previous:null,next:{name:'x',code:'return 1',enabled:false},warnings:[]}),
        test:async()=>{tested++;return {status:'passed',phase:'execute',rows:[]};},save:async()=>{saved++;}};
    const testCall=()=>{const request=f.model.requests.at(-1),candidateId=request.messages.findLast(row=>row.role==='tool'&&row.result?.data?.candidateId)?.result.data.candidateId;return [tool('muyu.scripts.test',{candidateId},'synthetic'),done];};
    f=fixture([[tool('muyu.scripts.preview',{operation:'create',changesJson:'{"name":"x"}'}),done],testCall,[text('Synthetic test only'),done]],{scriptExecutors});
    await f.enable();f.controller.setMode('assistant');f.controller.setInput('Draft and test');f.controller.send();await settle();
    let request=f.controller.snapshot().interaction;assert.equal(request.source,'scriptAssets');f.controller.answerPermission(request.id,'task');await settle();
    request=f.controller.snapshot().interaction;assert.equal(request.source,'scriptTests');assert.equal(tested,0);
    assert.throws(()=>f.controller.answerPermission(request.id,'chat'),/INVALID_PERMISSION_DECISION/);
    f.controller.answerPermission(request.id,'task');await settle();assert.equal(tested,1);assert.equal(saved,0);
    assert.equal(f.controller.snapshot().runs.at(-1).status,'succeeded');assert.ok(f.controller.snapshot().artifacts.some(row=>row.kind==='script-draft'));
    await f.controller.dispose();
});

test('Script bundle source permission never saves; one exact approval records v9 without code', async () => {
    let saved=0;
    const scriptExecutors={assertDraft(){},preview:()=>({module:'script-executor',operation:'create',id:'',baseRevision:'',previous:null,next:{name:'x',code:'CODE_SENTINEL',enabled:true},warnings:['Enables future automatic execution']}),
        save:async()=>{saved++;return {status:'saved_unconfirmed',persistence:'unconfirmed',id:'se_x',enabled:true};}};
    const f=fixture([[tool('muyu.task.preview',{scripts:[{operation:'create',changesJson:'{"name":"x","enabled":true}'}]}),done],[text('Bundle draft only'),done]],{scriptExecutors});
    await f.enable();f.controller.setMode('assistant');f.controller.setInput('Preview bundle');f.controller.send();await settle();
    const request=f.controller.snapshot().interaction;assert.equal(request.source,'scriptAssets');f.controller.answerPermission(request.id,'task');await settle();
    const artifact=f.controller.snapshot().artifacts.find(row=>row.kind==='task-bundle');assert.ok(artifact);assert.equal(saved,0);
    const approval=f.controller.prepareBundleApply(artifact.id,artifact.revision);const result=await f.controller.approveBundleApply(approval.id);
    assert.equal(result.status,'applied_unconfirmed');assert.equal(saved,1);
    const receipt=JSON.parse(f.controller.exportHistory()).receipts.at(-1);assert.equal(receipt.version,9);assert.doesNotMatch(JSON.stringify(receipt),/CODE_SENTINEL/);
    await f.controller.dispose();
});

for (const operation of ['create', 'update', 'delete']) test(`Script ${operation} pauses for source permission, then requires one exact save approval`, async () => {
    let writes = 0;
    const content = { module: 'script-executor', operation, id: operation === 'create' ? '' : 'se_user', baseRevision: '', previous: { name: 'user', code: 'OLD_SOURCE' }, next: operation === 'delete' ? null : { name: 'user', enabled: false, code: 'NEW_SOURCE' }, warnings: [] };
    const scriptExecutors = { preview: () => content, assertDraft() {}, save: async () => { writes++; return { status: 'saved_unconfirmed', id: 'se_user', enabled: false, persistence: 'unconfirmed' }; } };
    const f = fixture([[tool('muyu.scripts.preview', { operation, changesJson: '{}' }), done], [text('Only preview'), done]], { scriptExecutors });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Preview script'); f.controller.send(); await settle();
    const request = f.controller.snapshot().interaction; assert.equal(request.source, 'scriptAssets'); assert.equal(writes, 0);
    f.controller.answerPermission(request.id, 'task'); await settle();
    const artifact = f.controller.snapshot().artifacts.find(row => row.kind === 'script-draft'); assert.ok(artifact); assert.equal(writes, 0);
    const approval = f.controller.prepareScriptSave(artifact.id, artifact.revision); await f.controller.approveScriptSave(approval.id);
    assert.equal(writes, 1); const receipt = JSON.parse(f.controller.exportHistory()).receipts.find(row => row.version === 8);
    assert.equal(receipt.operation, operation); assert.doesNotMatch(JSON.stringify(receipt), /OLD_SOURCE|NEW_SOURCE/);
    assert.throws(() => f.controller.approveScriptSave(approval.id), /STALE/); await f.controller.dispose();
});

test('Script full access only saves explicitly requested apply candidates', async () => {
    let writes = 0;
    const scriptExecutors = { assertDraft() {}, preview: () => ({ module: 'script-executor', operation: 'create', id: '', baseRevision: '', previous: null, next: { name: 'user', enabled: false }, warnings: [] }),
        save: async () => { writes++; return { status: 'saved_unconfirmed', id: 'se_user', enabled: false, persistence: 'unconfirmed' }; } };
    const args = { operation: 'create', changesJson: '{"name":"user"}' };
    const f = fixture([[tool('muyu.scripts.preview', args), done], [text('Preview'), done], [tool('muyu.scripts.preview', { ...args, apply: true }), done], [text('Save requested'), done]], { scriptExecutors });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput('Preview only'); f.controller.send(); await settle(); assert.equal(writes, 0);
    f.controller.setInput('Save it'); f.controller.send(); await settle(); assert.equal(writes, 1); assert.equal(f.controller.snapshot().receipts.at(-1).version, 8);
    await f.controller.dispose();
});
test('Long-term memory is opt-in even in full access, and explicit remembering survives into a later conversation', async () => {
    let f; const settings = { muyuAgentMemoryEnabled: false };
    const agentMemory = createAgentMemoryPort({ getAccount: async () => ({ enabled: false }), getSettings: () => settings, saveSettings: async () => {}, getTarget: () => f.host.currentTarget() });
    f = fixture([[text('not enabled'), done], [tool('muyu.notes.remember', { quote: '先给结论', scope: 'chat' }), done], [text('remembered'), done],
        [tool('muyu.notes.list', { query: '结论', offset: 0 }), done], [text('found user note'), done]], { agentMemory });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setFullAccess(true);
    f.controller.setInput('hello'); f.controller.send(); await settle();
    assert.ok(!f.model.requests[0].tools.some(row => row.id.startsWith('muyu.notes.')));
    await f.controller.setAgentMemoryEnabled(true);
    f.controller.setInput('记住：先给结论'); f.controller.send(); await settle();
    assert.equal((await agentMemory.list(f.host.currentTarget())).length, 1);
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
    f.controller.newSession(); f.controller.setInput('我以前希望怎么回答？'); f.controller.send(); await settle();
    if (f.controller.snapshot().busy) {
        const idle = deferred(); const subscription = f.controller.subscribe(() => { if (!f.controller.snapshot().busy) { subscription.unsubscribe(); idle.resolve(); } });
        await idle.promise;
    }
    assert.match(JSON.stringify(f.model.requests.at(-1)), /先给结论/);
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
    f.switchChat('B'); assert.equal((await agentMemory.list(f.host.currentTarget())).length, 0);
    await f.controller.dispose();
});

test('Turning long-term memory off before a returned tool call prevents any note read or write', async () => {
    let f; const settings = { muyuAgentMemoryEnabled: true }, wait = deferred(); let writes = 0;
    const agentMemory = createAgentMemoryPort({ getAccount: async () => ({ enabled: false }), getSettings: () => settings, saveSettings: async () => { writes++; }, getTarget: () => f.host.currentTarget() });
    f = fixture([() => wait.promise, [text('not written'), done]], { agentMemory });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('记住：先给结论'); f.controller.send(); await flush();
    await f.controller.setAgentMemoryEnabled(false); const before = writes;
    wait.resolve([tool('muyu.notes.remember', { quote: '先给结论', scope: 'chat' }), done]); await settle();
    assert.equal(writes, before); assert.deepEqual(await agentMemory.list(f.host.currentTarget()), []);
    await f.controller.dispose();
});
test('Storage preference saves without switching the active backend or dropping the composer draft', async () => {
    const store = createMemoryHistoryStore(); store.kind = 'browser';
    const saving = deferred(); let selected = false, opened = 0;
    const history = { enabled: () => true, accountStorage: () => selected, activeAccountStorage: () => false, open: async () => { opened++; return store; },
        setAccountStorage: async value => { await saving.promise; selected = value; } };
    const f = fixture([], { history }); await f.controller.ready; await f.enable(); f.controller.setMode('assistant');
    f.controller.newSession(); f.controller.setInput('unsent message');
    const choice = f.controller.setHistoryAccountStorage(true); await flush();
    assert.equal(f.controller.snapshot().resetting, true);
    assert.equal(f.controller.snapshot().input, 'unsent message');
    await assert.rejects(f.controller.setHistoryAccountStorage(false), /NOT_READY/);
    saving.resolve(); await choice;
    const state = f.controller.snapshot();
    assert.equal(state.history.accountStorage, true); assert.equal(state.history.backend, 'browser');
    assert.equal(state.history.storageChangePending, true);
    assert.equal(state.history.canChooseStorage, true); assert.equal(state.input, 'unsent message');
    assert.equal(opened, 1); assert.equal(f.model.requests.length, 0);
    await f.controller.dispose();
});
for (const nextStorage of ['world-book', 'account-settings']) test('Storage selector preserves the current backend and draft until reload / ' + nextStorage, async () => {
    const store = createMemoryHistoryStore(); store.kind = 'browser';
    let selected = 'auto', opened = 0; const saving = deferred();
    const history = { enabled: () => true, storageChoice: () => selected, activeStorage: () => 'auto',
        open: async () => { opened++; return store; }, setStorage: async choice => { await saving.promise; selected = choice; } };
    const f = fixture([], { history }); await f.controller.ready; await f.enable(); f.controller.setMode('assistant');
    f.controller.newSession(); f.controller.setInput('Keep my unsent draft');
    const change = f.controller.setHistoryStorage(nextStorage); await flush();
    assert.equal(f.controller.snapshot().resetting, true);
    await assert.rejects(f.controller.setHistoryStorage('auto'), /NOT_READY/);
    saving.resolve(); await change;
    const state = f.controller.snapshot();
    assert.equal(state.history.storageChoice, nextStorage); assert.equal(state.history.backend, 'browser');
    assert.equal(state.history.storageChangePending, true); assert.equal(state.input, 'Keep my unsent draft');
    assert.equal(opened, 1); assert.equal(f.model.requests.length, 0);
    await f.controller.dispose();
});

test('Globe is opt-in even in full access; enabled searches reach the model and reconnect turns it off', async () => {
    let calls = 0, checks = 0;
    const capture = { limits: { maxSearches: 3, maxResults: 5, resultBytes: 12000 }, search: async args => { calls++; return { status: 'ok', provider: 'brave', query: args.query, fetchedAt: '2026-09-30T00:00:00Z', truncated: false, results: [{ title: 'Docs', url: 'https://docs.example.test/', snippet: 'Untrusted public evidence' }] }; } };
    const webSearch = { describe: () => ({ ...capture.limits, hasKey: true, provider: 'brave' }), check: async () => { checks++; }, capture: () => capture, cancel() {} };
    const f = fixture([[text('offline'), done], [tool('muyu.web.search', { query: 'SillyTavern docs' }), done], [text('[Docs](https://docs.example.test/)'), done]], { webSearch });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setFullAccess(true);
    f.controller.setInput('offline'); f.controller.send(); await settle();
    assert.ok(!f.model.requests[0].tools.some(row => row.id === 'muyu.web.search')); assert.equal(calls, 0);
    f.controller.setInput('keep this draft'); await f.controller.setWebSearchEnabled(true);
    assert.equal(f.controller.snapshot().input, 'keep this draft'); assert.equal(checks, 1);
    f.controller.send(); await settle();
    assert.ok(f.model.requests[1].tools.some(row => row.id === 'muyu.web.search')); assert.equal(calls, 1);
    assert.match(JSON.stringify(f.model.requests[2]), /Untrusted public evidence/);
    assert.equal(f.controller.snapshot().interaction, null);
    await f.enable(); assert.equal(f.controller.snapshot().webSearch.enabled, false); await f.controller.dispose();
});

test('Installation can be checked before model setup without enabling search, saving or changing the draft', async () => {
    let checks = 0;
    const webSearch = { describe: () => ({ hasKey: false, backend: checks ? 'available' : 'unknown' }), checkInstallation: async () => { checks++; }, cancel() {} };
    const f = fixture([], { webSearch });
    f.controller.setInput('unsent'); await f.controller.checkWebSearchInstallation();
    assert.equal(checks, 1); assert.equal(f.controller.snapshot().enabled, false);
    assert.equal(f.controller.snapshot().webSearch.enabled, false); assert.equal(f.controller.snapshot().input, 'unsent');
    assert.equal(f.model.requests.length, 0); assert.equal(f.controller.snapshot().webSearch.saving, false);
    webSearch.checkInstallation = async () => { throw Error('WEB_BACKEND_INCOMPATIBLE'); };
    await assert.rejects(f.controller.checkWebSearchInstallation(), /INCOMPATIBLE/);
    assert.equal(f.controller.snapshot().webSearch.saving, false);
    await f.controller.dispose();
});

test('Turning the globe off after the model request prevents its queued search from making any network call', async () => {
    let calls = 0, cancels = 0;
    const wait = deferred(), webSearch = { describe: () => ({ hasKey: true }), check: async () => {}, cancel() { cancels++; }, capture: () => ({ limits: { maxSearches: 3, maxResults: 5, resultBytes: 12000 }, search: async () => { calls++; throw Error('must not run'); } }) };
    const f = fixture([() => wait.promise, [text('offline now'), done]], { webSearch });
    await f.enable(); f.controller.setMode('assistant'); await f.controller.setWebSearchEnabled(true);
    f.controller.setInput('search'); f.controller.send(); await flush();
    await f.controller.setWebSearchEnabled(false);
    wait.resolve([tool('muyu.web.search', { query: 'query' }), done]); await settle();
    assert.equal(calls, 0); assert.ok(cancels > 0); assert.equal(f.controller.snapshot().webSearch.enabled, false);
    await f.controller.dispose();
});

const taskPlan = () => tool('muyu.task.plan', { goal: '建立当前聊天金币系统', scope: 'mixed',
    sources: ['configSettings', 'variables'], steps: [
        { kind: 'read', title: '核对现状', detail: '只读现有变量与配置' },
        { kind: 'variables', title: '创建金币余额', detail: '当前尚无变量写入工具' },
        { kind: 'settings', title: '预览激活设置', detail: '另需配置草稿与单次批准' },
    ], unknowns: ['是否已有同名变量'] });

const taskFooting = request => {
    const guide = request.taskGuides?.find(m => m.content.startsWith('Host task observation'));
    return guide && JSON.parse(guide.content.split('\n')[1]);
};

test('Read association uses host evidence IDs and live plan ownership without writing or completing steps', async () => {
    const f = fixture([[tool('muyu.task.plan', { ...taskPlan().call.args, scope: 'global', sources: ['memoryConfig'] }), done],
        [tool('muyu.settings.read', { fields: ['autoMemoryInterval'] }, 'read-evidence'), done],
        request => {
            const footing = taskFooting(request), plan = footing.taskState.plan;
            const evidence = footing.readEvidence.evidence.find(row => row.observation.outcome === 'settings-read');
            assert.ok(evidence);
            return [tool('muyu.task.bind_read', { planArtifactId: plan.artifactId, planRevision: plan.artifactRevision,
                evidenceId: evidence.id, stepIds: [plan.steps.find(row => row.kind === 'read').id] }, 'bind-read'), done];
        }, request => {
            assert.ok(request.messages.some(row => row.result?.ok && row.result.data?.bound));
            const footing = taskFooting(request);
            assert.ok(footing.readEvidence.evidence.some(row => row.binding?.intentVerification === 'not-assessed'));
            assert.ok(footing.taskState.plan.steps.every(row => row.status === 'not-assessed'));
            return [text('Read association only'), done];
        }]);
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('规划只读检查'); f.controller.send(); await settle();
    const plan = f.controller.snapshot().artifacts.find(row => row.kind === 'task-plan');
    f.controller.approveTaskPlanReads(plan.id, plan.revision); await settle();
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
    assert.equal(f.controller.snapshot().configActions.length, 0);
    assert.doesNotMatch(f.controller.exportHistory(), /read-evidence:|Host task observation/);
    await f.controller.dispose();
});

test('Explicit step binding tool verifies live plan and candidate; publication still needs exact UI approval', async () => {
    let writer, saves = 0, args;
    const f = fixture([[tool('muyu.task.plan', { ...taskPlan().call.args, scope: 'global', sources: ['memoryConfig'] }), done],
        [tool('muyu.config.preview', { changes: { autoMemoryInterval: 15 } }, 'preview'), done],
        request => {
            const plan = taskFooting(request).taskState.plan;
            const result = request.messages.filter(m => m.role === 'tool').map(m => m.result).find(r => r.data?.candidateId);
            args = { planArtifactId: plan.artifactId, planRevision: plan.artifactRevision, stepIds: [plan.steps.find(s => s.kind === 'settings').id], candidateId: result.data.candidateId };
            return [tool('muyu.task.bind_step', args, 'bind'), done];
        }, [text('Only associated; not applied'), done]], { configWriter: { apply: value => writer.apply(value) } });
    writer = createConfigWriter({ getSettings: () => f.settings, saveSettings: async () => { saves++; } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('规划修改间隔'); f.controller.send(); await settle();
    const plan = f.controller.snapshot().artifacts.find(a => a.kind === 'task-plan');
    f.controller.approveTaskPlanReads(plan.id, plan.revision); await settle();
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
    const results = f.model.requests.at(-1).messages.filter(m => m.role === 'tool').map(m => m.result);
    assert.ok(results.some(r => r.ok && r.data?.bound === true));
    assert.equal(saves, 0); assert.equal(f.settings.autoMemoryInterval, 10);
    const draft = f.controller.snapshot().artifacts.find(a => a.kind === 'config-draft'); assert.ok(draft);
    const action = f.controller.prepareConfigApply(draft.id, draft.revision); await f.controller.approveConfigApply(action.id);
    assert.equal(saves, 1); assert.equal(f.settings.autoMemoryInterval, 15);
    assert.equal(f.controller.snapshot().receipts.at(-1).artifactId, draft.id);
    assert.doesNotMatch(f.controller.exportHistory(), /stepReference|intentVerification|Host task observation/);
    await f.controller.dispose();
});

test('Task observation survives plan approval with stable proposed steps, but no implicit goal completion', async () => {
    const f = fixture([[tool('muyu.settings.contract', { fields: ['autoMemoryInterval'] }, 'contract'), done],
        [tool('muyu.task.plan', { ...taskPlan().call.args, scope: 'global', sources: ['memoryConfig'] }, 'plan'), done],
        [tool('muyu.settings.read', { fields: ['autoMemoryInterval'] }, 'read'), done], [text('Read only'), done]]);
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('先规划只读检查'); f.controller.send(); await settle();
    const artifact = f.controller.snapshot().artifacts.find(a => a.kind === 'task-plan'); assert.ok(artifact);
    f.controller.approveTaskPlanReads(artifact.id, artifact.revision); await settle();
    const first = taskFooting(f.model.requests[2]), last = taskFooting(f.model.requests[3]);
    assert.deepEqual(first.queriedContractFields, ['autoMemoryInterval']);
    assert.equal(first.taskState.plan.readScopeReview, 'approved-read-only');
    assert.deepEqual(first.taskState.plan.steps, last.taskState.plan.steps);
    assert.deepEqual(last.observedSettingFields, ['autoMemoryInterval']);
    assert.equal(last.goalCompletion, 'not-assessed'); assert.equal(last.taskState.segmentCount, 2);
    assert.equal(f.controller.snapshot().configActions.length, 0);
    assert.doesNotMatch(f.controller.exportHistory(), /Host task observation|queriedContractFields|displayIndex/);
    await f.controller.dispose();
});

test('Task observation survives automatic authorization then explicit clarification without rereading the field', async () => {
    const f = fixture([[tool('muyu.settings.read', { fields: ['autoMemoryInterval'] }, 'read'), done],
        [tool('muyu.interaction.ask', { question: '怎么表达？', options: ['简洁', '详细'] }, 'question'), done], [text('Done'), done]]);
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('读取后问我表达方式'); f.controller.send(); await settle();
    const permission = f.controller.snapshot().interaction; assert.equal(permission.kind, 'permission');
    f.controller.answerPermission(permission.id, 'task'); await settle();
    const question = f.controller.snapshot().interaction; assert.equal(question.kind, 'clarification');
    const readValue = f.settings.autoMemoryInterval;
    f.settings.autoMemoryInterval = readValue + 5; // Independent host edit while waiting.
    f.controller.setInteractionDraft(question.id, '简洁'); f.controller.answerInteraction(question.id); await settle();
    const state = taskFooting(f.model.requests.at(-1));
    assert.deepEqual(state.observedSettingFields, ['autoMemoryInterval']);
    assert.equal(state.taskState.segmentCount, 3); assert.equal(state.taskState.goalCompletion, 'not-assessed');
    assert.equal(state.priorReadReferences.fields[0].field, 'autoMemoryInterval');
    assert.equal(state.priorReadReferences.fields[0].value, readValue);
    assert.equal(f.settings.autoMemoryInterval, readValue + 5);
    assert.doesNotMatch(f.controller.exportHistory(), /priorReadReferences|capturedAt/);
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
    await f.controller.dispose();
});

test('Revoking a read source while clarification waits clears task result transport and invalidates continuation', async () => {
    const f = fixture([[tool('muyu.settings.read', { fields: ['autoMemoryInterval'] }, 'read'), done],
        [tool('muyu.interaction.ask', { question: '怎么表达？', options: ['简洁', '详细'] }, 'question'), done], [text('New task'), done]]);
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('先读后问'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'task'); await settle();
    const question = f.controller.snapshot().interaction;
    await f.controller.revokePermission('source:memoryConfig');
    assert.throws(() => f.controller.answerInteraction(question.id), /INTERACTION_STALE|NOT_READY/);
    f.controller.setInput('新任务，不读取'); f.controller.send(); await settle();
    assert.deepEqual(taskFooting(f.model.requests.at(-1)).priorReadReferences.fields, []);
    await f.controller.dispose();
});
test('Approving a task plan preserves the search budget of its successful earlier segment', async () => {
    let calls = 0;
    const capture = { limits: { maxSearches: 1, maxResults: 5, resultBytes: 12000 }, search: async args => { calls++; return { status: 'empty', provider: 'brave', query: args.query, fetchedAt: '', truncated: false, results: [] }; } };
    const webSearch = { describe: () => ({ ...capture.limits, hasKey: true }), check: async () => {}, capture: () => capture, cancel() {} };
    const f = fixture([[tool('muyu.web.search', { query: 'first' }, 'search1'), done], [taskPlan(), done],
        [tool('muyu.web.search', { query: 'second' }, 'search2'), done], [text('finished'), done]], { webSearch });
    await f.enable(); f.controller.setMode('assistant'); await f.controller.setWebSearchEnabled(true);
    f.controller.setInput('Plan a system'); f.controller.send(); await settle();
    const plan = f.controller.snapshot().artifacts.find(row => row.kind === 'task-plan');
    assert.equal(calls, 1); f.controller.approveTaskPlanReads(plan.id, plan.revision); await settle();
    const runs = f.controller.snapshot().runs;
    assert.equal(runs[0].taskId, runs[1].taskId); assert.equal(calls, 1);
    assert.match(JSON.stringify(f.model.requests.at(-1)), /budget_exceeded/);
    await f.controller.dispose();
});
test('Read analysis waits for plan approval and runs exactly once, not before and after approval', async () => {
    const planCall = tool('muyu.task.plan', { ...taskPlan().call.args, scope: 'global', sources: ['memoryConfig'],
        steps: [{ kind: 'read', title: '读取分析', detail: '读取记忆设置并分析' }] }, 'plan');
    const f = fixture([[planCall, done], [tool('muyu.settings.read', { fields: ['autoMemoryInterval'] }, 'read'), done], [text('SINGLE_ANALYSIS'), done]]);
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('分析配置');
    f.controller.send(); await settle();
    const first = f.controller.snapshot(), plan = first.artifacts.find(a => a.kind === 'task-plan');
    assert.ok(plan); assert.equal(f.model.requests.length, 1); assert.equal(f.reads(), 0);
    assert.equal(first.interaction, null); assert.equal(first.messages.some(m => m.content === 'SINGLE_ANALYSIS'), false);
    f.controller.approveTaskPlanReads(plan.id, plan.revision); await settle();
    const last = f.controller.snapshot();
    assert.equal(f.model.requests.length, 3); assert.ok(f.reads() > 0);
    assert.equal(last.messages.filter(m => m.content === 'SINGLE_ANALYSIS').length, 1);
    assert.equal(last.approvedPlans.includes(plan.id), true);
    assert.throws(() => f.controller.approveTaskPlanReads(plan.id, plan.revision), /TASK_PLAN_STALE/);
    assert.equal(f.model.requests.length, 3); assert.equal(last.configActions.length, 0);
    await f.controller.dispose();
});

test('A plan and a data read in the same model response execute neither until corrected', async () => {
    const f = fixture([[taskPlan(), tool('muyu.settings.read', { fields: ['mode'] }, 'read'), done], [taskPlan(), done]]);
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('分析配置'); f.controller.send(); await settle();
    const state = f.controller.snapshot();
    assert.equal(state.runs[0].status, 'succeeded'); assert.equal(f.reads(), 0);
    assert.equal(state.interaction, null); assert.equal(state.artifacts.filter(a => a.kind === 'task-plan').length, 1);
    assert.match(JSON.stringify(f.model.requests[1]), /no tools were executed/);
    assert.equal(f.model.requests.length, 2);
    await f.controller.dispose();
});

test('Full access auto-approves the plan boundary and performs its analysis only once', async () => {
    const planCall = tool('muyu.task.plan', { ...taskPlan().call.args, scope: 'global', sources: ['memoryConfig'],
        steps: [{ kind: 'read', title: '读取分析', detail: '读取记忆设置并分析' }] }, 'plan');
    const f = fixture([[planCall, done], [tool('muyu.settings.read', { fields: ['autoMemoryInterval'] }, 'read'), done], [text('AUTO_SINGLE_ANALYSIS'), done]]);
    await f.enable(); f.controller.setMode('assistant'); f.controller.setFullAccess(true);
    f.controller.setInput('分析配置'); f.controller.send(); await settle();
    const state = f.controller.snapshot();
    assert.equal(state.interaction, null); assert.equal(state.approvedPlans.length, 1);
    assert.equal(f.model.requests.length, 3);
    assert.equal(state.messages.filter(m => m.content === 'AUTO_SINGLE_ANALYSIS').length, 1);
    assert.equal(state.runs.length, 2); assert.equal(state.runs[0].taskId, state.runs[1].taskId);
    assert.equal(state.configActions.length, 0); await f.controller.dispose();
});

test('Task plan reviews two read sources once, resumes same task and never grants write authority', async () => {
    const f = fixture([[taskPlan(), done],
        [tool('muyu.settings.read', { fields: ['mode'] }), done], [text('仍未修改'), done]]);
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('给本聊天建立金币系统并激活');
    f.controller.send(); await settle();
    const before = f.controller.snapshot(), plan = before.artifacts.find(a => a.kind === 'task-plan');
    assert.ok(plan); assert.deepEqual(plan.content.plan.sources, ['configSettings', 'variables']);
    assert.equal(before.configActions.length, 0); assert.equal(f.reads(), 0);
    assert.equal(JSON.parse(f.controller.exportHistory()).required.includes('source:variables'), false);
    f.controller.setInput('保留的未发送草稿');
    f.controller.approveTaskPlanReads(plan.id, plan.revision); await settle();
    assert.equal(f.controller.snapshot().input, '保留的未发送草稿');
    assert.ok(f.reads() > 0);
    assert.equal(f.controller.snapshot().approvedPlans.includes(plan.id), true);
    assert.equal(f.controller.snapshot().configActions.length, 0);
    assert.throws(() => f.controller.approveTaskPlanReads(plan.id, plan.revision), /TASK_PLAN_STALE/);
    assert.equal(JSON.parse(f.controller.exportHistory()).required.includes('source:configSettings'), true);
    f.switchChat('B');
    assert.equal(f.controller.snapshot().artifacts.length, 0);
    await f.controller.dispose();
});
test('Declining a task plan does not resume it or authorize its read sources', async () => {
    const f = fixture([[taskPlan(), done]]);
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('建立金币系统');
    f.controller.send(); await settle();
    const plan = f.controller.snapshot().artifacts.find(a => a.kind === 'task-plan');
    assert.ok(plan);
    const calls = f.model.requests.length;
    f.controller.declineTaskPlanReads(plan.id, plan.revision);
    assert.equal(f.model.requests.length, calls);
    assert.equal(f.reads(), 0);
    assert.equal(f.controller.snapshot().declinedPlans.includes(plan.id), true);
    assert.throws(() => f.controller.approveTaskPlanReads(plan.id, plan.revision), /TASK_PLAN_STALE/);
    await f.controller.dispose();
});
test('Stopped plan cannot regrant reads; approved plan produces an unapplied variable draft', async () => {
    const draftArgs = { action: 'create', id: 'party_gold', label: '队伍金币', initialValue: 0, min: 0,
        rule: '有明确收支时更新', autoUpdate: true, injectMode: 'always', updateMode: 'delta' };
    const stopped = fixture([[taskPlan(), done]]);
    await stopped.enable(); stopped.controller.setMode('assistant'); stopped.controller.setInput('金币系统'); stopped.controller.send(); await settle();
    const oldPlan = stopped.controller.snapshot().artifacts.find(a => a.kind === 'task-plan');
    stopped.controller.stop();
    assert.ok(stopped.controller.snapshot().invalidPlans.includes(oldPlan.id));
    assert.throws(() => stopped.controller.approveTaskPlanReads(oldPlan.id, oldPlan.revision), /TASK_PLAN_STALE/);
    await stopped.controller.dispose();

    const f = fixture([[taskPlan(), done], [tool('muyu.variables.preview', draftArgs), done], [text('草稿未应用'), done]]);
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('金币系统'); f.controller.send(); await settle();
    const plan = f.controller.snapshot().artifacts.find(a => a.kind === 'task-plan');
    f.controller.approveTaskPlanReads(plan.id, plan.revision); await settle();
    const draft = f.controller.snapshot().artifacts.find(a => a.kind === 'variable-draft');
    assert.ok(draft); assert.equal(draft.content.definition.id, 'party_gold');
    assert.equal(f.ctx.chatMetadata.gd, undefined);
    assert.equal(f.controller.snapshot().configActions.length, 0);
    assert.equal(f.controller.revalidate(draft.id, draft.revision).validation.writes, 'separate-approval-required');
    f.ctx.chatMetadata.gd = { variables: { defs: [{ id: 'party_gold', scope: 'global', type: 'number', defaultValue: 0 }], values: { global: {}, character: {} }, log: [] } };
    assert.throws(() => f.controller.revalidate(draft.id, draft.revision), /STALE_DRAFT/);
    await f.controller.dispose();
});
test('One explicit variable approval saves once and records a chat-scoped historical receipt', async () => {
    let saves = 0;
    const draftArgs = { action: 'create', id: 'party_gold', label: '队伍金币', initialValue: 0, min: 0,
        rule: '有明确收支时更新', autoUpdate: true, injectMode: 'always', updateMode: 'delta' };
    const f = fixture([[taskPlan(), done], [tool('muyu.variables.preview', draftArgs), done], [text('草稿'), done]],
        { variableSaveConfirmed: async () => { saves++; } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('金币系统'); f.controller.send(); await settle();
    const plan = f.controller.snapshot().artifacts.find(a => a.kind === 'task-plan');
    f.controller.approveTaskPlanReads(plan.id, plan.revision); await settle();
    const draft = f.controller.snapshot().artifacts.find(a => a.kind === 'variable-draft');
    assert.ok(draft); assert.equal(f.ctx.chatMetadata.gd, undefined);
    const action = f.controller.prepareVariableApply(draft.id, draft.revision);
    assert.equal(saves, 0); assert.equal(f.ctx.chatMetadata.gd, undefined);
    await f.controller.approveVariableApply(action.id);
    assert.equal(saves, 1); assert.equal(f.ctx.chatMetadata.gd.variables.values.global.party_gold, 0);
    const receipt = f.controller.snapshot().receipts.find(r => r.operationId === action.id);
    assert.equal(receipt.version, 3); assert.equal(receipt.variableId, 'party_gold'); assert.equal(receipt.status, 'applied_confirmed'); assert.equal(receipt.chatSave, 'confirmed');
    assert.ok(JSON.parse(f.controller.exportHistory()).required.includes('source:variables'));
    assert.throws(() => f.controller.approveVariableApply(action.id), /ACTION_STALE/);
    await assert.rejects(f.controller.checkReceipt(action.id), /NOT_READY/);
    await f.controller.dispose();
});
test('One task-bundle approval executes exact variable and global setting steps without further approvals', async () => {
    let chatSaves = 0, settingsSaves = 0;
    const plan = { ...taskPlan().call.args, sources: ['memoryConfig', 'variables'] };
    const bundle = { variables: [{ action: 'create', id: 'party_gold', label: '队伍金币', initialValue: 0,
        rule: '仅在明确收支时更新', autoUpdate: true, injectMode: 'always', updateMode: 'delta' }], settingsJson: '{"memoryEnabled":false}' };
    const f = fixture([[tool('muyu.task.plan', plan), done],
        [tool('muyu.task.preview', bundle), done], [text('整单草稿'), done]],
    { variableSaveConfirmed: async () => { chatSaves++; }, bundleSaveSettings: async () => { settingsSaves++; return { confirmed: true }; } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('建立金币系统'); f.controller.send(); await settle();
    const planArtifact = f.controller.snapshot().artifacts.find(a => a.kind === 'task-plan');
    f.controller.approveTaskPlanReads(planArtifact.id, planArtifact.revision); await settle();
    const draft = f.controller.snapshot().artifacts.find(a => a.kind === 'task-bundle');
    assert.ok(draft); assert.equal(chatSaves, 0); assert.equal(settingsSaves, 0);
    const action = f.controller.prepareBundleApply(draft.id, draft.revision);
    await f.controller.approveBundleApply(action.id);
    assert.equal(chatSaves, 1); assert.equal(settingsSaves, 1); assert.equal(f.settings.memoryEnabled, false);
    const receipt = f.controller.snapshot().receipts.find(row => row.operationId === action.id);
    assert.equal(receipt.version, 4); assert.equal(receipt.status, 'applied_confirmed');
    assert.deepEqual(receipt.steps.map(row => row.status), ['applied_confirmed', 'applied_confirmed']);
    assert.throws(() => f.controller.approveBundleApply(action.id), /ACTION_STALE/);
    await f.controller.dispose();
});
test('Plan read scope survives a clarification handoff within the same task only', async () => {
    const draftArgs = { action: 'create', id: 'party_gold', label: '队伍金币', initialValue: 0,
        rule: '有明确收支时更新', autoUpdate: true, injectMode: 'always', updateMode: 'delta' };
    const f = fixture([[taskPlan(), done], [ask(), done], [tool('muyu.variables.preview', draftArgs), done], [text('仅预览'), done]]);
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('金币系统'); f.controller.send(); await settle();
    const plan = f.controller.snapshot().artifacts.find(a => a.kind === 'task-plan');
    f.controller.approveTaskPlanReads(plan.id, plan.revision); await settle();
    const question = f.controller.snapshot().interaction;
    assert.equal(question.kind, 'clarification');
    f.controller.setInteractionDraft(question.id, '队伍共享金币');
    f.controller.answerInteraction(question.id); await settle();
    assert.ok(f.controller.snapshot().artifacts.some(a => a.kind === 'variable-draft'));
    assert.equal(f.controller.snapshot().taskUsage.segments, 3);
    assert.equal(f.ctx.chatMetadata.gd, undefined);
    await f.controller.dispose();
});
test('A valid plan hands off at the tool budget boundary without an unapproved preview', async () => {
    const f = fixture([[taskPlan(), done], [tool('muyu.variables.preview', { action: 'create', id: 'party_gold' }), done]], {
        runConfig: { read: () => ({ ...RUN_DEFAULTS, modelCalls: 2, toolCalls: 1 }) },
    });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('金币系统'); f.controller.send(); await settle();
    const state = f.controller.snapshot();
    assert.equal(state.artifacts.length, 1);
    assert.equal(state.artifacts[0].kind, 'task-plan');
    assert.equal(state.runs[0].status, 'succeeded');
    assert.equal(f.model.requests.length, 1);
    assert.equal(state.interaction, null);
    assert.equal(f.ctx.chatMetadata.gd, undefined);
    await f.controller.dispose();
});
test('Ordinary chat queries config only with diagnostics permission; history cannot bypass revocation', async () => {
    let f, reads = 0;
    const port = createProviderPort({ getSettings: () => { reads++; return f.settings; }, getContext: () => f.ctx, extensionKey: 'gd' });
    const read = () => tool('muyu.provider.read', { id: 'memoryConfig', selector: '', revision: '', offset: 0 });
    f = fixture([[read(), done], [text('no diagnostics'), done], [read(), done], [text('current config'), done]], { providerPort: port });
    await f.enable(); f.controller.setMode('chat'); f.controller.setInput('current interval');
    f.controller.send({ consent: true }); await settle(); assert.equal(reads, 0);
    assert.match(JSON.stringify(f.model.requests[1]), /PERMISSION_DENIED/);
    f.controller.grantPermission('diagnostics'); f.controller.setInput('read again'); f.controller.send(); await settle();
    assert.ok(reads > 0); assert.match(JSON.stringify(f.model.requests.at(-1)), /current-memory/);
    const id = JSON.parse(f.controller.exportHistory()).id;
    assert.ok(JSON.parse(f.controller.exportHistory()).required.includes('diagnostics'));
    await f.controller.revokePermission('diagnostics'); await f.controller.openSession(id);
    f.controller.setInput('again'); assert.throws(() => f.controller.send(), /HISTORY_PERMISSION_REQUIRED/);
    await f.controller.dispose();
});

test('Receipt check uses Provider without model or writing, survives view changes and sees later edits', async () => {
    let f, writer, writes = 0;
    const port = createProviderPort({ getSettings: () => f.settings, getContext: () => f.ctx, extensionKey: 'gd' });
    f = fixture([[tool('muyu.config.preview', { changes: { autoMemoryInterval: 15 } }), done], [text('draft'), done]], { providerPort: port, configWriter: { apply: value => { writes++; return writer.apply(value); } } });
    writer = createConfigWriter({ getSettings: () => f.settings, saveSettings: async () => {} });
    await f.enable(); f.controller.setMode('draft'); f.controller.setInput('interval');
    f.controller.send({ consent: true, fields: ['autoMemoryInterval'] }); await settle();
    const owner = JSON.parse(f.controller.exportHistory()).id, a = f.controller.snapshot().artifacts[0];
    const r = f.controller.prepareConfigApply(a.id, a.revision); await f.controller.approveConfigApply(r.id);
    f.ctx.chatId = ''; f.controller.setInput('preserved');
    await f.controller.checkReceipt(r.id);
    assert.equal(f.controller.snapshot().configChecks[r.id].state, 'matched');
    assert.equal(f.controller.snapshot().input, 'preserved');
    assert.equal(f.controller.snapshot().artifacts.length, 1);
    f.settings.autoMemoryInterval = 25;
    const pending = f.controller.checkReceipt(r.id); f.controller.newSession(); f.controller.setInput('other'); await pending;
    assert.deepEqual(f.controller.snapshot().configChecks, {}); assert.equal(f.controller.snapshot().input, 'other');
    await f.controller.openSession(owner);
    assert.equal(f.controller.snapshot().configChecks[r.id].state, 'different');
    assert.equal(f.controller.snapshot().configChecks[r.id].fields[0].actual, '25');
    f.settings.autoMemoryInterval = 'invalid'; await f.controller.checkReceipt(r.id);
    assert.equal(f.controller.snapshot().configChecks[r.id].state, 'unknown');
    assert.equal(f.model.requests.length, 2); assert.equal(writes, 1);
    const cancelled = f.controller.checkReceipt(r.id); f.controller.stop(); await cancelled;
    assert.equal(f.controller.snapshot().configChecks[r.id].state, 'unknown');
    await f.controller.revokePermission('diagnostics'); await f.controller.openSession(owner);
    await assert.rejects(f.controller.checkReceipt(r.id), /CONSENT_REQUIRED/);
    await f.controller.dispose();
});
test('Receipt explanation is explicit, tool-free, retryable without writes and preserves the composer', async () => {
    let writer, saves = 0;
    const f = fixture([[tool('muyu.config.preview', { changes: { autoMemoryInterval: 15 } }), done], [text('draft'), done],
        () => { throw new ExecutionError('MODEL_NETWORK_ERROR'); }, [text('Persistence unconfirmed'), done], [text('fresh'), done]], { configWriter: { apply: value => writer.apply(value) } });
    writer = createConfigWriter({ getSettings: () => f.settings, saveSettings: async () => { saves++; throw Error('save failed'); } });
    await f.enable(); f.controller.setMode('draft'); f.controller.setInput('interval');
    f.controller.send({ consent: true, fields: ['autoMemoryInterval'] }); await settle();
    const a = f.controller.snapshot().artifacts[0], r = f.controller.prepareConfigApply(a.id, a.revision);
    await f.controller.approveConfigApply(r.id);
    assert.equal(f.model.requests.length, 2);
    assert.equal(f.controller.snapshot().receipts.length, 1);
    assert.equal(f.controller.snapshot().receipts[0].saveError, true);
    f.controller.snapshot().receipts[0].status = 'cancelled';
    assert.equal(f.controller.snapshot().receipts[0].status, 'applied_unconfirmed');
    f.controller.setInput('UNSAVED COMPOSER'); f.controller.explainReceipt(r.id); await settle();
    assert.equal(f.controller.snapshot().receiptExplanations[r.id], 'failed');
    f.controller.explainReceipt(r.id); await settle();
    assert.equal(f.controller.snapshot().receiptExplanations[r.id], 'succeeded');
    assert.equal(f.controller.snapshot().input, 'UNSAVED COMPOSER');
    assert.equal(saves, 1); assert.equal(f.controller.snapshot().artifacts.length, 1);
    assert.deepEqual(f.model.requests.at(-1).tools, []);
    assert.match(f.model.requests.at(-1).instructions.task, /本轮只解释/);
    assert.doesNotMatch(f.model.requests.at(-1).instructions.task, /character:N|range:START/);
    assert.match(JSON.stringify(f.model.requests.at(-1)), /applied_unconfirmed/);
    assert.equal(JSON.parse(f.controller.exportHistory()).receipts.length, 1);
    f.controller.setOmitHistory(true); assert.throws(() => f.controller.explainReceipt(r.id), /HISTORY_PERMISSION_REQUIRED/);
    f.controller.send({ fields: ['autoMemoryInterval'] }); await settle();
    assert.doesNotMatch(JSON.stringify(f.model.requests.at(-1)), /operationId|applied_unconfirmed/);
    const exported = f.controller.exportHistory(); await f.controller.importHistory(exported);
    assert.equal(f.controller.snapshot().readOnly, true);
    assert.throws(() => f.controller.explainReceipt(r.id), /HISTORY_READ_ONLY/);
    assert.equal(saves, 1); await f.controller.dispose();
});

test('Pending save records its receipt only in the originating session after selection changes', async () => {
    const gate = deferred(); let writer;
    const f = fixture([[tool('muyu.config.preview', { changes: { autoMemoryInterval: 15 } }), done], [text('draft'), done]], { configWriter: { apply: value => writer.apply(value) } });
    writer = createConfigWriter({ getSettings: () => f.settings, saveSettings: () => gate.promise });
    await f.enable(); f.controller.setMode('draft'); f.controller.setInput('interval');
    f.controller.send({ consent: true, fields: ['autoMemoryInterval'] }); await settle();
    const original = JSON.parse(f.controller.exportHistory()).id;
    const a = f.controller.snapshot().artifacts[0], r = f.controller.prepareConfigApply(a.id, a.revision);
    const pending = f.controller.approveConfigApply(r.id); await settle();
    f.controller.newSession(); f.controller.setInput('new draft'); f.settings.autoMemoryInterval = 25;
    gate.resolve(); await pending;
    assert.deepEqual(f.controller.snapshot().receipts, []); assert.equal(f.controller.snapshot().input, 'new draft');
    await f.controller.openSession(original);
    assert.equal(f.controller.snapshot().receipts[0].changed, true);
    await f.controller.revokePermission('diagnostics'); await f.controller.openSession(original);
    assert.throws(() => f.controller.explainReceipt(r.id), /CONSENT_REQUIRED|HISTORY_PERMISSION_REQUIRED/);
    await f.controller.dispose();
});
test('Config application requires UI approval, survives view changes, and does not replay on reconnect', async () => {
    let writer, saves = 0;
    const f = fixture([[tool('muyu.config.preview', { changes: { autoMemoryInterval: 15 } }), done], [text('draft only'), done]], { configWriter: { apply: value => writer.apply(value) } });
    writer = createConfigWriter({ getSettings: () => f.settings, saveSettings: async () => { saves++; } });
    await f.enable(); f.controller.setMode('draft'); f.controller.setInput('set interval 15, yes I approve');
    f.controller.send({ consent: true, fields: ['autoMemoryInterval'] }); await settle();
    assert.equal(saves, 0); const a = f.controller.snapshot().artifacts[0];
    const r = f.controller.prepareConfigApply(a.id, a.revision); assert.equal(saves, 0);
    f.controller.setMode('chat'); assert.throws(() => f.controller.approveConfigApply(r.id), /STALE/);
    f.controller.setMode('draft'); const applying = f.controller.approveConfigApply(r.id);
    assert.throws(() => f.controller.approveConfigApply(r.id), /STALE/);
    await applying; assert.equal(saves, 1); assert.equal(f.settings.autoMemoryInterval, 15);
    assert.equal(f.controller.snapshot().configActions[0].status, 'applied_unconfirmed');
    assert.equal(f.model.requests.length, 2); assert.equal(JSON.parse(f.controller.exportHistory()).receipts[0].operationId, r.id);
    await f.enable(); assert.throws(() => f.controller.approveConfigApply(r.id), /STALE/); assert.equal(saves, 1);
    await f.controller.dispose();
});
test('Reconnect drains an in-flight config save; late result never grants another approval', async () => {
    const gate = deferred(); let writer;
    const f = fixture([[tool('muyu.config.preview', { changes: { autoMemoryInterval: 15 } }), done], [text('draft'), done]], { configWriter: { apply: value => writer.apply(value) } });
    writer = createConfigWriter({ getSettings: () => f.settings, saveSettings: () => gate.promise });
    await f.enable(); f.controller.setMode('draft'); f.controller.setInput('interval'); f.controller.send({ consent: true, fields: ['autoMemoryInterval'] }); await settle();
    const a = f.controller.snapshot().artifacts[0], r = f.controller.prepareConfigApply(a.id, a.revision);
    const save = f.controller.approveConfigApply(r.id); await settle();
    let reconnected = false; const reset = f.enable().then(() => { reconnected = true; }); await settle();
    assert.equal(reconnected, false); gate.resolve(); await save; await reset;
    assert.deepEqual(f.controller.snapshot().configActions, []); await f.controller.dispose();
});
const requestRead = (source = 'chatHistory') => ({ type: 'tool_call_complete', call: { toolId: 'muyu.permission.request', callId: 'permission:' + source, version: 1, args: { source, reason: 'Understand the current story' } } });
const readSource = (id = 'chatHistory') => ({ type: 'tool_call_complete', call: { toolId: 'muyu.provider.read', callId: 'read:' + id, version: 2, args: { id, selector: '', revision: '', offset: 0 } } });

test('On-demand task grant reads only the selected source, expires, and guards history and summaries', async () => {
    const reads = [];
    const f = fixture([[readSource(), done], [requestRead(), done], [readSource(), done], [readSource('characters'), done], [text('protected answer'), done], [text('public followup'), done]], {
        providerPort: { available() { throw Error('Catalog must not inspect host'); }, read(id) { reads.push(id); return { text: 'PROTECTED_SOURCE', limited: false }; } },
    });
    await f.enable(); f.controller.setMode('chat'); f.controller.setInput('analyze'); f.controller.send(); await settle();
    assert.deepEqual(reads, []); assert.match(JSON.stringify(f.model.requests[1]), /PERMISSION_REQUIRED/);
    const r = f.controller.snapshot().interaction; assert.equal(r.kind, 'permission');
    assert.throws(() => f.controller.send({ interactionId: r.id }), /STALE/);
    f.controller.answerPermission(r.id, 'task'); assert.throws(() => f.controller.answerPermission(r.id, 'task'), /STALE/); await settle();
    assert.deepEqual(reads, ['chatHistory']);
    assert.equal(f.controller.snapshot().messages.at(-1).content, 'protected answer');
    const exported = JSON.parse(f.controller.exportHistory()); assert.ok(exported.required.includes('source:chatHistory'));
    assert.doesNotMatch(f.controller.exportHistory(), /Permission request resolved by the application/);
    f.controller.setInput('another task'); assert.throws(() => f.controller.send(), /HISTORY_PERMISSION_REQUIRED/);
    await assert.rejects(f.controller.compactHistory(), /HISTORY_PERMISSION_REQUIRED/);
    f.controller.setOmitHistory(true); f.controller.send(); await settle();
    assert.doesNotMatch(JSON.stringify(f.model.requests.at(-1)), /PROTECTED_SOURCE|protected answer/);
    await f.controller.dispose();
});
test('Denied permission continues without reading or repeated prompts', async () => {
    let reads = 0;
    const f = fixture([[requestRead(), done], [requestRead(), done], [readSource(), done], [text('No access; conditional answer'), done]], { providerPort: { read() { reads++; } } });
    await f.enable(); f.controller.setMode('chat'); f.controller.setInput('help'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'deny'); await settle();
    assert.equal(reads, 0); assert.equal(f.controller.snapshot().interaction.status, 'denied');
    assert.equal(f.controller.snapshot().messages.at(-1).content, 'No access; conditional answer');
    assert.match(JSON.stringify(f.model.requests.at(-1)), /PERMISSION_DENIED/); await f.controller.dispose();
});
test('Mixed authorization batch never executes a source reader or opens a permission card', async () => {
    let reads = 0;
    const f = fixture([[requestRead(), readSource(), done], [text('retry later'), done]], { providerPort: { read() { reads++; } } });
    await f.enable(); f.controller.setMode('chat'); f.controller.setInput('help'); f.controller.send(); await settle();
    assert.equal(reads, 0); assert.equal(f.controller.snapshot().interaction, null);
    assert.match(JSON.stringify(f.model.requests.at(-1)), /INVALID_ARGUMENT/); await f.controller.dispose();
});
test('Omitting protected history remains effective through permission and clarification handoffs', async () => {
    const f = fixture([[requestRead(), done], [text('OLD_PRIVATE_ANSWER'), done], [requestRead('characters'), done], [ask(), done], [text('new answer'), done]]);
    await f.enable(); f.controller.setMode('chat'); f.controller.setInput('first'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'task'); await settle();
    f.controller.setOmitHistory(true); f.controller.setInput('new task'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'task'); await settle();
    const q = f.controller.snapshot().interaction; f.controller.setInteractionDraft(q.id, 'new details'); f.controller.answerInteraction(q.id); await settle();
    for (const r of f.model.requests.slice(2)) assert.doesNotMatch(JSON.stringify(r), /OLD_PRIVATE_ANSWER/);
    assert.match(JSON.stringify(f.model.requests.at(-1)), /new details/); await f.controller.dispose();
});
test('Chat grant is reused only in its chat; revoke and reconnect remove it', async () => {
    let reads = 0;
    const f = fixture([[requestRead(), done], [text('allowed'), done], [readSource(), done], [text('read'), done]], { providerPort: { read() { reads++; return { text: 'body', limited: false }; } } });
    await f.enable(); f.controller.setMode('chat'); f.controller.setInput('help'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'chat'); await settle();
    assert.deepEqual(f.controller.snapshot().sourceGrants, ['source:chatHistory']);
    f.controller.setInput('read again'); f.controller.send(); await settle(); assert.equal(reads, 1);
    f.switchChat('B'); assert.deepEqual(f.controller.snapshot().sourceGrants, []);
    f.switchChat('A'); await f.controller.revokePermission('source:chatHistory'); assert.deepEqual(f.controller.snapshot().sourceGrants, []);
    await f.enable(); assert.deepEqual(f.controller.snapshot().sourceGrants, []); await f.controller.dispose();
});
test('Stale authorization cannot target another chat or survive cancellation', async () => {
    const f = fixture([[requestRead(), done], [requestRead(), done]]); await f.enable(); f.controller.setMode('chat');
    f.controller.setInput('help'); f.controller.send(); await settle(); const id = f.controller.snapshot().interaction.id;
    f.switchChat('B'); assert.throws(() => f.controller.answerPermission(id, 'chat'), /STALE/);
    f.switchChat('A'); assert.throws(() => f.controller.answerPermission(id, 'chat'), /STALE/);
    assert.deepEqual(f.controller.snapshot().sourceGrants, []);
    f.controller.setInput('again'); f.controller.send(); await settle(); const next = f.controller.snapshot().interaction.id;
    f.controller.stop(); assert.throws(() => f.controller.answerPermission(next, 'task'), /STALE/);
    await f.controller.dispose();
});
test('Cancelling repeated permission handoffs releases module run capacity', async () => {
    const attempts = 130;
    const steps = Array.from({ length: attempts }, () => [tool('muyu.settings.read', { fields: ['topN'] }), done]);
    const f = fixture(steps); await f.enable(); f.controller.setMode('assistant');
    for (let i = 0; i < attempts; i++) {
        if (i % 8 === 0) f.controller.newSession();
        f.controller.setInput(`Inspect setting ${i}`); f.controller.send(); await settle();
        const state = f.controller.snapshot();
        assert.equal(state.interaction?.status, 'pending', `permission request ${i + 1}: ${state.notice}`);
        assert.equal(state.interaction.kind, 'permission');
        f.controller.cancelInteraction(state.interaction.id);
    }
    assert.equal(f.model.requests.length, attempts);
    assert.equal(f.controller.snapshot().notice, null);
    await f.controller.dispose();
});
test('Permission grants do not consume the three-clarification allowance', async () => {
    const sources = ['chatHistory', 'characters', 'directorLedger'];
    const steps = sources.flatMap(id => [[requestRead(id), done], [ask(), done]]); steps.push([text('finished'), done]);
    const f = fixture(steps); await f.enable(); f.controller.setMode('chat'); f.controller.setInput('help'); f.controller.send(); await settle();
    for (let i = 0; i < 6; i++) {
        const r = f.controller.snapshot().interaction;
        if (r.kind === 'permission') f.controller.answerPermission(r.id, 'deny');
        else { f.controller.setInteractionDraft(r.id, 'details'); f.controller.answerInteraction(r.id); }
        await settle();
    }
    assert.equal(f.model.requests.length, 7);
    assert.ok(!f.model.requests.at(-1).tools.some(t => t.id === 'muyu.interaction.ask'));
    assert.ok(f.model.requests.at(-1).tools.some(t => t.id === 'muyu.permission.request'));
    await f.controller.dispose();
});

test('One clarification and six distinct automatic source grants resume the original batch', async () => {
    const ids = ['recentMessages', 'chatSummary', 'character_profiles', 'charMemory', 'chatHistory'];
    const f = fixture([[ask(), done], [...ids.map(id => readSource(id)), tool('muyu.director.inspect'), done], [text('checked'), done]],
        { providerPort: { read: () => ({ text: 'Synthetic evidence', limited: false }) } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Read chat and inspect director'); f.controller.send(); await settle();
    let r = f.controller.snapshot().interaction;
    f.controller.setInteractionDraft(r.id, 'Read then inspect'); f.controller.answerInteraction(r.id); await settle();
    for (const id of [...ids, 'directorDiagnostics']) {
        r = f.controller.snapshot().interaction;
        assert.equal(r?.status, 'pending', id); assert.equal(r.source, id);
        f.controller.answerPermission(r.id, 'task'); await settle();
    }
    const s = f.controller.snapshot();
    assert.equal(s.runs.at(-1).status, 'succeeded'); assert.equal(s.messages.at(-1).content, 'checked');
    assert.equal(f.model.requests.length, 3); // Grants resume tools, not separate model confirmations.
    await f.controller.dispose();
});

test('One task source grant covers repeated reads of that source without a second handoff', async () => {
    let reads = 0;
    const second = readSource('recentMessages'); second.call.callId = 'read-again';
    const f = fixture([[readSource('recentMessages'), second, done], [text('read twice'), done]],
        { providerPort: { read: () => { reads++; return { text: 'Synthetic', limited: false }; } } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Read and reread'); f.controller.send(); await settle();
    const r = f.controller.snapshot().interaction; assert.equal(reads, 0);
    f.controller.answerPermission(r.id, 'task'); await settle();
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
    assert.equal(f.controller.snapshot().interaction.status, 'granted');
    assert.equal(reads, 2); assert.equal(f.model.requests.length, 2);
    const results = f.model.requests[1].messages.filter(m => m.role === 'tool');
    assert.equal(results[0].result.hostObservation.sources[0].status, 'granted_now');
    assert.equal(results[1].result.hostObservation.sources[0].status, 'reused');
    assert.equal(results[0].result.hostObservation.sources[0].grantScope, 'task');
    assert.doesNotMatch(f.controller.exportHistory(), /hostObservation|read_authorization/);
    await f.controller.dispose();
});
test('Committed permission continuation survives a synchronous history capture failure without revoking its grant', async () => {
    for (const decision of ['task', 'chat']) {
        let reads = 0;
        const f = fixture([[readSource('recentMessages'), done], [text('read completed'), done]],
            { providerPort: { read: () => { reads++; return { text: 'Synthetic evidence', limited: false }; } } });
        await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Analyze chat'); f.controller.send(); await settle();
        const r = f.controller.snapshot().interaction, clone = globalThis.structuredClone;
        let queued = false, injected = false;
        globalThis.structuredClone = value => {
            if (value?.sessions && value.runs?.at(-1)?.status === 'queued') queued = true;
            if (queued && !injected && value?.version >= 5 && Array.isArray(value.messages)) {
                injected = true; throw Error('HISTORY_INVALID');
            }
            return clone(value);
        };
        try { assert.doesNotThrow(() => f.controller.answerPermission(r.id, decision)); }
        finally { globalThis.structuredClone = clone; }
        assert.equal(injected, true);
        await settle();
        const s = f.controller.snapshot();
        assert.equal(s.runs.at(-1).status, 'succeeded'); assert.equal(s.interaction.status, 'granted');
        assert.equal(s.messages.at(-1).content, 'read completed'); assert.equal(reads, 1);
        assert.equal(s.runs.length, 2); assert.equal(f.model.requests.length, 2);
        await f.controller.dispose();
    }
});

test('Failure before continuation runtime preparation cancels the queued run before grant rollback', async () => {
    let reads = 0;
    const f = fixture([[readSource('recentMessages'), done]],
        { providerPort: { read: () => { reads++; return { text: 'Synthetic evidence', limited: false }; } } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Analyze chat'); f.controller.send(); await settle();
    const r = f.controller.snapshot().interaction, clone = globalThis.structuredClone, uuid = crypto.randomUUID;
    let creatingRun = false, injected = false;
    crypto.randomUUID = () => { creatingRun = true; return uuid.call(crypto); };
    globalThis.structuredClone = value => {
        if (creatingRun && !injected && value?.version >= 5 && Array.isArray(value.messages)) {
            injected = true; throw Error('HISTORY_INVALID');
        }
        return clone(value);
    };
    try { assert.throws(() => f.controller.answerPermission(r.id, 'task'), /HISTORY_INVALID/); }
    finally { globalThis.structuredClone = clone; crypto.randomUUID = uuid; }
    assert.equal(injected, true); await settle();
    const s = f.controller.snapshot();
    assert.equal(s.runs.at(-1).status, 'cancelled'); assert.notEqual(s.interaction.status, 'pending');
    assert.equal(reads, 0); assert.equal(f.model.requests.length, 1);
    await f.controller.dispose();
});

test('Clarification resumes the same task with verified answers, pinned budgets and unchanged permissions', async () => {
    const f = fixture([[ask(), done], [text('resolved'), done]]); await f.enable(); f.controller.setMode('chat');
    f.controller.setInput('help me choose'); f.controller.send(); await settle();
    const before = f.controller.snapshot(), r = before.interaction;
    assert.equal(r.status, 'pending'); assert.equal(before.busy, false); assert.equal(before.runs[0].status, 'yielded');
    assert.equal(f.model.requests.length, 1); assert.equal(before.history.restoredStatus, null);
    f.controller.setInput('unrelated unsent draft'); assert.throws(() => f.controller.send(), /INTERACTION_PENDING/);
    f.controller.setInteractionDraft(r.id, 'Content');
    await f.controller.saveRunConfig({ ...RUN_DEFAULTS, modelCalls: 12, maxTokens: 4096 });
    const result = f.controller.answerInteraction(r.id); assert.equal(result.taskId, r.taskId);
    assert.throws(() => f.controller.answerInteraction(r.id), /NOT_READY|STALE/); await settle();
    const after = f.controller.snapshot(); assert.equal(after.messages.at(-1).content, 'resolved');
    assert.equal(after.input, 'unrelated unsent draft'); assert.equal(after.taskUsage.modelCalls, 2); assert.equal(after.taskUsage.segments, 2);
    assert.deepEqual(after.permissions, before.permissions); assert.equal(f.model.requests[1].maxTokens, RUN_DEFAULTS.maxTokens);
    assert.match(JSON.stringify(f.model.requests[1].messages), /Content/);
    assert.match(JSON.stringify(f.model.requests[1].messages), /Clarification answer from the user \(not permission or approval\)/);
    assert.equal(after.messages.filter(m => m.role === 'user').at(-1).content, 'Content');
    assert.doesNotMatch(f.controller.exportHistory(), /Clarification answer from the user/);
    assert.doesNotMatch(f.controller.exportHistory(), /"kind":"clarification"|"draft":|request:/);
    await f.controller.dispose();
});
test('Pending clarification follows its conversation, expires on chat switch and never restores on reconnect', async () => {
    const f = fixture([[ask(), done]]); await f.enable(); f.controller.setMode('chat');
    const id = f.controller.newSession(); f.controller.setInput('help'); f.controller.send(); await settle();
    const r = f.controller.snapshot().interaction; f.controller.setInteractionDraft(r.id, 'draft answer');
    f.controller.newSession(); assert.equal(f.controller.snapshot().interaction, null);
    await f.controller.openSession(id); assert.equal(f.controller.snapshot().interaction.draft, 'draft answer');
    f.switchChat('B'); assert.throws(() => f.controller.answerInteraction(r.id), /STALE/);
    f.switchChat('A'); await f.controller.openSession(id); assert.equal(f.controller.snapshot().interaction.status, 'expired');
    await f.enable(); await f.controller.openSession(id); assert.equal(f.controller.snapshot().interaction, null);
    assert.equal(f.model.requests.length, 1); await f.controller.dispose();
});
test('Cancelling or archiving a clarification prevents replay; new tasks remain available', async () => {
    const f = fixture([[ask(), done], [ask(), done]]); await f.enable(); f.controller.setMode('chat');
    f.controller.setInput('one'); f.controller.send(); await settle();
    const r = f.controller.snapshot().interaction; f.controller.cancelInteraction(r.id);
    assert.equal(f.controller.snapshot().interaction.status, 'cancelled'); assert.throws(() => f.controller.answerInteraction(r.id), /STALE/);
    f.controller.setInput('two'); f.controller.send(); await settle();
    const id = f.controller.snapshot().history.sessionId, next = f.controller.snapshot().interaction;
    await f.controller.archiveSession(id, true); await f.controller.archiveSession(id, false);
    assert.equal(f.controller.snapshot().interaction.status, 'expired'); assert.throws(() => f.controller.answerInteraction(next.id), /STALE/);
    await f.controller.dispose();
});
test('Three clarification limit removes the tool on the fourth execution segment', async () => {
    const f = fixture([[ask(), done], [ask(), done], [ask(), done], [text('conditional answer'), done]]); await f.enable(); f.controller.setMode('chat');
    f.controller.setInput('help'); f.controller.send(); await settle();
    for (let i = 0; i < 3; i++) { const r = f.controller.snapshot().interaction; f.controller.setInteractionDraft(r.id, 'answer ' + i); f.controller.answerInteraction(r.id); await settle(); }
    assert.equal(f.model.requests.length, 4); assert.ok(!f.model.requests[3].tools.some(t => t.id === 'muyu.interaction.ask'));
    assert.equal(f.controller.snapshot().taskUsage.modelCalls, 4); assert.equal(f.controller.snapshot().messages.at(-1).content, 'conditional answer');
    await f.controller.dispose();
});

test('All-task browsing restores task mode; foreign history is read-only and cannot rebind tools', async () => {
    const f = fixture(); await f.enable(); const id = f.controller.newSession(); f.controller.setInput('memory'); f.controller.send({ consent: true }); await settle();
    f.controller.setMode('chat'); assert.ok(f.controller.snapshot().history.sessions.some(s => s.id === id));
    await f.controller.openSession(id); assert.equal(f.controller.snapshot().mode, 'memory');
    f.switchChat('B'); f.controller.setHistoryFilters({ range: 'all' }); await f.controller.openSession(id);
    assert.equal(f.controller.snapshot().readOnly, true); assert.equal(f.host.currentTarget().chatKey.includes('B'), true);
    assert.throws(() => f.controller.setInput('leak'), /HISTORY_READ_ONLY/); assert.throws(() => f.controller.send({ consent: true }), /HISTORY_READ_ONLY/);
    const fresh = f.controller.newSession(); assert.notEqual(fresh, id); assert.equal(f.controller.snapshot().readOnly, false);
    assert.equal(f.model.requests.length, 1); await f.controller.dispose();
});

test('Assistant history can continue in another ST chat with a visible switch and fresh target', async () => {
    const f = fixture([[text('first'), done], [text('second'), done]]); await f.enable(); f.controller.setMode('assistant');
    const id = f.controller.newSession(); f.controller.setInput('A question'); f.controller.send(); await settle();
    assert.equal(f.controller.snapshot().history.filters.range, 'all');
    f.switchChat('B');
    assert.ok(f.controller.snapshot().history.sessions.some(row => row.id === id));
    assert.equal(f.controller.snapshot().history.sessionId, id);
    assert.equal(f.controller.snapshot().messages.length, 2);
    assert.equal(f.controller.snapshot().readOnly, false);
    assert.equal(f.controller.snapshot().switchedChat, true);
    f.controller.setInput('B question'); f.controller.send(); await settle();
    assert.equal(f.controller.snapshot().switchedChat, false);
    assert.equal(f.controller.snapshot().messages.length, 4);
    assert.equal(f.controller.snapshot().runs.at(-1).target.chatKey, f.host.currentTarget().chatKey);
    assert.match(f.model.requests[1].instructions.task, /SillyTavern 聊天/);
    const switched = JSON.parse(f.controller.exportHistory());
    assert.equal(switched.scope, JSON.stringify(['assistant', 'chat', f.host.currentTarget().chatKey]));
    assert.equal(switched.version, 7); assert.equal(switched.scopeChanges.length, 1);
    f.controller.newSession();
    assert.equal(f.controller.snapshot().history.filters.range, 'all');
    await f.controller.dispose();
});

test('Delete waits for physical cleanup and never accepts late results or loses another draft', async () => {
    const wait = deferred(), f = fixture([() => wait.promise]); await f.enable();
    const id = f.controller.newSession(); f.controller.setInput('pending'); f.controller.send({ consent: true }); await flush();
    const deleting = f.controller.deleteSession(id); await settle(); assert.equal(f.controller.snapshot().resetting, true);
    assert.throws(() => f.controller.newSession(), /NOT_READY/);
    wait.resolve([text('late deleted answer'), done]); await deleting; await settle();
    assert.equal(f.controller.snapshot().messages.length, 0); assert.equal(f.controller.snapshot().history.total, 0);
    await assert.rejects(f.controller.openSession(id), /HISTORY_SCOPE/); await f.controller.dispose();
});

test('Deleting an idle conversation does not cancel another conversation running', async () => {
    const wait = deferred(), f = fixture([() => wait.promise]); await f.enable(); const idle = f.controller.newSession();
    const active = f.controller.newSession(); f.controller.setInput('active'); f.controller.send({ consent: true }); await flush();
    await f.controller.deleteSession(idle); assert.equal(f.controller.snapshot().busy, true);
    wait.resolve([text('finished'), done]); await settle(); assert.equal(f.controller.snapshot().history.sessionId, active);
    assert.equal(f.controller.snapshot().messages.at(-1).content, 'finished'); await f.controller.dispose();
});

test('Rename survives task completion; archiving blocks sends until explicitly restored', async () => {
    const wait = deferred(), f = fixture([() => wait.promise, [text('continued'), done]]); await f.enable();
    const id = f.controller.newSession(); f.controller.setInput('original'); f.controller.send({ consent: true }); await flush();
    await f.controller.renameSession(id, 'My title'); wait.resolve([text('answer'), done]); await settle();
    assert.equal(f.controller.snapshot().history.selected.title, 'My title'); assert.equal(f.controller.snapshot().messages.length, 2);
    await f.controller.archiveSession(id, true); assert.equal(f.controller.snapshot().readOnly, true);
    assert.throws(() => f.controller.send(), /HISTORY_READ_ONLY/); f.controller.setHistoryFilters({ archive: 'archived' }); assert.equal(f.controller.snapshot().history.sessions.length, 1);
    await f.controller.archiveSession(id, false); f.controller.setInput('continue'); f.controller.send({ consent: true }); await settle();
    assert.equal(f.controller.snapshot().messages.length, 4); await f.controller.dispose();
});

test('Imported backups cannot grant authority or enter model history, even with matching scope', async () => {
    const f = fixture(); await f.enable(); f.controller.newSession(); f.controller.setInput('original'); f.controller.send({ consent: true }); await settle();
    const exported = f.controller.exportHistory(); const previous = f.controller.snapshot().history.sessionId;
    const imported = await f.controller.importHistory(exported); assert.notEqual(imported, previous);
    assert.equal(f.controller.snapshot().readOnly, true); assert.equal(f.controller.snapshot().history.selected.imported, true);
    assert.throws(() => f.controller.send({ consent: true }), /HISTORY_READ_ONLY/);
    await f.controller.archiveSession(imported, true);
    assert.equal(await f.controller.importHistory(exported), imported);
    assert.equal(f.controller.snapshot().history.importReport.status, 'identical');
    assert.equal(f.controller.snapshot().history.selected.archived, true);
    assert.ok(f.controller.snapshot().history.sessions.some(row => row.id === imported));
    const changed = JSON.parse(exported); changed.messages[1].content = 'Changed backup';
    const another = await f.controller.importHistory(JSON.stringify(changed));
    assert.notEqual(another, imported); assert.equal(f.controller.snapshot().readOnly, true);
    assert.equal(f.controller.snapshot().history.importReport.status, 'created');
    await f.controller.openSession(previous); assert.equal(f.controller.snapshot().readOnly, false);
    await f.controller.openSession(another);
    assert.equal(f.model.requests.length, 1); assert.match(f.controller.exportHistory('markdown'), /# Muyu conversation/); await f.controller.dispose();
});

test('Scroll positions belong to conversation views and deletion clears their state', async () => {
    const f = fixture(); await f.enable(); const a = f.controller.newSession(), aKey = f.controller.snapshot().viewKey;
    f.controller.setInput('draft A'); f.controller.setScrollPosition(aKey, 250);
    const b = f.controller.newSession(); f.controller.setInput('draft B'); f.controller.setScrollPosition(f.controller.snapshot().viewKey, 40);
    await f.controller.openSession(a); assert.equal(f.controller.snapshot().scrollTop, 250); assert.equal(f.controller.snapshot().input, 'draft A');
    await f.controller.openSession(b); assert.equal(f.controller.snapshot().scrollTop, 40);
    await f.controller.deleteSession(a); await f.controller.dispose();
});

test('Independent conversations preserve drafts and history across reconnect without replaying old grants', async () => {
    const f = fixture([[text('first answer'), done], [text('second answer'), done]]); await f.enable();
    const first = f.controller.newSession(); f.controller.setInput('first'); f.controller.send({ consent: true }); await settle();
    f.controller.setInput('unsent first'); const second = f.controller.newSession(); f.controller.setInput('unsent second');
    await f.controller.selectSession(first); assert.equal(f.controller.snapshot().input, 'unsent first');
    assert.equal(f.controller.snapshot().messages.at(-1).content, 'first answer');
    await f.controller.selectSession(second); assert.equal(f.controller.snapshot().input, 'unsent second');
    await f.enable(); await f.controller.selectSession(first); f.controller.setInput('continue');
    assert.deepEqual(f.controller.snapshot().history.missingPermissions, ['diagnostics']);
    assert.throws(() => f.controller.send(), /CONSENT_REQUIRED|HISTORY_PERMISSION_REQUIRED/);
    assert.equal(f.model.requests.length, 1); f.controller.send({ consent: true }); await settle();
    assert.equal(f.model.requests.length, 2); assert.equal(f.controller.snapshot().messages.length, 4); await f.controller.dispose();
});

test('Persisted history reload is inert, scoped, and requires fresh grants before sending', async () => {
    const store = createMemoryHistoryStore(), history = { enabled: () => true, open: async () => store, setEnabled: async () => {} };
    const f = fixture(undefined, { history }); await f.controller.ready; await f.enable();
    const id = f.controller.newSession(); f.controller.setInput('diagnose'); f.controller.send({ consent: true }); await settle(); await f.controller.flushHistory(); await f.controller.dispose();
    const g = fixture(undefined, { history }); await g.controller.ready;
    assert.equal(g.controller.snapshot().enabled, false); assert.equal(g.model.requests.length, 0);
    await g.controller.selectSession(id); assert.equal(g.controller.snapshot().messages.length, 2); assert.equal(g.controller.snapshot().runs.length, 0);
    g.switchChat('B'); await assert.rejects(g.controller.selectSession(id), /HISTORY_SCOPE/); assert.equal(g.controller.snapshot().messages.length, 0);
    g.switchChat('A'); await g.enable(); await g.controller.selectSession(id);
    assert.deepEqual(g.controller.snapshot().history.missingPermissions, ['diagnostics']);
    assert.doesNotMatch(g.controller.exportHistory(), /PRIVATE_KEY|apiKey|endpoint|tool_call|reasoning/); await g.controller.dispose();
});

test('Revocation preserves read-only history but cannot leak it through an existing runtime', async () => {
    const f = fixture(); await f.enable(); f.controller.setMode('chat'); f.controller.grantPermission('extended');
    const id = f.controller.newSession(); f.controller.setInput('question'); f.controller.send(); await settle();
    await f.controller.revokePermission('extended'); await f.controller.selectSession(id);
    f.controller.setInput('continue without data'); assert.throws(() => f.controller.send(), /HISTORY_PERMISSION_REQUIRED/);
    assert.equal(f.model.requests.length, 1); assert.equal(f.controller.snapshot().messages.length, 2); await f.controller.dispose();
});

test('Switching Muyu conversations does not cancel or misattribute a pending answer', async () => {
    const wait = deferred(), f = fixture([() => wait.promise]); await f.enable();
    const first = f.controller.newSession(); f.controller.setInput('first'); f.controller.send({ consent: true }); await flush();
    const second = f.controller.newSession(); f.controller.setInput('second draft');
    wait.resolve([text('first answer'), done]); await settle();
    assert.equal(f.controller.snapshot().input, 'second draft'); assert.equal(f.controller.snapshot().messages.length, 0);
    await f.controller.selectSession(first); assert.equal(f.controller.snapshot().messages.at(-1).content, 'first answer');
    await f.controller.selectSession(second); assert.equal(f.controller.snapshot().input, 'second draft'); await f.controller.dispose();
});

test('Idle runtime eviction frees capacity without deleting recorded conversations', async () => {
    const f = fixture(Array.from({ length: 10 }, () => [text('answer'), done])); await f.enable(); let first;
    for (let n = 0; n < 9; n++) { const id = f.controller.newSession(); first ||= id; f.controller.setInput(`question ${n}`); f.controller.send({ consent: true }); await settle(); }
    await f.controller.selectSession(first); assert.equal(f.controller.snapshot().messages.length, 2);
    f.controller.setInput('continue'); f.controller.send({ consent: true }); await settle(); assert.equal(f.controller.snapshot().messages.length, 4); await f.controller.dispose();
});
async function generationBatchControllerFixture(mode, { budget = false, saveFails = false, paused = false } = {}) {
    const { createProfileSystem } = await import('../../systems/profile-system.js');
    const { createNpcSystem } = await import('../../systems/npc-system.js');
    const { createNpcAgent } = await import('../../agents/npc.js');
    const { execute } = await import('../../systems/agent-runtime.js');
    const { createProfileGenerationPort } = await import('../../muyu/host/profile-generation.js');
    const { createNpcGenerationPort } = await import('../../muyu/host/npc-generation.js');
    const { createGenerationBatchPort } = await import('../../muyu/host/generation-batch.js');
    let f, finish; const wait = new Promise(resolve => { finish = resolve; });
    const calls = [], saved = [], characters = [{ avatar: 'alice.png', name: 'Alice' }], providers = [];
    const settings = { profileEnabled: true, profileJsonSchema: '', npcEnabled: true, npcMaxCount: 10, npcBatchSize: 2,
        agentConfigs: { profile: {}, npc: { call: { timeout: 1000, retries: 2 } } } };
    const caller = kind => () => ({ supportsAbort: false, generate: async () => {
        calls.push(kind); if (paused) await wait;
        return kind === 'profile' ? '{"summary":"Generated","tags":[],"motivation":"Help","relationships":"Team"}' : '{"npcs":[{"name":"Merchant","description":"Trader","personality":"Calm","scenario":"Town"}]}';
    } });
    const saver = async metadata => { assert.equal(metadata, f.ctx.chatMetadata); saved.push(calls.at(-1)); if (saveFails) throw Error('unknown save'); };
    const npcAgent = createNpcAgent({ renderPrompt: async p => p, extractJsonObject: () => null, log() {} });
    const common = { settings, EXT_KEY: 'gd', getChatMetadata: () => f.ctx.chatMetadata, getChat: () => f.ctx.chat, getContext: () => f.ctx,
        getCharacters: () => characters, getCurrentGroup: () => f.ctx.groups[0], saveChatConditional: () => { throw Error('conditional fallback forbidden'); }, log() {} };
    const profile = createProfileSystem({ ...common, createCaller: caller('profile'), renderPrompt: async p => p, hashChar: (...a) => a.join('|'), djb2Hash: s => String(s.length),
        extractJsonObject: () => null, sanitizeJson: v => v, isRoundActive: () => false, setExtensionPrompt() {}, inject_ids: { QUIET_PROMPT: 'quiet' }, extension_prompt_types: { IN_PROMPT: 0 } });
    const npc = createNpcSystem({ ...common, createCaller: caller('npc'), AgentRegistry: { get: () => npcAgent }, execute,
        buildContextPool: opts => ({ group: () => opts.group, characters: () => characters, recentMessages: () => f.ctx.chat, npcExistingList: opts.npcExistingList, npcBatchSize: opts.npcBatchSize, npcGenerateFirstMes: opts.npcGenerateFirstMes }) });
    const portCommon = { getTarget: () => f.host.currentTarget(), getSettings: () => settings, getContext: () => f.ctx, getCharacters: () => characters, getProviders: () => providers, saveChatConfirmed: saver };
    const profileGeneration = createProfileGenerationPort({ ...portCommon, system: profile }), npcGeneration = createNpcGenerationPort({ ...portCommon, system: npc });
    const generationBatch = createGenerationBatchPort({ ...portCommon, extensionKey: 'gd', getAgents: () => [npcAgent], profileGeneration, npcGeneration });
    const proposal = () => ({ steps: [{ kind: 'profile', mode, character: 'profile-character:0', revision: profileGeneration.listTargets(f.host.currentTarget()).items[0].revision },
        { kind: 'npc', mode, count: 2, revision: npcGeneration.readState(f.host.currentTarget()).revision }] });
    const ticket = () => JSON.parse(f.model.requests.at(-1).messages.filter(m => m.role === 'tool' && m.result?.data?.text).at(-1).result.data.text).executionId;
    f = fixture([[tool('muyu.profile_generation.targets', {}, 'profile-dir'), tool('muyu.npc_generation.state', {}, 'npc-dir'), done],
        () => [tool('muyu.generation_batch.prepare', proposal(), 'batch-prepare'), done],
        () => [tool('muyu.generation_batch.execute', { executionId: ticket(), maxModelCalls: 2 }, 'batch-run'), done],
        [text('Historical per-step generation result'), done]], { profileGeneration, npcGeneration, generationBatch,
        ...(budget ? { runConfig: { read: () => ({ ...RUN_DEFAULTS, providerBytes: 6000 }) } } : {}) });
    f.ctx.groups[0].members = ['alice.png']; await f.enable(); f.controller.setMode('assistant');
    return { f, calls, saved, settings, finish, profile, npc };
}

for (const mode of ['trial', 'save']) for (const decision of ['task', 'deny', 'full']) test(`Generation batch ${mode}/${decision}: one exact approval continues both real pipelines`, async () => {
    const { f, calls, saved } = await generationBatchControllerFixture(mode);
    if (decision === 'full') f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput(mode === 'trial' ? 'Test a profile and NPCs without saving' : 'Generate and save a profile and NPCs'); f.controller.send(); await settle();
    if (decision !== 'full') {
        for (const source of ['profileGenerationTargets', 'npcGenerationState']) {
            const r = f.controller.snapshot().interaction; assert.equal(r.source, source); assert.deepEqual(calls, []);
            f.controller.answerPermission(r.id, 'task'); await settle();
        }
        const r = f.controller.snapshot().interaction; assert.equal(r.source, 'generationBatchExecution'); assert.deepEqual(calls, []);
        const details = f.controller.generationBatchExecutionDetails(r.executionId); assert.equal(details.maximumModelCalls, 2); assert.equal(details.steps.length, 2);
        assert.equal(f.model.requests.length, 3); f.controller.answerPermission(r.id, decision); await settle();
    }
    assert.deepEqual(calls, decision === 'deny' ? [] : ['profile', 'npc']); assert.equal(f.model.requests.length, 4);
    assert.equal(saved.length, decision !== 'deny' && mode === 'save' ? 2 : 0);
    assert.equal(f.controller.snapshot().interaction?.status === 'pending', false);
    if (mode === 'save' && decision !== 'deny') { assert.equal(f.ctx.chatMetadata.gd.characterProfiles['alice.png'].profile.summary, 'Generated'); assert.equal(f.ctx.chatMetadata.gd.npcs[0].imported, false); }
    const history = JSON.parse(f.controller.exportHistory()); assert.ok(history.required.some(s => s.startsWith('source:generationBatchExecution:')) || decision === 'deny');
    await f.controller.dispose();
});
test('batch approval rechecks business settings before any generation', async () => {
    const { f, settings, calls } = await generationBatchControllerFixture('save'); f.controller.setInput('Generate and save'); f.controller.send(); await settle();
    for (let i = 0; i < 2; i++) { f.controller.answerPermission(f.controller.snapshot().interaction.id, 'task'); await settle(); }
    const r = f.controller.snapshot().interaction; settings.npcBatchSize = 4;
    assert.throws(() => f.controller.answerPermission(r.id, 'task'), /INTERACTION_STALE/); assert.deepEqual(calls, []); f.controller.cancelInteraction(r.id); await f.controller.dispose();
});
test('batch aggregate budget denial is zero-cost even with full access', async () => {
    const { f, calls, saved } = await generationBatchControllerFixture('save', { budget: true }); f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput('Generate and save'); f.controller.send(); await settle(); assert.deepEqual(calls, []); assert.deepEqual(saved, []);
    assert.match(JSON.stringify(f.model.requests.at(-1).messages), /RESULT_BUDGET_EXCEEDED/); await f.controller.dispose();
});
test('batch unknown first save stops the second pipeline without retry or rollback', async () => {
    const { f, calls, saved } = await generationBatchControllerFixture('save', { saveFails: true }); f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput('Generate and save'); f.controller.send(); await settle(); assert.deepEqual(calls, ['profile']); assert.deepEqual(saved, ['profile']);
    assert.ok(f.ctx.chatMetadata.gd.characterProfiles['alice.png']); assert.equal(f.ctx.chatMetadata.gd.npcs, undefined);
    assert.match(JSON.stringify(f.model.requests.at(-1).messages), /outcome_unknown/); await f.controller.dispose();
});
test('batch controller stop drains native first call and never starts the second', async () => {
    const { f, calls, saved, finish, profile } = await generationBatchControllerFixture('save', { paused: true }); f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput('Generate and save'); f.controller.send(); await settle(); assert.deepEqual(calls, ['profile']);
    f.controller.stop(); await settle(); assert.equal(profile.isGenerating(), true); assert.deepEqual(saved, []);
    finish(); await settle(); assert.equal(profile.isGenerating(), false); assert.deepEqual(calls, ['profile']); assert.deepEqual(saved, []); assert.deepEqual(f.ctx.chatMetadata, {}); await f.controller.dispose();
});

for(const operation of ['update','create_entry','delete_entry','create_book','copy_book'])for(const access of ['normal','deny','full','preview'])test('World-book editor controller / '+operation+' / '+access+' preserves approval and shared-resource boundaries',async()=>{
    const { createWorldBookEditorPort } = await import('../../muyu/host/worldbook-editor.js');
    let f, saves=0, names=['PRIVATE_BOOK'], data={entries:{1:{uid:1,comment:'PRIVATE_NAME',content:'PRIVATE_BODY',key:['gold'],disable:false}}};
    const worldBookEditor=createWorldBookEditorPort({getTarget:()=>f.host.globalTarget,getState:()=>({names}),load:async()=>structuredClone(data),save:async(name,next)=>{saves++;data=next;if(!names.includes(name))names.push(name);},refresh:async()=>{},createEntry:(_name,book)=>{const entry={uid:0,content:'',key:[],disable:false};book.entries[0]=entry;return entry;}});
    const args={operation,selector:operation==='create_book'?'':['copy_book','create_entry'].includes(operation)?'book:0':'entry:0:0',revision:'pending',changesJson:['update','create_entry'].includes(operation)?'{"content":"NEW_BODY"}':'{}',...(['copy_book','create_book'].includes(operation)?{name:'NewBook'}:{}),...(access==='full'?{apply:true}:{})};
    const step=tool('muyu.worldbook_editor.preview',args);
    f=fixture([[step,done],[text('Prepared'),done]],{worldBookEditor,providerPort:{available:()=>true}});
    await f.enable();f.controller.setMode('assistant');if(['full','preview'].includes(access))f.controller.setFullAccess(true,{confirmed:true});
    const dir=worldBookEditor.list(f.host.globalTarget),row=await worldBookEditor.read(f.host.globalTarget,'book:0',dir.revision,0);
    args.revision=operation==='create_book'?dir.revision:row.revision;
    f.controller.setInput('Preview this world-book change');f.controller.send();await settle();
    if(['normal','deny'].includes(access)){const request=f.controller.snapshot().interaction;assert.equal(request.source,'stWorldBookEntries');assert.equal(saves,0);f.controller.answerPermission(request.id,access==='deny'?'deny':'task');await settle();}
    const artifact=f.controller.snapshot().artifacts.find(a=>a.kind==='worldbook-edit-draft');
    if(access==='normal'){assert.ok(artifact,JSON.stringify(f.controller.snapshot().runs));assert.equal(saves,0);const action=f.controller.prepareWorldBookEditApply(artifact.id,artifact.revision);await f.controller.approveWorldBookEditApply(action.id);assert.throws(()=>f.controller.approveWorldBookEditApply(action.id),/STALE/);}
    assert.equal(saves,['deny','preview'].includes(access)?0:1);
    if(access==='deny')assert.equal(artifact,undefined);else{assert.ok(artifact);const history=JSON.parse(f.controller.exportHistory());assert.ok(history.required.includes('source:stWorldBookEntries'));assert.doesNotMatch(JSON.stringify(history.receipts),/PRIVATE_BOOK|PRIVATE_NAME|PRIVATE_BODY|NEW_BODY/);if(access!=='preview')assert.equal(history.receipts.at(-1).version,32);}
    await f.controller.dispose();
});
for(const operation of ['set_global_binding','set_chat_binding','delete_book'])for(const access of ['normal','deny','full','preview'])test('ST world-book controls / '+operation+' / '+access+' requires exact scope and approval',async()=>{
 const {createWorldBookControls}=await import('../../muyu/host/worldbook-controls.js');const {createWorldBookEditorPort}=await import('../../muyu/host/worldbook-editor.js');
 let f,writes=0;const state={names:['Atlas'],global:[],chat:''},data={entries:{1:{uid:1,content:'PRIVATE_BODY'}}};
 const controls=createWorldBookControls({getTarget:()=>f.host.globalTarget,getChatTarget:()=>f.host.currentTarget(),getState:()=>state,getReferences:()=>({known:0}),load:async()=>structuredClone(data),refresh:async()=>{},setGlobal:async names=>{writes++;state.global=names;},setChat:async name=>{writes++;state.chat=name;},remove:async()=>{writes++;state.names=[];return true;}});
 const editor=createWorldBookEditorPort({getTarget:()=>f.host.globalTarget,getState:()=>state,load:async()=>structuredClone(data),controls});
 const args={operation,selector:operation==='delete_book'?'book:0':'',revision:'pending',changesJson:operation==='set_global_binding'?'{"names":["Atlas"]}':operation==='set_chat_binding'?'{"name":"Atlas"}':'{}',...(access==='full'?{apply:true}:{})};
 f=fixture([[tool('muyu.worldbook_editor.preview',args),done],[text('Prepared'),done]],{worldBookEditor:editor,providerPort:{available:()=>true}});await f.enable();f.controller.setMode('assistant');
 if(['full','preview'].includes(access))f.controller.setFullAccess(true,{confirmed:true});
 if(operation==='delete_book'){const root=editor.list(f.host.globalTarget);args.revision=(await editor.read(f.host.globalTarget,'book:0',root.revision,0)).revision;}else args.revision=editor.bindingRead(f.host.globalTarget).revision;
 f.controller.setInput('Preview requested operation');f.controller.send();await settle();
 if(['normal','deny'].includes(access)){for(let i=0;i<3&&f.controller.snapshot().interaction?.status==='pending';i++){const request=f.controller.snapshot().interaction;assert.ok(['stWorldBooks','stWorldBookEntries'].includes(request.source));assert.equal(writes,0);f.controller.answerPermission(request.id,access==='deny'?'deny':'task');await settle();}}
 const artifact=f.controller.snapshot().artifacts.find(a=>a.kind==='worldbook-edit-draft');
 if(access==='normal'){assert.ok(artifact,JSON.stringify(f.controller.snapshot().runs));assert.equal(writes,0);const pending=f.controller.prepareWorldBookEditApply(artifact.id,artifact.revision);await f.controller.approveWorldBookEditApply(pending.id);}
 assert.equal(writes,['normal','full'].includes(access)?1:0);
 if(access==='deny')assert.equal(artifact,undefined);else{assert.ok(artifact);const history=JSON.parse(f.controller.exportHistory());assert.ok(history.required.includes('source:stWorldBooks'));assert.doesNotMatch(JSON.stringify(history.receipts),/Atlas|PRIVATE_BODY/);}
 await f.controller.dispose();
});
for(const operation of ['update','copy','create','rename','delete'])for(const access of ['normal','deny','full','preview'])test('Character-card controller / '+operation+' / '+access+' isolates saved body and exact writes',async()=>{
    const {createCharacterCardPort}=await import('../../muyu/host/character-cards.js');let f,writes=0,copies=0;
    const rows=[{name:'PRIVATE_NAME',avatar:'Alice.png'}],cards={'Alice.png':{name:'PRIVATE_NAME',description:'PRIVATE_BODY',data:{description:'PRIVATE_BODY',extensions:{unknown:'PRIVATE_EXTENSION'}}}};
    const characterCards=createCharacterCardPort({getTarget:()=>f.host.globalTarget,getDirectory:()=>rows,isEditing:()=>false,getReferences:()=>({known:0}),
        load:async avatar=>({...structuredClone(cards[avatar]),avatar,json_data:JSON.stringify(cards[avatar])}),
        save:async(avatar,changes)=>{writes++;Object.assign(cards[avatar],changes);Object.assign(cards[avatar].data,changes);},
        duplicate:async avatar=>{copies++;cards['Alice_1.png']=structuredClone(cards[avatar]);return 'Alice_1.png';},
        create:async values=>{writes++;cards['new.png']={...values,data:{...values}};return 'new.png';},remove:async avatar=>{writes++;delete cards[avatar];},exists:async avatar=>Object.hasOwn(cards,avatar)});
    const args={operation,selector:operation==='create'?'':'card:0',revision:'pending',changesJson:['copy','delete'].includes(operation)?'{}':operation==='rename'?'{"name":"New Name"}':operation==='create'?'{"name":"New","description":"NEW_BODY"}':'{"description":"NEW_BODY"}',...(access==='full'?{apply:true}:{})};
    f=fixture([[tool('muyu.character_card.preview',args),done],[text('Prepared'),done]],{characterCards});await f.enable();f.controller.setMode('assistant');
    if(['full','preview'].includes(access))f.controller.setFullAccess(true,{confirmed:true});
    args.revision=operation==='create'?characterCards.list(f.host.globalTarget).revision:(await characterCards.read(f.host.globalTarget,'card:0',characterCards.list(f.host.globalTarget).revision,0)).revision;
    f.controller.setInput('Preview or apply this saved card');f.controller.send();await settle();
    if(['normal','deny'].includes(access)){let request=f.controller.snapshot().interaction;assert.equal(request.source,'stCharacterCardState');assert.equal(writes+copies,0);f.controller.answerPermission(request.id,access==='deny'?'deny':'task');await settle();if(operation==='delete'&&access==='normal'){request=f.controller.snapshot().interaction;assert.equal(request.source,'stCharacterCardReferences');f.controller.answerPermission(request.id,'task');await settle();}}
    const artifact=f.controller.snapshot().artifacts.find(a=>a.kind==='character-card-draft');
    if(access==='normal'){assert.ok(artifact,JSON.stringify(f.controller.snapshot().runs));assert.equal(writes+copies,0);const action=f.controller.prepareCharacterCardApply(artifact.id,artifact.revision);await f.controller.approveCharacterCardApply(action.id);assert.throws(()=>f.controller.approveCharacterCardApply(action.id),/STALE/);}
    assert.equal(writes+copies,['deny','preview'].includes(access)?0:1);
    if(access==='deny')assert.equal(artifact,undefined);else{assert.ok(artifact);const history=JSON.parse(f.controller.exportHistory());assert.ok(history.required.includes('source:stCharacterCardState'));assert.doesNotMatch(JSON.stringify(history.receipts),/PRIVATE_NAME|Alice.png|PRIVATE_BODY|NEW_BODY|PRIVATE_EXTENSION/);if(access!=='preview')assert.equal(history.receipts.at(-1).version,33);}
    await f.controller.dispose();
});

test('Read-all policy reads settings without a handoff, persists across reconnect and never enables full access', async () => {
    let saved = {readAccess:'ask'};
    const f = fixture([[tool('muyu.settings.read',{fields:['autoMemoryInterval']}),done],[text('Read only'),done]], {
        permissionConfig:{read:()=>saved,save:async value=>{saved=value;}}
    });
    await f.enable(); f.controller.setMode('assistant');
    await f.controller.savePermissionConfig({readAccess:'all'});
    f.controller.setInput('Read memory interval'); f.controller.send(); await settle();
    assert.equal(f.controller.snapshot().interaction?.status==='pending',false);
    assert.equal(f.controller.snapshot().runs.at(-1).status,'succeeded');
    assert.match(JSON.stringify(f.model.requests.at(-1).messages),/autoMemoryInterval/);
    assert.equal(f.controller.snapshot().fullAccess,false);
    assert.equal(f.settings.autoMemoryInterval,10);
    await f.enable(); assert.equal(f.controller.snapshot().permissionConfig.readAccess,'all');
    await f.controller.savePermissionConfig({readAccess:'ask'});
    assert.equal(f.controller.snapshot().permissionConfig.readAccess,'ask');
    await f.controller.dispose();
});

test('Read-all policy blocks direct settings writes, and policy save failure preserves the previous mode', async () => {
    const f=fixture([[tool('muyu.settings.preview',{changes:{autoMemoryInterval:15},apply:true}),done],[text('No write'),done]],{
        permissionConfig:{read:()=>({readAccess:'all'}),save:async()=>{throw Error('SAVE_FAILED');}}
    });
    await f.enable(); f.controller.setMode('assistant');
    f.controller.setInput('Prepare'); f.controller.send(); await settle();
    assert.equal(f.settings.autoMemoryInterval,10);
    assert.equal(f.controller.snapshot().artifacts.some(a=>a.kind==='config-draft'),false);
    assert.match(JSON.stringify(f.model.requests.at(-1).messages),/PERMISSION_DENIED/);
    await assert.rejects(f.controller.savePermissionConfig({readAccess:'ask'}),/SAVE_FAILED/);
    assert.equal(f.controller.snapshot().permissionConfig.readAccess,'all');
    await f.controller.dispose();
});

test('Read policy cannot change while a source permission continuation is pending', async()=>{
    const f=fixture([[tool('muyu.settings.read',{fields:['autoMemoryInterval']}),done]],{
        permissionConfig:{read:()=>({readAccess:'ask'}),save:async()=>{throw Error('Must not save');}}
    });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Read'); f.controller.send(); await settle();
    assert.equal(f.controller.snapshot().interaction.status,'pending');
    await assert.rejects(f.controller.savePermissionConfig({readAccess:'all'}),/NOT_READY/);
    assert.equal(f.controller.snapshot().permissionConfig.readAccess,'ask');
    await f.controller.dispose();
});

test('Reloading changed history detaches old runtime messages, preserves composer text and sends the new stored history', async () => {
    const store = createMemoryHistoryStore(); store.kind = 'browser';
    const f = fixture([[text('old answer'), done], [text('new answer'), done]], { history: { enabled: () => true, open: async () => store, setEnabled: async () => {} } });
    await f.controller.ready; await f.enable(); f.controller.setMode('assistant');
    f.controller.setInput('first question'); f.controller.send(); await settle(); await f.controller.flushHistory();
    const id = f.controller.snapshot().history.sessionId, old = await store.read(id);
    await store.update({ ...old, messages: old.messages.map(row => row.role === 'assistant' ? { ...row, content: 'updated externally' } : row) }, old.revision);
    f.controller.setInput('unsent draft'); await f.controller.refreshHistory();
    assert.equal(f.controller.snapshot().history.external, 'changed');
    assert.equal(f.controller.snapshot().messages.at(-1).content, 'old answer');
    assert.throws(() => f.controller.send(), /HISTORY_CONFLICT/);
    await f.controller.reloadHistory();
    assert.equal(f.controller.snapshot().input, 'unsent draft');
    assert.equal(f.controller.snapshot().messages.at(-1).content, 'updated externally');
    assert.equal(f.controller.snapshot().runs.length, 0);
    f.controller.send(); await settle(); await f.controller.flushHistory();
    assert.match(JSON.stringify(f.model.requests.at(-1).messages), /updated externally/);
    assert.doesNotMatch(JSON.stringify(f.model.requests.at(-1).messages), /old answer/);
    assert.equal((await store.read(id)).messages.at(-1).content, 'new answer');
    await f.controller.dispose();
});

test('Reloading an externally deleted conversation preserves the unsent draft without resurrecting its ID', async () => {
    const store = createMemoryHistoryStore();
    const f = fixture([[text('answer'), done], [text('fresh'), done]], { history: { enabled: () => true, open: async () => store, setEnabled: async () => {} } });
    await f.controller.ready; await f.enable(); f.controller.setMode('assistant');
    f.controller.setInput('question'); f.controller.send(); await settle(); await f.controller.flushHistory();
    const id = f.controller.snapshot().history.sessionId, saved = await store.read(id);
    await store.remove(id, saved.revision); f.controller.setInput('keep draft'); await f.controller.refreshHistory();
    assert.equal(f.controller.snapshot().history.external, 'deleted'); await f.controller.reloadHistory();
    assert.equal(f.controller.snapshot().input, 'keep draft'); assert.deepEqual(f.controller.snapshot().messages, []);
    f.controller.send(); await settle(); await f.controller.flushHistory();
    assert.notEqual(f.controller.snapshot().history.sessionId, id); assert.equal(await store.read(id), null);
    await f.controller.dispose();
});

test('Dirty history reload requires explicit discard approval, without dropping the unsent draft', async () => {
    const store = createMemoryHistoryStore(); let enabled = true;
    const history = { enabled: () => enabled, open: async () => store, setEnabled: async value => { enabled = value; } };
    const f = fixture([[text('saved answer'), done], [text('unsaved answer'), done]], { history });
    await f.controller.ready; await f.enable(); f.controller.setMode('assistant');
    f.controller.setInput('saved question'); f.controller.send(); await settle(); await f.controller.flushHistory();
    const id = f.controller.snapshot().history.sessionId, saved = await store.read(id);
    await f.controller.setHistoryEnabled(false);
    f.controller.setInput('unsaved question'); f.controller.send(); await settle();
    await store.update({ ...saved, title: 'external branch' }, saved.revision);
    f.controller.setInput('composer survives'); await f.controller.setHistoryEnabled(true); await f.controller.flushHistory();
    assert.equal(f.controller.snapshot().history.external, 'changed');
    await assert.rejects(f.controller.reloadHistory(), /HISTORY_UNSAVED/);
    assert.equal(f.controller.snapshot().messages.at(-1).content, 'unsaved answer');
    await f.controller.reloadHistory({ discardLocal: true });
    assert.equal(f.controller.snapshot().messages.at(-1).content, 'saved answer');
    assert.equal(f.controller.snapshot().input, 'composer survives');
    assert.equal(f.model.requests.length, 2); assert.equal((await store.read(id)).title, 'external branch');
    await f.controller.dispose();
});

test('A chat switch while history reload is waiting cannot replace records or overwrite the new chat draft', async () => {
    const store = createMemoryHistoryStore();
    const f = fixture([[text('old answer'), done]], { history: { enabled: () => true, open: async () => store, setEnabled: async () => {} } });
    await f.controller.ready; await f.enable(); f.controller.setMode('assistant');
    f.controller.setInput('question'); f.controller.send(); await settle(); await f.controller.flushHistory();
    const id = f.controller.snapshot().history.sessionId, saved = await store.read(id);
    await store.update({ ...saved, title: 'external version' }, saved.revision); await f.controller.refreshHistory();
    const gate = deferred(), read = store.read.bind(store); let waiting = false;
    store.read = async key => { const result = await read(key); waiting = true; await gate.promise; return result; };
    f.controller.setInput('old chat draft'); const pending = f.controller.reloadHistory();
    await settle(); assert.equal(waiting, true);
    f.switchChat('B'); f.controller.setInput('new chat draft'); gate.resolve();
    await assert.rejects(pending, /NOT_READY/);
    assert.equal(f.controller.snapshot().input, 'new chat draft');
    assert.equal(f.controller.snapshot().messages.at(-1).content, 'old answer');
    assert.equal(f.controller.snapshot().history.external, 'changed'); assert.equal(f.model.requests.length, 1);
    await f.controller.dispose();
});

test('Read-source switching isolates same-ID histories, composer drafts and scroll positions without model calls', async () => {
    const { createHistoryPort } = await import('../../muyu/host/history.js');
    const browser = createMemoryHistoryStore(), books = createMemoryHistoryStore(); browser.kind = 'browser'; books.kind = 'world-book';
    const settings = { muyuHistoryEnabled: true, muyuHistoryReadSource: 'browser', muyuHistoryWriteTargets: [] };
    const history = createHistoryPort({ getAccount: async () => ({ enabled: false }), getSettings: () => settings, saveSettings: async () => {}, openStore: async () => browser, openWorldBook: async () => books, openServer: async () => null });
    const f = fixture([], { history }); await f.controller.ready; await f.enable(); f.controller.setMode('assistant');
    const value = { version: 5, id: crypto.randomUUID(), revision: 0, scope: historyScope('assistant', f.host.currentTarget()), title: 'same ID', createdAt: 1, updatedAt: 1,
        messages: [{ role: 'user', content: 'browser history', runId: 'r' }], required: [], status: 'succeeded', archived: false, imported: false, receipts: [], contextSummary: null };
    await browser.create(value); await books.create({ ...value, messages: [{ role: 'user', content: 'world-book history', runId: 'r' }] });
    await f.controller.refreshHistory(); await f.controller.openSession(value.id);
    f.controller.setInput('browser draft'); const browserKey = f.controller.snapshot().viewKey; f.controller.setScrollPosition(browserKey, 120);
    await f.controller.setHistoryReadSource('world-book'); await f.controller.openSession(value.id);
    assert.equal(f.controller.snapshot().messages[0].content, 'world-book history'); assert.equal(f.controller.snapshot().input, '');
    f.controller.setInput('book draft'); const bookKey = f.controller.snapshot().viewKey; assert.notEqual(bookKey, browserKey);
    await f.controller.setHistoryReadSource('browser');
    assert.equal(f.controller.snapshot().messages[0].content, 'browser history'); assert.equal(f.controller.snapshot().input, 'browser draft');
    assert.equal(f.controller.snapshot().scrollTop, 120);
    await f.controller.setHistoryReadSource('world-book');
    assert.equal(f.controller.snapshot().input, 'book draft'); assert.equal(f.controller.snapshot().viewKey, bookKey);
    await f.controller.setHistoryEnabled(false); await f.controller.setHistoryReadSource('browser');
    assert.equal(f.controller.snapshot().history.enabled, false, 'cached source obeys the shared auto-save preference');
    assert.equal(f.controller.snapshot().input, 'browser draft'); await f.controller.setHistoryReadSource('world-book');
    assert.deepEqual(settings.muyuHistoryWriteTargets, []); assert.equal(f.model.requests.length, 0);
    await assert.rejects(f.controller.setHistoryReadSource('server'), /HISTORY_UNAVAILABLE/);
    assert.equal(f.controller.snapshot().history.readSource, 'world-book'); assert.equal(settings.muyuHistoryReadSource, 'world-book');
    assert.equal(f.controller.snapshot().input, 'book draft'); await f.controller.dispose();
});

function fixture(steps = [[text('answer'), done]], extraHost = {}) {
    const events = new EventEmitter(), settings = { memoryEnabled: true, autoMemoryEnabled: true, autoMemoryInterval: 10, autoMemorySpeakers: false };
    const ctx = { groupId: 'g', chatId: 'A', groups: [{ id: 'g', members: ['private-avatar'] }], chat: [{ mes: 'PRIVATE_BODY' }], chatMetadata: {}, eventSource: events, eventTypes: { CHAT_CHANGED: 'chat' } };
    Object.assign(ctx, extraHost.modelContext || {});
    let reads = 0;
    let host;
    const variableDraftPort = createVariableDraftPort({ getTarget: () => host?.currentTarget(), getMetadata: () => ctx.chatMetadata, extensionKey: 'gd' });
    const variableWriter = extraHost.variableSaveConfirmed && createVariableWriter({ draftPort: variableDraftPort, editorPort:extraHost.variableEditor,
        getTarget: () => host?.currentTarget(), getMetadata: () => ctx.chatMetadata, extensionKey: 'gd', saveChatConfirmed: extraHost.variableSaveConfirmed });
    const getSettings = () => { reads++; return settings; };
    const bundleDraftPort = createTaskBundleDraftPort({ getTarget: () => host?.currentTarget(), getSettings, variableDraftPort, scriptPort: extraHost.scriptExecutors });
    const configWriter = extraHost.bundleSaveSettings ? createConfigWriter({ getSettings, saveSettings: extraHost.bundleSaveSettings, isBusy: () => false }) : extraHost.configWriter;
    const bundleWriter = (variableWriter && configWriter || extraHost.scriptExecutors) && createTaskBundleWriter({ draftPort: bundleDraftPort, getTarget: () => host?.currentTarget(), variableWriter, configWriter, scriptWriter: extraHost.scriptExecutors });
    // Existing permission tests explicitly exercise the optional approval mode.
    host = createHostBridge({ getContext: () => ctx, getSettings, extensionKey: 'gd', pageId: 'test', contextConfig: { read: () => ({ ...CONTEXT_DEFAULTS, historyAuthorization: 'ask' }), save: async () => {} }, ...extraHost, configWriter, variableDraftPort, variableWriter, bundleDraftPort, bundleWriter });
    const model = scriptedModel(steps), configs = [];
    const controller = createMuyuController({ host, createModel: config => { configs.push(config); return model; } });
    controller.setMode('memory');
    return { host, ctx, events, settings, model, configs, controller, reads: () => reads,
        enable: () => controller.configure({ endpoint: 'https://example.test/chat/completions', apiKey: 'PRIVATE_KEY', model: 'test', thinking: true }),
        switchChat: id => { ctx.chatId = id; events.emit('chat'); } };
}
const settle = async () => { for (let i = 0; i < 12; i++) await flush(); };

for (const enabled of [false, true]) test('Public page fetch requires an enabled detected capability but no Brave key / ' + enabled, async () => {
    const { createServiceToolGate } = await import('../../muyu/services/tool-gate.js');
    const gate = createServiceToolGate({ check: async () => ({ status: 'available', toolProtocols: { webFetch: 1 } }), getEnabled: () => ({ webFetch: enabled }) });
    let requests = 0;
    const services = { captureTools: () => gate.capture(), cancel: () => gate.reset(), page: async () => {
        requests++; return { version: 1, status: 'ok', url: 'https://example.com/', fetchedAt: '2026-10-09T00:00:00.000Z', title: 'Example', text: 'Public evidence', limited: false };
    } };
    const f = fixture(enabled ? [[tool('muyu.service.fetch_page', { url: 'https://example.com/', maxChars: 1000 }), done], [text('Public evidence'), done]] : [[text('Normal chat'), done]], { services });
    await f.enable(); f.controller.setMode('assistant'); await gate.detect();
    f.controller.setInput('Read this public web page'); f.controller.send(); await settle();
    assert.equal(requests, enabled ? 1 : 0); assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
    assert.equal(f.model.requests[0].tools.some(tool => tool.id === 'muyu.service.fetch_page'), enabled);
    assert.equal(f.controller.snapshot().interaction, null);
    assert.equal(f.controller.snapshot().runs.at(-1).process.toolFailures, 0);
    await f.controller.dispose();
});

for (const decision of ['task', 'deny', 'all']) test('Local document tools use one source handoff and preserve normal chat / ' + decision, async () => {
    const { createServiceToolGate } = await import('../../muyu/services/tool-gate.js');
    const gate = createServiceToolGate({ check: async () => ({ status: 'available', toolProtocols: { documentSearch: 1 } }), getEnabled: () => ({ documentSearch: true }) });
    await gate.detect(); let reads = 0;
    const services = { captureTools: () => gate.capture(), cancel: () => gate.reset(), document: async () => {
        reads++; return { version: 1, status: 'ok', roots: [{ id: 'workspace', title: 'Workspace', revision: '1'.repeat(64) }] };
    } };
    const f = fixture([[tool('muyu.tools.select', { groups: ['service-documents'] }), done],
        [tool('muyu.service.list_roots', {}, 'roots'), done], [text('Only approved roots'), done]], { services });
    await f.enable(); f.controller.setMode('assistant'); await gate.detect();
    if (decision === 'all') f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput('Find my local plugin documentation'); f.controller.send(); await settle();
    if (decision !== 'all') {
        const interaction = f.controller.snapshot().interaction; assert.equal(interaction.source, 'serviceDocuments'); assert.equal(reads, 0);
        f.controller.answerPermission(interaction.id, decision); await settle();
    }
    assert.equal(reads, decision === 'deny' ? 0 : 1);
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
    assert.notEqual(f.controller.snapshot().interaction?.status, 'pending');
    assert.equal(f.model.requests.at(-1).tools.some(tool => tool.id === 'muyu.service.list_roots'), true);
    await f.controller.dispose();
});

test('Optional service absence never blocks normal conversation and disabled capabilities never probe', async () => {
    const { createServicesPort } = await import('../../muyu/host/services.js');
    for (const enabled of [false, true]) {
        let network = 0;
        const services = createServicesPort({ getEnabled: () => ({ webFetch: enabled }), fetcher: async () => {
            network++; return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
        } });
        const f = fixture([[text('normal reply'), done], [text('another reply'), done]], { services });
        await f.enable(); f.controller.setMode('assistant');
        for (const input of ['hello', 'continue']) {
            f.controller.setInput(input); f.controller.send(); await settle();
            assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
            assert.equal(f.controller.snapshot().interaction, null);
        }
        assert.equal(network, enabled ? 2 : 0); // status and legacy health only, cached across turns.
        assert.ok(f.model.requests.every(request => !request.tools.some(tool => tool.id.startsWith('muyu.service.'))));
        await f.controller.dispose();
    }
});

test('An opted-in service check still in flight cannot delay sending and is aborted on disposal', async () => {
    const { createServicesPort } = await import('../../muyu/host/services.js'); let cancelled = 0;
    const services = createServicesPort({ getEnabled: () => ({ webFetch: true }), fetcher: (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { cancelled++; reject(Error('PRIVATE')); }, { once: true });
    }) });
    const f = fixture([[text('No service required'), done]], { services });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('hello'); f.controller.send(); await settle();
    assert.equal(services.toolStatus().status, 'checking');
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
    await f.controller.dispose(); await settle(); assert.equal(cancelled, 1); assert.equal(services.toolStatus().status, 'unchecked');
});

test('Provider source draft requires separate import approval, saves once, and exports a v6 receipt', async () => {
    let installs = 0;
    const providerAssets = { assertNew() {}, install: async () => { installs++; return { status: 'saved_unconfirmed', registered: true, persistence: 'unconfirmed' }; } };
    const args = { name: 'gold', ids: ['gold'], source: 'export function register({registerProvider}) { registerProvider({id:"gold",placeholder:"{{gold}}",render:()=>"10"}); }' };
    const f = fixture([[tool('muyu.provider.preview', args), done], [text('Draft only'), done]], { providerAssets });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Prepare a gold Provider'); f.controller.send(); await settle();
    const artifact = f.controller.snapshot().artifacts.find(a => a.kind === 'provider-draft');
    assert.ok(artifact, JSON.stringify(f.controller.snapshot().runs)); assert.equal(installs, 0);
    const approval = f.controller.prepareProviderInstall(artifact.id, artifact.revision);
    assert.equal(installs, 0);
    const result = await f.controller.approveProviderInstall(approval.id);
    assert.equal(result.status, 'saved_unconfirmed'); assert.equal(installs, 1);
    assert.throws(() => f.controller.approveProviderInstall(approval.id), /STALE/);
    const saved = JSON.parse(f.controller.exportHistory());
    assert.ok(saved.receipts.some(r => r.version === 6 && r.name === 'gold'));
    await f.controller.dispose();
});

test('Full access imports Provider only when the exact draft requests installation', async () => {
    let installs = 0;
    const providerAssets = { assertNew() {}, install: async () => { installs++; return { status: 'saved_unconfirmed', registered: true, persistence: 'unconfirmed' }; } };
    const args = { name: 'gold', ids: ['gold'], source: 'export function register(deps) {}' };
    const f = fixture([[tool('muyu.provider.preview', args), done], [text('Preview'), done],
        [tool('muyu.provider.preview', { ...args, install: true }), done], [text('Install requested'), done]], { providerAssets });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput('Only preview'); f.controller.send(); await settle(); assert.equal(installs, 0);
    f.controller.setInput('Install now'); f.controller.send(); await settle(); assert.equal(installs, 1);
    assert.ok(f.controller.snapshot().receipts.some(r => r.version === 6));
    await f.controller.dispose();
});

test('Synthetic Provider tests require separate task code approval and never import drafts', async () => {
    let calls = 0;
    const providerAssets = { assertNew() {}, test: async () => { calls++; return { status: 'passed', phase: 'render', rows: [] }; } };
    const args = { name: 'gold', ids: ['gold'], source: 'export function register(deps) {}' };
    let f;
    const testCall = () => {
        const request = f.model.requests.at(-1);
        const candidateId = request.messages.findLast(row => row.role === 'tool' && row.result?.data?.candidateId)?.result.data.candidateId;
        assert.ok(candidateId, JSON.stringify(request.messages));
        return [tool('muyu.provider.test', { candidateId }, 'test'), done];
    };
    f = fixture([[tool('muyu.provider.preview', args), done], testCall, [text('Synthetic report only; not imported'), done]], { providerAssets });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Draft and synthetic-test'); f.controller.send(); await settle();
    const request = f.controller.snapshot().interaction;
    assert.equal(request?.source, 'providerTests', JSON.stringify(f.controller.snapshot().runs)); assert.equal(calls, 0);
    assert.throws(() => f.controller.answerPermission(request.id, 'chat'), /INVALID_PERMISSION_DECISION/);
    f.controller.answerPermission(request.id, 'task'); await settle();
    assert.equal(calls, 1, JSON.stringify(f.controller.snapshot().runs)); assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
    assert.deepEqual(f.controller.snapshot().sourceGrants, []);
    assert.equal(f.controller.snapshot().receipts.length, 0);
    assert.ok(f.controller.snapshot().artifacts.some(row => row.kind === 'provider-draft'));
    await f.controller.dispose();
});

for (const operation of ['update', 'remove']) test(`User Provider ${operation} uses read grant plus exact approval, recording a non-replayable receipt`, async () => {
    let writes = 0;
    const content = { module: 'provider-asset', operation: operation === 'update' ? 'update' : 'delete', name: 'user-import', ids: ['user'], baseRevision: 'v1', warnings: [],
        ...(operation === 'update' ? { source: 'export function register(deps){}', previous: { source: 'OLD_SOURCE', ids: ['user'] } } : {}) };
    const providerAssets = { assertDraft() {}, previewUpdate: () => content, previewDelete: () => content,
        install: async () => { writes++; return { status: 'saved_unconfirmed', registered: operation === 'update', persistence: 'unconfirmed' }; } };
    const args = { name: 'user-import', revision: 'v1', ...(operation === 'update' ? { source: content.source, ids: content.ids } : {}) };
    const f = fixture([[tool(`muyu.provider.${operation}_preview`, args), done], [text('Draft only'), done]], { providerAssets });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Preview user asset change'); f.controller.send(); await settle();
    const request = f.controller.snapshot().interaction;
    assert.equal(request.source, 'providerAssets'); assert.equal(writes, 0);
    f.controller.answerPermission(request.id, 'task'); await settle();
    const artifact = f.controller.snapshot().artifacts.find(row => row.kind === 'provider-draft'); assert.ok(artifact);
    assert.equal(writes, 0); const approval = f.controller.prepareProviderInstall(artifact.id, artifact.revision);
    const result = await f.controller.approveProviderInstall(approval.id);
    assert.equal(result.status, 'saved_unconfirmed'); assert.equal(writes, 1);
    const receipt = JSON.parse(f.controller.exportHistory()).receipts.find(row => row.version === 7);
    assert.equal(receipt.operation, content.operation); assert.doesNotMatch(JSON.stringify(receipt), /OLD_SOURCE|export function/);
    assert.throws(() => f.controller.approveProviderInstall(approval.id), /STALE/); await f.controller.dispose();
});

test('Full access previews are inert unless an explicit user-asset apply flag is present', async () => {
    let writes = 0;
    const providerAssets = { assertDraft() {}, previewDelete: () => ({ module: 'provider-asset', operation: 'delete', name: 'user', ids: ['user'], baseRevision: 'v1', warnings: [] }),
        install: async () => { writes++; return { status: 'saved_unconfirmed', registered: false, persistence: 'unconfirmed' }; } };
    const f = fixture([[tool('muyu.provider.remove_preview', { name: 'user', revision: 'v1' }), done], [text('Only preview'), done],
        [tool('muyu.provider.remove_preview', { name: 'user', revision: 'v1', apply: true }), done], [text('Delete requested'), done]], { providerAssets });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setFullAccess(true, { confirmed: true });
    f.controller.setInput('Preview only'); f.controller.send(); await settle(); assert.equal(writes, 0);
    f.controller.setInput('Delete now'); f.controller.send(); await settle(); assert.equal(writes, 1);
    assert.equal(f.controller.snapshot().receipts.at(-1).operation, 'delete'); await f.controller.dispose();
});

test('A delete preview supersedes a prior replacement candidate without publishing stale code', async () => {
    const base = { module: 'provider-asset', name: 'user', ids: ['user'], baseRevision: 'v1', warnings: [] };
    const providerAssets = { assertDraft() {}, previewUpdate: () => ({ ...base, operation: 'update', source: 'export function register(deps){}', previous: { source: 'old', ids: ['user'] } }),
        previewDelete: () => ({ ...base, operation: 'delete' }) };
    const f = fixture([[tool('muyu.provider.update_preview', { name: 'user', revision: 'v1', source: 'export function register(deps){}', ids: ['user'] }, 'replace'), done],
        [tool('muyu.provider.remove_preview', { name: 'user', revision: 'v1' }, 'delete'), done], [text('Latest draft only'), done]], { providerAssets });
    await f.enable(); f.controller.setMode('assistant');
    f.controller.setInput('Prepare latest user asset change'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'task'); await settle();
    const state = f.controller.snapshot(), artifacts = state.artifacts.filter(row => row.kind === 'provider-draft');
    assert.equal(artifacts.length, 1); assert.equal(artifacts[0].content.operation, 'delete');
    assert.equal(state.runs.at(-1).status, 'succeeded'); assert.ok(!Object.values(state.notices || {}).includes('RESULT_NEEDS_REVIEW'));
    await f.controller.dispose();
});

test('Provider source access pauses once and resumes the original read after permission', async () => {
    let reads = 0;
    const providerAssets = { list() { reads++; return { items: [{ name: 'asset', revision: 'v1', ids: ['p'] }], nextOffset: -1 }; } };
    const f = fixture([[tool('muyu.provider.assets', {}), done], [text('Listed'), done]], { providerAssets });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('List my saved Providers'); f.controller.send(); await settle();
    const request = f.controller.snapshot().interaction;
    assert.ok(request, JSON.stringify(f.controller.snapshot().runs)); assert.equal(request.source, 'providerAssets'); assert.equal(reads, 0);
    f.controller.answerPermission(request.id, 'task'); await settle();
    assert.equal(reads, 1); assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
    assert.ok(JSON.parse(f.controller.exportHistory()).required.includes('source:providerAssets'));
    await f.controller.dispose();
});

test('Three failed automatic operations pause repeated summaries; manual success resets only that conversation', async () => {
    let saved = { ...CONTEXT_DEFAULTS, inputTokens: 32000, autoSummary: false };
    let hardLimit = false;
    const fail = () => { throw Error('synthetic summary failure'); };
    const f = fixture([[text('seed evidence '.repeat(1000)), done], fail, [text('fallback1'), done], fail, [text('fallback2'), done], fail, [text('fallback3'), done], [text('no further summary'), done], [text('manual summary'), done], [text('merged summary'), done], [text('answer'), done]], {
        contextConfig: { read: () => saved, save: async value => { saved = value; } },
    });
    f.model.inspect = req => ({ estimatedTokens: req.tools.length ? hardLimit ? 40000 : 27000 : 100, requestBytes: 100, messageBytes: 100, toolDefinitionBytes: 0, toolResultBytes: 0, reasoningBytes: 0 });
    await f.enable(); f.controller.setMode('assistant'); await seedTurns(f, 1);
    await f.controller.saveContextConfig({ ...saved, autoSummary: true });
    for (let i = 1; i <= 3; i++) {
        f.controller.setInput('Continue ' + i); f.controller.send(); await settle();
        assert.deepEqual(f.controller.snapshot().autoCompaction, { failures: i, blocked: i === 3 });
    }
    const before = f.model.requests.length;
    f.controller.setInput('Continue without another doomed summary'); f.controller.send(); await settle();
    assert.equal(f.model.requests.length, before + 1); assert.equal(f.controller.snapshot().autoCompaction.blocked, true);
    await f.controller.compactHistory(); assert.equal(f.controller.snapshot().autoCompaction.failures, 0);
    // A committed partial summary is progress even if the full answer envelope
    // still cannot fit. Do not falsely trip the breaker on that operation.
    hardLimit = true;
    f.controller.setInput('Continue after manual recovery'); f.controller.send(); await settle();
    assert.equal(f.controller.snapshot().context.summary, 'merged summary'); assert.equal(f.controller.snapshot().autoCompaction.failures, 0);
    assert.equal(f.controller.snapshot().runs.at(-1).process.error, 'CONTEXT_INCOMPLETE');
    await f.controller.dispose();
});

for (const historyAuthorization of ['auto', 'ask']) test(`BUG-CTX-1: ${historyAuthorization} history transport permits summary after task read grants expire`, async () => {
    let reads = 0;
    const f = fixture([[readSource('variables'), done], [text('SAVED_EVIDENCE'), done], [text('summary reference'), done],
        [readSource('variables'), done], [text('read denied'), done]], {
        contextConfig: { read: () => ({ ...CONTEXT_DEFAULTS, historyAuthorization }) },
        providerPort: { read: () => { reads++; return { text: 'Synthetic variables', limited: false }; } },
    });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Read variables'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'task'); await settle();
    assert.deepEqual(f.controller.snapshot().sourceGrants, []);
    if (historyAuthorization === 'ask') f.controller.allowHistory();
    await f.controller.compactHistory();
    assert.equal(f.controller.snapshot().context.summary, 'summary reference'); assert.equal(reads, 1);
    assert.deepEqual(f.controller.snapshot().sourceGrants, []);
    f.controller.setInput('Read variables again'); f.controller.send(); await settle();
    assert.equal(f.controller.snapshot().interaction.source, 'variables'); assert.equal(reads, 1);
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'deny'); await settle(); await f.controller.dispose();
});

test('BUG-CTX-1: automatic compaction saves quoted evidence without reviving task read grants', async () => {
    let reads = 0;
    // Seed history with headroom; source/tool catalog growth must not fail a seed request.
    let savedContext = { ...CONTEXT_DEFAULTS, inputTokens: 80000, autoSummary: false };
    const answer = () => [...Array.from({ length: 4 }, () => text('OLD_EVIDENCE'.repeat(375))), done];
    const f = fixture([[readSource('variables'), done], answer(), answer(), answer(), answer(), [text('summary reference'), done], [text('final answer'), done]], {
        contextConfig: { read: () => savedContext, save: async value => { savedContext = value; } },
        providerPort: { read: () => { reads++; return { text: 'Synthetic variables', limited: false }; } },
    });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Read variables'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'task'); await settle();
    for (let i = 0; i < 3; i++) {
        f.controller.setInput('Continue ' + i); f.controller.send(); await settle();
        assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
    }
    await f.controller.saveContextConfig({ ...savedContext, inputTokens: 40000, autoSummary: true });
    f.controller.setInput('Summarize and continue'); f.controller.send(); await settle();
    assert.equal(f.controller.snapshot().context.summary, 'summary reference');
    assert.deepEqual(f.model.requests[5].tools, []); assert.equal(reads, 1);
    assert.deepEqual(f.controller.snapshot().sourceGrants, []); await f.controller.dispose();
});

test('BUG-CTX-1: changing history transport policy invalidates an in-flight summary even if restored', async () => {
    const gate = deferred(); let saved = { ...CONTEXT_DEFAULTS };
    const f = fixture([[text('answer'), done], () => gate.promise], {
        contextConfig: { read: () => saved, save: async value => { saved = structuredClone(value); } },
    });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('question'); f.controller.send(); await settle();
    const pending = f.controller.compactHistory(), rejected = assert.rejects(pending);
    await settle();
    await f.controller.saveContextConfig({ ...saved, historyAuthorization: 'ask' });
    await f.controller.saveContextConfig({ ...saved, historyAuthorization: 'auto' });
    gate.resolve([text('obsolete summary'), done]); await rejected;
    assert.equal(f.controller.snapshot().context.summary, ''); await f.controller.dispose();
});

test('Automatic history carries quoted evidence without new host grants; approval and omission remain explicit', async () => {
    let reads = 0, saved = { ...CONTEXT_DEFAULTS };
    const f = fixture([[readSource('variables'), done], [text('SAVED_VARIABLE_EVIDENCE'), done],
        [readSource('variables'), done], [text('denied fresh read'), done], [text('reconnected'), done], [text('without old history'), done]],
        { contextConfig: { read: () => saved, save: async value => { saved = structuredClone(value); } },
            providerPort: { read: () => { reads++; return { text: 'Synthetic variables', limited: false }; } } });
    await f.enable(); f.controller.setMode('assistant');
    f.controller.setInput('Read variables'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'task'); await settle();
    assert.deepEqual(f.controller.snapshot().history.missingPermissions, []);
    assert.deepEqual(f.controller.snapshot().sourceGrants, []);
    f.controller.setInput('Read again'); f.controller.send(); await settle();
    assert.match(JSON.stringify(f.model.requests.at(-1)), /SAVED_VARIABLE_EVIDENCE/);
    assert.equal(f.controller.snapshot().interaction.source, 'variables'); assert.equal(reads, 1);
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'deny'); await settle();
    const id = f.controller.snapshot().history.sessionId;
    await f.enable(); await f.controller.openSession(id);
    assert.deepEqual(f.controller.snapshot().history.missingPermissions, []);
    f.controller.setInput('Continue'); f.controller.send(); await settle();
    assert.match(JSON.stringify(f.model.requests.at(-1)), /SAVED_VARIABLE_EVIDENCE/);
    await f.controller.saveContextConfig({ ...saved, historyAuthorization: 'ask' });
    assert.deepEqual(f.controller.snapshot().history.missingPermissions, ['source:variables']);
    f.controller.setInput('Keep this draft'); assert.throws(() => f.controller.send(), /HISTORY_PERMISSION_REQUIRED/);
    assert.equal(f.controller.snapshot().input, 'Keep this draft');
    await f.controller.saveContextConfig({ ...saved, historyAuthorization: 'auto' });
    f.controller.setOmitHistory(true); f.controller.send(); await settle();
    assert.doesNotMatch(JSON.stringify(f.model.requests.at(-1)), /SAVED_VARIABLE_EVIDENCE/);
    assert.equal(reads, 1); await f.controller.dispose();
});

test('History approval preserves follow-up context without granting new host reads, and resets on reconnect', async () => {
    const f = fixture([[readSource('variables'), done], [text('SAVED_VARIABLE_EVIDENCE'), done],
        [readSource('variables'), done], [text('fresh read'), done]],
        { providerPort: { read: () => ({ text: 'Synthetic variables', limited: false }) } });
    await f.enable(); f.controller.setMode('assistant');
    f.controller.setInput('Read variables'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'task'); await settle();
    f.controller.setInput('Read them again');
    const calls = f.model.requests.length;
    assert.throws(() => f.controller.send(), /HISTORY_PERMISSION_REQUIRED/);
    assert.equal(f.model.requests.length, calls); assert.equal(f.controller.snapshot().input, 'Read them again');
    assert.equal(f.controller.snapshot().context.permissionOmitted, false);
    f.controller.allowHistory();
    assert.deepEqual(f.controller.snapshot().history.missingPermissions, []);
    assert.deepEqual(f.controller.snapshot().sourceGrants, []);
    f.controller.send(); await settle();
    assert.match(JSON.stringify(f.model.requests.at(-1)), /SAVED_VARIABLE_EVIDENCE/);
    assert.equal(f.controller.snapshot().interaction.source, 'variables');
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'task'); await settle();
    const id = f.controller.snapshot().history.sessionId;
    await f.enable(); await f.controller.openSession(id);
    assert.deepEqual(f.controller.snapshot().history.missingPermissions, ['source:variables']);
    await f.controller.dispose();
});

test('Budget failure releases sending; raising output/data budgets does not grant protected history', async () => {
    const f = fixture([[readSource('variables'), done], () => { throw new ExecutionError('CONTEXT_LIMIT'); }, [text('recovered'), done]],
        { providerPort: { read: () => ({ text: 'variables', limited: false }) } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Inspect variables'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'task'); await settle();
    assert.equal(f.controller.snapshot().notice, 'CONTEXT_LIMIT'); assert.equal(f.controller.snapshot().busy, false);
    await f.controller.saveRunConfig({ ...RUN_DEFAULTS, maxTokens: 32768, providerBytes: 50000 });
    f.controller.setInput('Continue'); assert.throws(() => f.controller.send(), /HISTORY_PERMISSION_REQUIRED/);
    f.controller.allowHistory(); f.controller.send(); await settle();
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
    assert.equal(f.model.requests.at(-1).maxTokens, 32768);
    await f.controller.dispose();
});

test('Failed question restores only its text and does not replay a model or tool', async () => {
    const f = fixture([() => { throw Error('Synthetic network failure'); }]);
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Original question'); f.controller.send(); await settle();
    const before = f.controller.snapshot();
    assert.equal(before.runs.at(-1).status, 'failed'); assert.equal(before.recovery.possibleEffects, false);
    assert.equal(before.input, ''); assert.equal(f.model.requests.length, 1);
    f.controller.setInput('A newer unsent draft');
    assert.throws(() => f.controller.restoreFailedInput(before.recovery.runId), /DRAFT_EXISTS/);
    f.controller.setInput(''); f.controller.restoreFailedInput(before.recovery.runId);
    assert.equal(f.controller.snapshot().input, 'Original question'); assert.equal(f.model.requests.length, 1);
    f.switchChat('B'); assert.equal(f.controller.snapshot().recovery, null);
    await f.controller.dispose();
});

test('Repeated independent failures remain recoverable after persistence and reload', async () => {
    const store = createMemoryHistoryStore(), history = { enabled: () => true, open: async () => store, setEnabled: async () => {} };
    const fail = () => { throw new ExecutionError('MODEL_NETWORK_ERROR'); };
    const f = fixture([fail, fail], { history }); await f.controller.ready; await f.enable(); f.controller.setMode('assistant');
    f.controller.setInput('Original question'); f.controller.send(); await settle();
    f.controller.restoreFailedInput(f.controller.snapshot().recovery.runId); f.controller.send(); await settle();
    const state = f.controller.snapshot(), id = state.history.sessionId;
    assert.notEqual(state.runs[0].taskId, state.runs[1].taskId);
    assert.equal(state.recovery.runId, state.runs[1].id);
    await f.controller.flushHistory(); await f.controller.dispose();
    const restored = fixture([], { history }); await restored.controller.ready; await restored.enable(); restored.controller.setMode('assistant');
    await restored.controller.openSession(id);
    restored.controller.restoreFailedInput(restored.controller.snapshot().recovery.runId);
    assert.equal(restored.controller.snapshot().input, 'Original question'); assert.equal(restored.model.requests.length, 0);
    await restored.controller.dispose();
});

test('Failed permission and clarification continuations never offer their replies as original questions', async () => {
    for (const permission of [true, false]) {
        const store = createMemoryHistoryStore(), history = { enabled: () => true, open: async () => store, setEnabled: async () => {} };
        const start = permission ? readSource() : ask();
        const f = fixture([[start, done], () => { throw new ExecutionError('MODEL_NETWORK_ERROR'); }], { history, providerPort: { read: () => ({ text: 'Protected source', limited: false }) } });
        await f.controller.ready; await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Original goal'); f.controller.send(); await settle();
        const interaction = f.controller.snapshot().interaction;
        if (permission) f.controller.answerPermission(interaction.id, 'task');
        else { f.controller.setInteractionDraft(interaction.id, 'Frequency'); f.controller.answerInteraction(interaction.id); }
        await settle();
        const state = f.controller.snapshot(), id = state.history.sessionId;
        assert.equal(state.runs.at(-1).status, 'failed'); assert.equal(state.recovery, null);
        await f.controller.flushHistory(); await f.controller.dispose();
        const restored = fixture([], { history }); await restored.controller.ready; await restored.enable(); restored.controller.setMode('assistant'); await restored.controller.openSession(id);
        assert.equal(restored.controller.snapshot().recovery, null); await restored.controller.dispose();
    }
});

test('Original-history reads stay in the active session and cannot undo an omitted-history choice', async () => {
    const readAttempt = tool('muyu.history.read', { index: 1, fingerprint: 'placeholder', start: 0 });
    const omittedAttempt = tool('muyu.history.read', { index: 1, fingerprint: 'placeholder', start: 0 }, 'omitted');
    const f = fixture([[text('PRIVATE_HISTORY_MARKER'), done], [text('second answer'), done], [tool('muyu.history.list', { offset: 0 }), done],
        [text('listed'), done], [readAttempt, done], [text('read'), done], [omittedAttempt, done], [text('denied'), done]],
    // Leave room for stable instructions; this test concerns history authorization, not the exact instruction size.
    { contextConfig: { read: () => ({ inputTokens: 50000, recentTurns: 1, autoSummary: false }) } });
    await f.enable(); f.controller.setMode('assistant');
    f.controller.setInput('First question'); f.controller.send(); await settle();
    const original = JSON.parse(f.controller.exportHistory()).messages[1];
    readAttempt.call.args.fingerprint = fingerprint(original);
    omittedAttempt.call.args.fingerprint = fingerprint(original);
    f.controller.setInput('Second question'); f.controller.send(); await settle();
    f.controller.setInput('List the original messages'); f.controller.send(); await settle();
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded', JSON.stringify(f.controller.snapshot().runs.at(-1).process));
    assert.match(JSON.stringify(f.model.requests[3]), /fingerprint/);
    f.controller.setInput('Read the original answer'); f.controller.send(); await settle();
    assert.match(JSON.stringify(f.model.requests.at(-1)), /PRIVATE_HISTORY_MARKER/);
    f.controller.setOmitHistory(true);
    f.controller.setInput('Try reading omitted history'); f.controller.send(); await settle();
    assert.match(JSON.stringify(f.model.requests.at(-1)), /PERMISSION_DENIED/);
    assert.doesNotMatch(JSON.stringify(f.model.requests.at(-1)), /PRIVATE_HISTORY_MARKER/);
    await f.controller.dispose();
});

test('A summarized detail is found and read from original history; omission blocks the same search', async () => {
    const body = '预算最新更正为 4200，截止日期是 11月23日。' + '旧讨论正文。'.repeat(300);
    const read = tool('muyu.history.read', { index: 1, fingerprint: 'placeholder', start: 0 }, 'original');
    const search = () => tool('muyu.history.search', { query: '4200', offset: 0, start: 0 });
    const f = fixture([[text(body), done], [text('讨论过预算与日期，细节请查原文。'), done],
        [search(), done], [read, done], [text('旧约定：4200，11月23日；不是当前酒馆配置。'), done],
        [search(), done], [text('未读取被排除的历史。'), done]]);
    await f.enable(); f.controller.setMode('assistant');
    f.controller.setInput('记住这份约定'); f.controller.send(); await settle();
    read.call.args.fingerprint = fingerprint(JSON.parse(f.controller.exportHistory()).messages[1]);
    await f.controller.compactHistory();
    assert.doesNotMatch(f.controller.snapshot().context.summary, /4200|11月23日/);
    f.controller.setInput('之前约定的预算和日期是什么？'); f.controller.send(); await settle();
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
    const searchResult = f.model.requests[3].messages.filter(row => row.role === 'tool').at(-1);
    assert.match(JSON.stringify(searchResult), /4200/); assert.match(JSON.stringify(searchResult), /fingerprint/);
    const readResult = f.model.requests[4].messages.filter(row => row.role === 'tool').at(-1);
    assert.match(JSON.stringify(readResult), /11月23日/);
    assert.equal(f.controller.snapshot().configActions.length, 0);
    f.controller.setOmitHistory(true); f.controller.setInput('本次不要携带历史'); f.controller.send(); await settle();
    const blocked = JSON.stringify(f.model.requests.at(-1));
    assert.match(blocked, /PERMISSION_DENIED/); assert.doesNotMatch(blocked, /11月23日|旧讨论正文/);
    await f.controller.dispose();
});

test('Generated config profile needs one UI approval, records a save-only receipt and leaves active settings alone', async () => {
    const profileSettings = { mode: 'off', topN: 1, configProfiles: [] }; let saves = 0;
    const profileWriter = createProfileWriter({ getSettings: () => profileSettings, saveSettings: async () => { saves++; return { confirmed: true }; }, getDrawerKeys: () => ({}) });
    const args = { name: 'Two speakers', description: 'For group pacing', settingsJson: '{"mode":"formula","topN":2}' };
    const f = fixture([[tool('muyu.profile.preview', args), done], [text('Profile preview ready'), done]], { profileWriter });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Create a reusable profile; preview first'); f.controller.send(); await settle();
    const draft = f.controller.snapshot().artifacts.find(a => a.kind === 'profile-draft');
    assert.ok(draft); assert.equal(saves, 0); assert.equal(profileSettings.configProfiles.length, 0);
    assert.equal(f.controller.revalidate(draft.id, draft.revision).validation.writes, 'profile-save-only');
    const action = f.controller.prepareProfileSave(draft.id, draft.revision);
    assert.equal(saves, 0);
    await f.controller.approveProfileSave(action.id);
    assert.equal(saves, 1); assert.equal(profileSettings.mode, 'off'); assert.equal(profileSettings.topN, 1);
    assert.deepEqual(profileSettings.configProfiles[0].settings, { mode: 'formula', topN: 2 });
    const receipt = f.controller.snapshot().receipts.find(r => r.operationId === action.id);
    assert.equal(receipt.version, 5); assert.equal(receipt.status, 'saved_confirmed'); assert.equal(receipt.persistence, 'confirmed');
    assert.throws(() => f.controller.approveProfileSave(action.id), /ACTION_STALE/);
    await f.controller.dispose();
});

test('Full access saves an explicitly requested profile, but never auto-saves a preview-only profile', async () => {
    const profileSettings = { configProfiles: [] }; let saves = 0;
    const profileWriter = createProfileWriter({ getSettings: () => profileSettings, saveSettings: async () => { saves++; return { confirmed: true }; }, getDrawerKeys: () => ({}) });
    const f = fixture([[tool('muyu.profile.preview', { name: 'Preview', settingsJson: '{"topN":2}' }), done], [text('Preview only'), done],
        [tool('muyu.profile.preview', { name: 'Saved', settingsJson: '{"topN":3}', save: true }), done], [text('Save requested'), done]], { profileWriter });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setFullAccess(true);
    f.controller.setInput('Preview a reusable profile only'); f.controller.send(); await settle();
    assert.equal(saves, 0); assert.equal(f.controller.snapshot().profileActions.length, 0);
    f.controller.setInput('Create and save another profile'); f.controller.send(); await settle();
    assert.equal(saves, 1); assert.deepEqual(profileSettings.configProfiles.map(p => p.name), ['Saved']);
    await f.controller.dispose();
});

test('Two profile previews in one run publish independently and save only requested candidates', async () => {
    for (const saveA of [false, true]) {
        const profileSettings = { configProfiles: [] };
        const profileWriter = createProfileWriter({ getSettings: () => profileSettings, saveSettings: async () => ({ confirmed: true }), getDrawerKeys: () => ({}) });
        const f = fixture([[tool('muyu.profile.preview', { name: 'A', settingsJson: '{"topN":2}', save: saveA }, 'profile-a'),
            tool('muyu.profile.preview', { name: 'B', settingsJson: '{"topN":3}', save: true }, 'profile-b'), done], [text('Both profiles ready'), done]], { profileWriter });
        await f.enable(); f.controller.setMode('assistant'); f.controller.setFullAccess(true);
        f.controller.setInput('Prepare two separate profiles'); f.controller.send(); await settle();
        const state = f.controller.snapshot(), drafts = state.artifacts.filter(a => a.kind === 'profile-draft');
        assert.deepEqual(drafts.map(a => [a.content.name, a.content.settings.topN]), [['A', 2], ['B', 3]]);
        assert.deepEqual(profileSettings.configProfiles.map(p => [p.name, p.settings.topN]), saveA ? [['A', 2], ['B', 3]] : [['B', 3]]);
        assert.equal(state.notice, null);
        await f.controller.dispose();
    }
});

test('Profile previews on either side of a permission handoff both remain publishable', async () => {
    const f = fixture([[tool('muyu.profile.preview', { name: 'A', settingsJson: '{"topN":2}' }, 'profile-a'),
        tool('muyu.settings.read', { fields: ['topN'] }, 'read-top-n'), done],
    [tool('muyu.profile.preview', { name: 'B', settingsJson: '{"topN":3}' }, 'profile-b'), done], [text('Ready'), done]]);
    await f.enable(); f.controller.setMode('assistant');
    f.controller.setInput('Prepare two profiles and inspect topN'); f.controller.send(); await settle();
    const request = f.controller.snapshot().interaction;
    assert.equal(request?.kind, 'permission');
    f.controller.answerPermission(request.id, 'task'); await settle();
    const state = f.controller.snapshot();
    assert.deepEqual(state.artifacts.filter(a => a.kind === 'profile-draft').map(a => [a.content.name, a.content.settings.topN]), [['A', 2], ['B', 3]]);
    assert.equal(state.notice, null);
    await f.controller.dispose();
});

test('A profile tool cannot request direct saving outside full-access mode', async () => {
    const profileSettings = { configProfiles: [] }; let saves = 0;
    const profileWriter = createProfileWriter({ getSettings: () => profileSettings, saveSettings: async () => { saves++; return { confirmed: true }; }, getDrawerKeys: () => ({}) });
    const f = fixture([[tool('muyu.profile.preview', { name: 'Denied', settingsJson: '{"topN":2}', save: true }), done], [text('No direct save'), done]], { profileWriter });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Save directly'); f.controller.send(); await settle();
    assert.equal(saves, 0); assert.equal(profileSettings.configProfiles.length, 0);
    assert.equal(f.controller.snapshot().artifacts.some(a => a.kind === 'profile-draft'), false);
    await f.controller.dispose();
});

for (const field of ['customPromptsEnabled', 'profileLibraryAutoLoad.enabled']) for (const mode of ['full', 'preview', 'normal']) test(`Business settings ${field} ${mode} save through controller`, async () => {
    const { createSettingsSwitchPort } = await import('../../muyu/host/settings-switches.js');
    const { createCustomPromptsSystem } = await import('../../systems/custom-prompts-system.js');
    const { createProfileLibrarySystem } = await import('../../systems/profile-library-system.js');
    const { DEFAULT_SETTINGS } = await import('../../settings.js');
    let writer, saves = 0; const providers = new Map(), apply = mode === 'full';
    const f = fixture([[tool('muyu.settings.preview', { changes: { [field]: true }, ...(apply ? { apply: true } : {}) }), done], [text('Result'), done]],
        { configWriter: { apply: request => writer.apply(request) } });
    Object.assign(f.settings, { customPromptsEnabled: false, customPrompts: [{ id: 'p', name: 'test_prompt', content: 'text', enabled: true }],
        profileEnabled: true, profileLibraryAutoLoad: structuredClone(DEFAULT_SETTINGS.profileLibraryAutoLoad) });
    const saveSettings = async () => { saves++; };
    const customPromptsSystem = createCustomPromptsSystem({ settings: f.settings, saveSettings, registerProvider: p => providers.set(p.id, p),
        unregisterProvider: id => providers.delete(id), getProviders: () => [...providers.values()], log() {} });
    const profileLibrarySystem = createProfileLibrarySystem({ settings: f.settings, extension_settings: {}, EXT_KEY: 'gd', saveSettings });
    writer = createConfigWriter({ getSettings: () => f.settings, saveSettings: async () => { throw Error('must use business save'); }, isBusy: () => false,
        settingsSwitchPort: createSettingsSwitchPort({ customPromptsSystem, profileLibrarySystem }) });
    await f.enable(); f.controller.setMode('assistant'); if (mode !== 'normal') f.controller.setFullAccess(true);
    f.controller.setInput(mode === 'preview' ? '只预览，不应用' : '打开所选开关'); f.controller.send(); await settle();
    if (mode === 'normal') {
        const request = f.controller.snapshot().interaction; assert.equal(request.source, 'configSettings');
        f.controller.answerPermission(request.id, 'task'); await settle(); assert.equal(saves, 0);
        const draft = f.controller.snapshot().artifacts.find(a => a.kind === 'config-draft');
        const pending = f.controller.prepareConfigApply(draft.id, draft.revision);
        await f.controller.approveConfigApply(pending.id); await settle();
    }
    assert.equal(saves, mode === 'preview' ? 0 : 1);
    assert.equal(field === 'customPromptsEnabled' ? f.settings.customPromptsEnabled : f.settings.profileLibraryAutoLoad.enabled, mode !== 'preview');
    if (field === 'customPromptsEnabled') assert.equal(providers.has('test_prompt'), mode !== 'preview');
    await f.controller.dispose();
});

for (const mode of ['full', 'preview', 'normal']) test(`Blueprint toggle ${mode} through controller and historical receipt`, async () => {
    const apply = mode === 'full', writes = mode !== 'preview';
    const { createStoryBlueprintTogglePort } = await import('../../muyu/host/story-blueprint-toggle.js');
    let f, saves = 0, chatSaves = 0;
    const blueprintTogglePort = createStoryBlueprintTogglePort({ getTarget: () => f.host.currentTarget(), getMetadata: () => f.ctx.chatMetadata,
        getSettings: () => f.settings, extensionKey: 'gd', saveChatConfirmed: async () => { chatSaves++; } });
    const configWriter = createConfigWriter({ getSettings: () => f.settings, isBusy: () => false, blueprintTogglePort,
        saveSettings: async () => { saves++; return { confirmed: true }; } });
    f = fixture([[tool('muyu.settings.preview', { changes: { storyBlueprintEnabled: true }, ...(apply ? { apply: true } : {}) }), done], [text('Result'), done]], { blueprintTogglePort, configWriter });
    Object.assign(f.settings, { storyBlueprintEnabled: false, storyBlueprintCompletionVariable: 'done', storyBlueprintAutoContinue: false });
    await f.enable(); f.controller.setMode('assistant'); if (mode !== 'normal') f.controller.setFullAccess(true);
    f.controller.setInput(apply ? '开启故事蓝图' : '预览开启故事蓝图，不应用'); f.controller.send(); await settle();
    if (mode === 'normal') {
        for (let i = 0; i < 2; i++) {
            const interaction = f.controller.snapshot().interaction;
            assert.equal(interaction.kind, 'permission');
            f.controller.answerPermission(interaction.id, 'task'); await settle();
        }
        assert.equal(saves, 0); assert.equal(chatSaves, 0);
        const draft = f.controller.snapshot().artifacts.find(a => a.content.blueprintTogglePlan);
        const pending = f.controller.prepareConfigApply(draft.id, draft.revision);
        assert.equal(saves, 0);
        await f.controller.approveConfigApply(pending.id); await settle();
    }
    assert.equal(f.settings.storyBlueprintEnabled, writes);
    assert.equal(saves, writes ? 1 : 0); assert.equal(chatSaves, writes ? 1 : 0);
    assert.ok(f.controller.snapshot().artifacts.some(a => a.content.blueprintTogglePlan));
    if (writes) {
        const history = JSON.parse(f.controller.exportHistory());
        assert.ok(JSON.stringify(history).includes('blueprintToggle'));
        assert.ok(history.required.includes('source:variables'));
    }
    await f.controller.dispose();
});

for (const apply of [true, false]) test(`General settings full access respects apply=${apply} and retains unsent input`, async () => {
    let saves = 0;
    const f = fixture([[tool('muyu.settings.preview', { changes: { lang: 'en', debugLogging: true }, ...(apply ? { apply: true } : {}) }), done], [text('Result'), done]],
        { bundleSaveSettings: async () => { saves++; } });
    f.settings.lang = 'zh'; f.settings.debugLogging = false;
    await f.enable(); f.controller.setMode('assistant'); f.controller.setFullAccess(true);
    f.controller.setInput(apply ? '修改语言为英文，打开调试日志' : '只预览语言和调试修改'); f.controller.send();
    f.controller.setInput('未发送的下一条消息'); await settle();
    assert.equal(f.settings.lang, apply ? 'en' : 'zh'); assert.equal(f.settings.debugLogging, apply);
    assert.equal(saves, apply ? 1 : 0); assert.equal(f.controller.snapshot().input, '未发送的下一条消息');
    await f.controller.dispose();
});

test('Full access directly grants reads and applies only an explicitly requested preview without approval calls', async () => {
    let saves = 0;
    const f = fixture([[tool('muyu.settings.preview', { changes: { autoMemoryInterval: 15 }, apply: true }), done], [text('等待操作回执'), done]],
        { bundleSaveSettings: async () => { saves++; } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setFullAccess(true);
    f.controller.setInput('把自动记忆间隔改成 15'); f.controller.send(); await settle();
    assert.equal(f.model.requests.length, 2);
    assert.equal(f.controller.snapshot().interaction, null);
    assert.equal(f.settings.autoMemoryInterval, 15, JSON.stringify({ artifacts: f.controller.snapshot().artifacts, actions: f.controller.snapshot().configActions, notice: f.controller.snapshot().notice, process: f.controller.snapshot().runs.at(-1)?.process }));
    assert.equal(saves, 1);
    assert.equal(f.controller.snapshot().configActions.length, 1);
    assert.equal(f.controller.snapshot().configActions[0].status, 'applied_unconfirmed');
    await f.controller.dispose();
});

test('Full access respects preview-only intent and reconnect turns the mode off', async () => {
    let saves = 0;
    const f = fixture([[tool('muyu.settings.preview', { changes: { autoMemoryInterval: 15 } }), done], [text('只预览'), done]],
        { bundleSaveSettings: async () => { saves++; } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setFullAccess(true);
    f.controller.setInput('只预览，不要应用'); f.controller.send(); await settle();
    assert.equal(f.controller.snapshot().artifacts.some(a => a.kind === 'config-draft'), true);
    assert.equal(f.controller.snapshot().configActions.length, 0);
    assert.equal(f.settings.autoMemoryInterval, 10); assert.equal(saves, 0);
    await f.enable(); assert.equal(f.controller.snapshot().fullAccess, false);
    await f.controller.dispose();
});

test('Without full access a model cannot request direct application', async () => {
    let saves = 0;
    const f = fixture([[tool('muyu.settings.preview', { changes: { autoMemoryInterval: 15 }, apply: true }), done], [text('未应用'), done]],
        { bundleSaveSettings: async () => { saves++; } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('修改间隔'); f.controller.send(); await settle();
    assert.equal(f.settings.autoMemoryInterval, 10); assert.equal(saves, 0);
    assert.equal(f.controller.snapshot().configActions.length, 0);
    await f.controller.dispose();
});

test('Full access continues a task plan and executes one bounded bundle without permission handoffs', async () => {
    let chatSaves = 0, settingsSaves = 0;
    const bundle = { variables: [{ action: 'create', id: 'party_gold', label: 'Party gold', initialValue: 0,
        rule: 'Update on explicit transaction', autoUpdate: true, injectMode: 'always', updateMode: 'delta' }],
    settingsJson: '{"memoryEnabled":false}', apply: true };
    const f = fixture([[taskPlan(), done], [tool('muyu.task.preview', bundle), done], [text('等待操作回执'), done]],
        { variableSaveConfirmed: async () => { chatSaves++; }, bundleSaveSettings: async () => { settingsSaves++; return { confirmed: true }; } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setFullAccess(true);
    f.controller.setInput('建立金币系统并启用'); f.controller.send(); await settle();
    assert.equal(f.controller.snapshot().interaction, null);
    assert.equal(f.controller.snapshot().approvedPlans.length, 1);
    assert.equal(f.controller.snapshot().bundleActions[0]?.status, 'applied_confirmed');
    assert.equal(chatSaves, 1); assert.equal(settingsSaves, 1);
    assert.equal(f.settings.memoryEnabled, false);
    await f.controller.dispose();
});

test('Fixed reply language stays pinned across permission and clarification continuations', async () => {
    for (const permission of [true, false]) for (const initiallyEnabled of [true, false]) {
        const preference = language => ({ enabled: false, text: '', replyLanguage: { enabled: true, language } });
        const initial = { ...preference('French'), replyLanguage: { enabled: initiallyEnabled, language: 'French' } };
        const f = fixture([[permission ? readSource() : ask(), done], [text('Finished'), done], [text('Next'), done]], {
            instructionConfig: { read: () => initial, save: async () => {} },
            providerPort: { read: () => ({ text: 'Protected source', limited: false }) },
        });
        await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Original goal'); f.controller.send(); await settle();
        const interaction = f.controller.snapshot().interaction;
        assert.equal(interaction.status, 'pending');
        const exposed = f.controller.snapshot(); exposed.instructionSettings.saved.replyLanguage.language = 'English';
        assert.equal(f.controller.snapshot().instructionSettings.saved.replyLanguage.language, 'French');
        f.controller.setInstructionDraft(preference('Korean')); await f.controller.saveInstructions();
        if (permission) f.controller.answerPermission(interaction.id, 'chat');
        else { f.controller.setInteractionDraft(interaction.id, 'Frequency'); f.controller.answerInteraction(interaction.id); }
        await settle();
        assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
        assert.deepEqual(f.model.requests.map(request => request.instructions.responseLanguage), f.model.requests.map(() => initiallyEnabled ? 'French' : undefined), `permission=${permission}, enabled=${initiallyEnabled}`);
        f.controller.setInput('Next question'); f.controller.send(); await settle();
        assert.equal(f.model.requests.at(-1).instructions.responseLanguage, 'Korean');
        await f.controller.dispose();
    }
});

test('Plan approval keeps its originating fixed language after a preference save', async () => {
    const preference = language => ({ enabled: false, text: '', replyLanguage: { enabled: true, language } });
    const f = fixture([[taskPlan(), done], [text('Read-only analysis'), done]], { instructionConfig: { read: () => preference('French'), save: async () => {} } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Plan first'); f.controller.send(); await settle();
    const plan = f.controller.snapshot().artifacts.find(a => a.kind === 'task-plan');
    assert.ok(plan);
    f.controller.setInstructionDraft(preference('Korean')); await f.controller.saveInstructions();
    f.controller.approveTaskPlanReads(plan.id, plan.revision); await settle();
    assert.equal(f.model.requests.at(-1).instructions.responseLanguage, 'French');
    await f.controller.dispose();
});

test('Instruction edits are draft-only, pinned at send time and not duplicated into task/user/history data', async () => {
    const gate = deferred(), saved = [];
    const f = fixture([() => gate.promise, [text('next'), done]], { instructionConfig: { read: () => ({ enabled: false, text: '' }), save: async value => saved.push(value) } });
    await f.enable(); f.controller.setInstructionDraft({ enabled: true, text: 'FIRST_STYLE' }); await f.controller.saveInstructions();
    f.controller.setInput('question'); f.controller.send({ consent: true }); await settle();
    f.controller.setInstructionDraft({ enabled: true, text: 'NEXT_STYLE' }); await f.controller.saveInstructions();
    assert.equal(f.model.requests[0].instructions.preference, 'FIRST_STYLE');
    assert.equal(f.model.requests[0].messages.filter(m => m.content === 'question').length, 1);
    assert.equal(f.model.requests[0].messages.some(m => m.content?.startsWith('Task context supplied')), false);
    gate.resolve([text('answer'), done]); await settle(); f.controller.setInput('follow up'); f.controller.send(); await settle();
    assert.equal(f.model.requests[1].instructions.preference, 'NEXT_STYLE');
    assert.doesNotMatch(f.controller.exportHistory(), /FIRST_STYLE|NEXT_STYLE/); assert.doesNotMatch(JSON.stringify(f.controller.snapshot().runs), /FIRST_STYLE|NEXT_STYLE/);
    assert.equal(saved.length, 2); await f.controller.dispose();
});

test('Instruction drafts survive chat/reconnect, failed saves and newer edits during an awaited save', async () => {
    let fail = true; const gate = deferred();
    const f = fixture([], { instructionConfig: { read: () => ({ enabled: false, text: 'saved' }), save: async () => { if (fail) throw Error('INSTRUCTION_CONFIG_SAVE_FAILED'); await gate.promise; } } });
    f.controller.setInstructionDraft({ enabled: true, text: 'draft' });
    await assert.rejects(f.controller.saveInstructions(), /INSTRUCTION_CONFIG_SAVE_FAILED/); assert.equal(f.controller.snapshot().instructionSettings.saved.text, 'saved');
    f.switchChat('B'); await f.enable(); assert.equal(f.controller.snapshot().instructionSettings.draft.text, 'draft');
    fail = false; const saving = f.controller.saveInstructions(); f.controller.setInstructionDraft({ enabled: true, text: 'newer draft' }); gate.resolve(); await saving;
    assert.equal(f.controller.snapshot().instructionSettings.saved.text, 'draft'); assert.equal(f.controller.snapshot().instructionSettings.draft.text, 'newer draft');
    f.controller.discardInstructionDraft(); assert.equal(f.controller.snapshot().instructionSettings.draft.text, 'draft');
    f.controller.resetInstructionDraft(); assert.equal(f.controller.snapshot().instructionSettings.saved.text, 'draft'); assert.equal(f.controller.snapshot().instructionSettings.draft.enabled, false);
    await f.controller.dispose();
});

async function seedTurns(f, count = 4) {
    for (let i = 0; i < count; i++) { f.controller.setInput('question ' + i); f.controller.send({ consent: true }); await settle(); }
}

test('Near-full summarized archive rejects a large question before queue/model calls and preserves the draft', async () => {
    const store = createMemoryHistoryStore();
    const f = fixture([[text('must not run'), done]], { history: { enabled: () => true, open: async () => store, setEnabled: async () => {} } });
    await f.controller.ready;
    const record = { version: 7, id: crypto.randomUUID(), revision: 0, scope: historyScope('assistant', f.host.currentTarget()), title: 'large fixture', createdAt: 1, updatedAt: 1, messages: [], required: [], status: 'succeeded', archived: false, imported: false, receipts: [], scopeChanges: [], contextSummary: null };
    for (let i = 0; i < 32; i++) record.messages.push({ role: i % 2 ? 'assistant' : 'user', runId: String(i), content: 'x'.repeat(1024 * 1024 - 10000) });
    record.contextSummary = { through: 32, fingerprint: fingerprint(record.messages), text: 'Synthetic summary.', createdAt: 1 };
    record.messages[31].content += 'x'.repeat(HISTORY_LIMITS.recordBytes - 210000 - historyBytes(record));
    record.contextSummary.fingerprint = fingerprint(record.messages);
    await store.create(record); await f.controller.refreshHistory(); await f.enable(); f.controller.setMode('assistant'); await f.controller.openSession(record.id);
    const input = 'question ' + 'b'.repeat(150000); f.controller.setInput(input);
    assert.throws(() => f.controller.send(), /HISTORY_CAPACITY/); await settle();
    assert.equal(f.model.requests.length, 0); assert.equal(f.controller.snapshot().runs.length, 0);
    assert.equal(f.controller.snapshot().input, input);
    assert.equal(JSON.parse(f.controller.exportHistory()).messages.length, 32);
    await f.controller.dispose();
});

test('Account archive rejects an unsavable question before model calls and preserves the composer', async () => {
    const settings = {}, store = openSettingsHistoryStore({ namespace: crypto.randomUUID(), getSettings: () => settings, saveSettings: async () => {} });
    const f = fixture([[text('must not run'), done]], { history: { enabled: () => true, open: async () => store, setEnabled: async () => {} } });
    try {
        await f.controller.ready;
        const record = { version: 7, id: crypto.randomUUID(), revision: 0, scope: historyScope('assistant', f.host.currentTarget()), title: 'account fixture', createdAt: 1, updatedAt: 1,
            messages: Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', runId: String(i >> 1), content: 'x'.repeat(1024 * 1024 - 1000) })),
            required: [], status: 'succeeded', archived: false, imported: false, receipts: [], scopeChanges: [], contextSummary: null };
        await store.create(record); await f.controller.refreshHistory(); await f.enable(); f.controller.setMode('assistant'); await f.controller.openSession(record.id);
        const input = 'question ' + '中'.repeat(20000); f.controller.setInput(input);
        assert.throws(() => f.controller.send(), /HISTORY_CAPACITY/); await settle();
        assert.equal(f.model.requests.length, 0); assert.equal(f.controller.snapshot().runs.length, 0); assert.equal(f.controller.snapshot().input, input);
        assert.equal(JSON.parse(f.controller.exportHistory()).messages.length, 8); assert.equal((await store.read(record.id)).messages.length, 8);
    } finally { await f.controller.dispose(); }
});

test('Unexpected capacity failure during final capture is visible, exportable and does not break disposal', async () => {
    const wait = deferred(), f = fixture([() => wait.promise]); await f.enable(); f.controller.setMode('assistant');
    f.controller.setInput('question'); f.controller.send(); await settle();
    const clone = globalThis.structuredClone; let injected = false;
    globalThis.structuredClone = value => {
        if (!injected && value?.version >= 5 && value.status === 'succeeded' && value.messages?.at(-1)?.content === 'RECOVERY_ANSWER') {
            injected = true; throw Error('HISTORY_CAPACITY');
        }
        return clone(value);
    };
    try { wait.resolve([text('RECOVERY_ANSWER'), done]); await settle(); }
    finally { globalThis.structuredClone = clone; }
    assert.equal(injected, true); const s = f.controller.snapshot();
    assert.equal(s.runs.at(-1).status, 'succeeded'); assert.equal(s.notice, 'HISTORY_SYNC_FAILED');
    assert.equal(s.history.error, 'HISTORY_CAPACITY'); assert.equal(s.history.recovery, true);
    assert.equal(JSON.parse(f.controller.exportHistory()).messages.at(-1).content, 'RECOVERY_ANSWER');
    await f.controller.dispose();
});

test('Manual compaction rejects a switched chat before any paid call and succeeds again in the original chat', async () => {
    const f = fixture([[text('a'.repeat(2000)), done], [text('Valid short summary.'), done]]);
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('story'); f.controller.send(); await settle();
    f.switchChat('B'); assert.equal(f.controller.snapshot().switchedChat, true);
    assert.equal(f.controller.snapshot().readOnly, false);
    await assert.rejects(f.controller.compactHistory(), /HISTORY_SCOPE/);
    assert.equal(f.model.requests.length, 1); assert.equal(f.controller.snapshot().context.summary, '');
    f.switchChat('A'); await f.controller.compactHistory();
    assert.equal(f.model.requests.length, 2); assert.equal(f.controller.snapshot().context.summary, 'Valid short summary.');
    await f.controller.dispose();
});

test('Controller avoids unnecessary recompaction and retains all intermediate corrections', async () => {
    const f = fixture([...Array.from({ length: 4 }, () => [text('answer'), done]), [text('old budget 3700'), done],
        [text('revision acknowledged'), done], [text('filler answer'), done], [text('4200'), done]],
        { contextConfig: { read: () => ({ inputTokens: 64000, recentTurns: 1, autoSummary: false }), save: async () => {} } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setFullAccess(true); await seedTurns(f);
    await f.controller.compactHistory();
    await f.controller.saveContextConfig({ inputTokens: 64000, recentTurns: 1, autoSummary: true });
    for (const input of ['Revision: 4200 replaces 3700', 'Discuss another topic', 'What is the budget?']) {
        f.controller.setInput(input); f.controller.send(); await settle();
    }
    const snapshot = f.controller.snapshot(), last = snapshot.runs.at(-1);
    assert.equal(last.status, 'succeeded'); assert.equal(last.process.coverage.status, 'skipped');
    assert.equal(last.process.coverage.omitted, 0); assert.equal(last.process.coverage.summarized, 6);
    assert.match(JSON.stringify(f.model.requests.at(-1)), /Revision: 4200 replaces 3700/);
    assert.equal(snapshot.context.coverage.state, 'complete'); assert.equal(snapshot.messages.length, 14);
    await f.controller.dispose();
});

test('Blocked controller history is recoverable only by explicit omission or a fitting context', async () => {
    const f = fixture([...Array.from({ length: 4 }, () => [text('answer'), done]), [text('old summary'), done],
        [...Array.from({ length: 8 }, () => text('中'.repeat(4000))), done], [text('fresh answer'), done]],
        // Fits the initial requests, but not the deliberately oversized generated history below.
        { contextConfig: { read: () => ({ inputTokens: 50000, recentTurns: 2, autoSummary: false }) } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setFullAccess(true); await seedTurns(f);
    await f.controller.compactHistory(); f.controller.setInput('Long answer'); f.controller.send(); await settle();
    const before = f.model.requests.length, rawCount = f.controller.snapshot().messages.length;
    assert.equal(f.controller.snapshot().context.coverage.state, 'blocked');
    f.controller.setInput('Continue'); f.controller.send(); await settle();
    const blocked = f.controller.snapshot(); assert.equal(blocked.runs.at(-1).process.coverage.status, 'blocked');
    assert.equal(blocked.notice, 'CONTEXT_INCOMPLETE'); assert.equal(f.model.requests.length, before);
    f.controller.setOmitHistory(true); assert.equal(f.controller.snapshot().context.coverage.state, 'omitted');
    f.controller.setInput('Start fresh'); f.controller.send(); await settle();
    assert.equal(f.model.requests.length, before + 1); assert.doesNotMatch(JSON.stringify(f.model.requests.at(-1)), /old summary|中{100}/);
    assert.ok(f.controller.snapshot().messages.length >= rawCount); await f.controller.dispose();
});

test('Changing context policy during a pending read never compacts the live continuation', async () => {
    const f = fixture([...Array.from({ length: 4 }, () => [text('answer'), done]), [text('reference'), done],
        [readSource('variables'), done], [text('continued answer'), done]],
        { contextConfig: { read: () => ({ inputTokens: 64000, recentTurns: 2, autoSummary: false }), save: async () => {} }, providerPort: { read: () => ({ text: 'Authorized variables', limited: false }) } });
    await f.enable(); f.controller.setMode('assistant'); await seedTurns(f);
    await f.controller.compactHistory(); f.controller.setInput('Read variables'); f.controller.send(); await settle();
    const pending = f.controller.snapshot().interaction; assert.equal(pending.status, 'pending'); assert.equal(pending.kind, 'permission');
    await f.controller.saveContextConfig({ inputTokens: 64000, recentTurns: 1, autoSummary: true });
    f.controller.answerPermission(pending.id, 'task'); await settle();
    assert.equal(f.model.requests.length, 7); assert.ok(f.model.requests.at(-1).tools.length > 0);
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
    assert.match(JSON.stringify(f.model.requests.at(-1)), /Authorized variables/); await f.controller.dispose();
});
test('Manual context summary preserves transcript, survives stored reload and does not replay grants', async () => {
    const store = createMemoryHistoryStore(), historyPort = { enabled: () => true, open: async () => store, setEnabled: async () => {} };
    const f = fixture([...Array.from({ length: 4 }, () => [text('old answer'.repeat(20)), done]), [text('summary reference'), done]], { history: historyPort });
    await f.controller.ready; await f.enable(); await seedTurns(f);
    const before = f.controller.snapshot().messages, id = f.controller.snapshot().history.sessionId;
    await f.controller.compactHistory(); await f.controller.flushHistory();
    assert.deepEqual(f.controller.snapshot().messages, before); assert.equal(f.controller.snapshot().context.summary, 'summary reference');
    assert.equal(f.controller.snapshot().context.usage.modelCalls, 1); assert.deepEqual(f.model.requests.at(-1).tools, []);
    await f.enable(); await f.controller.selectSession(id);
    await assert.rejects(f.controller.compactHistory(), /HISTORY_PERMISSION_REQUIRED/);
    assert.equal(f.controller.snapshot().context.summary, 'summary reference'); assert.equal(f.model.requests.length, 5);
    await f.controller.dispose();
    const second = fixture([], { history: historyPort }); await second.controller.ready; await second.controller.selectSession(id);
    assert.equal(second.controller.snapshot().context.summary, 'summary reference'); assert.equal(second.model.requests.length, 0); await second.controller.dispose();
});

test('Chat change cancels manual compaction and late summary cannot overwrite either chat', async () => {
    const gate = deferred(), f = fixture([...Array.from({ length: 4 }, () => [text('answer'), done]), () => gate.promise]);
    await f.enable(); await seedTurns(f); const id = f.controller.snapshot().history.sessionId;
    const pending = f.controller.compactHistory(); const rejected = assert.rejects(pending, /CANCELLED/); await settle();
    f.switchChat('B'); f.controller.setInput('B draft'); await settle();
    assert.equal(f.controller.snapshot().busy, true); gate.resolve([text('late summary'), done]); await rejected;
    assert.equal(f.controller.snapshot().input, 'B draft'); assert.equal(f.controller.snapshot().context.summary, '');
    f.switchChat('A'); await f.controller.selectSession(id); assert.equal(f.controller.snapshot().context.summary, ''); await f.controller.dispose();
});

test('Deleting a manual-summary target waits for drain; no late result resurrects it', async () => {
    const gate = deferred(), f = fixture([...Array.from({ length: 4 }, () => [text('answer'), done]), () => gate.promise]);
    await f.enable(); await seedTurns(f); const id = f.controller.snapshot().history.sessionId;
    const pending = f.controller.compactHistory(), rejected = assert.rejects(pending, /CANCELLED/); await settle();
    const deleted = f.controller.deleteSession(id); await settle(); assert.equal(f.controller.snapshot().resetting, true);
    gate.resolve([text('late summary'), done]); await Promise.all([deleted, rejected]);
    assert.equal(f.controller.snapshot().history.sessions.some(s => s.id === id), false); await f.controller.dispose();
});

test('Automatic summary is opt-in and uses send-time context policy; omission is one-send only', async () => {
    const f = fixture([...Array.from({ length: 4 }, () => [...Array.from({ length: 4 }, () => text('PRIVATE_OLD'.repeat(375))), done]), [text('summary'), done], [text('answer'), done], [text('no history'), done]], {
        contextConfig: { read: () => ({ inputTokens: 32000, recentTurns: 2, autoSummary: false }), save: async () => {} },
    });
    await f.enable(); await seedTurns(f); assert.equal(f.model.requests.length, 4);
    await f.controller.saveContextConfig({ inputTokens: 32000, recentTurns: 2, autoSummary: true });
    f.controller.setInput('continue'); f.controller.send(); await settle();
    assert.equal(f.model.requests.length, 6); assert.deepEqual(f.model.requests[4].tools, []); assert.equal(f.controller.snapshot().context.summary, 'summary');
    assert.equal(f.controller.snapshot().runs.at(-1).process.budget.modelCalls, 2);
    f.controller.setOmitHistory(true); f.controller.setInput('fresh'); f.controller.send(); await settle();
    assert.doesNotMatch(JSON.stringify(f.model.requests[6]), /PRIVATE_OLD|Historical conversation summary/);
    assert.equal(f.controller.snapshot().context.omitHistory, false); assert.equal(f.controller.snapshot().messages.length, 12);
    f.controller.clearContextSummary(); assert.equal(f.controller.snapshot().context.summary, ''); await f.controller.dispose();
});

test('A long answer is carried into the next request when the configured input budget fits', async () => {
    const longAnswer = '中'.repeat(9000);
    const f = fixture([[text(longAnswer), done], [text('Continue step three'), done]], {
        contextConfig: { read: () => ({ inputTokens: 128000, recentTurns: 12, autoSummary: false }) },
    });
    await f.enable(); f.controller.setMode('assistant');
    f.controller.setInput('Draft a plan'); f.controller.send(); await settle();
    f.controller.setInput('Continue step three'); f.controller.send(); await settle();
    assert.equal(f.model.requests.length, 2);
    assert.equal(f.model.requests[1].messages.some(m => m.content === longAnswer), true);
    assert.equal(f.controller.snapshot().runs.at(-1).process.context.historicalMessages, 2);
    await f.controller.dispose();
});

test('An uncarried recent long answer can be summarized once before the follow-up', async () => {
    // Leave room for the current tool contracts after compaction, while the original
    // answer still exceeds the planner's 90% raw-history allowance.
    const longAnswer = '中'.repeat(29000);
    const f = fixture([[...Array.from({ length: 10 }, (_, i) => text(longAnswer.slice(i * 3000, (i + 1) * 3000))).filter(e => e.text), done], [text('Step three: verify the balance'), done], [text('Continue'), done]], {
        contextConfig: { read: () => ({ inputTokens: 48000, recentTurns: 12, autoSummary: true }) },
    });
    await f.enable(); f.controller.setMode('assistant');
    f.controller.setInput('Draft a plan'); f.controller.send(); await settle();
    assert.equal(f.controller.snapshot().context.turns, 0);
    f.controller.setInput('Continue step three'); f.controller.send(); await settle();
    assert.equal(f.model.requests.length, 3, JSON.stringify(f.controller.snapshot().runs.at(-1).process));
    assert.deepEqual(f.model.requests[1].tools, []);
    assert.match(f.model.requests[1].messages.slice(1).map(message => JSON.parse(message.content).text).join(''), /中{100}/);
    assert.equal(f.controller.snapshot().context.summary, 'Step three: verify the balance');
    assert.match(JSON.stringify(f.model.requests[2].messages), /Step three: verify the balance/);
    assert.equal(f.controller.snapshot().runs.at(-1).process.budget.modelCalls, 2);
    await f.controller.dispose();
});

test('Revoking permissions cancels a summary before it can be cached', async () => {
    const gate = deferred(), f = fixture([...Array.from({ length: 4 }, () => [text('answer'), done]), () => gate.promise]);
    await f.enable(); await seedTurns(f); const id = f.controller.snapshot().history.sessionId;
    const pending = f.controller.compactHistory(), rejected = assert.rejects(pending, /CANCELLED/); await settle();
    const revoke = f.controller.revokePermission('diagnostics'); await settle(); gate.resolve([text('forbidden late'), done]); await Promise.all([revoke, rejected]);
    await f.controller.selectSession(id); assert.equal(f.controller.snapshot().context.summary, '');
    await assert.rejects(f.controller.compactHistory(), /HISTORY_PERMISSION_REQUIRED/); await f.controller.dispose();
});

test('Remembered grants permit repeated sends; revoke resets prior model conversation and connection clears grants', async () => {
    const f = fixture([[text('PRIVATE_ANSWER'), done], [text('second'), done], [text('fresh'), done]]);
    await f.enable(); f.controller.setInput('first'); f.controller.send({ consent: true }); await settle();
    assert.equal(f.controller.snapshot().permissions.diagnostics, true);
    f.controller.setInput('second'); f.controller.send(); await settle();
    assert.match(JSON.stringify(f.model.requests.at(-1)), /PRIVATE_ANSWER/);
    await f.controller.revokePermission('diagnostics'); assert.equal(f.controller.snapshot().messages.length, 0);
    f.controller.setInput('new'); assert.throws(() => f.controller.send(), /CONSENT_REQUIRED/);
    f.controller.send({ consent: true }); await settle(); assert.doesNotMatch(JSON.stringify(f.model.requests.at(-1)), /PRIVATE_ANSWER/);
    await f.enable(); assert.equal(f.controller.snapshot().permissions.diagnostics, false); await f.controller.dispose();
});

test('Budget settings are captured at send time and saving during a run affects only the next run', async () => {
    const gate = deferred(); let saved;
    const f = fixture([async () => { await gate.promise; return [tool('muyu.memory.inspect'), done]; }, [text('bounded'), done], [text('next'), done]], {
        runConfig: { read: () => ({ ...RUN_DEFAULTS, modelCalls: 2, maxTokens: 1024 }), save: async value => { saved = value; } },
    });
    await f.enable(); f.controller.setInput('first'); f.controller.send({ consent: true }); await settle();
    await f.controller.saveRunConfig({ ...RUN_DEFAULTS, modelCalls: 10, maxTokens: 2048 });
    assert.equal(saved.modelCalls, 10); gate.resolve(); await settle();
    let s = f.controller.snapshot(); assert.equal(s.runs[0].process.budget.modelLimit, 2); assert.equal(s.runs[0].process.budget.maxTokens, 1024);
    assert.equal(f.model.requests[1].finalize, true);
    f.controller.setInput('next'); f.controller.send(); await settle(); s = f.controller.snapshot();
    assert.equal(s.runs.at(-1).process.budget.modelLimit, 10); assert.equal(f.model.requests.at(-1).maxTokens, 2048);
    await assert.rejects(f.controller.saveRunConfig({ ...RUN_DEFAULTS, modelCalls: 500 }), /INVALID_RUN_CONFIG/);
    await f.controller.dispose();
});

test('Chat assistant exposes public catalog without data grant; grants follow only their chat', async () => {
    const f = fixture([[text('public'), done], [text('authorized'), done]]);
    await f.enable(); f.controller.setMode('chat'); f.controller.setInput('hello'); f.controller.send(); await settle();
    assert.equal(f.model.requests[0].tools.some(t => t.id === 'muyu.provider.read'), true);
    assert.equal(f.model.requests[0].tools.some(t => t.id === 'muyu.permission.request'), true);
    f.controller.grantPermission('chat'); f.controller.setInput('read'); f.controller.send(); await settle();
    assert.equal(f.model.requests.at(-1).tools.some(t => t.id === 'muyu.provider.read'), true);
    f.switchChat('B'); assert.equal(f.controller.snapshot().permissions.chat, false);
    f.switchChat('A'); assert.equal(f.controller.snapshot().permissions.chat, true); await f.controller.dispose();
});

test('Authorized Provider body reaches model only through the tool, not process projection', async () => {
    let reads = 0;
    const f = fixture([[tool('muyu.provider.read', { id: 'recentMessages', selector: '', revision: '', offset: 0 }), done], [text('answer'), done]], {
        providerPort: { available: () => true, read() { reads++; return { text: 'BODY_EVIDENCE', limited: false }; } },
    });
    await f.enable(); f.controller.setMode('chat'); f.controller.setInput('read'); f.controller.send({ consent: true }); await settle();
    assert.equal(reads, 1); assert.match(JSON.stringify(f.model.requests.at(-1)), /BODY_EVIDENCE/);
    assert.doesNotMatch(JSON.stringify(f.controller.snapshot().runs[0].process), /BODY_EVIDENCE/); await f.controller.dispose();
});

test('Basic consent cannot read extended sources; explicit extended grant permits only its scope', async () => {
    for (const grant of [false, true]) {
        let reads = 0;
        const f = fixture([[tool('muyu.provider.read', { id: 'directorLedger', selector: '', revision: '', offset: 0 }), done], [text('answer'), done]], { providerPort: { available: () => true, read() { reads++; return { text: 'LEDGER_BODY', limited: true }; } } });
        await f.enable(); f.controller.setMode('chat'); if (grant) f.controller.grantPermission('extended');
        f.controller.setInput('ledger'); f.controller.send({ consent: true }); await settle();
        assert.equal(reads, grant ? 1 : 0); if (!grant) assert.doesNotMatch(JSON.stringify(f.model.requests), /LEDGER_BODY/);
        f.switchChat('B'); assert.equal(f.controller.snapshot().permissions.extended, false);
        f.switchChat('A'); assert.equal(f.controller.snapshot().permissions.extended, grant);
        if (grant) { await f.controller.revokePermission('extended'); assert.equal(f.controller.snapshot().messages.length, 0); }
        await f.controller.dispose();
    }
});

test('Revoke while model is pending cancels the run and waits for drain before accepting a fresh context', async () => {
    const gate = deferred();
    const f = fixture([async () => { await gate.promise; return [text('LATE_PRIVATE'), done]; }]);
    await f.enable(); f.controller.setInput('read'); f.controller.send({ consent: true }); await settle();
    const revoking = f.controller.revokePermission('diagnostics'); await settle();
    assert.equal(f.controller.snapshot().resetting, true); assert.equal(f.controller.snapshot().permissions.diagnostics, false);
    assert.throws(() => f.controller.send(), /NOT_READY/); gate.resolve(); await revoking;
    assert.equal(f.controller.snapshot().messages.length, 0); assert.equal(f.controller.snapshot().runs.length, 0); await f.controller.dispose();
});

test('Saved credentials restore only on explicit configure, stay out of snapshots and do not restore grants', async () => {
    const settings = {}; let saves = 0;
    const credentials = createCredentialStore({ getSettings: () => settings, saveSettings: () => saves++ });
    const f = fixture(undefined, { credentials }); await f.enable(); assert.equal(saves, 1);
    await f.controller.configure({ endpoint: 'https://saved.test/chat/completions', apiKey: 'SYNTHETIC_KEY', model: 'm', rememberKey: true });
    assert.equal(saves, 2); f.controller.grantPermission('diagnostics'); await f.controller.dispose();
    const g = fixture(undefined, { credentials }); assert.equal(g.controller.snapshot().enabled, false);
    assert.equal(g.controller.snapshot().permissions.diagnostics, false); assert.doesNotMatch(JSON.stringify(g.controller.snapshot()), /SYNTHETIC_KEY/);
    await g.controller.configure({ endpoint: 'https://saved.test/chat/completions', apiKey: '', model: 'm', rememberKey: true });
    assert.equal(g.configs.at(-1).connection.apiKey, 'SYNTHETIC_KEY');
    await g.controller.forgetCredential(); assert.equal(g.controller.snapshot().savedConnection, null); await g.controller.dispose();
});

test('Opted-in connection auto-enables after restart without restoring grants, and disable persists opt-out', async () => {
    const settings = {}; let saves = 0;
    const credentials = createCredentialStore({ getSettings: () => settings, saveSettings: () => saves++ });
    const f = fixture(undefined, { credentials });
    f.controller.setInput('unsent question');
    await f.controller.configure({ endpoint: 'https://saved.test/chat/completions', apiKey: 'SYNTHETIC_KEY', model: 'm', rememberKey: true, autoConnect: true });
    assert.equal(f.controller.snapshot().input, 'unsent question');
    f.controller.grantPermission('diagnostics'); await f.controller.dispose();
    const g = fixture(undefined, { credentials });
    assert.equal(g.controller.snapshot().enabled, true);
    assert.equal(g.controller.snapshot().permissions.diagnostics, false);
    assert.doesNotMatch(JSON.stringify(g.controller.snapshot()), /SYNTHETIC_KEY/);
    assert.equal(g.configs[0].connection.apiKey, 'SYNTHETIC_KEY');
    await g.controller.disable(); assert.equal(credentials.describe().autoConnect, false);
    await g.controller.dispose();
    const h = fixture(undefined, { credentials }); assert.equal(h.controller.snapshot().enabled, false);
    assert.ok(saves >= 2); await h.controller.dispose();
});

test('Director mode publishes a safe report under chat ownership and cannot use memory-state tools', async () => {
    const f = fixture([[tool('muyu.director.inspect'), done], [text('current state only'), done]]);
    await f.enable(); f.controller.setMode('director'); f.controller.setInput('check director');
    assert.throws(() => f.controller.send(), /CONSENT_REQUIRED/); assert.equal(f.reads(), 0);
    f.controller.send({ consent: true }); await settle();
    const s = f.controller.snapshot(); assert.equal(s.runs[0].status, 'succeeded'); assert.equal(s.artifacts[0].content.module, 'director');
    assert.doesNotMatch(JSON.stringify(f.model.requests), /private-avatar|PRIVATE_BODY|PRIVATE_KEY/);
    f.switchChat('B'); assert.equal(f.controller.snapshot().artifacts.length, 0); await f.controller.dispose();
    const denied = fixture([[tool('muyu.memory.inspect'), done], [text('denied'), done]]);
    await denied.enable(); denied.controller.setMode('director'); denied.controller.setInput('read memory'); denied.controller.send({ consent: true }); await settle();
    assert.equal(denied.reads(), 0); assert.equal(denied.controller.snapshot().artifacts.length, 0); await denied.controller.dispose();
});

test('Safe network failures remain distinguishable from authentication errors', async () => {
    const f = fixture([() => { throw new ExecutionError('MODEL_NETWORK_ERROR'); }]);
    await f.enable(); f.controller.setInput('question'); f.controller.send({ consent: true }); await settle();
    assert.equal(f.controller.snapshot().notice, 'MODEL_NETWORK_ERROR');
    assert.equal(f.controller.snapshot().runs[0].status, 'failed'); await f.controller.dispose();
});

test('Memory authorization cannot invoke draft tools or create config artifacts', async () => {
    const f = fixture([[tool('muyu.config.preview', { changes: { autoMemoryEnabled: false } }), done], [text('denied'), done]]);
    await f.enable(); f.controller.setInput('question'); f.controller.send({ consent: true }); await settle();
    assert.equal(f.reads(), 0); assert.equal(f.controller.snapshot().artifacts.length, 0);
    assert.equal(f.settings.autoMemoryEnabled, true); await f.controller.dispose();
});

test('Continue a selected draft creates a new revision, preserving the unchanged fields', async () => {
    const f = fixture([
        [tool('muyu.config.preview', { changes: { autoMemoryInterval: 15 } }), done], [text('v1'), done],
        [tool('muyu.config.preview', { changes: { autoMemoryInterval: 20 } }), done], [text('v2'), done],
    ]);
    await f.enable(); f.controller.setMode('draft'); f.controller.setInput('interval 15');
    f.controller.send({ consent: true, fields: ['autoMemoryInterval'] }); await settle();
    const first = f.controller.snapshot().artifacts[0]; f.controller.setInput('change to 20');
    f.controller.send({ consent: true, fields: ['autoMemoryInterval'], artifactId: first.id }); await settle();
    const s = f.controller.snapshot(); assert.equal(s.artifacts.length, 1); assert.equal(s.artifacts[0].revision, 2);
    assert.equal(s.artifacts[0].taskId, first.taskId); assert.equal(s.artifacts[0].content.preview.manifest.settings.autoMemoryInterval, 20);
    assert.equal(f.settings.autoMemoryInterval, 10); await f.controller.dispose();
});

test('Host identity includes owner; bridge subscribes once and does not read message bodies', () => {
    const f = fixture(), a = f.host.currentTarget();
    f.ctx.groupId = 'other'; assert.notDeepEqual(f.host.currentTarget(), a);
    f.ctx.groupId = null; f.ctx.characterId = 0; f.ctx.characters = [{ avatar: 'avatar' }];
    assert.notDeepEqual(f.host.currentTarget(), a);
    f.ctx.chatId = ''; assert.equal(f.host.currentTarget(), null);
    assert.equal(f.reads(), 0); assert.equal(f.events.listenerCount('chat'), 1);
    return f.controller.dispose().then(() => assert.equal(f.events.listenerCount('chat'), 0));
});

test('ST connection defaults to ready without a key or model call; changes clear grants and retain composer', async () => {
    let calls = 0;
    const settings = {}, credentials = createCredentialStore({ getSettings: () => settings, saveSettings: async () => {} });
    const modelContext = { mainApi: 'openai', chatCompletionSettings: { chat_completion_source: 'custom', custom_url: 'https://host.test/v1', model: 'host-model' },
        getChatCompletionModel: s => s.model, ChatCompletionService: { sendRequest: async () => { calls++; return { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Hello' } }] }; } }, eventTypes: { CHAT_CHANGED: 'chat', CHATCOMPLETION_MODEL_CHANGED: 'model' } };
    const f = fixture(undefined, { credentials, modelContext });
    assert.equal(f.controller.snapshot().enabled, true); assert.equal(f.controller.snapshot().connection.source, 'st'); assert.equal(calls, 0);
    assert.equal(f.controller.snapshot().permissions.diagnostics, false); assert.equal(f.controller.snapshot().fullAccess, false);
    f.controller.setInput('unsent draft'); f.controller.grantPermission('diagnostics');
    f.ctx.chatCompletionSettings.model = 'new-model'; f.events.emit('model'); await settle();
    assert.equal(f.controller.snapshot().enabled, false); assert.equal(f.controller.snapshot().permissions.diagnostics, false);
    assert.equal(f.controller.snapshot().input, 'unsent draft'); assert.equal(f.controller.snapshot().error, 'HOST_CONNECTION_CHANGED');
    await f.controller.configure({ source: 'st' }); assert.equal(f.controller.snapshot().connection.model, 'new-model');
    await f.controller.disable(); await f.controller.dispose();
    const g = fixture(undefined, { credentials, modelContext }); assert.equal(g.controller.snapshot().enabled, false); await g.controller.dispose();
});

test('Stored independent connection stays selected when ST is available, and host setup keeps its key', async () => {
    const settings = {}, credentials = createCredentialStore({ getSettings: () => settings, saveSettings: async () => {} });
    await credentials.save({ endpoint: 'https://saved.test/chat/completions', model: 'saved-model', apiKey: 'PRIVATE_SAVED_KEY', autoConnect: true });
    const f = fixture(undefined, { credentials, modelContext: { mainApi: 'openai', chatCompletionSettings: { chat_completion_source: 'openai', model: 'host-model' }, getChatCompletionModel: s => s.model, ChatCompletionService: { sendRequest: async () => ({}) } } });
    assert.equal(f.controller.snapshot().connection.model, 'saved-model');
    await f.controller.configure({ source: 'st' });
    assert.equal(settings.agentConfigs['muyu-assistant'].apiKey, 'PRIVATE_SAVED_KEY');
    assert.doesNotMatch(JSON.stringify(f.controller.snapshot()), /PRIVATE_SAVED_KEY/);
    await f.controller.dispose();
});

test('Disabled/default controller and missing consent cannot invoke model or read settings', async () => {
    const f = fixture(); f.controller.setInput('hello');
    assert.equal(f.controller.snapshot().enabled, false);
    assert.throws(() => f.controller.send({ consent: true }), /NOT_READY/);
    await f.enable(); assert.throws(() => f.controller.send(), /CONSENT_REQUIRED/);
    assert.equal(f.reads(), 0); assert.equal(f.model.requests.length, 0);
    assert.ok(!JSON.stringify(f.controller.snapshot()).includes('PRIVATE_KEY'));
    const snapshot = f.controller.snapshot(); snapshot.connection.model = 'tamper';
    assert.equal(f.controller.snapshot().connection.model, 'test'); await f.controller.dispose();
});

test('View subscriptions and chat drafts survive unmount; empty chat switches reset view identity', async () => {
    const f = fixture(); const a = f.controller.snapshot().viewToken;
    f.controller.setInput('A draft'); let updates = 0;
    const sub = f.controller.subscribe(() => updates++); sub.unsubscribe();
    f.switchChat('B'); assert.notEqual(f.controller.snapshot().viewToken, a); assert.equal(updates, 0);
    f.controller.setInput('B draft'); f.switchChat('A'); assert.equal(f.controller.snapshot().input, 'A draft');
    f.controller.setMode('draft'); f.controller.setInput('global draft'); f.switchChat('B');
    assert.equal(f.controller.snapshot().input, 'global draft');
    f.controller.setMode('memory'); assert.equal(f.controller.snapshot().input, 'B draft'); await f.controller.dispose();
});

test('Memory run publishes trusted report, never private bodies or identities', async () => {
    const f = fixture([[tool('muyu.memory.inspect'), done], [text('evidence answer'), done]]);
    await f.enable(); f.controller.setInput('diagnose'); f.controller.send({ consent: true }); await settle();
    const s = f.controller.snapshot(); assert.equal(s.runs[0].status, 'succeeded'); assert.equal(s.artifacts[0].kind, 'report');
    assert.doesNotMatch(JSON.stringify(f.model.requests), /PRIVATE_BODY|private-avatar|PRIVATE_KEY/);
    assert.equal(s.messages.at(-1).content, 'evidence answer'); await f.controller.dispose();
});

test('Global draft requires explicit fields; publishes validated diff without writing settings', async () => {
    const f = fixture([[tool('muyu.config.preview', { changes: { autoMemoryInterval: 15 } }), done], [text('draft only'), done]]);
    await f.enable(); f.controller.setMode('draft'); f.controller.setInput('interval 15');
    assert.throws(() => f.controller.send({ consent: true }), /FIELD_SCOPE_REQUIRED/);
    f.controller.send({ consent: true, fields: ['autoMemoryInterval'] }); await settle();
    const s = f.controller.snapshot(); assert.equal(s.runs[0].status, 'succeeded'); assert.equal(s.artifacts.length, 1);
    assert.equal(s.artifacts[0].content.preview.manifest.settings.autoMemoryInterval, 15);
    assert.equal(f.settings.autoMemoryInterval, 10);
    f.settings.autoMemoryInterval = 20;
    assert.throws(() => f.controller.revalidate(s.artifacts[0].id, 1), /STALE_DRAFT/);
    assert.equal(f.controller.snapshot().artifacts[0].validation.status, 'stale'); await f.controller.dispose();
});

test('Chat switch cancels old run, late answer cannot overwrite new input, drain blocks reuse', async () => {
    const wait = deferred(), f = fixture([() => wait.promise]); await f.enable();
    f.controller.setInput('A'); f.controller.send({ consent: true }); await flush();
    f.switchChat('B'); f.controller.setInput('B unsaved'); await settle();
    assert.equal(f.controller.snapshot().busy, true); assert.equal(f.controller.snapshot().draining, true);
    assert.throws(() => f.controller.send({ consent: true }), /NOT_READY/);
    wait.resolve([text('late A'), done]); await settle();
    assert.equal(f.controller.snapshot().input, 'B unsaved'); assert.equal(f.controller.snapshot().messages.length, 0);
    f.switchChat('A'); assert.equal(f.controller.snapshot().runs[0].status, 'cancelled'); await f.controller.dispose();
});

test('Global run survives chat switch; disabling waits for physical drain and clears credentials/state', async () => {
    const wait = deferred(), f = fixture([() => wait.promise]); await f.enable();
    f.controller.setMode('draft'); f.controller.setInput('draft'); f.controller.send({ consent: true, fields: ['autoMemoryEnabled'] }); await flush();
    f.switchChat('B'); await flush(); assert.equal(f.controller.snapshot().runs[0].status, 'running');
    const disabled = f.controller.disable(); await settle(); assert.equal(f.controller.snapshot().resetting, true);
    wait.resolve([text('late'), done]); await disabled;
    assert.equal(f.controller.snapshot().enabled, false); assert.equal(f.controller.snapshot().connection, null);
    assert.equal(f.controller.snapshot().artifacts.length, 0); assert.equal(f.controller.snapshot().messages.length, 0); await f.controller.dispose();
});
