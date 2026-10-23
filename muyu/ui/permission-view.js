import { permissionSource } from '../permissions/contract.js';
import { permissionDisplayTitle } from './catalog-labels.js';
import { createPendingCardLayout, pendingRequestStamp } from './pending-card-layout.js';

/** UI can answer an existing request, never supply its target or permission scope. */
export function createPermissionView({ doc, parent, settings, controller, act, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const permissionTitle = id => permissionDisplayTitle(id, lang);
    const node = (tag, text, owner) => { const e = doc.createElement(tag); e.textContent = text; owner.append(e); return e; };
    const root = node('section', '', parent); root.className = 'gd-muyu-interaction gd-muyu-permission'; root.hidden = true;
    root.setAttribute('role', 'group'); root.setAttribute('aria-label', t('暮羽资料授权', 'Muyu data permission'));
    root.setAttribute('data-pending-card', '');
    const title = node('strong', '', root);
    const card = node('div', '', root); card.className = 'gd-muyu-interaction-body';
    const destination = node('p', '', card), reason = node('p', '', card), scope = node('p', '', card);
    const generationSummary = node('p', '', card); generationSummary.className = 'gd-muyu-generation-summary'; generationSummary.hidden = true;
    const executionDetails = node('details', '', card); executionDetails.hidden = true;
    node('summary', t('本次定义与执行范围', 'Definition and execution scope'), executionDetails);
    const executionSource = node('pre', '', executionDetails); executionSource.className = 'gd-muyu-execution-source';
    const actions = node('div', '', root); actions.className = 'gd-muyu-actions';
    const layout = createPendingCardLayout({ doc, root, parent });
    let current = null, disposed = false;
    const buttons = [['task', t('允许本任务', 'Allow this task')], ['chat', t('允许此聊天', 'Allow this chat')], ['deny', t('拒绝并继续', 'Deny and continue')]].map(([decision, text]) => {
        const b = node('button', text, actions); b.type = 'button'; b.className = 'menu_button';
        b.setAttribute('data-decision', decision);
        return b;
    });
    const cancel = node('button', t('取消任务', 'Cancel task'), actions); cancel.type = 'button'; cancel.className = 'menu_button';
    node('small', t('本任务授权在任务结束后失效；持续授权仅在当前连接及指定范围内复用，可在配置中撤销。读取授权不批准修改。', 'Task access expires at task end. Ongoing access lasts for this connection and stated scope; revoke it in settings. Read access does not approve changes.'), card);
    const status = node('p', '', parent); status.setAttribute('role', 'status'); status.hidden = true;
    const grants = node('div', '', settings); grants.className = 'gd-muyu-settings-card gd-muyu-grants';
    grants.setAttribute('tabindex', '-1');
    let signature = '';
    return { operationTarget: root, settingsTarget: grants, dispose() { if (disposed) return; disposed = true; layout.dispose(); root.remove(); status.remove(); grants.remove(); }, render(s) {
        if (disposed) return;
        current = s.interaction?.kind === 'permission' ? s.interaction : null;
        const pending = current?.status === 'pending'; root.hidden = !pending;
        buttons[0].textContent = current?.source === 'generationBatchExecution' ? t('批准本整单一次', 'Approve this exact batch once') : current?.source === 'npcExecution' ? t('批准本次NPC生成', 'Approve this NPC generation') : current?.source === 'profileExecution' ? t('批准本次档案生成', 'Approve this profile generation') : current?.source === 'memoryExecution' ? t('批准本次提取', 'Approve this extraction') : t('允许本任务', 'Allow this task');
        for (const b of buttons) b.disabled = !pending || s.busy || s.resetting || s.readOnly;
        buttons[1].hidden = permissionSource(current?.source)?.permission === 'code';
        cancel.disabled = !pending || s.resetting || s.readOnly;
        const id = current?.id, stamp = pendingRequestStamp(s);
        const bind = (button, callback) => {
            const disabled = button.disabled || button.hidden || s.readOnly;
            button.onclick = () => {
                if (disposed || disabled || button.disabled || button.hidden || pendingRequestStamp(controller.snapshot()) !== stamp) return;
                return act(callback);
            };
        };
        buttons.forEach((button, index) => bind(button, () => controller.answerPermission(id, ['task', 'chat', 'deny'][index])));
        bind(cancel, () => controller.cancelInteraction(id));
        layout.update();
        executionDetails.hidden = !pending || !['scriptExecution', 'agentExecution', 'memoryExecution', 'profileExecution', 'npcExecution', 'generationBatchExecution'].includes(current.source);
        generationSummary.hidden = !pending || !['memoryExecution', 'profileExecution', 'npcExecution', 'generationBatchExecution'].includes(current.source);
        if (!generationSummary.hidden) {
            const details = current.source === 'generationBatchExecution' ? controller.generationBatchExecutionDetails?.(current.executionId) : current.source === 'npcExecution' ? controller.npcExecutionDetails?.(current.executionId) : current.source === 'profileExecution' ? controller.profileExecutionDetails?.(current.executionId) : controller.memoryExecutionDetails?.(current.executionId);
            if (current.source === 'generationBatchExecution') generationSummary.textContent = details
                ? t('按下列顺序执行，最多业务模型调用：', 'Ordered steps; maximum business model attempts: ') + details.maximumModelCalls + '\n' +
                    details.steps.map((step, index) => (index + 1) + '. ' +
                        ({ memory: t('提取记忆', 'Extract memories'), profile: t('生成档案', 'Generate profile'), npc: t('生成NPC', 'Generate NPCs') })[step.kind] +
                        (step.name ? ' · ' + step.name : ' · ' + t('请求／实际最多：', 'Requested / maximum: ') + step.requested + '/' + step.effectiveCount) +
                        ' · ' + (step.mode === 'trial' ? t('试跑，不保存', 'Trial, no save') : step.kind === 'memory' ? t('保存，可能裁剪旧记忆', 'Save; oldest memories may be pruned') : step.kind === 'profile' ? t('仅新建缺失档案', 'Create missing profile only') : t('仅追加，不导入角色卡', 'Append only; no character-card import'))).join('\n') +
                    '\n' + t('不是原子事务：中途停止会保留已确认的写入；不会自动重试。', 'Non-atomic: confirmed earlier writes remain on stop; no automatic retries.')
                : t('执行单已失效，请重新准备。', 'Execution ticket expired; prepare again.');
            if (current.source === 'npcExecution') generationSummary.textContent = details
                ? (details.mode === 'trial' ? t('试生成，不保存', 'Trial, no save') : t('生成并保存，仅追加NPC记录', 'Generate and save; append NPC records only')) + ' · ' + t('请求／实际最多：', 'Requested / maximum accepted: ') + details.requested + '/' + details.effectiveCount + ' · ' + t('已有／上限：', 'Existing / limit: ') + details.existingCount + '/' + details.limit + ' · ' + t('不导入角色卡', 'No character-card import')
                : t('执行单已失效，请重新准备。', 'Execution ticket expired; prepare again.');
            if (current.source === 'profileExecution') generationSummary.textContent = details
                ? t('角色：', 'Character: ') + details.name + ' · ' + (details.mode === 'trial' ? t('试生成，不保存', 'Trial, no save') : t('生成并保存，仅新建缺失档案', 'Generate and save; missing profile only')) + ' · ' + (details.existing ? t('已有档案，禁止覆盖', 'Existing profile, overwrite forbidden') : t('尚无档案', 'No existing profile'))
                : t('执行单已失效，请重新准备。', 'Execution ticket expired; prepare again.');
            if (current.source !== 'profileExecution' && current.source !== 'npcExecution' && current.source !== 'generationBatchExecution') generationSummary.textContent = details
                ? t('角色：', 'Character: ') + details.name + ' · ' + (details.mode === 'trial' ? t('试跑，不保存', 'Trial, no save') : t('生成并保存，可能裁剪旧记忆', 'Generate and save; oldest memories may be pruned')) +
                    ' · ' + t('已有／上限：', 'Existing / limit: ') + details.existingCount + '/' + details.limit
                : t('执行单已失效，请重新准备。', 'Execution ticket expired; prepare again.');
        }
        if (!executionDetails.hidden) {
            const details = current.source === 'generationBatchExecution' ? controller.generationBatchExecutionDetails?.(current.executionId) : current.source === 'npcExecution' ? controller.npcExecutionDetails?.(current.executionId) : current.source === 'profileExecution' ? controller.profileExecutionDetails?.(current.executionId) : current.source === 'memoryExecution' ? controller.memoryExecutionDetails?.(current.executionId) : current.source === 'agentExecution' ? controller.agentExecutionDetails?.(current.executionId) : controller.scriptExecutionDetails?.(current.executionId);
            executionSource.textContent = details ? JSON.stringify(details, null, 2) : t('执行单已失效，请重新准备。', 'Execution ticket expired; prepare again.');
        }
        if (pending) {
            destination.textContent = t('结果会发送至：', 'Output goes to: ') + (s.connection ? `${s.connection.model} · ${s.connection.endpoint}` : t('连接尚未就绪', 'Connection not ready'));
            const global = permissionSource(current.source)?.scope === 'global';
            buttons[1].textContent = global ? t('允许本连接', 'Allow this connection') : t('允许此聊天', 'Allow this chat');
            title.textContent = current.source === 'generationBatchExecution' ? t('暮羽请求执行整单业务生成', 'Muyu requests exact generation batch') : current.source === 'npcExecution' ? t('暮羽请求生成NPC记录', 'Muyu requests NPC record generation') : current.source === 'profileExecution' ? t('暮羽请求生成单角色档案', 'Muyu requests character profile generation') : current.source === 'memoryExecution' ? t('暮羽请求提取单角色记忆', 'Muyu requests character memory extraction') : current.source === 'agentExecution' ? t('暮羽请求运行自定义 Agent', 'Muyu requests a Custom Agent run') : current.source === 'scriptExecution' ? t('暮羽请求在当前聊天执行脚本', 'Muyu requests real script execution') : current.source === 'providerExecution' ? t('暮羽请求执行代码：', 'Muyu requests code execution: ') + `${current.providerId} (${current.providerRevision})` : ['providerTests', 'scriptTests'].includes(current.source) ? t('暮羽请求合成代码测试：', 'Muyu requests synthetic code tests: ') + permissionTitle(current.source) : t('暮羽希望读取：', 'Muyu requests access to: ') + permissionTitle(current.source);
            reason.textContent = t('模型说明的用途：', 'Model-provided reason: ') + current.reason;
            scope.textContent = (current.source === 'generationBatchExecution' ? t('仅批准本整单一次，按列出的对象、模式和顺序执行，不授予子单或其他操作权限。试跑不保存；记忆保存可能裁剪，档案只新建缺失记录，NPC只追加且不导入角色卡。不启用功能、不改设置、不操作库、不生成蓝图。业务模型会额外产生费用，最多调用数见上方，独立于暮羽自身模型预算；不保证使用同一连接。真实Prompt/Provider渲染可能读取资料、执行代码、联网，试跑不是沙箱。非原子事务：未知／部分保存、并发变化、取消或超时停止后续步骤，已确认写入保留；不自动重试、不回滚整仓。取消不保证停止原生计费或在途保存。结果是历史快照，不是已核实事实。', 'Approve this exact list once, in displayed order and modes; no child-ticket or other-operation grants. Trial does not save; memory save may prune, profile save creates missing records only, NPC save appends without card import. No enablement, settings, libraries or Blueprint generation. Business models incur extra costs; maximum attempts shown above are separate from Muyu model budget and may use other connections. Real rendering may read data, run Providers or use network; trial is not a sandbox. Non-atomic: unknown/partial saves, concurrent changes, cancellation or timeout stop remaining steps; confirmed prior writes remain, with no retry or warehouse rollback. Cancellation cannot guarantee stopping native billing or in-flight saves. Historical output is not verified fact. ') : current.source === 'npcExecution' ? t('仅本执行单一次：试生成不保存；保存仅追加当前聊天的新NPC记录，受批准数量和剩余容量限制，检查全酒馆角色与本批次重名。不覆盖、不裁剪、不启用功能、不操作库、不创建或导入角色卡。使用NPC业务模型或酒馆原生连接，额外产生费用，不保证与暮羽同一连接。真实Prompt/Provider渲染可能读取资料、执行代码、联网或产生副作用，试生成不是沙箱。取消／超时不保证停止原生计费或在途保存；未知结果不重试。生成内容不是已核实的剧情事实。', 'This exact ticket once: trial does not save; save appends new current-chat NPC records within approved count and remaining capacity, deduplicated against all ST characters and this batch. No overwrite, pruning, enablement, library operation or character-card creation/import. Uses the NPC business model or ST native connection with extra costs, not necessarily Muyu’s connection. Real Prompt/Provider rendering may read data, execute code, use network or cause side effects; trial is not a sandbox. Cancellation/timeout cannot guarantee stopping native billing or in-flight saves; never retry unknown outcomes. Generated content is not verified story fact. ') : current.source === 'profileExecution' ? t('仅本执行单一次：试生成不保存；保存只新建当前聊天缺失的角色档案，不覆盖任何已有记录、归档或共享Schema。仅标准四字段，不支持自定义Schema；不开启功能、不批量生成。使用档案业务模型或酒馆原生连接，额外产生费用，不保证与暮羽同一连接。真实Prompt/Provider渲染可能读取资料、执行代码、联网或产生副作用，试生成不是沙箱。取消／超时不保证停止原生计费或在途保存；未知结果不重试。生成内容不是核实过的角色事实。', 'This exact ticket once: trial does not save; save only creates a missing current-chat profile, never overwrites existing records, archives or shared Schema. Standard four fields only, no custom Schema, enablement or batch. Uses the profile business model or ST native connection with extra costs, not necessarily Muyu’s connection. Real Prompt/Provider rendering may read data, execute code, use network or cause side effects; trial is not a sandbox. Cancellation/timeout cannot guarantee stopping native billing or an in-flight save; never retry unknown results. Generated content is not verified character fact. ') : current.source === 'memoryExecution' ? t('仅本执行单一次：试跑不保存，生成并保存会追加指定角色的记忆，并可能裁剪最旧条目。使用记忆业务模型或酒馆原生连接，额外产生费用；不保证与暮羽使用同一连接。真实提示词渲染可能读取资料、执行Provider代码、联网或产生副作用，试跑不是沙箱。不开启功能、不批量生成。取消／超时不能保证停止原生请求计费或在途保存；未知结果不重试。生成内容不是已核实的剧情事实。', 'This exact ticket once: trial does not save; save appends memories for the selected character and may prune oldest entries. Uses the memory business model or ST native connection, with extra costs; not necessarily Muyu’s connection. Real rendering may read data, execute Providers, use network or cause side effects; trial is not a sandbox. No enablement or batch run. Cancellation/timeout cannot guarantee stopping native billing or an in-flight save; never retry unknown outcomes. Generated text is not verified story fact. ') : current.source === 'agentExecution' ? t('仅本执行单一次：展开核对 trial（试跑不保存）或 save（替换本聊天结果）。使用自定义 Agent 业务连接或酒馆当前原生连接，会额外调用模型并产生费用；不是暮羽当前连接的保证。真实提示词渲染可读取资料并执行 Provider 代码，可能联网或产生其他副作用，试跑也不是沙箱。不会开启自动运行。取消／超时可能无法停止原生请求计费及已开始的保存；未知结果不要重试。', 'This exact ticket once: inspect trial (no result save) or save (replace this chat result). Uses the Custom Agent business connection or current ST native connection, with extra model costs; not necessarily Muyu’s connection. Real rendering reads data and runs Providers with possible network/side effects; trial is not a sandbox. Does not enable automatic mode. Cancellation/timeout may not stop native billing or an already started save; do not retry unknown outcomes. ') : current.source === 'scriptExecution' ? t('仅批准执行单指定的脚本版本、聊天、阶段和消息一次；包括参数模板渲染及其 Provider 调用。可运行已关闭脚本而不启用它。同页代码可能读取密钥、修改数据、联网或产生费用；结果发送给模型。取消或超时不能终止代码副作用。手动运行不更新导演决策或回合共享状态。', 'Approve this ticket’s exact script version, chat, stage and message once, including template/Provider rendering. Disabled scripts may run without enabling them. Page code can access secrets, change data, use network or incur costs; output goes to the model. Cancellation/timeout cannot stop effects. Manual execution does not update the live director decision or turn shared state. ') : current.source === 'providerExecution' ? t('只允许本任务执行此版本 Provider。代码在酒馆页面运行，可能修改数据、联网或产生费用；超时不能保证中止。', 'Only this task may run this Provider version. Code runs in the ST page and may change data, use the network or incur costs; timeout cannot reliably stop it. ') : ['providerTests', 'scriptTests'].includes(current.source) ? t('仅本任务：执行草稿源码，用虚构聊天和角色检查执行阶段与返回格式；不读取真实酒馆资料，不导入。禁止联网并限制运行时间；通过不证明安全或业务正确。', 'This task only: execute draft source with fake chat/characters to check execution stages and output. No real ST data or import. Network blocked and runtime bounded; passing is not proof of security or intent. ') : ['providerAssets', 'scriptAssets'].includes(current.source) ? t('范围：全局用户代码资产名称和源码，源码可能含敏感信息；仅允许读取，不执行或导入。', 'Scope: global user code asset names and source, which may contain sensitive information. Read only; no execution or import. ') : global ? t('范围：此来源的全局白名单配置，不含聊天正文。', 'Scope: global whitelist settings for this source, no chat bodies. ') : t('范围：当前酒馆聊天的指定资料来源。', 'Scope: this source in the current ST chat. '));
        }
        status.hidden = !current || !['expired', 'cancelled'].includes(current.status);
        status.textContent = current?.status === 'expired' ? t('读取授权申请已失效。', 'Read permission request expired.') : t('读取授权申请已取消。', 'Read permission request cancelled.');
        const grantStamp = state => JSON.stringify([state.viewKey, state.viewToken, state.connection, state.sourceGrants || [], state.busy, state.resetting, state.readOnly]);
        const next = grantStamp(s);
        if (next !== signature) {
            signature = next; grants.replaceChildren();
            node('strong', t('当前有效的资料授权', 'Active data grants'), grants);
            if (!s.sourceGrants?.length) node('small', t('暂无；暮羽需要资料时会申请。', 'None. Muyu will ask when data is needed.'), grants);
            for (const key of s.sourceGrants || []) {
                const row = node('div', permissionTitle(key.slice(7)), grants);
                const b = node('button', t('撤销', 'Revoke'), row); b.type = 'button'; b.className = 'menu_button'; b.disabled = s.resetting;
                b.onclick = () => { if (disposed || b.disabled || grantStamp(controller.snapshot()) !== next) return; return act(() => controller.revokePermission(key)); };
            }
        }
    } };
}
