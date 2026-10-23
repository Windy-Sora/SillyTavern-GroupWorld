import { createSkillPort } from '../../muyu/host/skills.js';
import { UI_LABELS } from '../../muyu/ui/navigation-metadata.js';
import { createSelectionEditorPort } from '../../muyu/host/selection-editor.js';
import { createLedgerEditorPort } from '../../muyu/host/ledger-editor.js';
import { createStPresetEditor } from '../../muyu/host/st-preset-editor.js';
import { createNativePresetApi } from '../../muyu/host/native-preset-api.js';
import { createCharacterCardPort } from '../../muyu/host/character-cards.js';
import { createNativeCharacterApi } from '../../muyu/host/native-character-api.js';
import { createWorldBookEditorPort } from '../../muyu/host/worldbook-editor.js';
import { createWorldBookControls } from '../../muyu/host/worldbook-controls.js';
import { createBlueprintNodeEditorPort } from '../../muyu/host/blueprint-node-editor.js';
import { createNpcEditorPort } from '../../muyu/host/npc-editor.js';
import { createProfileEditorPort } from '../../muyu/host/profile-editor.js';
import { createMemoryEditorPort } from '../../muyu/host/memory-editor.js';
import { registerSection } from './registry.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createStPromptSnapshots } from '../../muyu/host/st-prompt-snapshots.js';
import { createStDiagnostics } from '../../muyu/host/st-diagnostics.js';
import { createProfileWriter } from '../../muyu/host/profile-write.js';
import { createConfigWriter } from '../../muyu/host/config-write.js';
import { createMemoryLimitPort } from '../../muyu/host/memory-limit.js';
import { createStoryBlueprintTogglePort } from '../../muyu/host/story-blueprint-toggle.js';
import { createSettingsSwitchPort } from '../../muyu/host/settings-switches.js';
import { createStoryCompletionVariablePort } from '../../muyu/host/story-completion-variable.js';
import { createVariableDraftPort } from '../../muyu/host/variable-draft.js';
import { createVariableEditorPort } from '../../muyu/host/variable-editor.js';
import { createVariableWriter } from '../../muyu/host/variable-write.js';
import { createTaskBundleDraftPort } from '../../muyu/host/task-bundle-draft.js';
import { createTaskBundleWriter } from '../../muyu/host/task-bundle-write.js';
import { createProviderPort } from '../../muyu/host/providers.js';
import { createBrowserScriptTester } from '../../muyu/host/script-test.js';
import { createBlueprintLibraryChatPort } from '../../muyu/host/blueprint-library-chat.js';
import { createNpcLibraryChatPort } from '../../muyu/host/npc-library-chat.js';
import { createProfileLibraryChatPort } from '../../muyu/host/profile-library-chat.js';
import { createBlueprintLibraryPort } from '../../muyu/host/blueprint-libraries.js';
import { createNpcLibraryPort } from '../../muyu/host/npc-libraries.js';
import { createProfileLibraryPort } from '../../muyu/host/profile-libraries.js';
import { createCustomPromptPort } from '../../muyu/host/custom-prompts.js';
import { createCustomAgentPort } from '../../muyu/host/custom-agents.js';
import { createMemoryGenerationPort } from '../../muyu/host/memory-generation.js';
import { createProfileGenerationPort } from '../../muyu/host/profile-generation.js';
import { createGenerationBatchPort } from '../../muyu/host/generation-batch.js';
import { createNpcGenerationPort } from '../../muyu/host/npc-generation.js';
import { createScriptExecutorPort } from '../../muyu/host/script-executors.js';
import { createProviderAssetPort } from '../../muyu/host/provider-assets.js';
import { createBrowserProviderTester } from '../../muyu/host/provider-test.js';
import { createCredentialStore } from '../../muyu/host/credentials.js';
import { createRunConfigStore } from '../../muyu/host/run-config.js';
import { createDisplayConfigStore } from '../../muyu/host/display-config.js';
import { createPermissionConfigStore } from '../../muyu/host/permission-config.js';
import { createContextConfigStore } from '../../muyu/host/context-config.js';
import { createInstructionConfigStore } from '../../muyu/host/instruction-config.js';
import { createHistoryPort } from '../../muyu/host/history.js';
import { createAgentMemoryPort } from '../../muyu/host/agent-memory.js';
import { createServicesPort } from '../../muyu/host/services.js';
import { createWebSearchPort } from '../../muyu/host/web-search.js';
import { createMuyuController } from '../../muyu/application/controller.js';
import { mountMuyuPanel } from '../../muyu/ui/panel.js';
import { muyuFloatingState } from '../../muyu/ui/floating-state.js';
import { createFloatingRegistry } from '../floating/registry.js';
import { createFloatingShell } from '../floating/shell.js';
import { getQuickActions } from '../quick-actions.js';
import { syncConfigPromptEditors } from '../../muyu/ui/config-prompt-editors.js';
import { toggleContinuityMode } from '../i18n.js';
import { syncGeneralSettingsView } from '../general-settings-view.js';

