import { renderSkillSave } from './skill-save-view.js';
import { renderSelectionEditor } from './selection-editor-view.js';
import { renderWorkspace } from './workspace-view.js';
import { renderLedgerEditor } from './ledger-editor-view.js';
import { renderStPreset } from './st-preset-view.js';
import { renderCharacterCard } from './character-card-view.js';
import { renderWorldBookEditor } from './worldbook-editor-view.js';
import { renderBlueprintNodeEditor } from './blueprint-node-editor-view.js';
import { renderNpcEditor } from './npc-editor-view.js';
import { renderProfileEditor } from './profile-editor-view.js';
import { renderMemoryEditor } from './memory-editor-view.js';
import { renderConfigDiff } from './config-diff-view.js';
import { renderConfigApply } from './config-apply-view.js';
import { renderVariableEditor } from './variable-editor-view.js';
import { renderVariableApply } from './variable-apply-view.js';
import { renderTaskBundleApply } from './task-bundle-apply-view.js';
import { renderProfileSave } from './profile-save-view.js';
import { renderBlueprintLibraryChat } from './blueprint-library-chat-view.js';
import { renderNpcLibraryChat } from './npc-library-chat-view.js';
import { renderProfileLibraryChat } from './profile-library-chat-view.js';
import { renderBlueprintLibrarySave } from './blueprint-library-save-view.js';
import { renderNpcLibrarySave } from './npc-library-save-view.js';
import { renderProfileLibrarySave } from './profile-library-save-view.js';
import { renderCustomPromptSave } from './custom-prompt-save-view.js';
import { renderCustomAgentSave } from './custom-agent-save-view.js';
import { renderScriptSave } from './script-save-view.js';
import { renderProviderInstall } from './provider-install-view.js';
import { permissionTitle } from '../permissions/contract.js';
import { createArtifactViews } from './artifact-view-registry.js';
import { builtinActionDescriptors } from '../actions/builtins.js';

