import { createToolboxModule } from './toolbox.js';
import { createSkillModule } from './skills/index.js';
import { createSkillRuntimeModule } from './skills/runtime.js';
import { createSelectionEditorModule } from './selection-editor/index.js';
import { createLedgerEditorModule } from './ledger-editor/index.js';
import { createStPresetModule } from './st-preset-editor/index.js';
import { createCharacterCardModule } from './character-card/index.js';
import { createWorldBookEditorModule } from './worldbook-editor/index.js';
import { createBlueprintNodeEditorModule } from './blueprint-node-editor/index.js';
import { createNpcEditorModule } from './npc-editor/index.js';
import { createProfileEditorModule } from './profile-editor/index.js';
import { createMemoryEditorModule } from './memory-editor/index.js';
import { createMemoryReader } from './memory/reader.js';
import { createMemoryModule } from './memory/index.js';
import { createConfigDraftModule } from './config-draft/index.js';
import { memoryFields } from './config-draft/contracts.js';
import { createDirectorModule } from './director/index.js';
import { createContextModule } from './context/index.js';
import { createProviderModule } from './providers/index.js';
import { createInteractionModule } from './interaction/index.js';
import { createPermissionModule } from './permission/index.js';
import { createSettingsModule } from './settings/index.js';
import { createTaskPlanModule } from './task-plan/index.js';
import { createVariableEditorModule } from './variable-editor/index.js';
import { createVariableDraftModule } from './variables/index.js';
import { createTaskBundleModule } from './task-bundle/index.js';
import { createProfileDraftModule } from './profile-draft/index.js';
import { createBlueprintLibraryChatModule } from './blueprint-library-chat/index.js';
import { createNpcLibraryChatModule } from './npc-library-chat/index.js';
import { createProfileLibraryChatModule } from './profile-library-chat/index.js';
import { createBlueprintLibraryModule } from './blueprint-libraries/index.js';
import { createNpcLibraryModule } from './npc-libraries/index.js';
import { createProfileLibraryModule } from './profile-libraries/index.js';
import { createCustomPromptModule } from './custom-prompts/index.js';
import { createGenerationBatchModule } from './generation-batch/index.js';
import { createNpcGenerationModule } from './npc-generation/index.js';
import { createProfileGenerationModule } from './profile-generation/index.js';
import { createMemoryGenerationModule } from './memory-generation/index.js';
import { createCustomAgentModule } from './custom-agents/index.js';
import { createScriptExecutorModule } from './script-executors/index.js';
import { createProviderAssetModule } from './provider-assets/index.js';
import { createHistoryModule } from './history/index.js';
import { createWebSearchModule } from './web/index.js';
import { createServiceDocumentModule } from './service-documents/index.js';
import { createServicePageModule } from './service-pages/index.js';
import { createServiceWorkspaceModule } from './service-workspace/index.js';
import { createAgentMemoryModule } from './agent-memory/index.js';
import { createVariableDraftPort } from '../host/variable-draft.js';
import { createTaskBundleDraftPort } from '../host/task-bundle-draft.js';
import { createToolPlan } from './tool-plan.js';
import { createArtifactOwners } from './artifact-owners.js';
import { createDraftAssembly } from './draft-assembly.js';
import { editorDescriptors } from './editor-assembly.js';
import { assetDescriptors } from './asset-assembly.js';
import { executionDescriptors } from './execution-assembly.js';
import { readDescriptors } from './read-assembly.js';
import { supportDescriptors } from './support-assembly.js';
import { toolCapability } from '../application/capabilities.js';
import { toolLabels } from './catalog.js';

