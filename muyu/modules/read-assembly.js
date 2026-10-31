/** Read/control modules have no candidate drafts. Reports use a separate trusted outlet. */
export function readDescriptors(host, modules) {
    const definitions = [
        ['toolbox', 'muyu.tools.', ['list', 'select']],
        ['memory', 'muyu.', ['knowledge.list', 'knowledge.read', 'memory.inspect'], 'muyu.memory.inspect'],
        ['director', 'muyu.director.', ['inspect'], 'muyu.director.inspect'],
        ['context', 'muyu.context.', ['list', 'read']],
        ['history', 'muyu.history.', ['list', 'read', 'search']],
        ['interaction', 'muyu.interaction.', ['ask']],
        ['permission', 'muyu.permission.', ['request']],
    ];
    const entries = definitions.map(([id, prefix, names, reportTool]) => ({
        id, module: modules[id], bindAssistant: null,
        tools: names.map(name => ({ id: prefix + name, group: null })), artifacts: [],
        reports: reportTool ? [{ toolId: reportTool, kind: 'report' }] : [],
    }));
    if (host.storageInspection) entries.push({
        id: 'storage-inspection', module: modules.storageInspection, bindAssistant: identity => modules.storageInspection.bindRun(identity),
        tools: ['muyu.storage.list', 'muyu.storage.read'].map(id => ({ id, group: { id: 'storage-inspection', title: '已保存笔记与总结核验（只读） / Saved notes and summaries (read only)' } })), artifacts: [],
    });
    if (host.history?.inspection) entries.push({
        id: 'archive-inspection', module: modules.archiveInspection, bindAssistant: identity => modules.archiveInspection.bindRun(identity),
        tools: ['muyu.archives.list', 'muyu.archives.inspect'].map(id => ({ id, group: { id: 'archive-inspection', title: '暮羽对话存档核验（只读） / Muyu archive inspection (read only)' } })), artifacts: [],
    });
    if (typeof host.readSelfConfig === 'function') entries.push({
        id: 'self', module: modules.self, bindAssistant: identity => modules.self.bindRun(identity),
        tools: ['muyu.self.read', ...(typeof host.readSelfText === 'function' ? ['muyu.self.read_text'] : [])].map(id => ({ id, group: { id: 'muyu-self', title: '暮羽自身配置（只读） / Muyu self-configuration (read only)' } })), artifacts: [],
    });
    if (host.skills?.catalog) entries.push({
        id: 'skill-runtime', module: modules.skillRuntime, taskLifecycle: true,
        bindAssistant: (identity, intent) => modules.skillRuntime.bindRun(identity, intent.selectedSkill),
        tools: ['discover', 'load'].map(name => ({ id: 'muyu.skills.' + name, group: null })), artifacts: [],
    });
    return entries;
}