// deps survives reloadSettingsUI; the section owns only the disposable view.
registerSection('muyu', ctx => {
    const root = document.getElementById('gd-muyu-root'); if (!root || !ctx.muyuOwner) return;
    const owner = ctx.muyuOwner;
    owner.currentContext = ctx;
    if (!owner.controller) {
        let host;
        const stPromptSnapshots = createStPromptSnapshots({getContext:ctx.getContext,getTarget:()=>host?.currentTarget(),getSettings:()=>ctx.settings,saveSettings:ctx.saveMuyuCredentials});
        const stDiagnostics = createStDiagnostics({ getContext: ctx.getContext, getTarget: () => host?.currentTarget(), getSettings: () => ctx.settings, saveSettings: ctx.saveMuyuCredentials });
        const services = createServicesPort({ fetcher: globalThis.fetch?.bind(globalThis), getHeaders: ctx.getRequestHeaders,
            getEnabled: () => ctx.settings.muyuServiceTools,
            saveEnabled: async value => {
                const settings = ctx.settings, previous = settings.muyuServiceTools;
                settings.muyuServiceTools = value;
                try { await ctx.saveMuyuCredentials(); }
                catch (error) { if (settings.muyuServiceTools === value) { if (previous === undefined) delete settings.muyuServiceTools; else settings.muyuServiceTools = previous; } throw error; }
            } });
        const providerPort = createProviderPort({ getContext: ctx.getContext, getSettings: () => ctx.settings, extensionKey: ctx.EXT_KEY, bindings: ctx.muyuProviderBindings, getProviders: ctx.getMuyuProviders,
            stDiagnostics, stPromptSnapshots, services,
            worldBooks: { getState: ctx.getMuyuWorldBookState, load: ctx.loadWorldInfo },
            stDirectories: { getSelectedPersona: ctx.getMuyuSelectedPersona, getExtensions: ctx.getMuyuExtensionDirectory } });
        const credentials = createCredentialStore({ getSettings: () => ctx.settings, saveSettings: ctx.saveMuyuCredentials });
        const runConfig = createRunConfigStore({ getSettings: () => ctx.settings, saveSettings: ctx.saveMuyuCredentials });
        const displayConfig = createDisplayConfigStore({ getSettings: () => ctx.settings, saveSettings: ctx.saveMuyuCredentials });
        const permissionConfig = createPermissionConfigStore({ getSettings: () => ctx.settings, saveSettings: ctx.saveMuyuCredentials });
        const contextConfig = createContextConfigStore({ getSettings: () => ctx.settings, saveSettings: ctx.saveMuyuCredentials });
        const instructionConfig = createInstructionConfigStore({ getSettings: () => ctx.settings, saveSettings: ctx.saveMuyuCredentials });
        const history = createHistoryPort({ getAccount: ctx.getMuyuAccount, getSettings: () => ctx.settings, saveSettings: ctx.saveMuyuCredentials, fetcher: globalThis.fetch?.bind(globalThis), getHeaders: ctx.getRequestHeaders });
        const webSearch = createWebSearchPort({ getSettings: () => ctx.settings, saveSettings: ctx.saveMuyuCredentials, fetcher: globalThis.fetch?.bind(globalThis), getHeaders: ctx.getRequestHeaders });
        const agentMemory = createAgentMemoryPort({ getAccount: ctx.getMuyuAccount, getSettings: () => ctx.settings, saveSettings: ctx.saveMuyuCredentials, getTarget: () => host?.currentTarget() });
        const memoryLimitPort = createMemoryLimitPort({ getTarget: () => host?.currentTarget(), getMetadata: ctx.getChatMetadata, extensionKey: ctx.EXT_KEY, memorySystem: ctx.memorySystem,
            changed: () => { const live = owner.currentContext || ctx; live.refreshMemoryList?.(); window.__gdRefreshDashboard?.(); } });
        const completionVariablePort = createStoryCompletionVariablePort({ getTarget: () => host?.currentTarget(), getMetadata: ctx.getChatMetadata,
            getSettings: () => ctx.settings, extensionKey: ctx.EXT_KEY, saveChatConfirmed: ctx.saveVariablesChatConfirmed });
        const blueprintTogglePort = createStoryBlueprintTogglePort({ getTarget: () => host?.currentTarget(), getMetadata: ctx.getChatMetadata,
            getSettings: () => ctx.settings, extensionKey: ctx.EXT_KEY, saveChatConfirmed: ctx.saveVariablesChatConfirmed,
            changed: () => { window.__gdRefreshVariables?.(); window.__gdRefreshDashboard?.(); } });
        const variablesBusy = () => {
            const guards = ctx.getMuyuGuards?.() || {};
            return !!guards.roundActive || !!guards.manualGenerating || !!guards.takeoverPending || !!ctx.storyBlueprintSystem?.isGenerating?.();
        };
        const variableDraftPort = createVariableDraftPort({ getTarget: () => host?.currentTarget(), getMetadata: ctx.getChatMetadata, extensionKey: ctx.EXT_KEY, isBusy: variablesBusy });
        const selectionEditor = createSelectionEditorPort({getTarget:()=>host?.globalTarget,getSettings:()=>ctx.settings,getWorldNames:()=>(owner.currentContext||ctx).world_names,
            worldBookScanner:ctx.worldBookScanner,profileLibrarySystem:ctx.profileLibrarySystem,saveSettings:ctx.saveMuyuCredentials,
            isBusy:()=>{const g=ctx.getMuyuGuards?.()||{};return !!g.roundActive||!!g.manualGenerating||!!g.takeoverPending;}});
        const presetApi = createNativePresetApi({getContext:ctx.getContext,getHeaders:ctx.getRequestHeaders,fetch:globalThis.fetch?.bind(globalThis),getSelect:()=>document.getElementById('settings_preset_openai')});
        const stPresetEditor = createStPresetEditor({getTarget:()=>host?.globalTarget,getContext:ctx.getContext,getLive:ctx.getMuyuLivePreset,save:presetApi.save,select:presetApi.select,
            isBusy:()=>typeof ctx.getMuyuPresetBusy!=='function'||ctx.getMuyuPresetBusy(),
            isEditing:()=>!globalThis.$||globalThis.$('#completion_prompt_manager_popup').is(':visible')});
        const characterApi = createNativeCharacterApi({fetch:globalThis.fetch?.bind(globalThis),getHeaders:ctx.getRequestHeaders});
        const characterIsEditing = avatar => { const context=ctx.getContext(); return context.characters?.[context.characterId]?.avatar===avatar && globalThis.$?.('#form_create').attr('actiontype')==='editcharacter'; };
        const characterCards = createCharacterCardPort({getTarget:()=>host?.globalTarget,getDirectory:()=>ctx.getContext().characters,
            load:characterApi.load,save:characterApi.save,duplicate:characterApi.duplicate,create:characterApi.create,remove:characterApi.remove,exists:characterApi.exists,getReferences:ctx.getMuyuCharacterReferences,isEditing:characterIsEditing,
            isBusy:()=>{const g=ctx.getMuyuGuards?.()||{};return !!g.roundActive||!!g.manualGenerating||!!g.takeoverPending;},
            syncCache:(avatar,observed,created)=>{const context=ctx.getContext(),rows=context.characters;if(!Array.isArray(rows)||characterIsEditing(avatar))return;
                if(created){if(!rows.some(c=>c.avatar===avatar))rows.push(observed);return;}
                const current=rows.find(c=>c.avatar===avatar);if(!current)return;
                // Do not reload the selected editor, change chat paths or overwrite unrelated runtime state.
                const fields=['description','personality','scenario','first_mes','mes_example','system_prompt','post_history_instructions','creator_notes'];
                for(const field of fields){const value=observed.data?.[field]??observed[field];if(typeof value==='string'){current[field]=value;if(current.data&&typeof current.data==='object')current.data[field]=value;}}
                current.name=observed.name;if(current.data&&typeof current.data==='object')current.data.name=observed.data?.name??observed.name;
                if(typeof observed.json_data==='string')current.json_data=observed.json_data;
            }});
        const worldBookEditor = createWorldBookEditorPort({ getTarget: () => host?.globalTarget, getState: ctx.getMuyuWorldBookState, load: ctx.loadWorldInfo,
            controls:createWorldBookControls({getTarget:()=>host?.globalTarget,getChatTarget:()=>host?.currentTarget(),getState:ctx.getMuyuWorldBookState,
                getReferences:ctx.getMuyuWorldBookReferences,load:ctx.loadWorldInfo,
                refresh:()=>ctx.getContext().updateWorldInfoList(),remove:ctx.deleteWorldInfo,
                setGlobal:ctx.setMuyuGlobalWorldBooks,
                setChat:async(name,target)=>{if(JSON.stringify(host?.currentTarget())!==JSON.stringify(target))throw Error('TARGET_UNAVAILABLE');const metadata=ctx.getChatMetadata();if(name)metadata.world_info=name;else delete metadata.world_info;return ctx.getContext().saveMetadata();},
                isBusy:()=>{const g=ctx.getMuyuGuards?.()||{};return !!g.roundActive||!!g.manualGenerating||!!g.takeoverPending;}}),
            createEntry: ctx.createWorldInfoEntry,
            refresh: () => { const refresh = ctx.getContext()?.updateWorldInfoList; if (typeof refresh !== 'function') throw Error('WRITE_UNAVAILABLE'); return refresh(); },
            save: (name, data, immediate) => { const save = ctx.getContext()?.saveWorldInfo; if (typeof save !== 'function') throw Error('WRITE_UNAVAILABLE'); return save(name, data, immediate); },
            isBusy: () => { const guards = ctx.getMuyuGuards?.() || {}; return !!guards.roundActive || !!guards.manualGenerating || !!guards.takeoverPending; } });
        const ledgerEditor = createLedgerEditorPort({getTarget:()=>host?.currentTarget(),getMetadata:ctx.getChatMetadata,extensionKey:ctx.EXT_KEY,saveChatConfirmed:ctx.saveLedgerChatConfirmed,
            isBusy:()=>{const g=ctx.getMuyuGuards?.()||{};return !!g.roundActive||!!g.manualGenerating||!!g.takeoverPending;},
            changed:index=>{const live=owner.currentContext||ctx;const history=live.getDirectorHistory?.()||[];
                if(index===history.length-1)live.onLatestEntryEdited?.();
                live.$c?.('ledger-count')?.text(live.settings.lang==='en'?'Ledger updated in memory; see Muyu receipt. Refresh to view; editor draft kept.':'账本已更新内存；保存结果见暮羽回执。点击刷新查看，编辑草稿已保留。');}});
        const blueprintNodeEditor = createBlueprintNodeEditorPort({getTarget:()=>host?.currentTarget(),getMetadata:ctx.getChatMetadata,extensionKey:ctx.EXT_KEY,saveChatConfirmed:ctx.saveStoryBlueprintChatConfirmed,
            getSettings:()=>ctx.settings,getChatLength:()=>ctx.getContext().chat?.length,saveStructureConfirmed:ctx.saveBlueprintLibraryChatConfirmed,
            isBusy:()=>{const g=ctx.getMuyuGuards?.()||{};return !!g.roundActive||!!g.manualGenerating||!!g.takeoverPending||!!ctx.storyBlueprintSystem?.isGenerating?.();},
            changed:()=>{const live=owner.currentContext||ctx;live.$c?.('story-blueprint-status')?.text(live.settings.lang==='en'?'Blueprint data updated in memory; see Muyu save receipt. Refresh Blueprint to view; JSON draft kept.':'蓝图数据已更新内存；保存结果见暮羽回执。点击刷新查看，JSON草稿已保留。');}});
        const npcEditor = createNpcEditorPort({getTarget:()=>host?.currentTarget(),getMetadata:ctx.getChatMetadata,extensionKey:ctx.EXT_KEY,system:ctx.npcSystem,saveChatConfirmed:ctx.saveNpcChatConfirmed,
            isBusy:()=>{const g=ctx.getMuyuGuards?.()||{};return !!g.roundActive||!!g.manualGenerating||!!g.takeoverPending;},
            changed:()=>{const live=owner.currentContext||ctx;live.refreshNpcList?.();window.__gdRefreshDashboard?.();}});
        const profileEditor = createProfileEditorPort({getTarget:()=>host?.currentTarget(),getMetadata:ctx.getChatMetadata,getCharacters:ctx.getCharacters,getCreationContext:()=>ctx.profileSystem.inspectManualCreation(),extensionKey:ctx.EXT_KEY,saveChatConfirmed:ctx.saveProfileEditorChatConfirmed,
            isBusy:()=>{const g=ctx.getMuyuGuards?.()||{};return !!g.roundActive||!!g.manualGenerating||!!g.takeoverPending||!!ctx.profileSystem?.isGenerating?.()||!!ctx.profileLibrarySystem?.isAutoLoading?.()||getQuickActions(owner.currentContext||ctx).unavailable('profiles')==='busy';},
            changed:()=>{const live=owner.currentContext||ctx;live.profileSystem?.refreshProfileManagementUI?.();window.__gdRefreshDashboard?.();}});
        const memoryEditor = createMemoryEditorPort({getTarget:()=>host?.currentTarget(),getMetadata:ctx.getChatMetadata,getCharacters:ctx.getCharacters,getSettings:()=>ctx.settings,getChatLength:()=>ctx.getContext().chat?.length,extensionKey:ctx.EXT_KEY,saveChatConfirmed:ctx.saveMemoriesChatConfirmed,
            isBusy:()=>{const g=ctx.getMuyuGuards?.()||{};return !!g.roundActive||!!g.manualGenerating||!!g.takeoverPending||!!ctx.memorySystem?.isGenerating?.()||getQuickActions(owner.currentContext||ctx).unavailable('memory')==='busy';},
            changed:()=>{const live=owner.currentContext||ctx;live.renderMemoryList?.();window.__gdRefreshDashboard?.();}});
        const variableEditor = createVariableEditorPort({
            getTarget: () => host?.currentTarget(), getMetadata: ctx.getChatMetadata, getSettings: () => ctx.settings,
            getCharacters: () => (ctx.getCharacters?.() || []).map(c => ({avatar:c.avatar,name:c.name})), getGroup: ctx.getCurrentGroup,
            extensionKey: ctx.EXT_KEY, saveChatConfirmed: ctx.saveVariablesChatConfirmed,
            isBusy: () => {
                const guards=ctx.getMuyuGuards?.()||{};
                return !!guards.roundActive||!!guards.manualGenerating||!!guards.takeoverPending||!!ctx.storyBlueprintSystem?.isGenerating?.();
            },
            changed: () => { window.__gdRefreshVariables?.(); window.__gdRefreshDashboard?.(); },
        });
        const variableWriter = createVariableWriter({ draftPort: variableDraftPort, editorPort: variableEditor, getTarget: () => host?.currentTarget(),
            isBusy: variablesBusy,
            getMetadata: ctx.getChatMetadata, extensionKey: ctx.EXT_KEY, saveChatConfirmed: ctx.saveVariablesChatConfirmed,
            changed: () => { window.__gdRefreshVariables?.(); window.__gdRefreshDashboard?.(); } });
        const configWriter = createConfigWriter({ getSettings: () => ctx.settings, saveSettings: ctx.saveMuyuCredentials, memoryLimitPort, completionVariablePort, blueprintTogglePort,
            settingsSwitchPort: createSettingsSwitchPort({ customPromptsSystem: ctx.customPromptsSystem, profileLibrarySystem: ctx.profileLibrarySystem }),
            isBusy: () => !ctx.getMuyuGuards || Object.entries(ctx.getMuyuGuards()).some(([key, value]) => ['roundActive', 'takeoverPending', 'manualGenerating'].includes(key) && value) || !!ctx.summarySystem?.isGenerating?.() || !!ctx.critiqueSystem?.isGenerating?.() || !!ctx.profileSystem?.isGenerating?.() || !!ctx.storyBlueprintSystem?.isGenerating?.() || !!ctx.npcSystem?.isGenerating?.() || ['profiles', 'memory', 'summary', 'blueprint'].some(id => getQuickActions(ctx).unavailable(id) === 'busy'),
            changed: fields => {
                const live = owner.currentContext || ctx;
                syncGeneralSettingsView(live, fields);
                if (fields.includes('customPromptsEnabled')) live.$c('cp-enabled').prop('checked', live.settings.customPromptsEnabled !== false);
                for (const [key, id] of Object.entries({ enabled: 'profile-library-auto-enabled', overwriteExisting: 'profile-library-overwrite', importTemplate: 'profile-library-import-template' })) {
                    if (fields.includes('profileLibraryAutoLoad.' + key)) live.$c(id).prop('checked', !!live.settings.profileLibraryAutoLoad?.[key]);
                }
                if (fields.some(key => key.startsWith('profileLibraryAutoLoad.'))) window.__gdRefreshDashboard?.();
                getQuickActions(live).refresh();
                if (fields.includes('profileEnabled')) {
                    live.$c('profile-enabled').prop('checked', live.settings.profileEnabled);
                    live.$c('qs-profile-enabled').prop('checked', live.settings.profileEnabled);
                    $('#gd-profile-section').toggle(live.settings.profileEnabled);
                    if (live.settings.profileEnabled) {
                        live.refreshProfileManagementUI?.();
                        live.checkProfileStartupStatus?.();
                    }
                    window.__gdRefreshDashboard?.();
                }
                if (fields.includes('profileTokenBudget')) live.$c('profile-token-budget').val(live.settings.profileTokenBudget);
                if (fields.includes('profileConcurrency')) live.$c('profile-concurrency').val(live.settings.profileConcurrency);
                if (fields.includes('storyBlueprintEnabled')) {
                    live.$c('story-blueprint-enabled').prop('checked', live.settings.storyBlueprintEnabled);
                    window.__gdRefreshDashboard?.();
                }
                if (fields.includes('storyBlueprintAutoContinue')) live.$c('story-blueprint-auto-continue').prop('checked', live.settings.storyBlueprintAutoContinue);
                if (fields.includes('storyBlueprintMaxNodes')) live.$c('story-blueprint-max-nodes').val(live.settings.storyBlueprintMaxNodes);
                if (fields.includes('llmHistoryEnabled')) live.$c('llm-history-enabled').prop('checked', live.settings.llmHistoryEnabled);
                if (fields.includes('llmWorldInfoEnabled')) live.$c('llm-world-info-enabled').prop('checked', live.settings.llmWorldInfoEnabled);
                if (fields.includes('llmScriptEnabled')) { live.$c('llm-script-enabled').prop('checked', live.settings.llmScriptEnabled); window.__gdRefreshDashboard?.(); }
                if (fields.includes('llmScriptPosition')) live.$c('llm-script-position').val(String(live.settings.llmScriptPosition));
                if (fields.includes('llmScriptContinuity')) live.$c('llm-script-continuity').prop('checked', live.settings.llmScriptContinuity);
                if (fields.includes('llmScriptContinuityMode')) {
                    $(`input[name="gd-llm-script-continuity-mode"][value="${live.settings.llmScriptContinuityMode}"]`).prop('checked', true);
                    toggleContinuityMode(live.settings.llmScriptContinuityMode);
                }
                if (fields.includes('llmScriptContinuityCount') && live.$c('llm-script-continuity-count')[0] !== globalThis.document?.activeElement) live.$c('llm-script-continuity-count').val(live.settings.llmScriptContinuityCount);
                if (fields.includes('forceSpeakMode')) {
                    $(`input[name="gd-force-speak-mode"][value="${live.settings.forceSpeakMode}"]`).prop('checked', true);
                    $('#gd-force-speak-llm-section').toggle(live.settings.forceSpeakMode === 'llm');
                }
                if (fields.includes('templateMaxPasses') && live.$c('template-max-passes')[0] !== globalThis.document?.activeElement) live.$c('template-max-passes').val(live.settings.templateMaxPasses);
                if (fields.includes('templateRecursive')) live.$c('template-recursive').prop('checked', live.settings.templateRecursive);
                if (fields.includes('templateDebugPlaceholders')) live.$c('template-debug-placeholders').prop('checked', live.settings.templateDebugPlaceholders);
                if (fields.includes('storyBlueprintCompletionVariable')) live.$c('story-blueprint-var').val(live.settings.storyBlueprintCompletionVariable);
                if (fields.includes('npcEnabled')) {
                    live.$c('npc-enabled').prop('checked', live.settings.npcEnabled);
                    $('#gd-npc-section').toggle(live.settings.npcEnabled);
                    // Populate an untouched list, but never rebuild an open NPC editor draft.
                    if (live.settings.npcEnabled && !live.$c('npc-list').contents().length) live.refreshNpcList?.();
                    window.__gdRefreshDashboard?.();
                }
                if (fields.includes('npcMaxCount')) live.$c('npc-max-count').val(live.settings.npcMaxCount);
                if (fields.includes('npcBatchSize')) live.$c('npc-batch-size').val(live.settings.npcBatchSize);
                if (fields.includes('npcGenerateFirstMes')) live.$c('npc-generate-firstmes').prop('checked', live.settings.npcGenerateFirstMes);
                if (fields.includes('memoryKeepRecent')) live.$c('memory-keep-recent').val(live.settings.memoryKeepRecent);
                if (fields.includes('memoryMaxEntries')) live.$c('memory-max-entries').val(live.settings.memoryMaxEntries);
                if (fields.includes('traceMaxEntries')) {
                    live.AgentTrace?.setMax(live.settings.traceMaxEntries);
                    live.$c('trace-max').val(live.settings.traceMaxEntries);
                }
                if (fields.includes('postSpeechMessageEnabled')) {
                    live.$c('ps-msg-enabled').prop('checked', live.settings.postSpeechMessageEnabled);
                    $('#gd-ps-msg-section').toggle(live.settings.postSpeechMessageEnabled);
                    window.__gdRefreshDashboard?.();
                }
                if (fields.includes('postSpeechRoundEnabled')) {
                    live.$c('ps-round-enabled').prop('checked', live.settings.postSpeechRoundEnabled);
                    $('#gd-ps-round-section').toggle(live.settings.postSpeechRoundEnabled);
                    window.__gdRefreshDashboard?.();
                }
                if (fields.includes('postSpeechBlocking')) live.$c('ps-blocking').prop('checked', live.settings.postSpeechBlocking);
                if (fields.includes('postSpeechDecisionLimit')) {
                    live.$c('ps-decision-limit').val(live.settings.postSpeechDecisionLimit);
                    live.refreshPostSpeechDecisions?.();
                }
                syncConfigPromptEditors({ fields, settings: live.settings, getControl: id => live.$c(id), activeElement: globalThis.document?.activeElement });
                if (fields.includes('worldBookSourceMode') || fields.includes('worldBookMaxEntries')) {
                    live.worldBookScanner?.clearCache?.();
                    if (fields.includes('worldBookSourceMode')) {
                        live.$c('world-book-source-mode').val(live.settings.worldBookSourceMode);
                        try { Promise.resolve(live.renderWorldBookList?.()).catch(() => {}); } catch { /* UI refresh only. */ }
                    }
                    if (fields.includes('worldBookMaxEntries')) live.$c('world-book-max-entries').val(live.settings.worldBookMaxEntries);
                }
            } });
        const blueprintLibraries = ctx.storyBlueprintLibrarySystem ? createBlueprintLibraryPort({ getSettings: () => ctx.settings, system: ctx.storyBlueprintLibrarySystem }) : null;
        const npcLibraries = ctx.npcLibrarySystem ? createNpcLibraryPort({ getSettings: () => ctx.settings, system: ctx.npcLibrarySystem }) : null;
        const profileLibraries = ctx.profileLibrarySystem ? createProfileLibraryPort({ getSettings: () => ctx.settings, system: ctx.profileLibrarySystem }) : null;
        const memoryGeneration = ctx.memorySystem?.generateApproved ? createMemoryGenerationPort({ getTarget: () => host?.currentTarget(), getSettings: () => ctx.settings,
            getContext: ctx.getContext, getCharacters: ctx.getCharacters, getProviders: ctx.getMuyuProviders, system: ctx.memorySystem,
            saveChatConfirmed: ctx.saveMemoriesChatConfirmed,
            isBusy: () => { const g = ctx.getMuyuGuards?.() || {}; return !!g.roundActive || !!g.manualGenerating || !!g.takeoverPending || !!ctx.summarySystem?.isGenerating?.() || !!ctx.critiqueSystem?.isGenerating?.() || !!ctx.profileSystem?.isGenerating?.() || !!ctx.npcSystem?.isGenerating?.() || !!ctx.storyBlueprintSystem?.isGenerating?.(); },
            changed: () => { const live = owner.currentContext || ctx; live.renderMemoryList?.(); window.__gdRefreshDashboard?.(); } }) : null;
        const profileGeneration = ctx.profileSystem?.generateApproved ? createProfileGenerationPort({ getTarget: () => host?.currentTarget(), getSettings: () => ctx.settings,
            getContext: ctx.getContext, getCharacters: ctx.getCharacters, getProviders: ctx.getMuyuProviders, system: ctx.profileSystem,
            saveChatConfirmed: ctx.saveProfilesChatConfirmed,
            // Do not include profileSystem's own physical lease: current() also runs inside this generation.
            isBusy: () => { const g = ctx.getMuyuGuards?.() || {}; return !!g.roundActive || !!g.manualGenerating || !!g.takeoverPending || !!ctx.profileLibrarySystem?.isAutoLoading?.() || !!ctx.memorySystem?.isGenerating?.() || !!ctx.summarySystem?.isGenerating?.() || !!ctx.critiqueSystem?.isGenerating?.() || !!ctx.npcSystem?.isGenerating?.() || !!ctx.storyBlueprintSystem?.isGenerating?.(); } }) : null;
        const npcGeneration = ctx.npcSystem?.generateApproved ? createNpcGenerationPort({ getTarget: () => host?.currentTarget(), getSettings: () => ctx.settings,
            getContext: ctx.getContext, getProviders: ctx.getMuyuProviders, system: ctx.npcSystem,
            saveChatConfirmed: ctx.saveNpcChatConfirmed,
            // Its own physical lease is checked by npcSystem, not by this cross-business guard.
            isBusy: () => { const g = ctx.getMuyuGuards?.() || {}; return !!g.roundActive || !!g.manualGenerating || !!g.takeoverPending || !!ctx.profileLibrarySystem?.isAutoLoading?.() || !!ctx.memorySystem?.isGenerating?.() || !!ctx.profileSystem?.isGenerating?.() || !!ctx.summarySystem?.isGenerating?.() || !!ctx.critiqueSystem?.isGenerating?.() || !!ctx.storyBlueprintSystem?.isGenerating?.(); } }) : null;
        const generationBatch = memoryGeneration && profileGeneration && npcGeneration && ctx.AgentRegistry ? createGenerationBatchPort({
            getTarget: () => host?.currentTarget(), getSettings: () => ctx.settings, getContext: ctx.getContext,
            getCharacters: ctx.getCharacters, getProviders: ctx.getMuyuProviders,
            getAgents: () => ctx.AgentRegistry.list().map(row => ctx.AgentRegistry.get(row.id)),
            extensionKey: ctx.EXT_KEY, memoryGeneration, profileGeneration, npcGeneration,
            isBusy: () => { const g = ctx.getMuyuGuards?.() || {}; return !!g.roundActive || !!g.manualGenerating || !!g.takeoverPending || !!ctx.profileLibrarySystem?.isAutoLoading?.() || !!ctx.memorySystem?.isGenerating?.() || !!ctx.profileSystem?.isGenerating?.() || !!ctx.npcSystem?.isGenerating?.() || !!ctx.summarySystem?.isGenerating?.() || !!ctx.critiqueSystem?.isGenerating?.() || !!ctx.storyBlueprintSystem?.isGenerating?.(); },
        }) : null;
        const skills = createSkillPort({ getSettings: () => ctx.settings, saveSettings: ctx.saveMuyuCredentials });
        const customPrompts = ctx.customPromptsSystem ? createCustomPromptPort({ getSettings: () => ctx.settings, system: ctx.customPromptsSystem }) : null;
        const customAgents = ctx.customAgentSystem ? createCustomAgentPort({ getSettings: () => ctx.settings, system: ctx.customAgentSystem, getProviders: ctx.getMuyuProviders, getContext: ctx.getContext, getTarget: () => host?.currentTarget(),
            changed: () => owner.currentContext?.refreshCustomAgentList?.() }) : null;
        const scriptExecutors = createScriptExecutorPort({ getSettings: () => ctx.settings, getContext: ctx.getContext, getTarget: () => host?.currentTarget(), system: ctx.scriptExecutorSystem, testRunner: createBrowserScriptTester(),
            changed: () => owner.currentContext?.refreshScriptExecutorList?.() });
        const bundleDraftPort = createTaskBundleDraftPort({ getTarget: () => host?.currentTarget(), getSettings: () => ctx.settings, variableDraftPort, scriptPort: scriptExecutors });
        const bundleWriter = createTaskBundleWriter({ draftPort: bundleDraftPort, getTarget: () => host?.currentTarget(), variableWriter, configWriter, scriptWriter: scriptExecutors });
        const profileWriter = createProfileWriter({ getSettings: () => ctx.settings, saveSettings: ctx.saveMuyuCredentials,
            getDrawerKeys: () => ctx.configProfileSystem.getDrawerKeys(), onSaved: () => window.__gdRefreshConfigList?.() });
        const providerAssets = createProviderAssetPort({ getSettings: () => ctx.settings, loader: ctx.userProviderLoader,
            testRunner: createBrowserProviderTester(),
            getProviders: ctx.getMuyuProviders, registerProvider: provider => window.GroupDirector.registerProvider(provider),
            changed: () => owner.currentContext?.refreshUserProviderList?.() });
        const profileLibraryChat = profileLibraries ? createProfileLibraryChatPort({
            getSettings: () => ctx.settings, getMetadata: ctx.getChatMetadata, getTarget: () => host?.currentTarget(),
            system: ctx.profileLibrarySystem, libraryPort: profileLibraries, saveChatConfirmed: ctx.saveProfilesChatConfirmed,
            isBusy: () => !!ctx.profileSystem?.isGenerating?.() || ['busy', 'round-active'].includes(getQuickActions(ctx).unavailable('profiles')),
        }) : null;
        const blueprintLibraryChat = blueprintLibraries ? createBlueprintLibraryChatPort({
            getSettings: () => ctx.settings, getMetadata: ctx.getChatMetadata, getTarget: () => host?.currentTarget(),
            getChatLength: () => ctx.getContext()?.chat?.length ?? 0, extensionKey: ctx.EXT_KEY,
            system: ctx.storyBlueprintLibrarySystem, libraryPort: blueprintLibraries, saveChatConfirmed: ctx.saveBlueprintLibraryChatConfirmed,
            isBusy: () => {
                const guards = ctx.getMuyuGuards?.() || {};
                return !!ctx.storyBlueprintSystem?.isGenerating?.() || !!guards.roundActive || !!guards.manualGenerating || !!guards.takeoverPending;
            },
        }) : null;
        const npcLibraryChat = npcLibraries ? createNpcLibraryChatPort({
            getSettings: () => ctx.settings, getMetadata: ctx.getChatMetadata, getTarget: () => host?.currentTarget(),
            system: ctx.npcLibrarySystem, libraryPort: npcLibraries, saveChatConfirmed: ctx.saveNpcChatConfirmed,
            isBusy: () => {
                const guards = ctx.getMuyuGuards?.() || {};
                return !!ctx.npcSystem?.isGenerating?.() || !!guards.roundActive || !!guards.manualGenerating || !!guards.takeoverPending;
            },
        }) : null;
        host = createHostBridge({ getContext: ctx.getContext, getSettings: () => ctx.settings, extensionKey: ctx.EXT_KEY, getGuards: ctx.getMuyuGuards, providerPort, stDiagnostics, stPromptSnapshots, providerAssets, scriptExecutors, customAgents, memoryGeneration, profileGeneration, npcGeneration, generationBatch, skills, customPrompts, profileLibraries, npcLibraries, blueprintLibraries, blueprintLibraryChat, profileLibraryChat, npcLibraryChat, credentials, runConfig, permissionConfig, contextConfig, instructionConfig, displayConfig, history, agentMemory, webSearch, services, configWriter, variableDraftPort, variableEditor, memoryEditor, profileEditor, npcEditor, selectionEditor, ledgerEditor, characterCards, stPresetEditor, worldBookEditor, blueprintNodeEditor, variableWriter, bundleDraftPort, bundleWriter, profileWriter, memoryLimitPort, completionVariablePort, blueprintTogglePort });
        owner.controller = createMuyuController({ host });
        owner.floatingRegistry = createFloatingRegistry();
        owner.floatingRegistry.register({
            id: 'muyu', label: { zh: '暮羽助手', en: 'Muyu assistant' }, icon: '✦', order: 10,
            isAvailable: () => true,
            getPresentation: () => {
                const s = owner.controller.snapshot();
                return { ...muyuFloatingState(s), completionVersion: s.completionVersion };
            },
            subscribe: notify => owner.controller.subscribe(notify).unsubscribe,
            mount: (container, options) => mountMuyuPanel(container, owner.controller, {
                ...options, standalone: true,
                navigateDirector: () => {
                    options.close();
                    const panel = document.getElementById('gd-settings-panel');
                    if (panel && !panel.getClientRects().length) document.querySelector('#gd-settings-button .drawer-toggle')?.click();
                    document.querySelector('.group-director-settings')?.__gdNavigation?.navigate('rules', { focus: true });
                    const control = document.getElementById('gd-mode-formula');
                    for (let p = control?.parentElement; p; p = p.parentElement) {
                        if (p.classList.contains('inline-drawer-content')) p.style.display = 'block';
                    }
                    control?.scrollIntoView({ block: 'center', behavior: 'smooth' }); control?.focus();
                },
                navigateMemory: () => {
                    const control = document.getElementById('gd-memory-enabled'); if (!control) return;
                    options.close();
                    document.querySelector('.group-director-settings')?.__gdNavigation?.navigate('memory', { focus: false });
                    for (let p = control.parentElement; p; p = p.parentElement) {
                        if (p.classList.contains('inline-drawer-content')) p.style.display = 'block';
                    }
                    const panel = document.getElementById('gd-settings-panel');
                    if (panel && !panel.getClientRects().length) document.querySelector('#gd-settings-button .drawer-toggle')?.click();
                    control.scrollIntoView({ block: 'center', behavior: 'smooth' }); control.focus();
                },
            }),
        });
        owner.floating = createFloatingShell({ registry: owner.floatingRegistry, lang: ctx.settings.lang,
            getBallPosition: () => (owner.currentContext || ctx).settings.muyuFloatingPosition,
            saveBallPosition: position => {
                const current = owner.currentContext || ctx;
                current.settings.muyuFloatingPosition = position;
                return current.saveMuyuCredentials();
            },
        });
        window.addEventListener('pagehide', event => {
            if (event.persisted) return;
            owner.floating.dispose(); owner.floatingRegistry.dispose(); void owner.controller.dispose().catch(() => {});
        });
    }
    owner.refreshView = (options = {}) => {
        root.__gdMuyuDispose?.(); owner.floating.setLanguage(ctx.settings.lang, options);
        const en = ctx.settings.lang === 'en'; root.classList.add('gd-muyu-entry');
        const label = document.createElement('label'); label.className = 'checkbox_label';
        const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.id = 'gd-muyu-floating-ball-visible';
        toggle.checked = ctx.settings.muyuFloatingBallVisible !== false;
        owner.floating.setBallVisible(toggle.checked);
        const text = document.createElement('span'); text.textContent = UI_LABELS.showBall[en ? 1 : 0];
        label.htmlFor = toggle.id; label.append(toggle, text);
        const hint = document.createElement('small');
        const hintText = en ? 'Hide only the launcher; ongoing tasks are not stopped. Enable here to show it again.' : '仅隐藏入口，不停止正在执行的任务；可在这里重新开启。';
        hint.textContent = hintText;
        label.title = hintText;
        hint.hidden = true;
        hint.setAttribute('role', 'status');
        toggle.onchange = async () => {
            const previous = ctx.settings.muyuFloatingBallVisible;
            ctx.settings.muyuFloatingBallVisible = toggle.checked;
            owner.floating.setBallVisible(toggle.checked); toggle.disabled = true;
            try { await ctx.saveMuyuCredentials(); hint.textContent = hintText; hint.hidden = true; }
            catch {
                ctx.settings.muyuFloatingBallVisible = previous;
                toggle.checked = previous !== false; owner.floating.setBallVisible(toggle.checked);
                hint.textContent = en ? 'Could not save; previous visibility restored.' : '保存失败，已恢复原显示设置。';
                hint.hidden = false;
            } finally { toggle.disabled = false; }
        };
        root.append(label, hint);
        root.__gdMuyuDispose = () => { toggle.onchange = null; root.replaceChildren(); delete root.__gdMuyuDispose; };
    };
    owner.refreshView();
});