/** Composition owns module lifecycle and task hooks, not the UI controller. */
export function createBuiltins(host) {
    const memory = createMemoryModule({ reader: createMemoryReader(host.memoryPorts) });
    const draft = createConfigDraftModule({ getSettings: host.getSettings, getTarget: host.configTarget });
    const director = createDirectorModule({ ports: host.memoryPorts });
    const settings = createSettingsModule({ getSettings: host.getSettings, getTarget: host.configTarget, memoryLimitPort: host.memoryLimitPort, completionVariablePort: host.completionVariablePort, blueprintTogglePort: host.blueprintTogglePort });
    const context = createContextModule(), history = createHistoryModule({ access: host.historyAccess, budget: host.historyReadBudget }), providers = createProviderModule(host), interaction = createInteractionModule(), permission = createPermissionModule(), taskPlan = createTaskPlanModule({ bindStep: host.bindTaskStep, bindRead: host.bindTaskRead });
    const variablePort = host.variableDraftPort || createVariableDraftPort(host.memoryPorts);
    const variableEditor = createVariableEditorModule({port:host.variableEditor,charge:(id,bytes)=>providers.charge(id,bytes)});
    const variables = createVariableDraftModule({ port: variablePort });
    const bundle = createTaskBundleModule({ port: host.bundleDraftPort || createTaskBundleDraftPort({ getTarget: host.currentTarget, getSettings: host.getSettings, variableDraftPort: variablePort, scriptPort: host.scriptExecutors }) });
    const profiles = createProfileDraftModule(), web = createWebSearchModule();
    const documents = createServiceDocumentModule({ port: host.services, usage: id => providers.usage(id), charge: (id, bytes) => providers.charge(id, bytes) });
    const pages = createServicePageModule({ port: host.services, usage: id => providers.usage(id), charge: (id, bytes) => providers.charge(id, bytes) });
    const workspace = createServiceWorkspaceModule({port:host.services,charge:(id,bytes)=>providers.charge(id,bytes),usage:id=>providers.usage(id)});
    const notes = createAgentMemoryModule({ port: host.agentMemory, budget: id => providers.usage(id).limit, used: id => providers.usage(id).used, charge: (id, bytes) => providers.charge(id, bytes) });
    const providerAssets = createProviderAssetModule({ port: host.providerAssets, charge: (id, bytes) => providers.charge(id, bytes) });
    const scripts = createScriptExecutorModule({ port: host.scriptExecutors, charge: (id, bytes) => providers.charge(id, bytes) });
    const generationBatch = createGenerationBatchModule({ port: host.generationBatch, charge: (id, bytes) => providers.charge(id, bytes) });
    const npcGeneration = createNpcGenerationModule({ port: host.npcGeneration, charge: (id, bytes) => providers.charge(id, bytes) });
    const profileGeneration = createProfileGenerationModule({ port: host.profileGeneration, charge: (id, bytes) => providers.charge(id, bytes) });
    const memoryGeneration = createMemoryGenerationModule({ port: host.memoryGeneration, charge: (id, bytes) => providers.charge(id, bytes) });
    const customAgents = createCustomAgentModule({ port: host.customAgents, charge: (id, bytes) => providers.charge(id, bytes) });
    const toolbox = createToolboxModule();
    const skills = createSkillModule({ port: host.skills, charge: (id, bytes) => providers.charge(id, bytes) });
    const skillRuntime = createSkillRuntimeModule({ port: host.skills, charge: (id, bytes) => providers.charge(id, bytes) });
    const customPrompts = createCustomPromptModule({ port: host.customPrompts, charge: (id, bytes) => providers.charge(id, bytes) });
    const profileLibraries = createProfileLibraryModule({ port: host.profileLibraries, charge: (id, bytes) => providers.charge(id, bytes) });
    const profileLibraryChat = createProfileLibraryChatModule({ port: host.profileLibraryChat });
    const npcLibraries = createNpcLibraryModule({ port: host.npcLibraries, charge: (id, bytes) => providers.charge(id, bytes) });
    const blueprintLibraryChat = createBlueprintLibraryChatModule({ port: host.blueprintLibraryChat });
    const npcLibraryChat = createNpcLibraryChatModule({ port: host.npcLibraryChat });
    const blueprintLibraries = createBlueprintLibraryModule({ port: host.blueprintLibraries, charge: (id, bytes) => providers.charge(id, bytes) });
    const memoryEditor = createMemoryEditorModule({port:host.memoryEditor,charge:(id,bytes)=>providers.charge(id,bytes)});
    const profileEditor = createProfileEditorModule({port:host.profileEditor,charge:(id,bytes)=>providers.charge(id,bytes)});
    const npcEditor = createNpcEditorModule({port:host.npcEditor,charge:(id,bytes)=>providers.charge(id,bytes)});
    const selectionEditor = createSelectionEditorModule({port:host.selectionEditor,charge:(id,bytes)=>providers.charge(id,bytes)});
    const ledgerEditor = createLedgerEditorModule({port:host.ledgerEditor,charge:(id,bytes)=>providers.charge(id,bytes)});
    const stPresetEditor = createStPresetModule({port:host.stPresetEditor,charge:(id,bytes)=>providers.charge(id,bytes)});
    const characterCards = createCharacterCardModule({port:host.characterCards,charge:(id,bytes)=>providers.charge(id,bytes)});
    const worldBookEditor = createWorldBookEditorModule({port:host.worldBookEditor,charge:(id,bytes)=>providers.charge(id,bytes)});
    const blueprintNodeEditor = createBlueprintNodeEditorModule({port:host.blueprintNodeEditor,charge:(id,bytes)=>providers.charge(id,bytes)});
    const modules = [toolbox, generationBatch, npcGeneration, profileGeneration, memoryGeneration, selectionEditor, ledgerEditor, characterCards, stPresetEditor, worldBookEditor, blueprintNodeEditor, npcEditor, profileEditor, memoryEditor, variableEditor, blueprintLibraries, npcLibraryChat, blueprintLibraryChat, npcLibraries, profileLibraryChat, profileLibraries, skills, customPrompts, customAgents, scripts, memory, draft, director, context, history, providers, interaction, permission, settings, taskPlan, variables, bundle, profiles, web, notes, providerAssets];
    const unified = new Map();
    modules.push(skillRuntime);
    modules.push(documents, pages, workspace);
    const legacyPreview = (args, ctx) => {
        const run = unified.get(ctx.runId);
        if (run && !run.bound) {
            draft.bindRun({ runId: ctx.runId, taskId: run.identity.taskId, target: ctx.target, allowedFields: memoryFields,
                previousArtifact: run.intent.artifact?.kind === 'config-draft' ? run.intent.artifact : null });
            run.bound = true;
        }
        return draft.handlers['muyu.config.preview'](args, ctx);
    };
    const draftAssembly = createDraftAssembly({ draft, settings, variables, bundle, legacyPreview,
        extraEntries: [
            ...editorDescriptors(host, { selectionEditor, ledgerEditor, blueprintNodeEditor, stPresetEditor, characterCards, worldBookEditor,
                variableEditor, memoryEditor, profileEditor, npcEditor, providerAssets }),
            ...assetDescriptors(host, { customPrompts, skills, profileLibraries, npcLibraries, blueprintLibraries, profileLibraryChat, npcLibraryChat, blueprintLibraryChat }),
            ...executionDescriptors(host, { scriptExecutors: scripts, customAgents, generationBatch, memoryGeneration, profileGeneration, npcGeneration }),
            ...readDescriptors(host, { toolbox, memory, director, context, history, interaction, permission, skillRuntime }),
            ...supportDescriptors(host, { providers, taskPlan, profiles, web, notes, documents, pages, workspace }),
        ] });
    const draftEntry = id => draftAssembly.toolEntries.find(row => row.id === id);
    const entries = [
        { id: 'toolbox', module: toolbox },
        ...(host.generationBatch ? [{ id: 'generation-batch', module: generationBatch }] : []),
        ...(host.npcGeneration ? [{ id: 'npc-generation', module: npcGeneration }] : []),
        ...(host.profileGeneration ? [{ id: 'profile-generation', module: profileGeneration }] : []),
        ...(host.memoryGeneration ? [{ id: 'memory-generation', module: memoryGeneration }] : []),
        ...(host.selectionEditor ? [{id:'selection-editor',module:selectionEditor}] : []),
        ...(host.ledgerEditor ? [{id:'ledger-editor',module:ledgerEditor}] : []),
        ...(host.stPresetEditor ? [{id:'st-preset-editor',module:stPresetEditor}] : []),
        ...(host.characterCards ? [{id:'character-card',module:characterCards}] : []),
        ...(host.worldBookEditor ? [{id:'worldbook-editor',module:worldBookEditor}] : []),
        ...(host.blueprintNodeEditor ? [{id:'blueprint-node-editor',module:blueprintNodeEditor}] : []),
        ...(host.npcEditor ? [{id:'npc-editor',module:npcEditor}] : []),
        ...(host.profileEditor ? [{id:'profile-editor',module:profileEditor}] : []),
        ...(host.memoryEditor ? [{id:'memory-editor',module:memoryEditor}] : []),
        ...(host.variableEditor ? [{id:'variable-editor',module:variableEditor}] : []),
        { id: 'memory', module: memory },
        draftEntry('legacy-draft'),
        { id: 'director', module: director }, { id: 'context', module: context }, { id: 'history', module: history },
        { id: 'providers', module: providers }, { id: 'interaction', module: interaction },
        { id: 'permission', module: permission }, draftEntry('settings'), { id: 'task-plan', module: taskPlan }, draftEntry('variables'),
        draftEntry('task-bundle'),
        { id: 'profile-draft', module: profiles },
        ...(host.blueprintLibraryChat ? [{ id: 'blueprint-library-chat', module: blueprintLibraryChat }] : []),
        ...(host.npcLibraryChat ? [{ id: 'npc-library-chat', module: npcLibraryChat }] : []),
        ...(host.profileLibraryChat ? [{ id: 'profile-library-chat', module: profileLibraryChat }] : []),
        ...(host.blueprintLibraries ? [{ id: 'blueprint-libraries', module: blueprintLibraries }] : []),
        ...(host.npcLibraries ? [{ id: 'npc-libraries', module: npcLibraries }] : []),
        ...(host.profileLibraries ? [{ id: 'profile-libraries', module: profileLibraries }] : []),
        ...(host.skills ? [{ id: 'skills', module: skills }] : []),
        ...(host.skills?.catalog ? [{ id: 'skill-runtime', module: skillRuntime }] : []),
        ...(host.customPrompts ? [{ id: 'custom-prompts', module: customPrompts }] : []),
        ...(host.customAgents ? [{ id: 'custom-agents', module: customAgents }] : []),
        ...(host.scriptExecutors ? [{ id: 'script-executors', module: scripts }] : []),
        ...(host.providerAssets ? [{ id: 'provider-assets', module: providerAssets }] : []),
        { id: 'web', module: web },
        { id: 'service-documents', module: documents },
        { id: 'service-pages', module: pages },
        { id: 'service-workspace', module: workspace },
        { id: 'agent-memory', module: notes },
    ];
    const labels = Object.fromEntries(Object.entries(toolLabels).filter(([id]) => (host.generationBatch || !generationBatch.registry.list().some(tool => tool.id === id)) && (host.npcGeneration || !npcGeneration.registry.list().some(tool => tool.id === id)) && (host.profileGeneration || !profileGeneration.registry.list().some(tool => tool.id === id)) && (host.memoryGeneration || !memoryGeneration.registry.list().some(tool => tool.id === id)) && (host.selectionEditor || !selectionEditor.registry.list().some(tool=>tool.id===id)) && (host.stPresetEditor || !stPresetEditor.registry.list().some(tool=>tool.id===id)) && (host.characterCards || !characterCards.registry.list().some(tool=>tool.id===id)) && (host.worldBookEditor || !worldBookEditor.registry.list().some(tool=>tool.id===id)) && (host.ledgerEditor || !ledgerEditor.registry.list().some(tool=>tool.id===id)) && (host.blueprintNodeEditor || !blueprintNodeEditor.registry.list().some(tool=>tool.id===id)) && (host.npcEditor || !npcEditor.registry.list().some(tool=>tool.id===id)) && (host.profileEditor || !profileEditor.registry.list().some(tool=>tool.id===id)) && (host.memoryEditor || !memoryEditor.registry.list().some(tool=>tool.id===id)) && (host.variableEditor || !variableEditor.registry.list().some(tool=>tool.id===id)) && (host.blueprintLibraryChat || !blueprintLibraryChat.registry.list().some(tool => tool.id === id)) && (host.blueprintLibraries || !blueprintLibraries.registry.list().some(tool => tool.id === id)) && (host.npcLibraryChat || !npcLibraryChat.registry.list().some(tool => tool.id === id)) && (host.npcLibraries || !npcLibraries.registry.list().some(tool => tool.id === id)) && (host.profileLibraryChat || !profileLibraryChat.registry.list().some(tool => tool.id === id)) && (host.profileLibraries || !profileLibraries.registry.list().some(tool => tool.id === id)) && (host.skills || !skills.registry.list().some(tool => tool.id === id)) && (host.customPrompts || !customPrompts.registry.list().some(tool => tool.id === id)) && (host.customAgents || !customAgents.registry.list().some(tool => tool.id === id)) && (host.providerAssets || !providerAssets.registry.list().some(tool => tool.id === id)) && (host.scriptExecutors || !scripts.registry.list().some(tool => tool.id === id))));
    if (!host.skills?.catalog) for (const definition of skillRuntime.registry.list()) delete labels[definition.id];
    if (!host.bindTaskStep) delete labels['muyu.task.bind_step'];
    if (!host.bindTaskRead) delete labels['muyu.task.bind_read'];
    const { registry, handlers } = createToolPlan(entries.map(entry => {
        const declared = draftEntry(entry.id);
        if (!declared || declared.module !== entry.module && !draftAssembly.owns(entry.module)) throw Error('MODULE_OWNER_MISSING');
        return declared;
    }), { capabilityFor: toolCapability, labels });
    const artifacts = createArtifactOwners(draftAssembly.artifactEntries);
    const shared = [...context.registry.list(), ...interaction.registry.list()].map(d => d.id);
    const tasks = {
        assistant: { module: null,
            bind(identity, intent) {
                unified.set(identity.id, { identity, intent, bound: false });
                draftAssembly.bindAssistant(identity, intent);
            },
            publish(app, id, intent) {
                let failed = false; const published = new Map();
                const publish = fn => { try { fn(); } catch { failed = true; } };
                publish(() => draftAssembly.publishReports(app, id, intent.completedTools));
                for (const candidate of intent.candidates?.values() || []) publish(() => published.set(candidate.candidateId, artifacts.publish(app, id, candidate)));
                return { notice: failed ? 'RESULT_NEEDS_REVIEW' : null, published };
            },
        },
        chat: { module: providers, publish: () => null },
        memory: { module: memory, publish: (app, id) => { memory.publishReport(app, id); return null; } },
        director: { module: director, publish: (app, id) => { director.publishReport(app, id); return null; } },
        draft: { module: draft,
            validate(fields) { if (!Array.isArray(fields) || !fields.length || fields.some(f => !memoryFields.includes(f)) || new Set(fields).size !== fields.length) throw Error('FIELD_SCOPE_REQUIRED'); },
            bind(identity, intent) { draft.bindRun({ runId: identity.id, taskId: identity.taskId, target: identity.target, allowedFields: intent.fields, previousArtifact: intent.artifact }); },
            publish(app, id, intent) { const candidate = intent.candidates?.get('muyu.config.preview'); if (!candidate) return 'NO_CANDIDATE'; artifacts.publish(app, id, candidate); return null; },
        },
    };
    for (const task of Object.values(tasks)) task.tools = task.module ? [...shared, ...task.module.registry.list().map(d => d.id)] : registry.list().map(d => d.id);
    tasks.chat.tools.push(...permission.registry.list().map(d => d.id));
    return { registry, handlers, tasks, toolGroups: draftAssembly.toolGroups, moduleDescriptors: draftAssembly.describe, candidateTool: artifacts.produces, candidateGroup: artifacts.group, invalidateSettingsAttempt: (id, fields) => settings.invalidateAttempt(id, fields), takeInvalidatedSettingsCandidates: id => settings.takeInvalidatedCandidates(id),
        skillGuides: id => host.skills?.catalog ? { prepare: signal => skillRuntime.prepare(id, signal), project: () => skillRuntime.project(id) } : null,
        skillUsage: id => { try { return skillRuntime.usage(id); } catch { return []; } },
        parkSkillRun: (id, artifact) => host.skills?.catalog ? skillRuntime.parkRun(id, artifact) : true,
        forgetSkillTask: id => skillRuntime.forgetTask(id),
        transferRun(from, identity, intent) { const previous = unified.get(from); if (previous) { unified.delete(from); unified.set(identity.id, { ...previous, identity, intent }); } draftAssembly.transferRun(from, identity); for (const module of modules) if (!draftAssembly.owns(module)) module.transferRun?.(from, identity); },
        bindBudget: (id, limit, from = null) => draftAssembly.bindBudget(id, limit, from),
        retainArtifacts: values => { draftAssembly.retainArtifacts(values); modules.filter(m => !draftAssembly.owns(m)).forEach(m => m.retainArtifacts?.(values)); },
        resourceUsage: id => draftAssembly.resourceUsage(id), revalidate: artifacts.revalidate,
        forgetTask: id => {
            const errors = [];
            try { draftAssembly.forgetTask(id); } catch (error) { errors.push(error); }
            for (const module of modules) if (!draftAssembly.owns(module)) try { module.forgetTask?.(id); } catch (error) { errors.push(error); }
            if (errors.length) throw new AggregateError(errors, 'MODULE_TASK_CLEANUP_FAILED');
        },
        forgetRun: id => { unified.delete(id); draftAssembly.forgetRun(id); modules.filter(m => !draftAssembly.owns(m)).forEach(m => m.forgetRun(id)); }, dispose: () => { unified.clear(); draftAssembly.dispose(); modules.filter(m => !draftAssembly.owns(m)).forEach(m => m.dispose()); } };
}
