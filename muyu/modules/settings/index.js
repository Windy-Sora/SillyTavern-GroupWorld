import { randomUUID } from '../../runtime/crypto.js';
import { copyJson, jsonKey } from '../../core/json-contract.js';
import { assertActive, ExecutionError } from '../../core/execution.js';
import { createToolRegistry } from '../../tools/registry.js';
import { configFields, configDomains, configChangesSchema, dependencyFields, fieldDefinition, previewSettings, readSettingsFields, selectedFields } from '../../config/registry.js';
import { configurationCoverage, dynamicSettings } from '../../config/coverage.js';
import { configPresentation } from '../../config/presentation.js';
import { settingDisplayValues, settingAnswerView } from '../../config/read-presentation.js';
import { settingReadEvidence } from '../../config/read-evidence.js';
import { BUNDLE_LIMITS, BUNDLE_VARIABLE_SCOPE } from '../../config/bundle-policy.js';
import { createArtifactLeases } from '../artifact-leases.js';

const string = { type: 'string', maxLength: 24000 };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const strings = { type: 'array', items: { type: 'string', enum: configFields }, maxItems: configFields.length };
// JSON text keeps the global tool schema small; the domain owner validates its contents.
const output = { type: 'object', properties: { text: string, candidateId: { type: 'string', maxLength: 100 }, applyRequested: { type: 'boolean' } }, required: ['text', 'candidateId'], additionalProperties: false };

