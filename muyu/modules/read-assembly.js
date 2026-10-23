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
    if (host.skills?.catalog) entries.push({
        id: 'skill-runtime', module: modules.skillRuntime, taskLifecycle: true,
        bindAssistant: (identity, intent) => modules.skillRuntime.bindRun(identity, intent.selectedSkill),
        tools: ['discover', 'load'].map(name => ({ id: 'muyu.skills.' + name, group: null })), artifacts: [],
    });
    return entries;
}