function render_report({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    const findingLabels = { fact: t('已确认', 'Confirmed'), unknown: t('尚未确认', 'Unknown'), blocker: t('阻止条件', 'Blocking condition'), condition: t('当前条件', 'Current condition') };
    for (const f of artifact.content.findings) node('p', `${Object.hasOwn(findingLabels, f.kind) ? findingLabels[f.kind] : t('说明', 'Note')}：${f.text}`, card);
    const technical = node('details', '', card);
    node('summary', t('技术详情', 'Technical details'), technical);
    node('pre', JSON.stringify(artifact.content.findings, null, 2), technical);
    node('small', t('这是生成时的证据快照，不是实时状态。', 'Snapshot at generation time, not live state.'), card);
    const director = artifact.content.module === 'director';
    button(director ? t('前往导演设置', 'Open director settings') : t('前往记忆设置', 'Open memory settings'), card).onclick = director ? navigateDirector : navigateMemory;

}

function render_task_plan({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    const plan = artifact.content.plan;
    const availability = {
        'read-only': t('仅可读取', 'Read only'),
        'draft-only': t('仅可预览草稿', 'Draft preview only'),
        'single-draft-approval-required': t('需单份草稿另行批准', 'Separate approval for one draft'),
        'bundle-or-separate-draft-approval-required': t('需精确整单或单份草稿另行批准', 'Separate approval for an exact bundle or draft'),
        'not-available': t('当前不可执行', 'Not available yet'),
        'separate-code-approval-required': t('代码操作需另行审批', 'Code action requires separate approval'),
    };
    node('small', t('这是规划时的方案，不代表实时执行结果或修改批准；实际进展见后续对话与操作回执。', 'This is the proposal at planning time, not a live execution result or write approval. See later replies and receipts for actual progress.'), card);
    for (const step of plan.steps) node('p', `${step.title} · ${availability[step.availability] || step.availability}: ${step.detail}`, card);
    if (plan.risks?.length) node('p', t('风险：', 'Risks: ') + plan.risks.join('；'), card);
    if (plan.unknowns.length) node('p', t('待核实：', 'Unknowns: ') + plan.unknowns.join('；'), card);
    node('p', t('本任务拟读取：', 'Sources requested for this task: ') + (plan.sources.map(permissionTitle).join('；') || t('无', 'None')), card);
    const reviewed = s.approvedPlans?.includes(artifact.id);
    const declined = s.declinedPlans?.includes(artifact.id);
    const invalid = s.invalidPlans?.includes(artifact.id);
    node('small', invalid ? t('任务已停止，本方案不能再用于授权。', 'Task stopped; this plan can no longer grant access.') : reviewed ? t('本次已允许读取上述来源；任务结束后授权失效，未授予写入权限。', 'These sources were allowed for this task; access expires when the task ends, and no write permission was granted.') : declined ? t('已拒绝本方案的资料读取；不会继续执行或改用其他来源。', 'Reads for this plan were declined; it will not continue or use alternate sources.') : t('批准只允许本任务读取列出的来源并继续核对，不批准任何修改；切换聊天或连接后失效。', 'Approval permits only these sources for this task and continues review, not any write. It expires on chat or connection change.'), card);
    if (!reviewed && !declined && !invalid) {
        const approve = button(t('批准方案并开始读取', 'Approve plan and start reading'), card);
        approve.disabled = s.busy || s.resetting || s.readOnly;
        approve.onclick = () => act(() => controller.approveTaskPlanReads(artifact.id, artifact.revision));
        const decline = button(t('不允许读取', 'Decline reads'), card);
        decline.disabled = s.busy || s.resetting || s.readOnly;
        decline.onclick = () => act(() => controller.declineTaskPlanReads(artifact.id, artifact.revision));
    }

}

function render_task_bundle({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    node('small', t('仅预览，未修改内容。执行顺序：当前聊天变量 → 全局配置 → 脚本定义。', 'Preview only; no changes yet. Order: current-chat variables → global settings → script definitions.'), card);
    for (const variable of artifact.content.variables) {
        node('strong', t('当前聊天变量：', 'Current-chat variable: ') + variable.preview.id, card);
        for (const diff of variable.preview.diff) node('p', `${diff.field}: ${JSON.stringify(diff.before)} → ${JSON.stringify(diff.after)}`, card);
    }
    if (artifact.content.settings) {
        node('strong', t('全局配置：影响所有聊天', 'Global settings: affects all chats'), card);
        renderConfigDiff({ doc, parent: card, diff: artifact.content.settings.preview.diff, lang });
        for (const warning of artifact.content.settings.preview.warnings) node('p', warning, card);
    }
    for (const script of artifact.content.scripts || []) {
        const details = node('details', '', card);
        node('summary', t('脚本定义：', 'Script definition: ') + (script.next?.name || script.previous?.name), details);
        node('code', JSON.stringify({ operation: script.operation, before: script.previous, after: script.next }, null, 2), node('pre', '', details));
        for (const warning of script.warnings) node('p', warning, card);
    }
    const recheck = button(t('重新校验整单', 'Revalidate bundle'), card); recheck.disabled = s.busy || s.resetting;
    recheck.onclick = () => act(() => controller.revalidate(artifact.id, artifact.revision));
    renderTaskBundleApply({ doc, card, artifact, state: s, controller, act, lang });

}

function render_blueprint_library_chat_draft({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    renderBlueprintLibraryChat({ doc, card, artifact, state: s, controller, act, lang });

}

function render_npc_library_chat_draft({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    renderNpcLibraryChat({ doc, card, artifact, state: s, controller, act, lang });

}

function render_profile_library_chat_draft({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    renderProfileLibraryChat({ doc, card, artifact, state: s, controller, act, lang });

}

function render_blueprint_library_draft({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    renderBlueprintLibrarySave({ doc, card, artifact, state: s, controller, act, lang });

}

function render_npc_library_draft({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    renderNpcLibrarySave({ doc, card, artifact, state: s, controller, act, lang });

}

function render_profile_library_draft({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    renderProfileLibrarySave({ doc, card, artifact, state: s, controller, act, lang });

}

function render_skill_draft({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    renderSkillSave({ doc, card, artifact, state: s, controller, act, lang });

}

function render_custom_prompt_draft({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    renderCustomPromptSave({ doc, card, artifact, state: s, controller, act, lang });

}

function render_custom_agent_draft({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    renderCustomAgentSave({ doc, card, artifact, state: s, controller, act, lang });

}

function render_script_draft({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    renderScriptSave({ doc, card, artifact, state: s, controller, act, lang });

}

function render_provider_draft({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    renderProviderInstall({ doc, card, artifact, state: s, controller, act, lang });

}

function render_profile_draft({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    node('p', artifact.content.name, card);
    if (artifact.content.description) node('small', artifact.content.description, card);
    renderConfigDiff({ doc, parent: card, settings: artifact.content.settings, lang });
    for (const warning of artifact.content.warnings) node('small', warning, card);
    node('small', t('这是一份可复用的局部配置档；保存到库不会修改当前设置。以后应用配置档时，以上字段将影响所有聊天，未列出的字段保持不变。', 'Reusable partial profile. Saving does not change active settings. Applying it later affects all chats for the listed fields; omitted fields stay unchanged.'), card);
    const recheck = button(t('重新校验配置档', 'Revalidate profile'), card); recheck.disabled = s.busy || s.resetting;
    recheck.onclick = () => act(() => controller.revalidate(artifact.id, artifact.revision));
    renderProfileSave({ doc, card, artifact, state: s, controller, act, lang });

}

function render_selection_draft({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    renderSelectionEditor({doc,card,artifact,state:s,controller,act,lang});

}

function render_st_preset_draft({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    renderStPreset({doc,card,artifact,state:s,controller,act,lang});

}

function render_character_card_draft({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    renderCharacterCard({doc,card,artifact,state:s,controller,act,lang});

}

function render_worldbook_edit_draft({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    renderWorldBookEditor({doc,card,artifact,state:s,controller,act,lang});

}

function render_ledger_edit_draft({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    renderLedgerEditor({doc,card,artifact,state:s,controller,act,lang});

}

function render_blueprint_node_edit_draft({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    renderBlueprintNodeEditor({doc,card,artifact,state:s,controller,act,lang});

}

function render_npc_edit_draft({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    renderNpcEditor({doc,card,artifact,state:s,controller,act,lang});

}

function render_profile_edit_draft({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    renderProfileEditor({doc,card,artifact,state:s,controller,act,lang});

}

function render_memory_edit_draft({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    renderMemoryEditor({doc,card,artifact,state:s,controller,act,lang});

}

function render_variable_editor_draft({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    renderVariableEditor({doc,card,artifact,state:s,controller,act,lang});

}

function render_variable_draft({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    const preview = artifact.content.preview;
    node('p', t('当前聊天变量：', 'Current-chat variable: ') + preview.id, card);
    for (const diff of preview.diff) node('p', `${diff.field}: ${JSON.stringify(diff.before)} → ${JSON.stringify(diff.after)}`, card);
    node('small', t('草稿本身未修改或保存变量；应用前须核对并单独确认。', 'The draft itself changed or saved nothing; review and confirm separately before applying.'), card);
    const recheck = button(t('重新校验', 'Revalidate'), card); recheck.disabled = s.busy || s.resetting;
    recheck.onclick = () => act(() => controller.revalidate(artifact.id, artifact.revision));
    renderVariableApply({ doc, card, artifact, state: s, controller, act, lang });

}

function render_config_draft({ doc, card, artifact, state: s, controller, act, lang, node, button, t, navigateDirector, navigateMemory, follow }) {
    renderConfigDiff({ doc, parent: card, diff: artifact.content.preview.diff, lang });
    const operation = s.configActions?.find(r => r.artifactId === artifact.id && r.revision === artifact.revision);
    const attempted = operation && !['pending', 'cancelled', 'expired', 'not_executed'].includes(operation.status);
    node('p', attempted ? t('上方为本次操作的原始差异；实际结果见操作回执。', 'Original operation diff above; see the operation receipt for the result.') : artifact.content.preview.notice, card); node('p', artifact.content.preview.warnings.join(' · '), card);
    if (Array.isArray(artifact.content.preview.impact?.characters)) {
        node('small', t('当前聊天记忆仓库中的角色序号；不向模型发送角色标识或记忆正文。', 'Character slots in this chat memory store; identities and memory text are not sent to the model.'), card);
        for (const row of artifact.content.preview.impact.characters) node('p', t(`角色序号 ${row.slot}：${row.before} → ${row.before - row.remove}（裁剪 ${row.remove}）`, `Character slot ${row.slot}: ${row.before} → ${row.before - row.remove} (prune ${row.remove})`), card);
    }
    if (artifact.content.blueprintTogglePlan) {
        const p = artifact.content.blueprintTogglePlan;
        node('p', p.operation === 'none' ? t('当前聊天无完成变量，不创建。', 'No completion variable in this chat; none will be created.') :
            t(`当前聊天完成变量 ${p.variableId}：${p.before.stored ? String(p.before.value) : '无存储值'} → false`, `Current-chat completion variable ${p.variableId}: ${p.before.stored ? String(p.before.value) : 'no stored value'} → false`), card);
    }
    if (!attempted) node('p', artifact.validation?.status === 'stale' ? t('过期，需重新生成', 'Stale; regenerate') : artifact.validation ? t('已校验当时基线；使用前需复核，未应用', 'Validated against saved baseline; recheck before use. Not applied.') : t('未校验，未应用', 'Not validated; not applied'), card);
    const recheck = button(t('重新校验', 'Revalidate'), card); recheck.disabled = s.busy || s.resetting; recheck.onclick = () => act(() => controller.revalidate(artifact.id, artifact.revision));
    renderConfigApply({ doc, card, artifact, state: s, controller, act, lang });
}

const definitions = [
    {kind:'workspace-draft',title:['工作区文档草稿','Workspace document draft'],role:'action',layout:'inline',render:renderWorkspace},
    { kind: 'report', title: ["排查报告","Diagnostic report"], role: 'report', layout: 'anchored-details', render: render_report },
    { kind: 'task-plan', title: ["任务方案","Task plan"], role: 'read-review', layout: 'anchored-details', render: render_task_plan },
    { kind: 'task-bundle', title: ["整单草稿","Operation bundle"], role: 'action', layout: 'inline', render: render_task_bundle },
    { kind: 'blueprint-library-chat-draft', title: ["聊天与蓝图库草稿","Chat / Blueprint library draft"], role: 'action', layout: 'inline', render: render_blueprint_library_chat_draft },
    { kind: 'npc-library-chat-draft', title: ["聊天与 NPC 库草稿","Chat / NPC library draft"], role: 'action', layout: 'inline', render: render_npc_library_chat_draft },
    { kind: 'profile-library-chat-draft', title: ["聊天与档案库草稿","Chat / profile library draft"], role: 'action', layout: 'inline', render: render_profile_library_chat_draft },
    { kind: 'blueprint-library-draft', title: ["蓝图库草稿","Blueprint library draft"], role: 'action', layout: 'inline', render: render_blueprint_library_draft },
    { kind: 'npc-library-draft', title: ["NPC 库草稿","NPC library draft"], role: 'action', layout: 'inline', render: render_npc_library_draft },
    { kind: 'profile-library-draft', title: ["角色档案库草稿","Character profile library draft"], role: 'action', layout: 'inline', render: render_profile_library_draft },
    { kind: 'skill-draft', title: ["技能管理草稿","Skill management draft"], role: 'action', layout: 'inline', render: render_skill_draft },
    { kind: 'custom-prompt-draft', title: ["自定义 Prompt 草稿","Custom Prompt draft"], role: 'action', layout: 'inline', render: render_custom_prompt_draft },
    { kind: 'custom-agent-draft', title: ["自定义 Agent 草稿","Custom Agent draft"], role: 'action', layout: 'inline', render: render_custom_agent_draft },
    { kind: 'script-draft', title: ["脚本执行器草稿","Script Executor draft"], role: 'action', layout: 'inline', render: render_script_draft },
    { kind: 'provider-draft', title: ["Provider 源码草稿","Provider source draft"], role: 'action', layout: 'inline', render: render_provider_draft },
    { kind: 'profile-draft', title: ["配置档草稿","Profile draft"], role: 'action', layout: 'inline', render: render_profile_draft },
    { kind: 'selection-draft', title: ["选择策略草稿","Selection policy draft"], role: 'action', layout: 'inline', render: render_selection_draft },
    { kind: 'st-preset-draft', title: ["酒馆预设操作草稿","ST preset operation draft"], role: 'action', layout: 'inline', render: render_st_preset_draft },
    { kind: 'character-card-draft', title: ["酒馆角色卡操作草稿","ST character-card draft"], role: 'action', layout: 'inline', render: render_character_card_draft },
    { kind: 'worldbook-edit-draft', title: ["世界书条目修改草稿","World-book entry draft"], role: 'action', layout: 'inline', render: render_worldbook_edit_draft },
    { kind: 'ledger-edit-draft', title: ["导演账本编辑草稿","Director ledger editing draft"], role: 'action', layout: 'inline', render: render_ledger_edit_draft },
    { kind: 'blueprint-node-edit-draft', title: ["蓝图节点编辑草稿","Blueprint node editing draft"], role: 'action', layout: 'inline', render: render_blueprint_node_edit_draft },
    { kind: 'npc-edit-draft', title: ["NPC编辑草稿","NPC editing draft"], role: 'action', layout: 'inline', render: render_npc_edit_draft },
    { kind: 'profile-edit-draft', title: ["角色档案编辑草稿","Character profile editing draft"], role: 'action', layout: 'inline', render: render_profile_edit_draft },
    { kind: 'memory-edit-draft', title: ["记忆编辑草稿","Memory editing draft"], role: 'action', layout: 'inline', render: render_memory_edit_draft },
    { kind: 'variable-editor-draft', title: ["变量编辑草稿","Variable editing draft"], role: 'action', layout: 'inline', render: render_variable_editor_draft },
    { kind: 'variable-draft', title: ["变量草稿","Variable draft"], role: 'action', layout: 'inline', render: render_variable_draft },
    { kind: 'config-draft', title: ["配置草稿","Configuration draft"], role: 'action', layout: 'inline', render: render_config_draft },
];

/** Trusted presentation only; original controller handlers still authorize every action. */
export function createBuiltinArtifactViews() {
    const actions = builtinActionDescriptors();
    return createArtifactViews(definitions.map(row => ({ ...row,
        actionOwner: row.role === 'action' ? actions.find(action => action.artifactKinds.includes(row.kind))?.id : null,
    })), actions);
}