export function createSettingsModule({ getSettings, getTarget, memoryLimitPort, completionVariablePort, blueprintTogglePort }) {
    const registry = createToolRegistry(), handlers = {}, runs = new Map(); let disposed = false;
    function release(content) {
        if (content.memoryPrunePlan) memoryLimitPort?.forget(content.memoryPrunePlan);
        if (content.completionVariablePlan) completionVariablePort?.forget(content.completionVariablePlan);
        if (content.blueprintTogglePlan) blueprintTogglePort?.forget(content.blueprintTogglePlan);
    }
    const published = createArtifactLeases(release);
    function target(expected) {
        const actual = getTarget();
        if (!actual || (expected.kind === 'global' ? expected.userKey !== actual.userKey : jsonKey(expected) !== jsonKey(actual))) throw Error('TARGET_UNAVAILABLE');
    }
    function read(expected, fields) {
        target(expected); const settings = getSettings(), baseline = readSettingsFields(settings, fields);
        if (settings !== getSettings() || jsonKey(baseline) !== jsonKey(readSettingsFields(settings, fields))) throw Error('STALE_BASELINE');
        target(expected); return baseline;
    }
    function inspectMemoryLimit(changes, target, existingPlan = null) {
        if (!Object.hasOwn(changes, 'memoryMaxEntries')) {
            if (existingPlan) throw Error('INVALID_DRAFT');
            return null;
        }
        if (Object.keys(changes).length !== 1) throw new ExecutionError('MEMORY_LIMIT_REQUIRES_SEPARATE_DRAFT');
        if (!memoryLimitPort) throw Error('MEMORY_LIMIT_UNAVAILABLE');
        if (existingPlan) { memoryLimitPort.assertFresh(existingPlan); return existingPlan; }
        return memoryLimitPort.plan(target, changes.memoryMaxEntries);
    }
    function inspectCompletionVariable(changes, target, baseline, existingPlan = null) {
        if (!Object.hasOwn(changes, 'storyBlueprintCompletionVariable')) {
            if (existingPlan) throw Error('INVALID_DRAFT');
            return null;
        }
        if (Object.keys(changes).length !== 1) throw new ExecutionError('COMPLETION_VARIABLE_REQUIRES_SEPARATE_DRAFT');
        if (!completionVariablePort) throw Error('COMPLETION_VARIABLE_UNAVAILABLE');
        if (existingPlan) { completionVariablePort.assertFresh(existingPlan); return existingPlan; }
        return completionVariablePort.plan(target, baseline.storyBlueprintCompletionVariable, changes.storyBlueprintCompletionVariable);
    }
    function inspectBlueprintToggle(changes, target, existingPlan = null) {
        if (!Object.hasOwn(changes, 'storyBlueprintEnabled')) {
            if (existingPlan) throw Error('INVALID_DRAFT');
            return null;
        }
        if (Object.keys(changes).length !== 1) throw new ExecutionError('BLUEPRINT_TOGGLE_REQUIRES_SEPARATE_DRAFT');
        if (!blueprintTogglePort) throw Error('BLUEPRINT_TOGGLE_UNAVAILABLE');
        if (existingPlan) { blueprintTogglePort.assertFresh(existingPlan); return existingPlan; }
        return blueprintTogglePort.plan(target, changes.storyBlueprintEnabled);
    }
    function withBlueprintImpact(preview, plan) {
        if (!plan) return preview;
        return copyJson({ ...preview, impact: { scope: 'current-chat', variableId: plan.variableId, operation: plan.operation,
            before: plan.before, after: plan.operation === 'none' ? null : false,
            enableAutoUpdate: plan.enableAutoUpdate, useManualInjection: plan.useManualInjection },
            notice: '仅预览，未应用。蓝图开关影响所有聊天；当前聊天完成变量将创建或重置为 false（关闭且无变量时不创建）。启用会将兼容完成变量设为自动更新、手动注入。先确认聊天保存，再保存全局开关，可能部分完成；不改蓝图正文、进度或其他聊天变量。已有自动续写设置可能带来后续模型调用。' });
    }
    function withCompletionImpact(preview, plan) {
        if (!plan) return preview;
        return copyJson({ ...preview, impact: { scope: 'current-chat', newVariableId: plan.newId, initialValue: false, oldVariable: 'retained' },
            notice: '仅预览，未应用。先在当前聊天创建并确认保存值为 false 的新变量，再保存影响所有聊天的全局名称；旧变量保留。其他聊天只会在下次使用时检查，遇到同名冲突将停止推进。' });
    }
    function withMemoryImpact(preview, plan) {
        if (!plan) return preview;
        return copyJson({ ...preview, impact: { scope: 'current-chat', remove: plan.total, characters: plan.counts },
            warnings: [...preview.warnings, ...(plan.total ? ['CURRENT_CHAT_MEMORIES_WILL_BE_REMOVED'] : [])],
            notice: `仅预览，未应用。全局上限将影响所有聊天之后的记忆生成/导入；当前聊天将裁剪 ${plan.total} 条最旧记忆。全局设置保存与聊天裁剪可能部分完成，须逐项查看回执。` });
    }
    function register(id, description, inputSchema, handler) {
        registry.register({ id, version: 1, description, inputSchema, outputSchema: output, scope: 'global', effect: 'read', dataClasses: ['settings-whitelist'], confirmation: 'policy', resourceKeys: [], timeoutMs: 1000, retryPolicy: { kind: 'none', maxAttempts: 1 } });
        handlers[id] = (args, ctx) => { if (disposed) throw Error('MODULE_DISPOSED'); assertActive(ctx.signal); return handler(args, ctx); };
    }
    function invalidateCandidates(run, fields) {
        for (const [id, candidate] of run.candidates) {
            if (!fields.some(field => Object.hasOwn(candidate.content.requestedChanges, field))) continue;
            release(candidate.content);
            run.candidates.delete(id); run.invalidatedCandidateIds.push(id);
        }
    }
    register('muyu.settings.catalog', '列出可编辑配置领域和字段；已知目标领域时传domain，仅返回该领域及精确read/contract调用参数，避免无关目录；省略domain才查询全目录与未接入范围。目录不读取当前值或授权，不要求随后全量读取；nextCalls只是参数建议，依然受权限和预算核验。deferred不能靠授权解锁。普通回答解释范围，不照抄分类键。', { type: 'object', properties: { domain: { type: 'string', enum: configDomains } }, required: [], additionalProperties: false }, ({ domain }) => {
        if (domain !== undefined) {
            if (!configDomains.includes(domain)) throw Error('INVALID_CATALOG_QUERY');
            const fields = configFields.filter(id => fieldDefinition(id).domain === domain);
            return { candidateId: '', text: JSON.stringify({ version: 2, coverage: 'requested-domain-only', domain, fieldCount: fields.length, domainCount: 1,
                totalFieldCount: configFields.length, totalDomainCount: configDomains.length,
                interpretation: 'Only the requested domain of settings-tool coverage. Counts are directory entries, not read values. Other domains and unsupported-key coverage are omitted, not absent; query catalog with {} for whole coverage. nextCalls query this whole domain only when requested; for a specific field use fields alone in read/contract, not unrelated fields. No current values, permission, execution or persistence confirmed.',
                supported: [{ domain, fields }], labels: Object.fromEntries(fields.map(id => [id, configPresentation(id).label])),
                nextCalls: { read: { toolId: 'muyu.settings.read', args: { fields } }, contract: { toolId: 'muyu.settings.contract', args: { domain } } } }) };
        }
        return { candidateId: '', text: JSON.stringify({ version: 2,
        fieldCount: configFields.length, domainCount: configDomains.length,
        interpretation: 'Agent settings-tool coverage only, not a GUI inventory. supported lists fields for these tools; pending/deferred are not supported here; specialEditors names separate host writers, not evidence of any GUI entry or permission; dynamicPending is outside these field tools, not proof that other tools cannot manage it. Presence in this catalog does not mean readable/writable. Missing mappings do not prove a GUI control is absent. No current values were read.',
        supported: configDomains.map(domain => ({ domain, fields: configFields.filter(id => fieldDefinition(id).domain === domain) })),
        labels: Object.fromEntries(configFields.map(id => [id, configPresentation(id).label])),
        bundle: { tool: 'muyu.task.preview', sections: ['variables', 'settings', 'scripts'], order: ['variables', 'settings', 'scripts'], limits: BUNDLE_LIMITS, variableScope: BUNDLE_VARIABLE_SCOPE, variableMeaning: 'One shared current-chat numeric value; no character selector. Per-character variables require variable_editor.', target: 'current-chat-required', atomic: false, eligibility: 'Query field contract bundle.supported; do not split by domain name.' },
        partial: configurationCoverage().filter(row => row.partial).map(({ key, pendingFields }) => ({ key, pendingFields })),
        pending: configurationCoverage().filter(row => !['supported', 'internal', 'special-editor-supported'].includes(row.status)).map(({ key, owner, status }) => ({ key, owner, status })), specialEditors: configurationCoverage().filter(row => row.status === 'special-editor-supported').map(({ key, writer }) => ({ key, writer })), dynamicPending: Object.keys(dynamicSettings),
    }) };
    });
    register('muyu.settings.contract', '查询字段用途、类型、限制和生效时机，也用于只读分析，不限于修改前校验。已知字段名时用fields一次查询多个领域，跨领域时省略domain；仅探索一个领域时用domain。两者同时提供时fields必须属于该领域；INVALID_CONTRACT_QUERY后改用fields单独查询或拆分领域，勿重复原组合。scope=global影响所有聊天；未指定字段保持原值，不填默认值。', {
        type: 'object', properties: { domain: { type: 'string', enum: configDomains }, fields: { type: 'array', items: { type: 'string', enum: configFields }, maxItems: 16 } },
        required: [], additionalProperties: false,
    }, ({ domain, fields }) => {
        if (!domain && !fields) throw Error('INVALID_CONTRACT_QUERY');
        const ids = fields ? selectedFields(fields) : configFields.filter(id => fieldDefinition(id).domain === domain);
        if (domain && ids.some(id => fieldDefinition(id).domain !== domain)) throw Error('INVALID_CONTRACT_QUERY');
        return { candidateId: '', text: JSON.stringify(ids.map(fieldDefinition)) };
    });
    register('muyu.settings.read', '按明确字段读取当前内存值；局部问题只选目标及必要依赖，不因目录可读就读取全部。判断当前生效的选人人数需读mode，单个人数值不能证明当前模式。未提供的字段为缺失，不补默认值；不能证明持久化、字段的用途或历史变化。分析字段联动与生效关系前按需查询muyu.settings.contract或静态说明，不按字段名猜测。需要相应配置读取授权。', object({ fields: strings }), ({ fields }, ctx) => {
        const ids = selectedFields(fields), values = read(ctx.target, ids);
        const needsMode = ids.some(id => ['topN', 'llmMaxSpeakers'].includes(id)) && !Object.hasOwn(values, 'mode');
        const cautions = ids.flatMap(id => fieldDefinition(id).readCaution ? [{ field: id, interpretation: fieldDefinition(id).readCaution }] : []);
        return { candidateId: '', text: JSON.stringify({ evidence: settingReadEvidence(ids, values), ...(cautions.length ? { readCautions: cautions } : {}), observation: 'Current memory values at this read only; not persisted confirmation or a guarantee of later values.', answerView: settingAnswerView(values), scope: 'global', persistence: 'unknown', fields: ids, values,
            ...(needsMode ? { applicability: 'Current effective speaker limit is not established by this read. Read mode if allowed, then use the field contract; otherwise state only the stored limits conditionally. Do not claim a mode is active from limit values alone.' } : {}),
            labels: Object.fromEntries(ids.map(id => [id, configPresentation(id).label])), displayValues: settingDisplayValues(values) }) };
    });
    register('muyu.settings.preview', '生成已登记配置的局部changes草稿。仅在全权限模式且用户明确要求直接修改时设置apply=true：宿主在本轮成功结束后重新校验并写入，不需额外授权调用。用户要求只预览或不修改时省略apply。普通模式只允许预览。不隐式开启功能。customPromptsEnabled必须单独预览；profileLibraryAutoLoad的已接入叶字段可相互组合但不可与其他配置混合，使用专用业务保存，不立即导入。memoryMaxEntries、storyBlueprintCompletionVariable、storyBlueprintEnabled各须单独出草稿；若收到对应 REQUIRES_SEPARATE_DRAFT 错误，按字段拆分后重新预览，不重复原调用。', { type: 'object', properties: { changes: configChangesSchema, apply: { type: 'boolean' } }, required: ['changes'], additionalProperties: false }, ({ changes, apply }, ctx) => {
        const run = runs.get(ctx.runId); if (!run || jsonKey(run.target) !== jsonKey(ctx.target)) throw Error('RUN_NOT_BOUND');
        run.invalidatedCandidateIds = [];
        invalidateCandidates(run, Object.keys(changes));
        const fields = dependencyFields(Object.keys(changes)), baseline = read(ctx.target, fields);
        const basePreview = previewSettings({ baseline, changes });
        let plan, completionPlan, togglePlan, content;
        try {
            plan = inspectMemoryLimit(changes, ctx.target);
            completionPlan = inspectCompletionVariable(changes, ctx.target, baseline);
            togglePlan = inspectBlueprintToggle(changes, ctx.target);
            const preview = withBlueprintImpact(withCompletionImpact(withMemoryImpact(basePreview, plan), completionPlan), togglePlan);
            content = copyJson({ module: 'settings-config', producedByRunId: ctx.runId, baseline, requestedChanges: changes, preview, ...(plan ? { memoryPrunePlan: plan } : {}), ...(completionPlan ? { completionVariablePlan: completionPlan } : {}), ...(togglePlan ? { blueprintTogglePlan: togglePlan } : {}) });
            // Reserve envelope space for artifact, validation and operation metadata.
            if (new TextEncoder().encode(JSON.stringify(content)).length > 24000) throw Error('DRAFT_TOO_LARGE');
        } catch (error) { if (plan) memoryLimitPort?.forget(plan); if (completionPlan) completionVariablePort?.forget(completionPlan); if (togglePlan) blueprintTogglePort?.forget(togglePlan); throw error; }
        const candidateId = 'settings:' + randomUUID();
        // Model-only interpretation; keep the private draft and approval equality contract unchanged.
        const modelPreview = { ...content.preview, interpretation: 'Draft comparison only. before is the captured preview baseline, not proof of the current value. after is proposed, not executed. No write or persistence is confirmed by this result.' };
        const result = copyJson({ candidateId, text: JSON.stringify(apply ? { ...modelPreview, automaticApplication: 'requested; executes only after successful run and fresh host validation; check receipt' } : modelPreview) });
        run.candidates.set(candidateId, { candidateId, content }); return { ...result, ...(apply ? { applyRequested: true } : {}) };
    });
    registry.seal();
    function verifyContent(content, expectedTarget) {
        if (content.module !== 'settings-config' || content.preview.contractVersion !== 2) throw Error('INVALID_DRAFT');
        const changes = content.requestedChanges ?? content.preview.manifest.settings, fields = dependencyFields(Object.keys(changes));
        const baseline = read(expectedTarget, fields);
        if (jsonKey(baseline) !== jsonKey(content.baseline)) throw Error('STALE_BASELINE');
        const plan = inspectMemoryLimit(changes, expectedTarget, content.memoryPrunePlan);
        const completionPlan = inspectCompletionVariable(changes, expectedTarget, baseline, content.completionVariablePlan);
        const togglePlan = inspectBlueprintToggle(changes, expectedTarget, content.blueprintTogglePlan);
        if (jsonKey(withBlueprintImpact(withCompletionImpact(withMemoryImpact(previewSettings({ baseline, changes }), plan), completionPlan), togglePlan)) !== jsonKey(content.preview)) throw Error('INVALID_DRAFT');
    }
    return { registry, handlers,
        bindRun(identity) { if (disposed || runs.size >= 128 || runs.has(identity.id)) throw Error('RUN_CAPACITY'); runs.set(identity.id, { target: copyJson(identity.target), taskId: identity.taskId, candidates: new Map(), invalidatedCandidateIds: [] }); },
        invalidateAttempt(id, fields) { const run = runs.get(id); if (run && Array.isArray(fields)) invalidateCandidates(run, fields); },
        takeInvalidatedCandidates(id) { const run = runs.get(id); if (!run) return []; const ids = run.invalidatedCandidateIds; run.invalidatedCandidateIds = []; return ids; },
        transferRun(from, identity) { const run = runs.get(from); if (!run) return; if (runs.has(identity.id) || run.taskId !== identity.taskId || jsonKey(run.target) !== jsonKey(identity.target)) throw Error('INVALID_RUN_TRANSFER'); runs.delete(from); for (const candidate of run.candidates.values()) candidate.content.producedByRunId = identity.id; runs.set(identity.id, run); },
        publishDraft(app, id, candidateId) {
            const r = runs.get(id), run = app.snapshot().runs.find(item => item.id === id);
            const candidate = r?.candidates.get(candidateId);
            if (!candidate || run?.status !== 'succeeded' || run.taskId !== r.taskId || jsonKey(run.target) !== jsonKey(r.target)) throw Error('INVALID_CANDIDATE_SOURCE');
            verifyContent(candidate.content, r.target);
            const a = app.createArtifact({ taskId: r.taskId, sourceRunId: id, kind: 'config-draft', content: candidate.content }); published.track(a); r.candidates.delete(candidateId); return a;
        },
        validateSaved(app, id, revision) {
            const a = app.getArtifact(id), run = app.snapshot().runs.find(r => r.id === a.content.producedByRunId);
            if (a.kind !== 'config-draft' || a.revision !== revision || run?.status !== 'succeeded' || run.taskId !== a.taskId) throw Error('STALE_ARTIFACT');
            verifyContent(a.content, run.target);
            return app.validateArtifact(id, revision, { contractVersion: 2, structural: 'passed', semantic: a.content.preview.semantic, intent: 'requires_user_review', baseline: 'matched-at-validation' });
        },
        forgetRun(id) { const run = runs.get(id); for (const candidate of run?.candidates.values() || []) release(candidate.content); runs.delete(id); },
        retainArtifacts: values => published.retain(values),
        dispose() { if (disposed) return; disposed = true; for (const run of runs.values()) for (const candidate of run.candidates.values()) release(candidate.content); runs.clear(); published.clear(); },
    };
}
