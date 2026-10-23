import { createModuleAssembly } from './assembly.js';
import { builtinActionDescriptors } from '../actions/builtins.js';
import { toolCapability } from '../application/capabilities.js';
import { toolLabels } from './catalog.js';

const drafts = Object.freeze({ id: 'config-drafts', title: '领域配置、配置档与整单草稿 / Domain configuration, configuration profile and batch drafts' });
const tool = (id, group = null) => ({ id, group });
const artifact = (moduleId, kind, actionOwner, toolId) => ({ moduleId, kind, actionOwner, tools: [toolId] });

/** The original four-owner pilot plus all enabled module descriptors. */
export function createDraftAssembly({ draft, settings, variables, bundle, legacyPreview, extraEntries = [] }) {
    return createModuleAssembly([
        { id: 'legacy-draft', module: draft, toolModule: { registry: draft.registry, handlers: { ...draft.handlers, 'muyu.config.preview': legacyPreview } },
            bindAssistant: null, // Legacy assistant preview is lazily bound; draft mode supplies its field whitelist.
            tools: [tool('muyu.config.contract'), tool('muyu.config.preview')],
            artifacts: [artifact('memory-config', 'config-draft', 'actions', 'muyu.config.preview')] },
        { id: 'settings', module: settings, bindAssistant: identity => settings.bindRun(identity),
            tools: [tool('muyu.settings.catalog'), tool('muyu.settings.contract'), tool('muyu.settings.read'), tool('muyu.settings.preview', drafts)],
            artifacts: [artifact('settings-config', 'config-draft', 'actions', 'muyu.settings.preview')] },
        { id: 'variables', module: variables, bindAssistant: identity => variables.bindRun(identity),
            tools: [tool('muyu.variables.preview')],
            artifacts: [artifact('variable-draft', 'variable-draft', 'variableActions', 'muyu.variables.preview')] },
        { id: 'task-bundle', module: bundle, bindAssistant: identity => bundle.bindRun(identity),
            tools: [tool('muyu.task.preview', drafts)],
            artifacts: [artifact('task-bundle', 'task-bundle', 'bundleActions', 'muyu.task.preview')] },
        ...extraEntries,
    ], { capabilityFor: toolCapability, labels: toolLabels, actions: builtinActionDescriptors() });
}
