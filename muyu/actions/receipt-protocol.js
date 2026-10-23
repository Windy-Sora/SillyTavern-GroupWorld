// Wire metadata only: no writer, approval, host data or model-controlled registration.
const configOwners = [{ id: 'actions', kind: 'config-draft' }];
const row = (version, module, id, kind, extra = {}) => ({ version, modules: [module],
    owners: [{ id, kind }], sources: 'none', projection: 'identity', config: false, technical: 'none', ...extra });
const definitions = [
    row(undefined, 'memory-config', 'actions', 'config-draft', { modules: [undefined, 'memory-config', 'settings-config'], owners: configOwners, sources: 'config', projection: 'diff', config: true, technical: 'diff' }),
    row(2, 'settings-config', 'actions', 'config-draft', { modules: [undefined, 'memory-config', 'settings-config'], owners: configOwners, sources: 'config', projection: 'diff', config: true, technical: 'diff' }),
    row(3, 'variable-draft', 'variableActions', 'variable-draft', { sources: 'variables', projection: 'diff' }),
    row(4, 'task-bundle', 'bundleActions', 'task-bundle', { sources: 'bundle', projection: 'steps', technical: 'settings-steps' }),
    row(5, 'generated-profile', 'profileActions', 'profile-draft', { technical: 'profile-fields' }),
    row(6, 'provider-asset', 'providerActions', 'provider-draft'),
    row(7, 'provider-asset', 'providerActions', 'provider-draft'),
    row(8, 'script-executor', 'scriptActions', 'script-draft'),
    row(9, 'task-bundle', 'bundleActions', 'task-bundle', { sources: 'bundle', projection: 'steps', technical: 'settings-steps' }),
    row(10, 'custom-agent', 'customAgentActions', 'custom-agent-draft'),
    row(11, 'custom-agent', 'customAgentActions', 'custom-agent-draft'),
    row(12, 'custom-prompt', 'customPromptActions', 'custom-prompt-draft'),
    row(13, 'custom-prompt', 'customPromptActions', 'custom-prompt-draft'),
    row(14, 'profile-library', 'profileLibraryActions', 'profile-library-draft'),
    row(15, 'profile-library-chat', 'profileLibraryChatActions', 'profile-library-chat-draft'),
    row(16, 'npc-library', 'npcLibraryActions', 'npc-library-draft'),
    row(17, 'npc-library-chat', 'npcLibraryChatActions', 'npc-library-chat-draft'),
    row(18, 'blueprint-library', 'blueprintLibraryActions', 'blueprint-library-draft'),
    row(19, 'blueprint-library-chat', 'blueprintLibraryChatActions', 'blueprint-library-chat-draft'),
    row(20, 'variable-editor', 'variableActions', 'variable-editor-draft'),
    row(21, 'memory-editor', 'memoryEditActions', 'memory-edit-draft'),
    row(22, 'profile-editor', 'profileEditActions', 'profile-edit-draft'),
    row(23, 'npc-editor', 'npcEditActions', 'npc-edit-draft'),
    row(24, 'blueprint-node-editor', 'blueprintNodeEditActions', 'blueprint-node-edit-draft'),
    row(25, 'ledger-editor', 'ledgerEditActions', 'ledger-edit-draft'),
    row(26, 'selection-editor', 'selectionActions', 'selection-draft'),
    row(27, 'blueprint-node-editor', 'blueprintNodeEditActions', 'blueprint-node-edit-draft'),
    row(28, 'memory-editor', 'memoryEditActions', 'memory-edit-draft'),
    row(29, 'blueprint-node-editor', 'blueprintNodeEditActions', 'blueprint-node-edit-draft'),
    row(30, 'profile-editor', 'profileEditActions', 'profile-edit-draft', {
        modules: ['profile-editor', 'npc-editor'], owners: [{ id: 'profileEditActions', kind: 'profile-edit-draft' }, { id: 'npcEditActions', kind: 'npc-edit-draft' }] }),
    row(31, 'skill', 'skillActions', 'skill-draft'),
    row(32, 'worldbook-editor', 'worldBookEditActions', 'worldbook-edit-draft'),
    row(33, 'character-card', 'characterCardActions', 'character-card-draft'),
    row(34, 'st-preset-editor', 'stPresetActions', 'st-preset-draft'),
    row(35,'service-workspace','workspaceActions','workspace-draft'),
].map(value => Object.freeze({ ...value, modules: Object.freeze([...value.modules]),
    owners: Object.freeze(value.owners.map(owner => Object.freeze({ ...owner }))) }));
const versions = new Map(definitions.map(value => [value.version, value]));
if (versions.size !== definitions.length) throw Error('DUPLICATE_RECEIPT_VERSION');
export const receiptProtocol = version => versions.get(version);
export const receiptProtocolDescriptors = () => definitions.map(value => ({ ...value,
    modules: [...value.modules], owners: value.owners.map(owner => ({ ...owner })) }));

// Operation variants are explicit; an unknown module never becomes a config edit.
const selectors = new Map([
    ...[undefined, 'memory-config', 'settings-config'].map(module => [module, content => content.preview?.contractVersion === 2 ? 2 : undefined]),
    ['provider-asset', content => content.operation ? 7 : 6],
    ['task-bundle', content => content.scripts?.length ? 9 : 4],
    ['custom-agent', content => content.operation === 'batch' ? 11 : 10],
    ['custom-prompt', content => content.operation === 'batch' ? 13 : 12],
    ['memory-editor', content => content.operation === 'create' ? 28 : 21],
    ['profile-editor', content => content.operation === 'create' ? 30 : 22],
    ['npc-editor', content => content.operation === 'create' ? 30 : 23],
    ['blueprint-node-editor', content => content.operation === 'initialize' ? 29 : content.operation ? 27 : 24],
]);
for (const value of definitions) for (const module of value.modules) {
    if (!selectors.has(module)) selectors.set(module, () => value.version);
}
export function actionReceiptProtocol(content) {
    const select = selectors.get(content?.module);
    if (!content || !select) throw Error('UNKNOWN_RECEIPT_MODULE');
    const value = receiptProtocol(select(content));
    if (!value || !value.modules.includes(content.module)) throw Error('INVALID_RECEIPT_OWNER');
    return value;
}

/** Composition-time coverage, not runtime permission. No action factories imported here. */
export function validateReceiptOwners(actions) {
    const owners = new Map();
    for (const action of actions) for (const kind of action.artifactKinds) {
        if (owners.has(kind)) throw Error('DUPLICATE_RECEIPT_OWNER');
        owners.set(kind, action.id);
    }
    const covered = new Set();
    for (const value of definitions) for (const owner of value.owners) {
        if (owners.get(owner.kind) !== owner.id) throw Error('INVALID_RECEIPT_OWNER');
        covered.add(owner.kind);
    }
    if (covered.size !== owners.size) throw Error('MISSING_RECEIPT_PROTOCOL');
}
