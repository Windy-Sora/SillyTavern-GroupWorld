/** Trusted module wiring. Metadata never approves reads, writes or code. */
export function createModuleAssembly(entries, { capabilityFor, labels, actions }) {
    if (!Array.isArray(entries) || !entries.length || typeof capabilityFor !== 'function' || !labels || !Array.isArray(actions)) throw Error('INVALID_MODULE_ASSEMBLY');
    const ids = new Set(), modules = new Set(), toolIds = new Set(), contentIds = new Set(), producers = new Set();
    const tools = [], artifacts = [], reports = [], groups = Object.create(null), rows = [];
    let budgetOwner = null;
    for (const entry of entries) {
        const module = entry?.module;
        if (typeof entry?.id !== 'string' || !entry.id || ids.has(entry.id) || !module || modules.has(module) ||
            ['transferRun', 'forgetRun', 'dispose', 'retainArtifacts'].some(k => typeof module[k] !== 'function') ||
            !(entry.bindAssistant === null || typeof entry.bindAssistant === 'function') ||
            !Array.isArray(entry.tools) || !Array.isArray(entry.artifacts) ||
            !(entry.reports === undefined || Array.isArray(entry.reports)) ||
            !(entry.taskLifecycle === undefined || typeof entry.taskLifecycle === 'boolean') ||
            !(entry.budgetLifecycle === undefined || typeof entry.budgetLifecycle === 'boolean') ||
            entry.budgetLifecycle === true && (budgetOwner || entry.bindAssistant !== null || typeof module.bindRun !== 'function' || typeof module.usage !== 'function') ||
            entry.taskLifecycle === true && typeof module.forgetTask !== 'function') throw Error('INVALID_MODULE_DESCRIPTOR');
        ids.add(entry.id); modules.add(module);
        if (entry.budgetLifecycle) budgetOwner = module;
        const toolModule = entry.toolModule || module;
        const definitions = toolModule.registry.list(), declared = new Map();
        for (const tool of entry.tools) {
            if (!tool?.id || declared.has(tool.id) || toolIds.has(tool.id) ||
                !(tool.group === null || tool.group && typeof tool.group.id === 'string' && tool.group.id && typeof tool.group.title === 'string' && tool.group.title)) throw Error('INVALID_MODULE_TOOL');
            declared.set(tool.id, tool); toolIds.add(tool.id);
            groups[tool.id] = tool.group && Object.freeze({ ...tool.group });
        }
        if (definitions.length !== declared.size || definitions.some(d => !declared.has(d.id)) ||
            Object.keys(toolModule.handlers).length !== declared.size || Object.keys(toolModule.handlers).some(id => !declared.has(id))) throw Error('MODULE_TOOL_MISMATCH');
        for (const definition of definitions) {
            const capability = capabilityFor(definition.id), label = labels[definition.id];
            if (!capability || capability.effect !== definition.effect || typeof capability.sources !== 'function' ||
                typeof toolModule.handlers[definition.id] !== 'function') throw Error('MODULE_CAPABILITY_MISMATCH');
            if (!Array.isArray(label) || label.length !== 2 || label.some(v => typeof v !== 'string' || !v.trim())) throw Error('MODULE_LABEL_MISSING');
        }
        for (const artifact of entry.artifacts) {
            const action = actions.find(row => row.id === artifact?.actionOwner);
            const readReview = artifact?.review === 'read-scope' && artifact.kind === 'task-plan' && artifact.actionOwner === null;
            if (!artifact?.moduleId || contentIds.has(artifact.moduleId) || !artifact.kind ||
                !(readReview || artifact.review === undefined && action?.artifactKinds.includes(artifact.kind)) || !Array.isArray(artifact.tools) || !artifact.tools.length ||
                new Set(artifact.tools).size !== artifact.tools.length || artifact.tools.some(id => !declared.has(id) || producers.has(id)) ||
                readReview && artifact.tools.some(id => definitions.find(d => d.id === id)?.effect !== 'read') ||
                typeof module.publishDraft !== 'function' || typeof module.validateSaved !== 'function') throw Error('INVALID_MODULE_ARTIFACT');
            contentIds.add(artifact.moduleId);
            for (const toolId of artifact.tools) { producers.add(toolId); artifacts.push({ toolId, moduleId: artifact.moduleId, owner: module }); }
        }
        for (const report of entry.reports || []) {
            if (report?.kind !== 'report' || !declared.has(report.toolId) || producers.has(report.toolId) ||
                definitions.find(d => d.id === report.toolId)?.effect !== 'read' ||
                typeof module.publishReport !== 'function') throw Error('INVALID_MODULE_REPORT');
            producers.add(report.toolId); reports.push({ toolId: report.toolId, kind: report.kind, owner: module });
        }
        tools.push({ id: entry.id, module: toolModule });
        rows.push({ id: entry.id, module, bindAssistant: entry.bindAssistant, taskLifecycle: entry.taskLifecycle === true, budgetLifecycle: entry.budgetLifecycle === true,
            artifacts: entry.artifacts.map(a => ({ ...a, tools: [...a.tools] })),
            reports: (entry.reports || []).map(r => ({ ...r })) });
    }
    let disposed = false;
    function visit(method, args) {
        if (disposed && method !== 'dispose') throw Error('MODULE_ASSEMBLY_DISPOSED');
        const errors = [];
        for (const row of rows) if ((method !== 'forgetTask' || row.taskLifecycle) && (method !== 'transferRun' || !row.budgetLifecycle)) try { row.module[method](...args); } catch (error) { errors.push(error); }
        if (errors.length) throw new AggregateError(errors, 'MODULE_LIFECYCLE_FAILED');
    }
    return Object.freeze({
        toolEntries: Object.freeze(tools.map(Object.freeze)), artifactEntries: Object.freeze(artifacts.map(Object.freeze)), toolGroups: Object.freeze(groups),
        owns: module => modules.has(module),
        describe: () => rows.map(row => ({ id: row.id, taskLifecycle: row.taskLifecycle, budgetLifecycle: row.budgetLifecycle, tools: tools.find(t => t.id === row.id).module.registry.list().map(d => d.id),
            artifacts: row.artifacts.map(a => ({ ...a, tools: [...a.tools] })), reports: row.reports.map(r => ({ ...r })) })),
        publishReports(app, runId, completedTools) {
            if (disposed) throw Error('MODULE_ASSEMBLY_DISPOSED');
            const errors = [];
            for (const report of reports) if (completedTools?.has(report.toolId)) {
                try { report.owner.publishReport(app, runId); } catch (error) { errors.push(error); }
            }
            if (errors.length) throw new AggregateError(errors, 'MODULE_REPORT_PUBLICATION_FAILED');
        },
        bindAssistant(identity, intent) { if (disposed) throw Error('MODULE_ASSEMBLY_DISPOSED'); for (const row of rows) row.bindAssistant?.(identity, intent); },
        bindBudget(id, limit, from = null) {
            if (disposed) throw Error('MODULE_ASSEMBLY_DISPOSED');
            if (!budgetOwner) throw Error('MODULE_BUDGET_OWNER_MISSING');
            return from ? budgetOwner.transferRun(from, id, limit) : budgetOwner.bindRun(id, limit);
        },
        resourceUsage(id) {
            if (disposed) throw Error('MODULE_ASSEMBLY_DISPOSED');
            if (!budgetOwner) throw Error('MODULE_BUDGET_OWNER_MISSING');
            return budgetOwner.usage(id);
        },
        transferRun: (from, identity) => visit('transferRun', [from, identity]),
        forgetRun: id => visit('forgetRun', [id]),
        forgetTask: id => visit('forgetTask', [id]),
        retainArtifacts: values => visit('retainArtifacts', [values]),
        dispose() { if (disposed) return; disposed = true; visit('dispose', []); },
    });
}
