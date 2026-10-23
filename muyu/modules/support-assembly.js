/** Remaining support owners. This describes existing effects, never approves them. */
export function supportDescriptors(host, { providers, taskPlan, profiles, web, notes, documents, pages, workspace }) {
    const tools = (prefix, names, group = null) => names.map(name => ({ id: prefix + name, group }));
    return [
        { id: 'providers', module: providers, bindAssistant: null, budgetLifecycle: true,
            tools: tools('muyu.provider.', ['list', 'read', 'discover', 'execute', 'result', 'search', 'match']), artifacts: [] },
        { id: 'task-plan', module: taskPlan, bindAssistant: identity => taskPlan.bindRun(identity),
            tools: tools('muyu.task.', ['plan', ...(host.bindTaskStep ? ['bind_step'] : []), ...(host.bindTaskRead ? ['bind_read'] : [])]),
            artifacts: [{ moduleId: 'task-plan', kind: 'task-plan', actionOwner: null, review: 'read-scope', tools: ['muyu.task.plan'] }] },
        { id: 'profile-draft', module: profiles, bindAssistant: identity => profiles.bindRun(identity),
            tools: tools('muyu.profile.', ['preview'], { id: 'config-drafts', title: '领域配置、配置档与整单草稿 / Domain configuration, configuration profile and batch drafts' }),
            artifacts: [{ moduleId: 'generated-profile', kind: 'profile-draft', actionOwner: 'profileActions', tools: ['muyu.profile.preview'] }] },
        { id: 'web', module: web, bindAssistant: (identity, intent) => web.bindRun(identity, intent), taskLifecycle: true,
            tools: tools('muyu.web.', ['search']), artifacts: [] },
        ...(documents ? [{ id: 'service-documents', module: documents, bindAssistant: (identity, intent) => documents.bindRun(identity, intent),
            tools: tools('muyu.service.', ['list_roots', 'list_files', 'search_documents', 'read_document'], { id: 'service-documents', title: '本地资料检索与片段读取 / Local document search and excerpts' }), artifacts: [] }] : []),
        ...(pages ? [{ id: 'service-pages', module: pages, bindAssistant: (identity, intent) => pages.bindRun(identity, intent), taskLifecycle: true,
            tools: tools('muyu.service.', ['fetch_page'], { id: 'service-pages', title: '公开网页正文读取 / Public web page text' }), artifacts: [] }] : []),
        ...(workspace ? [{id:'service-workspace',module:workspace,bindAssistant:(identity,intent)=>workspace.bindRun(identity,intent),
            tools:tools('muyu.service.',['write_file','validate_json'],{id:'service-workspace',title:'工作区文档草稿与JSON校验 / Workspace drafts and JSON validation'}),
            artifacts:[{moduleId:'service-workspace',kind:'workspace-draft',actionOwner:'workspaceActions',tools:['muyu.service.write_file']}]}] : []),
        { id: 'agent-memory', module: notes, bindAssistant: (identity, intent) => notes.bindRun(identity, intent),
            tools: tools('muyu.notes.', ['list', 'read', 'remember', 'forget']), artifacts: [] },
    ];
}
