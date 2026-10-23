import { receiptProtocol, receiptProtocolDescriptors, actionReceiptProtocol } from './receipt-protocol.js';
import { validateJson } from '../core/json-contract.js';
import { memoryFields } from '../modules/config-draft/contracts.js';
import { configFields, fieldDefinition } from '../config/registry.js';
import { configDiffText, configLabel } from '../config/presentation.js';
const text = maxLength => ({ type: 'string', maxLength });
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const receiptStatuses = ['cancelled', 'expired', 'not_executed', 'applied_confirmed', 'applied_unconfirmed', 'saved_confirmed', 'saved_unconfirmed', 'partial', 'outcome_unknown'];
const schemaV35 = object({version:{type:'integer',enum:[35]},operationId:text(100),artifactId:text(100),revision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},at:{type:'integer',minimum:0,maximum:8640000000000000},status:{type:'string',enum:receiptStatuses},operation:{type:'string',enum:['create','update']},persistence:{type:'string',enum:['not_started','file_synced','unknown']}});
const schemaV34 = object({version:{type:'integer',enum:[34]},operationId:text(100),artifactId:text(100),revision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},at:{type:'integer',minimum:0,maximum:8640000000000000},status:{type:'string',enum:receiptStatuses},selector:text(40),operation:{type:'string',enum:['update','copy','save_current','select']},resourceSave:{type:'string',enum:['not_started','unconfirmed','unknown']}});
const schemaV33 = object({version:{type:'integer',enum:[33]},operationId:text(100),artifactId:text(100),revision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},at:{type:'integer',minimum:0,maximum:8640000000000000},status:{type:'string',enum:receiptStatuses},selector:text(40),operation:{type:'string',enum:['update','copy','create','rename','delete']},resourceSave:{type:'string',enum:['not_started','unconfirmed','unknown']}});
const schemaV32 = object({version:{type:'integer',enum:[32]},operationId:text(100),artifactId:text(100),revision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},at:{type:'integer',minimum:0,maximum:8640000000000000},status:{type:'string',enum:receiptStatuses},selector:text(40),operation:{type:'string',enum:['update','create_entry','delete_entry','create_book','copy_book','set_global_binding','set_chat_binding','delete_book']},resourceSave:{type:'string',enum:['not_started','unconfirmed','unknown']}});
const schema = object({ operationId: text(100), artifactId: text(100), revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, at: { type: 'integer', minimum: 0, maximum: 8640000000000000 }, status: { type: 'string', enum: receiptStatuses },
    diff: { type: 'array', maxItems: 4, items: object({ field: { type: 'string', enum: memoryFields }, before: text(40), after: text(40) }) }, saveError: { type: 'boolean' }, changed: { type: 'boolean' } });
const schemaV2 = { ...schema, properties: { ...schema.properties, version: { type: 'integer', enum: [2] }, diff: { type: 'array', maxItems: configFields.length, items: object({ field: { type: 'string', enum: configFields }, before: text(24000), after: text(24000) }) },
    memoryPrune: object({ chatKey: text(4096), settingsSave: { type: 'string', enum: ['not_started', 'confirmed', 'unconfirmed', 'error'] }, status: { type: 'string', enum: ['not_started', 'not_needed', 'pruned', 'skipped', 'outcome_unknown'] }, planned: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, removed: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } }),
    blueprintToggle: object({ chatKey: text(4096), chatSave: { type: 'string', enum: ['not_started', 'not_needed', 'confirmed', 'unknown'] }, settingsSave: { type: 'string', enum: ['not_started', 'confirmed', 'unconfirmed', 'error'] } }),
    completionVariable: object({ chatKey: text(4096), chatSave: { type: 'string', enum: ['not_started', 'confirmed', 'unknown'] }, settingsSave: { type: 'string', enum: ['not_started', 'confirmed', 'unconfirmed', 'error'] } }) } };
const variableFields = ['id', 'scope', 'type', 'defaultValue', 'label', 'rule', 'autoUpdate', 'injectMode', 'updateMode', 'min', 'max', 'showInDashboard'];
const receiptValue = (value, limit) => { const serialized = JSON.stringify(value); return serialized.length <= limit ? serialized : `[omitted ${serialized.length} characters; inspect the original draft]`; };
const schemaV3 = object({ version: { type: 'integer', enum: [3] }, operationId: text(100), artifactId: text(100), variableId: text(64),
    revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, at: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
    status: { type: 'string', enum: receiptStatuses },
    diff: { type: 'array', maxItems: variableFields.length, items: object({ field: { type: 'string', enum: variableFields }, before: text(1000), after: text(1000) }) },
    saveError: { type: 'boolean' }, changed: { type: 'boolean' }, chatSave: { type: 'string', enum: ['not_started', 'confirmed', 'unknown'] },
});
const bundleStepSchema = object({ kind: { type: 'string', enum: ['variable', 'settings'] }, id: text(100),
    status: { type: 'string', enum: [...receiptStatuses, 'not_started'] },
    chatSave: { type: 'string', enum: ['not_started', 'confirmed', 'unknown'] },
    settingsSave: { type: 'string', enum: ['not_started', 'confirmed', 'unconfirmed', 'error'] },
    saveError: { type: 'boolean' }, changed: { type: 'boolean' },
    diff: { type: 'array', maxItems: configFields.length, items: object({ field: text(100), before: text(24000), after: text(24000) }) },
});
const schemaV4 = object({ version: { type: 'integer', enum: [4] }, operationId: text(100), artifactId: text(100),
    revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, at: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
    status: { type: 'string', enum: receiptStatuses }, steps: { type: 'array', maxItems: 7, items: bundleStepSchema },
});
const schemaV5 = object({ version: { type: 'integer', enum: [5] }, operationId: text(100), artifactId: text(100),
    revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, at: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
    status: { type: 'string', enum: receiptStatuses }, profileName: text(80), profileId: text(100),
    fields: { type: 'array', maxItems: configFields.length, items: { type: 'string', enum: configFields } },
    persistence: { type: 'string', enum: ['not_started', 'confirmed', 'unconfirmed', 'unknown'] },
});
const schemaV6 = object({ version: { type: 'integer', enum: [6] }, operationId: text(100), artifactId: text(100),
    revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, at: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
    status: { type: 'string', enum: receiptStatuses }, name: text(80), ids: { type: 'array', maxItems: 8, items: text(80) },
    registered: { type: 'boolean' }, persistence: { type: 'string', enum: ['not_started', 'unconfirmed', 'unknown'] } });
const schemaV7 = { ...schemaV6, properties: { ...schemaV6.properties, version: { type: 'integer', enum: [7] }, operation: { type: 'string', enum: ['update', 'delete'] } }, required: [...schemaV6.required, 'operation'] };
const schemaV8 = object({ version: { type: 'integer', enum: [8] }, operationId: text(100), artifactId: text(100),
    revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, at: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
    status: { type: 'string', enum: receiptStatuses }, operation: { type: 'string', enum: ['create', 'update', 'delete'] },
    name: text(80), scriptId: text(100), enabled: { type: 'boolean' }, persistence: { type: 'string', enum: ['not_started', 'unconfirmed', 'unknown'] } });
const schemaV31 = object({ version: { type: 'integer', enum: [31] }, operationId: text(100), artifactId: text(100),
    revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, at: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
    status: { type: 'string', enum: receiptStatuses }, operation: { type: 'string', enum: ['create', 'update', 'delete', 'enable', 'copy', 'feature'] },
    persistence: { type: 'string', enum: ['not_started', 'unconfirmed', 'unknown'] } });
const schemaV30 = object({version:{type:'integer',enum:[30]},operationId:text(100),artifactId:text(100),revision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},at:{type:'integer',minimum:0,maximum:8640000000000000},status:{type:'string',enum:receiptStatuses},kind:{type:'string',enum:['profile','npc']},operation:{type:'string',enum:['create']},chatSave:{type:'string',enum:['not_started','confirmed','unknown']}});
const schemaV29 = object({version:{type:'integer',enum:[29]},operationId:text(100),artifactId:text(100),revision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},at:{type:'integer',minimum:0,maximum:8640000000000000},status:{type:'string',enum:receiptStatuses},operation:{type:'string',enum:['initialize']},completionReset:{type:'boolean'},chatSave:{type:'string',enum:['not_started','confirmed','unknown']}});
const schemaV28 = object({version:{type:'integer',enum:[28]},operationId:text(100),artifactId:text(100),revision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},at:{type:'integer',minimum:0,maximum:8640000000000000},status:{type:'string',enum:receiptStatuses},operation:{type:'string',enum:['create']},character:text(40),index:{type:'integer',minimum:0,maximum:1023},chatSave:{type:'string',enum:['not_started','confirmed','unknown']}});
const schemaV27 = object({version:{type:'integer',enum:[27]},operationId:text(100),artifactId:text(100),revision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},at:{type:'integer',minimum:0,maximum:8640000000000000},status:{type:'string',enum:receiptStatuses},operation:{type:'string',enum:['create','delete','move']},completionReset:{type:'boolean'},chatSave:{type:'string',enum:['not_started','confirmed','unknown']}});
const schemaV26 = object({version:{type:'integer',enum:[26]},operationId:text(100),artifactId:text(100),revision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},at:{type:'integer',minimum:0,maximum:8640000000000000},status:{type:'string',enum:receiptStatuses},kind:{type:'string',enum:['worldbooks','profile-autoload']},settingsSave:{type:'string',enum:['not_started','confirmed','unconfirmed','unknown']}});
const schemaV25 = object({version:{type:'integer',enum:[25]},operationId:text(100),artifactId:text(100),revision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},at:{type:'integer',minimum:0,maximum:8640000000000000},status:{type:'string',enum:receiptStatuses},selector:text(40),operation:{type:'string',enum:['update','clear']},chatSave:{type:'string',enum:['not_started','confirmed','unknown']}});
const schemaV24 = object({version:{type:'integer',enum:[24]},operationId:text(100),artifactId:text(100),revision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},at:{type:'integer',minimum:0,maximum:8640000000000000},status:{type:'string',enum:receiptStatuses},selector:text(40),chatSave:{type:'string',enum:['not_started','confirmed','unknown']}});
const schemaV23 = object({version:{type:'integer',enum:[23]},operationId:text(100),artifactId:text(100),revision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},at:{type:'integer',minimum:0,maximum:8640000000000000},status:{type:'string',enum:receiptStatuses},operation:{type:'string',enum:['update','delete']},selector:text(40),chatSave:{type:'string',enum:['not_started','confirmed','unknown']}});
const schemaV22 = object({version:{type:'integer',enum:[22]},operationId:text(100),artifactId:text(100),revision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},at:{type:'integer',minimum:0,maximum:8640000000000000},status:{type:'string',enum:receiptStatuses},operation:{type:'string',enum:['update','delete']},character:text(40),chatSave:{type:'string',enum:['not_started','confirmed','unknown']}});
const schemaV21 = object({version:{type:'integer',enum:[21]},operationId:text(100),artifactId:text(100),revision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},at:{type:'integer',minimum:0,maximum:8640000000000000},status:{type:'string',enum:receiptStatuses},operation:{type:'string',enum:['update','delete']},character:text(40),index:{type:'integer',minimum:0,maximum:1023},chatSave:{type:'string',enum:['not_started','confirmed','unknown']}});
const schemaV20 = object({version:{type:'integer',enum:[20]},operationId:text(100),artifactId:text(100),
    revision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},at:{type:'integer',minimum:0,maximum:8640000000000000},
    status:{type:'string',enum:receiptStatuses},operation:{type:'string',enum:['create','update','delete','set_value']},
    variableId:text(64),label:text(100),character:text(40),chatSave:{type:'string',enum:['not_started','confirmed','unknown']}});
const schemaV19 = object({ version: { type: 'integer', enum: [19] }, operationId: text(100), artifactId: text(100),
    revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, at: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
    status: { type: 'string', enum: receiptStatuses }, operation: { type: 'string', enum: ['capture', 'apply'] },
    name: text(80), libraryId: text(100), count: { type: 'integer', minimum: 0, maximum: 256 },
    chatSave: { type: 'string', enum: ['not_started', 'confirmed', 'unknown'] },
    settingsSave: { type: 'string', enum: ['not_started', 'unconfirmed', 'unknown'] } });
const schemaV17 = object({ version: { type: 'integer', enum: [17] }, operationId: text(100), artifactId: text(100),
    revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, at: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
    status: { type: 'string', enum: receiptStatuses }, operation: { type: 'string', enum: ['capture', 'apply'] },
    name: text(80), libraryId: text(100), count: { type: 'integer', minimum: 0, maximum: 64 },
    chatSave: { type: 'string', enum: ['not_started', 'confirmed', 'unknown'] },
    settingsSave: { type: 'string', enum: ['not_started', 'unconfirmed', 'unknown'] } });
const schemaV15 = object({ version: { type: 'integer', enum: [15] }, operationId: text(100), artifactId: text(100),
    revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, at: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
    status: { type: 'string', enum: receiptStatuses }, operation: { type: 'string', enum: ['capture', 'apply'] },
    name: text(80), libraryId: text(100), count: { type: 'integer', minimum: 0, maximum: 64 },
    chatSave: { type: 'string', enum: ['not_started', 'confirmed', 'unknown'] },
    settingsSave: { type: 'string', enum: ['not_started', 'unconfirmed', 'unknown'] } });
const schemaV18 = object({ version: { type: 'integer', enum: [18] }, operationId: text(100), artifactId: text(100),
    revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, at: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
    status: { type: 'string', enum: receiptStatuses }, operation: { type: 'string', enum: ['create', 'update', 'delete'] },
    name: text(80), libraryId: text(100), persistence: { type: 'string', enum: ['not_started', 'unconfirmed', 'unknown'] } });
const schemaV16 = object({ version: { type: 'integer', enum: [16] }, operationId: text(100), artifactId: text(100),
    revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, at: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
    status: { type: 'string', enum: receiptStatuses }, operation: { type: 'string', enum: ['create', 'update', 'delete'] },
    name: text(80), libraryId: text(100), persistence: { type: 'string', enum: ['not_started', 'unconfirmed', 'unknown'] } });
const schemaV14 = object({ version: { type: 'integer', enum: [14] }, operationId: text(100), artifactId: text(100),
    revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, at: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
    status: { type: 'string', enum: receiptStatuses }, operation: { type: 'string', enum: ['create', 'update', 'delete'] },
    name: text(80), libraryId: text(100), persistence: { type: 'string', enum: ['not_started', 'unconfirmed', 'unknown'] } });
const schemaV12 = object({ version: { type: 'integer', enum: [12] }, operationId: text(100), artifactId: text(100),
    revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, at: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
    status: { type: 'string', enum: receiptStatuses }, operation: { type: 'string', enum: ['create', 'update', 'delete'] },
    name: text(80), promptId: text(100), persistence: { type: 'string', enum: ['not_started', 'unconfirmed', 'unknown'] } });
const schemaV10 = object({ version: { type: 'integer', enum: [10] }, operationId: text(100), artifactId: text(100),
    revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, at: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
    status: { type: 'string', enum: receiptStatuses }, operation: { type: 'string', enum: ['create', 'update', 'delete'] },
    name: text(80), agentId: text(100), providerName: text(80), enabled: { type: 'boolean' }, autoEnabled: { type: 'boolean' },
    persistence: { type: 'string', enum: ['not_started', 'unconfirmed', 'unknown'] } });
const schemaV13 = object({ version: { type: 'integer', enum: [13] }, operationId: text(100), artifactId: text(100),
    revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, at: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
    status: { type: 'string', enum: receiptStatuses }, origin: { type: 'string', enum: ['batch', 'import'] },
    items: { type: 'array', maxItems: 6, items: object({ operation: { type: 'string', enum: ['create', 'update', 'delete'] }, name: text(80), promptId: text(100) }) },
    skipped: { type: 'array', maxItems: 6, items: text(80) }, persistence: { type: 'string', enum: ['not_started', 'unconfirmed', 'unknown'] } });
const schemaV11 = object({ version: { type: 'integer', enum: [11] }, operationId: text(100), artifactId: text(100),
    revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, at: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
    status: { type: 'string', enum: receiptStatuses }, origin: { type: 'string', enum: ['batch', 'import'] },
    items: { type: 'array', maxItems: 6, items: object({ operation: { type: 'string', enum: ['create', 'update', 'delete'] }, name: text(80), providerName: text(80), agentId: text(100) }) },
    skipped: { type: 'array', maxItems: 6, items: text(80) }, persistence: { type: 'string', enum: ['not_started', 'unconfirmed', 'unknown'] } });
const scriptStepInfo = object({ name: text(80), scriptId: text(100), operation: { type: 'string', enum: ['create', 'update', 'delete'] },
    persistence: { type: 'string', enum: ['not_started', 'unconfirmed', 'unknown'] } });
const schemaV9 = { ...schemaV4, properties: { ...schemaV4.properties, version: { type: 'integer', enum: [9] },
    steps: { type: 'array', maxItems: 10, items: { ...bundleStepSchema, properties: { ...bundleStepSchema.properties,
        kind: { type: 'string', enum: ['variable', 'settings', 'script'] }, script: scriptStepInfo } } } } };
const receiptSchemas = new Map([[undefined, schema], [2, schemaV2], [3, schemaV3], [4, schemaV4], [5, schemaV5], [6, schemaV6], [7, schemaV7], [8, schemaV8], [9, schemaV9], [10, schemaV10], [11, schemaV11], [12, schemaV12], [13, schemaV13], [14, schemaV14], [15, schemaV15], [16, schemaV16], [17, schemaV17], [18, schemaV18], [19, schemaV19], [20, schemaV20], [21, schemaV21], [22, schemaV22], [23, schemaV23], [24, schemaV24], [25, schemaV25], [26, schemaV26], [27, schemaV27], [28, schemaV28], [29, schemaV29], [30, schemaV30], [31, schemaV31], [32, schemaV32], [33, schemaV33], [34, schemaV34]]);
receiptSchemas.set(35,schemaV35);
for (const version of receiptSchemas.keys()) if (!receiptProtocol(version)) throw Error('UNKNOWN_RECEIPT_VERSION');
for (const { version } of receiptProtocolDescriptors()) if (!receiptSchemas.has(version)) throw Error('MISSING_RECEIPT_SCHEMA');
export function receiptSources(value) {
    const protocol = receiptProtocol(value?.version);
    if (!protocol) throw Error('UNKNOWN_RECEIPT_VERSION');
    if (protocol.sources === 'none') return [];
    if (protocol.sources === 'bundle') return [...new Set(value.steps.flatMap(step => step.kind === 'variable' ? ['source:variables'] : step.kind === 'script' ? [] :
        step.diff.map(row => fieldDefinition(row.field).domain === 'memory' ? 'source:memoryConfig' : 'source:configSettings')))];
    if (protocol.sources === 'variables') return ['source:variables'];
    if (protocol.sources !== 'config') throw Error('INVALID_RECEIPT_SOURCES');
    return [...new Set([...value.diff.map(d => value.version === 2 ? fieldDefinition(d.field).domain === 'memory' ? 'source:memoryConfig' : 'source:configSettings' : 'source:memoryConfig'), ...(value.memoryPrune ? ['source:memoryDiagnostics'] : []), ...(value.completionVariable || value.blueprintToggle ? ['source:variables'] : [])])];
}
export function validateReceipt(value) {
    if (!receiptProtocol(value?.version)) throw Error('UNKNOWN_RECEIPT_VERSION');
    const result = validateJson(receiptSchemas.get(value?.version), value);
    if (result.version === 34 && (result.operation==='save_current' ? result.selector!=='current' : !/^preset:(0|[1-9]\d{0,2})$/.test(result.selector))) throw Error('INVALID_RECEIPT');
    if (result.version === 33 && (result.operation==='create' ? result.selector!=='' : !/^card:(0|[1-9]\d{0,3})$/.test(result.selector))) throw Error('INVALID_RECEIPT');
    if ([11, 13].includes(result.version) && !result.items.length) throw Error('INVALID_RECEIPT');
    if (result.version === 7 && result.operation === 'delete' && result.registered) throw Error('INVALID_RECEIPT');
    if (result.version === 9 && (result.steps.filter(step => step.kind === 'script').length > 3 || !result.steps.some(step => step.kind === 'script'))) throw Error('INVALID_RECEIPT');
    if ([4, 9].includes(result.version) && (!result.steps.length || result.steps.some(step => step.kind === 'script' ? result.version !== 9 || !step.script || step.diff.length !== 0 : step.script !== undefined || (step.kind === 'settings' ? step.id !== 'global-settings' || step.diff.some(row => !configFields.includes(row.field)) : !/^[a-z0-9_]{1,64}$/.test(step.id) || step.diff.some(row => !variableFields.includes(row.field)))))) throw Error('INVALID_RECEIPT');
    if (result.version === 2 && (result.diff.some(d => d.field === 'memoryMaxEntries') !== !!result.memoryPrune)) throw Error('INVALID_RECEIPT');
    if (result.version === 2 && (result.diff.some(d => d.field === 'storyBlueprintCompletionVariable') !== !!result.completionVariable)) throw Error('INVALID_RECEIPT');
    if (result.version === 2 && (result.diff.some(d => d.field === 'storyBlueprintEnabled') !== !!result.blueprintToggle)) throw Error('INVALID_RECEIPT');
    return result;
}
export function actionReceipt(action) {
    if(action.content?.module==='service-workspace')return validateReceipt({version:35,operationId:action.id,artifactId:action.artifactId,revision:action.revision,at:Date.now(),status:action.status,operation:action.content.operation,persistence:action.result?.persistence||(action.status==='outcome_unknown'?'unknown':'not_started')});
    const protocol = actionReceiptProtocol(action.content);
    if (protocol.version === 34) return validateReceipt({ version: 34,operationId:action.id,artifactId:action.artifactId,revision:action.revision,at:Date.now(),status:action.status,selector:action.content.selector,operation:action.content.operation,resourceSave:action.result?.resourceSave||'not_started'});
    if (protocol.version === 33) return validateReceipt({ version: 33,operationId:action.id,artifactId:action.artifactId,revision:action.revision,at:Date.now(),status:action.status,selector:action.content.selector,operation:action.content.operation,resourceSave:action.result?.resourceSave||'not_started'});
    if (protocol.version === 32) return validateReceipt({ version: 32,operationId:action.id,artifactId:action.artifactId,revision:action.revision,at:Date.now(),status:action.status,selector:action.content.selector,operation:action.content.operation,resourceSave:action.result?.resourceSave||'not_started'});
    if (protocol.version === 31) return validateReceipt({ version: 31, operationId: action.id, artifactId: action.artifactId, revision: action.revision, at: Date.now(), status: action.status, operation: action.content.operation, persistence: action.result?.persistence || (action.status === 'outcome_unknown' ? 'unknown' : 'not_started') });
    if (protocol.version === 30) return validateReceipt({ version: 30,operationId:action.id,artifactId:action.artifactId,revision:action.revision,at:Date.now(),status:action.status,kind:action.content.module==='profile-editor'?'profile':'npc',operation:'create',chatSave:action.result?.chatSave||'not_started'});
    if (protocol.version === 26) return validateReceipt({ version: 26,operationId:action.id,artifactId:action.artifactId,revision:action.revision,at:Date.now(),status:action.status,kind:action.content.kind,settingsSave:action.result?.settingsSave||'not_started'});
    if (protocol.version === 25) return validateReceipt({ version: 25,operationId:action.id,artifactId:action.artifactId,revision:action.revision,at:Date.now(),status:action.status,selector:action.content.selector,operation:action.content.operation,chatSave:action.result?.chatSave||'not_started'});
    if (protocol.version === 29) return validateReceipt({ version: 29,operationId:action.id,artifactId:action.artifactId,revision:action.revision,at:Date.now(),status:action.status,operation:'initialize',completionReset:!!action.content.completion.before.exists,chatSave:action.result?.chatSave||'not_started'});
    if (protocol.version === 27) return validateReceipt({ version: 27,operationId:action.id,artifactId:action.artifactId,revision:action.revision,at:Date.now(),status:action.status,operation:action.content.operation,completionReset:!!action.content.completion.before.exists,chatSave:action.result?.chatSave||'not_started'});
    if (protocol.version === 24) return validateReceipt({ version: 24,operationId:action.id,artifactId:action.artifactId,revision:action.revision,at:Date.now(),status:action.status,selector:action.content.selector,chatSave:action.result?.chatSave||'not_started'});
    if (protocol.version === 23) return validateReceipt({ version: 23,operationId:action.id,artifactId:action.artifactId,revision:action.revision,at:Date.now(),status:action.status,operation:action.content.operation,selector:action.content.selector,chatSave:action.result?.chatSave||'not_started'});
    if (protocol.version === 22) return validateReceipt({ version: 22,operationId:action.id,artifactId:action.artifactId,revision:action.revision,at:Date.now(),status:action.status,operation:action.content.operation,character:action.content.character,chatSave:action.result?.chatSave||'not_started'});
    if (protocol.version === 28) return validateReceipt({ version: 28,operationId:action.id,artifactId:action.artifactId,revision:action.revision,at:Date.now(),status:action.status,operation:'create',character:action.content.character,index:action.content.index,chatSave:action.result?.chatSave||'not_started'});
    if (protocol.version === 21) return validateReceipt({ version: 21,operationId:action.id,artifactId:action.artifactId,revision:action.revision,at:Date.now(),status:action.status,operation:action.content.operation,character:action.content.character,index:action.content.index,chatSave:action.result?.chatSave||'not_started'});
    if (protocol.version === 20) return validateReceipt({ version: 20,operationId:action.id,artifactId:action.artifactId,revision:action.revision,at:Date.now(),status:action.status,operation:action.content.operation,variableId:action.content.id,label:action.content.name,character:action.content.character,chatSave:action.result?.chatSave||'not_started'});
    if (protocol.version === 19) return validateReceipt({ version: 19, operationId: action.id, artifactId: action.artifactId,
        revision: action.revision, at: Date.now(), status: action.status, operation: action.content.operation,
        name: action.content.name, libraryId: action.result?.id || action.content.libraryId || '', count: action.content.count,
        chatSave: action.result?.chatSave || 'not_started', settingsSave: action.result?.settingsSave || 'not_started' });
    if (protocol.version === 17) return validateReceipt({ version: 17, operationId: action.id, artifactId: action.artifactId,
        revision: action.revision, at: Date.now(), status: action.status, operation: action.content.operation,
        name: action.content.name, libraryId: action.result?.id || action.content.libraryId || '', count: action.content.count,
        chatSave: action.result?.chatSave || 'not_started', settingsSave: action.result?.settingsSave || 'not_started' });
    if (protocol.version === 15) return validateReceipt({ version: 15, operationId: action.id, artifactId: action.artifactId,
        revision: action.revision, at: Date.now(), status: action.status, operation: action.content.operation,
        name: action.content.name, libraryId: action.result?.id || action.content.libraryId || '', count: action.content.count,
        chatSave: action.result?.chatSave || 'not_started', settingsSave: action.result?.settingsSave || 'not_started' });
    if (protocol.version === 18) return validateReceipt({ version: 18, operationId: action.id, artifactId: action.artifactId,
        revision: action.revision, at: Date.now(), status: action.status, operation: action.content.operation,
        name: action.content.next?.name || action.content.previous?.name, libraryId: action.result?.id || action.content.id,
        persistence: action.result?.persistence || 'not_started' });

    if (protocol.version === 16) return validateReceipt({ version: 16, operationId: action.id, artifactId: action.artifactId,
        revision: action.revision, at: Date.now(), status: action.status, operation: action.content.operation,
        name: action.content.next?.name || action.content.previous?.name, libraryId: action.result?.id || action.content.id,
        persistence: action.result?.persistence || 'not_started' });

    if (protocol.version === 14) return validateReceipt({ version: 14, operationId: action.id, artifactId: action.artifactId,
        revision: action.revision, at: Date.now(), status: action.status, operation: action.content.operation,
        name: action.content.next?.name || action.content.previous?.name, libraryId: action.result?.id || action.content.id,
        persistence: action.result?.persistence || 'not_started' });

    if (protocol.version === 13) return validateReceipt({ version: 13,
        operationId: action.id, artifactId: action.artifactId, revision: action.revision, at: Date.now(), status: action.status, origin: action.content.origin,
        items: action.content.entries.map((row, index) => ({ operation: row.operation, name: row.next?.name || row.previous?.name,
            promptId: action.result?.ids?.[index] || row.id })),
        skipped: action.content.skipped, persistence: action.result?.persistence || 'not_started' });

    if (protocol.version === 12) return validateReceipt({ version: 12, operationId: action.id, artifactId: action.artifactId,
        revision: action.revision, at: Date.now(), status: action.status, operation: action.content.operation,
        name: action.content.next?.name || action.content.previous?.name, promptId: action.result?.id || action.content.id,
        persistence: action.result?.persistence || 'not_started' });
    if (protocol.version === 11) return validateReceipt({ version: 11,
        operationId: action.id, artifactId: action.artifactId, revision: action.revision, at: Date.now(), status: action.status, origin: action.content.origin,
        items: action.content.entries.map((row, index) => ({ operation: row.operation, name: row.next?.name || row.previous?.name,
            providerName: row.next?.providerName || row.previous?.providerName, agentId: action.result?.ids?.[index] || row.id })),
        skipped: action.content.skipped, persistence: action.result?.persistence || 'not_started' });
    if (protocol.version === 10) return validateReceipt({ version: 10, operationId: action.id, artifactId: action.artifactId,
        revision: action.revision, at: Date.now(), status: action.status, operation: action.content.operation,
        name: action.content.next?.name || action.content.previous?.name, providerName: action.content.next?.providerName || action.content.previous?.providerName,
        agentId: action.result?.id || action.content.id, enabled: action.result?.enabled === true, autoEnabled: action.result?.autoEnabled === true,
        persistence: action.result?.persistence || 'not_started' });
    if (protocol.version === 8) return validateReceipt({ version: 8, operationId: action.id, artifactId: action.artifactId,
        revision: action.revision, at: Date.now(), status: action.status, operation: action.content.operation,
        name: action.content.next?.name || action.content.previous?.name, scriptId: action.result?.id || action.content.id,
        enabled: action.result?.enabled === true, persistence: action.result?.persistence || 'not_started' });
    if (protocol.version === 6 || protocol.version === 7) return validateReceipt({ version: protocol.version, ...(action.content.operation ? { operation: action.content.operation } : {}), operationId: action.id, artifactId: action.artifactId,
        revision: action.revision, at: Date.now(), status: action.status, name: action.content.name, ids: action.content.ids,
        registered: action.result?.registered === true, persistence: action.result?.persistence || 'not_started' });
    if (protocol.version === 5) return validateReceipt({ version: 5, operationId: action.id, artifactId: action.artifactId,
        revision: action.revision, at: Date.now(), status: action.status, profileName: action.content.name,
        profileId: action.result?.profileId || '', fields: action.content.fields,
        persistence: action.result?.persistence || 'not_started' });
    if (protocol.version === 4 || protocol.version === 9) {
        const planned = [...action.content.variables.map(row => ({ kind: 'variable', id: row.preview.id,
            diff: row.preview.diff.map(d => ({ field: d.field, before: receiptValue(d.before, 24000), after: receiptValue(d.after, 24000) })) })),
        ...(action.content.settings ? [{ kind: 'settings', id: 'global-settings', diff: action.content.settings.preview.diff }] : []),
        ...(action.content.scripts || []).map(row => ({ kind: 'script', id: row.id || row.next.name, diff: [], script: { name: row.next?.name || row.previous?.name, scriptId: row.id, operation: row.operation, persistence: 'not_started' } }))];
        return validateReceipt({ version: protocol.version, operationId: action.id, artifactId: action.artifactId, revision: action.revision,
            at: Date.now(), status: action.status, steps: planned.map((step, index) => {
                const result = action.result?.steps?.[index];
                return { ...step, ...(step.script ? { script: { ...step.script, scriptId: result?.result?.id || step.script.scriptId, persistence: result?.result?.persistence || 'not_started' } } : {}), status: result?.status || 'not_started', chatSave: result?.result?.chatSave || 'not_started',
                    settingsSave: step.kind === 'settings' ? result?.result?.saveError ? 'error' : result?.status === 'applied_confirmed' ? 'confirmed' : result?.status === 'applied_unconfirmed' ? 'unconfirmed' : 'not_started' : 'not_started',
                    saveError: result?.result?.saveError === true, changed: result?.result?.changed === true };
            }) });
    }
    if (protocol.version === 3) return validateReceipt({ version: 3, operationId: action.id, artifactId: action.artifactId, variableId: action.content.preview.id,
        revision: action.revision, at: Date.now(), status: action.status,
        diff: action.content.preview.diff.map(d => ({ field: d.field, before: receiptValue(d.before, 1000), after: receiptValue(d.after, 1000) })),
        saveError: action.result?.saveError === true, changed: action.result?.changed === true, chatSave: action.result?.chatSave || 'not_started' });
    if (!protocol.config) throw Error('MISSING_RECEIPT_PRODUCER');
    return validateReceipt({ ...(protocol.version === 2 ? { version: 2 } : {}), operationId: action.id, artifactId: action.artifactId, revision: action.revision, at: Date.now(), status: action.status,
        diff: action.content.preview.diff, saveError: action.result?.saveError === true, changed: action.result?.changed === true,
        ...(action.content.memoryPrunePlan ? { memoryPrune: { chatKey: action.content.memoryPrunePlan.target.chatKey, settingsSave: action.result?.settingsSave || 'not_started', status: action.result?.memoryPrune?.status || 'not_started', planned: action.content.memoryPrunePlan.total, removed: action.result?.memoryPrune?.removed || 0 } } : {}),
        ...(action.content.blueprintTogglePlan ? { blueprintToggle: { chatKey: action.content.blueprintTogglePlan.target.chatKey,
            chatSave: action.result?.blueprintToggle?.chatSave || 'not_started', settingsSave: action.result?.blueprintToggle?.settingsSave || 'not_started' } } : {}),
        ...(action.content.completionVariablePlan ? { completionVariable: { chatKey: action.content.completionVariablePlan.target.chatKey,
            chatSave: action.result?.completionVariable?.chatSave || 'not_started', settingsSave: action.result?.completionVariable?.settingsSave || 'not_started' } } : {}) });
}
export function receiptText(r, lang = 'zh') {
    if (!receiptProtocol(r?.version)) throw Error('UNKNOWN_RECEIPT_VERSION');
    if (r.version === 31) return new Date(r.at).toISOString() + ' · ' + r.status + '\n' + (lang === 'en' ? 'Skill management: ' : '技能管理：') + r.operation + ' · ' + r.persistence + '\n' + (lang === 'en' ? 'Historical result, not current Skill state or permission. Saving does not execute a Skill; unconfirmed/unknown persistence must not be auto retried.' : '历史结果，不代表当前技能状态或授权。保存不执行技能；未确认／未知保存不要自动重试。');
    if(r.version===30)return new Date(r.at).toISOString()+' · '+r.status+'\n'+(lang==='en'?'Manual chat data creation: ':'手工新建聊天数据：')+(r.kind==='profile'?(lang==='en'?'Character profile':'角色档案'):'NPC')+' · '+r.chatSave+'\n'+(lang==='en'?'No extra generation, card import, enabling or overwrite. Historical result, not current state or permission; unknown saving must not be retried automatically.':'未额外生成、导入角色卡、开启功能或覆盖。历史结果，不代表当前状态或授权；未知保存不要自动重试。');
    if (r.version === 29) return new Date(r.at).toISOString() + ' · ' + r.status + '\n' + (lang === 'en' ? 'First blank Blueprint · Chat save: ' : '首次新建空白蓝图 · 聊天保存：') + r.chatSave + '\n' + (lang === 'en' ? 'Existing completion signal reset: ' : '重置已有完成标记：') + r.completionReset + '\n' + (lang === 'en' ? 'Blank data, no extra generation or enabling. Historical result, not current state or authorization; unknown saving must not be retried automatically.' : '仅空白数据，未额外生成或开启功能。历史结果，不代表当前状态或授权；未知保存不要自动重试。');
    if (r.version === 28) return new Date(r.at).toISOString() + ' · ' + r.status + '\n' + (lang === 'en' ? 'Manual memory creation · Chat save: ' : '手工新增角色记忆 · 聊天保存：') + r.chatSave + '\n' + (lang === 'en' ? 'No extra generation, pruning or enabling. Historical result, not current state or permission; unknown saving must not be retried automatically.' : '未额外调用生成模型、裁剪旧记忆或开启功能。历史结果，不代表当前状态或授权；未知保存不要自动重试。');
    const en = lang === 'en';
    if(r.version===35)return new Date(r.at).toISOString()+' · '+r.status+'\n'+(en?'Private workspace file · File sync: ':'私有工作区文档 · 文件同步：')+r.persistence+'\n'+(en?'Historical result, not current file state or crash-proof directory persistence. No automatic retry; not applied to ST/GroupWorld.':'历史结果，不代表当前文件或断电后的目录持久化。不自动重试，未应用到酒馆/GroupWorld。');
    if (r.version === 15) return `${new Date(r.at).toISOString()} · ${r.status}\n${en ? 'Profile library / chat' : '档案库与本聊天'}: ${r.name} · ${r.operation}\n${en ? 'Planned profiles' : '计划档案数'}: ${r.count}\n${en ? 'Chat save / global save' : '聊天保存／全局保存'}: ${r.chatSave} / ${r.settingsSave}\n${en ? 'Separate save domains may partly complete. Historical result, not current state or permission. Do not retry unknown outcomes automatically.' : '两域可能部分完成；未确认不代表保存成功。历史结果，不代表当前状态或授权。未知结果不要自动重试。'}`;
    if (r.version === 17) return `${new Date(r.at).toISOString()} · ${r.status}\n${en ? 'NPC library / chat' : 'NPC 库与本聊天'}: ${r.name} · ${r.operation}\n${en ? 'Planned NPCs' : '计划 NPC 数'}: ${r.count}\n${en ? 'Chat save / global save' : '聊天保存／全局保存'}: ${r.chatSave} / ${r.settingsSave}\n${en ? 'Separate save domains may partly complete. Historical result, not current state or permission. Do not retry unknown outcomes automatically.' : '两域可能部分完成；未确认不代表保存成功。历史结果，不代表当前状态或授权。未知结果不要自动重试。'}`;
    if (r.version === 16) return `${new Date(r.at).toISOString()} · ${r.status}\nNPC ${en ? 'library' : '库'}: ${r.name} · ${r.operation}\n${en ? 'Persistence' : '持久化'}: ${r.persistence}\n${en ? 'Only the global library entry was targeted. No chat NPC, active Prompt or character card application; no generation. Historical result, not current state or authorization. Unknown outcomes must not be retried automatically.' : '仅针对全局库条目，不应用聊天 NPC、当前提示词或角色卡，不生成。保存未确认不代表持久化成功；未知结果可能保留内存修改，不自动重试。历史结果，不代表当前状态或授权。'}`;
    if(r.version===26)return `${new Date(r.at).toISOString()} · ${r.status}\n${r.kind==='worldbooks'?(en?'World book selection':'世界书选择'):(en?'Profile auto-load policy':'档案库加载策略')}\n${en?'Global settings save':'全局设置保存'}: ${r.settingsSave}\n${en?'Historical result, not current state or authorization; no immediate scan/load.':'历史结果，不代表当前状态或授权；未立即扫描或加载。'}`;
    if(r.version===34)return `${new Date(r.at).toISOString()} · ${r.status}\n${en?'ST chat-completion preset':'酒馆聊天补全预设'} · ${r.selector}\n${en?'Resource/settings save':'资源／设置保存'}: ${r.resourceSave}\n${en?'Historical result, not current state or persistence/injection proof. No automatic retry or rollback.':'历史结果，不代表当前状态或持久化／注入证明；不自动重试或回滚。'}`;
    if(r.version===33)return `${new Date(r.at).toISOString()} · ${r.status}\n${en?'Shared ST character card':'共享酒馆角色卡'} · ${r.selector}\n${en?'Resource save':'资源保存'}: ${r.resourceSave}\n${en?'Historical result; persistence unconfirmed. Refresh ST UI manually; no automatic retry or rollback.':'历史结果，持久化未确认。手动刷新酒馆界面核对；不自动重试或回滚。'}`;
    if(r.version===32)return `${new Date(r.at).toISOString()} · ${r.status}\n${en?'Shared world-book entry':'共享世界书条目'} · ${r.selector}\n${en?'Resource save':'资源保存'}: ${r.resourceSave}\n${en?'Historical result; persistence is not confirmed. Do not automatically retry or roll back.':'历史结果，不证明持久化保存；不要自动重试或回滚。'}`;
    if(r.version===25)return `${new Date(r.at).toISOString()} · ${r.status}\n${r.operation==='clear'?(en?'Clear ledger entry':'清空账本条目'):(en?'Edit ledger entry':'编辑账本条目')} · ${r.selector}\n${en?'Chat save':'聊天保存'}: ${r.chatSave}\n${en?'Historical result, not current state or authorization. Unknown outcomes must not auto-retry.':'历史结果，不代表当前状态或授权；未知结果不自动重试。'}`;
    if(r.version===27)return `${new Date(r.at).toISOString()} · ${r.status}\n${en?'Blueprint structure operation':'蓝图结构操作'}: ${r.operation}\n${en?'Chat save':'聊天保存'}: ${r.chatSave}\n${en?'Approved completion reset included':'批准范围包含完成信号重置'}: ${r.completionReset}\n${en?'Historical result, not current state or authorization. Unknown outcomes must not auto-retry.':'历史结果，不代表当前状态或授权；未知结果不自动重试。'}`;
    if(r.version===24)return `${new Date(r.at).toISOString()} · ${r.status}\n${en?'Edit Blueprint node':'编辑蓝图节点'} · ${r.selector}\n${en?'Chat save':'聊天保存'}: ${r.chatSave}\n${en?'Historical result, not current state or authorization. Unknown outcomes must not auto-retry.':'历史结果，不代表当前状态或授权；未知结果不自动重试。'}`;
    if(r.version===23)return `${new Date(r.at).toISOString()} · ${r.status}\n${r.operation==='delete'?(en?'Delete NPC record':'删除NPC记录'):(en?'Edit NPC record':'编辑NPC记录')} · ${r.selector}\n${en?'Chat save':'聊天保存'}: ${r.chatSave}\n${en?'Historical result, not current state or authorization. Unknown outcomes must not auto-retry.':'历史结果，不代表当前状态或授权；未知结果不自动重试。'}`;
    if(r.version===22)return `${new Date(r.at).toISOString()} · ${r.status}\n${r.operation==='delete'?(en?'Archive character profile':'归档删除角色档案'):(en?'Edit character profile':'编辑角色档案')} · ${r.character}\n${en?'Chat save':'聊天保存'}: ${r.chatSave}\n${en?'Historical result, not current state or authorization. Unknown outcomes must not auto-retry.':'历史结果，不代表当前状态或授权；未知结果不自动重试。'}`;
    if(r.version===21)return `${new Date(r.at).toISOString()} · ${r.status}\n${r.operation} · ${r.character} · #${r.index}\n${en?'Chat save':'聊天保存'}: ${r.chatSave}\n${en?'Historical single memory operation, not current state or authorization. Unknown outcomes must not auto-retry.':'单条记忆操作的历史结果，不代表当前状态或授权；未知结果不自动重试。'}`;
    if(r.version===20)return `${new Date(r.at).toISOString()} · ${r.status}\n${r.label} · ${r.operation}\n${en?'Chat save':'聊天保存'}: ${r.chatSave}\n${en?'One current-chat variable operation. Historical result, not current state or authorization. Unknown outcomes must not auto-retry.':'单个当前聊天变量操作。历史结果，不代表当前状态或授权；未知结果不自动重试。'}`;
    if (r.version === 19) return `${new Date(r.at).toISOString()} · ${r.status}\n${en?'Blueprint package':'蓝图包'}: ${r.name} · ${r.operation}\n${en?'Chat/settings persistence':'聊天／设置保存'}: ${r.chatSave} / ${r.settingsSave}\n${en?'Historical result, not current state. Application replaces the Blueprint and resets an existing compatible completion value; no enabling or generation. Unknown outcomes never auto-retry.':'历史结果，不代表当前状态。应用替换蓝图并重置已有兼容完成标记；不启用或生成。未知结果不自动重试。'}`;
    if (r.version === 18) return `${new Date(r.at).toISOString()} · ${r.status}\nBlueprint ${en ? 'library' : '库'}: ${r.name} · ${r.operation}\n${en ? 'Persistence' : '持久化'}: ${r.persistence}\n${en ? 'Only the global library entry was targeted. No current chat Blueprint/progress/variable changes or generation. Historical result, not current state or authorization. Unknown outcomes must not be retried automatically.' : '仅针对全局库条目，不应用聊天蓝图、进度或完成变量，不生成。保存未确认不代表持久化成功；未知结果可能保留内存修改，不自动重试。历史结果，不代表当前状态或授权。'}`;
    if (r.version === 14) return `${new Date(r.at).toISOString()} · ${r.status}\n${en ? 'Character profile library' : '角色档案库'}: ${r.name} · ${r.operation}\n${en ? 'Persistence' : '持久化'}: ${r.persistence}\n${en ? 'Global entry save/delete only. No rendering or model call. No immediate chat/template application; deleting a fixed package clears/disables auto-load as previewed. Unconfirmed is not confirmed persistence. Historical result, not current state or authorization; do not retry unknown outcomes automatically.' : '仅保存／删除全局条目，未渲染或调用模型；不立即应用到聊天或全局模板；删除固定包会按预览清除选择并关闭自动加载。未确认不代表持久化成功。历史结果，不代表当前状态或授权；未知结果不要自动重试。'}`;
    if (r.version === 12) return `${new Date(r.at).toISOString()} · ${r.status}\n${en ? 'Custom Prompt' : '自定义 Prompt'}: ${r.name} · ${r.operation}\n${en ? 'Persistence' : '持久化'}: ${r.persistence}\n${en ? 'Global entry save/delete only. No rendering or model call. References not repaired; master switch unchanged. Unconfirmed is not confirmed persistence. Historical result, not current state or authorization; do not retry unknown outcomes automatically.' : '仅保存／删除全局条目，未渲染或调用模型；引用不自动修复，总开关未改变。未确认不代表持久化成功。历史结果，不代表当前状态或授权；未知结果不要自动重试。'}`;
    if (r.version === 13) return `${new Date(r.at).toISOString()} · ${r.status}\n${en ? 'Custom Prompt batch' : '自定义 Prompt 批次'} · ${r.origin}\n${r.items.map(row => row.operation + ': ' + row.name).join('\n')}\n${en ? 'Skipped' : '跳过'}: ${r.skipped.join(', ')}\n${en ? 'Persistence' : '持久化'}: ${r.persistence}\n${en ? 'One global definition save, no model run. Proposed items alone do not prove completion. Unconfirmed is not proof of persistence; unknown effects must not be retried automatically. Chat results were not edited by this operation. Historical result, not current state or permission.' : '同一全局定义保存，未主动运行模型。清单本身不证明完成；未确认不等于持久化成功，结果未知不要自动重试。本操作不修改聊天结果。这是历史结果，不代表当前状态或授权。'}`;
    if (r.version === 11) return `${new Date(r.at).toISOString()} · ${r.status}\n${en ? 'Custom Agent batch' : '自定义 Agent 批次'} · ${r.origin}\n${r.items.map(row => row.operation + ': ' + row.name + ' (' + row.providerName + ')').join('\n')}\n${en ? 'Skipped' : '跳过'}: ${r.skipped.join(', ')}\n${en ? 'Persistence' : '持久化'}: ${r.persistence}\n${en ? 'One global definition save, no model run. Proposed items alone do not prove completion. Unconfirmed is not proof of persistence; unknown effects must not be retried automatically. Chat results were not edited by this operation. Historical result, not current state or permission.' : '同一全局定义保存，未主动运行模型。清单本身不证明完成；未确认不等于持久化成功，结果未知不要自动重试。本操作不修改聊天结果。这是历史结果，不代表当前状态或授权。'}`;
    if (r.version === 10) return `${new Date(r.at).toISOString()} · ${r.status}\n${en ? 'Custom Agent' : '自定义 Agent'}: ${r.name}\n${r.operation} · ${r.providerName}\n${en ? 'Persistence' : '持久化'}: ${r.persistence}\n${en ? 'Definition save/delete only; no model call started. Automatic mode permits future calls and costs. Chat results retained; references not repaired. Historical result, not current state or permission. Do not automatically retry unknown outcomes.' : '仅保存／删除定义，未主动调用模型。自动运行允许后续调用及费用；聊天结果保留，引用不自动修复。历史结果，不代表当前状态或授权。未知结果不要自动重试。'}`;
    if (r.version === 8) return `${new Date(r.at).toISOString()} · ${r.status}\n${en ? 'Script Executor' : '脚本执行器'}: ${r.name}\n${r.operation} · ${r.scriptId}\n${en ? 'Persistence' : '持久化'}: ${r.persistence}\n${en ? 'Saved definition only; this action did not actively run code. Enabled definitions allow later matching events to execute. Historical result, not current state or authorization. Unknown outcomes must not be retried automatically.' : '仅保存／删除定义，此操作未主动运行代码；启用定义允许后续匹配事件自动执行。历史结果，不代表当前状态或授权。未知结果不要自动重试。'}`;
    if (r.version === 7) return `${new Date(r.at).toISOString()} · ${r.status}\n${en ? 'User Provider asset' : '用户 Provider 资产'}: ${r.name}\n${en ? 'Operation' : '操作'}: ${r.operation === 'update' ? en ? 'Replace source and owned registrations' : '替换源码及所属注册' : en ? 'Delete source and unload owned registrations' : '删除源码并卸载所属注册'}\n${r.ids.join(', ')}\n${en ? 'Persistence' : '持久化'}: ${r.persistence}\n${en ? 'Historical result only, not current state or authorization. Unconfirmed is not proof of persistence. Unknown outcomes must not be retried automatically. Replacement executes top-level/register code; deletion does not repair references.' : '历史结果，不代表当前状态或授权；未确认不等于已持久化，结果未知时不要自动重试。替换会执行顶层与注册代码；删除不修复模板引用。'}`;
    if (r.version === 6) return `${new Date(r.at).toISOString()} · ${r.status}\n${en ? 'User Provider asset' : '用户 Provider 资产'}: ${r.name}\n${r.ids.join(', ')}\n${en ? 'Registration reported successful' : '当时报告注册成功'}: ${r.registered}\n${en ? 'Persistence' : '持久化'}: ${r.persistence}\n${en ? 'Import executes top-level and registration code; this does not prove render was run or code had no side effects. Unknown outcomes must not be retried automatically. Historical result only.' : '导入会执行顶层与注册代码；不证明 render 已执行，也不证明无副作用。结果未知时不要自动重试。这是历史结果。'}`;
    if (r.version === 5) return `${new Date(r.at).toISOString()} · ${r.status}\n${en ? 'Profile' : '配置档'}: ${r.profileName}\n${en ? 'Saved ID' : '保存标识'}: ${r.profileId || (en ? 'none' : '无')}\n${en ? 'Persistence' : '持久化'}: ${r.persistence}\n${en ? 'Fields' : '字段'}: ${r.fields.map(field => configLabel(field, lang)).join(', ')}\n${en ? 'This operation only saved a reusable profile; it did not apply it or change active settings. Historical result only.' : '本次仅保存可复用配置档，未应用，也未修改当前生效设置；这是历史结果。'}`;
    if ([4, 9].includes(r.version)) return `${new Date(r.at).toISOString()} · ${r.status}\n` +
        r.steps.map((step, i) => `${i + 1}. ${step.kind === 'script' ? (en ? 'Script: ' : '脚本：') + step.script.name + ' · ' + step.script.operation : step.kind === 'variable' ? step.id : en ? 'Global settings' : '全局配置'} · ${step.status}\n` +
            step.diff.map(d => step.kind === 'settings' ? configDiffText(d, lang) : `${d.field}: ${d.before} → ${d.after}`).join('; ') +
            `\n${step.kind === 'script' ? (en ? 'definitionSave=' + step.script.persistence + '; no active execution; enabled definitions permit later events' : '定义持久化：' + step.script.persistence + '；未主动运行；启用定义允许后续事件自动执行') : step.kind === 'variable' ? 'chatSave=' + step.chatSave : 'settingsSave=' + step.settingsSave}`).join('\n') +
        (en ? '\nHistorical result, not current state or authorization.' : '\n历史结果，不代表当前状态或授权。');
    if (r.version === 3) return `${new Date(r.at).toISOString()} · ${r.status}\n${r.variableId}\n` +
        (en ? 'Current-chat variable proposal: ' : '当前聊天变量提议：') + r.diff.map(d => `${d.field}: ${d.before} → ${d.after}`).join('; ') +
        (en ? `\nChat save: ${r.chatSave}; save error: ${r.saveError}; post-save changed: ${r.changed}.` : `\n聊天保存：${r.chatSave}；保存异常：${r.saveError}；保存后变化：${r.changed}。`) +
        (en ? '\nHistorical result; not current state or authorization.' : '\n历史结果，不代表当前状态或授权。');
    if (!receiptProtocol(r.version).config) throw Error('MISSING_RECEIPT_FORMATTER');
    const statuses = {
        cancelled: ['已取消，未执行', 'Cancelled; not executed'], expired: ['已失效，未执行', 'Expired; not executed'], not_executed: ['未执行', 'Not executed'],
        applied_confirmed: ['当时已应用，保存已确认', 'Applied then; save confirmed'], applied_unconfirmed: ['当时已更新内存，持久化保存未确认', 'Memory updated then; persistence unconfirmed'], saved_confirmed: ['当时已保存', 'Saved then'], saved_unconfirmed: ['当时已加入列表，持久化未确认', 'Added then; persistence unconfirmed'], partial: ['部分完成，逐项核对', 'Partially completed; check each step'], outcome_unknown: ['执行结果不确定', 'Execution outcome unknown'],
    };
    return `${new Date(r.at).toISOString()} · ${statuses[r.status][en ? 1 : 0]}\n` +
        (en ? 'Proposed changes (not proof of approval or execution): ' : '提议的变更（不单独证明批准或执行成功）：') + r.diff.map(d => configDiffText(d, lang)).join('; ') +
        (r.saveError ? (en ? '\nSave call reported an error.' : '\n保存调用异常。') : '') +
        (r.changed ? (en ? '\nSettings changed again while saving.' : '\n保存期间配置又发生变化。') : '') +
        (r.memoryPrune ? (en ? `\nGlobal settings save: ${r.memoryPrune.settingsSave}; current-chat pruning: ${r.memoryPrune.status}; planned ${r.memoryPrune.planned}, reported removed ${r.memoryPrune.removed}.` : `\n全局设置保存：${r.memoryPrune.settingsSave}；当前聊天裁剪：${r.memoryPrune.status}；预计 ${r.memoryPrune.planned} 条，报告裁剪 ${r.memoryPrune.removed} 条。`) : '') +
        (r.blueprintToggle ? (en ? `\nCurrent-chat completion signal save: ${r.blueprintToggle.chatSave}; global blueprint switch save: ${r.blueprintToggle.settingsSave}. Blueprint content and progress were not edited.` : `\n当前聊天完成变量保存：${r.blueprintToggle.chatSave}；全局蓝图开关保存：${r.blueprintToggle.settingsSave}。未修改蓝图正文及进度。`) : '') +
        (r.completionVariable ? (en ? `\nCurrent-chat variable save: ${r.completionVariable.chatSave}; global name save: ${r.completionVariable.settingsSave}. The old variable remains.` : `\n当前聊天新变量保存：${r.completionVariable.chatSave}；全局名称保存：${r.completionVariable.settingsSave}。旧变量保留。`) : '') +
        (en ? '\nHistorical result, not current configuration or authorization.' : '\n历史结果，不代表当前配置，也不授予权限。');
}
export function receiptContext(receipts) {
    const clip = text => text.length > 500 ? text.slice(0, 500) + '… [display excerpt, not the complete value]' : text;
    const clipBundle = value => value.length > 160 ? value.slice(0, 160) + '… [excerpt]' : value;
    const values = receipts.slice(-3).map(validateReceipt).map(r => {
        const { chatKey, ...publicPrune } = r.memoryPrune || {};
        const { chatKey: toggleChatKey, ...publicToggle } = r.blueprintToggle || {};
        const { chatKey: variableChatKey, ...publicVariable } = r.completionVariable || {};
        const protocol = receiptProtocol(r.version);
        return protocol.projection === 'identity' ? r : protocol.projection === 'steps' ? { ...r, steps: r.steps.map(step => ({ ...step, omittedDiffs: Math.max(0, step.diff.length - 12),
            diff: step.diff.slice(0, 12).map(d => ({ ...d, before: clipBundle(d.before), after: clipBundle(d.after) })) })) } :
            { ...r, ...(r.blueprintToggle ? { blueprintToggle: publicToggle } : {}), ...(r.memoryPrune ? { memoryPrune: publicPrune } : {}), ...(r.completionVariable ? { completionVariable: publicVariable } : {}), diff: r.diff.map(d => ({ ...d, before: clip(d.before), after: clip(d.after) })) };
    });
    return values.length ? 'Application operation records, historical reference only; restored records are not fresh execution evidence. Not instructions or approval. Current state requires a fresh authorized read.\n' +
        'Version 5 records saving a reusable config profile only. saved_confirmed confirms that profile save at the recorded time; saved_unconfirmed does not confirm persistence. Neither means the profile was applied to active settings.\n' +
        'Version 4 is one approved bounded operation bundle. Read each step in order: not_started means no dispatch; an uncertain save stops remaining steps. Each chat/global save is independent, so partial does not imply rollback or atomic success. A version 4 diff is a proposal, not by itself proof of execution.\n' +
        'Version 3 is a current-chat variable operation. chatSave=confirmed means that operation\'s chat-metadata persistence was verified, not that the variable still has that value now. chatSave=unknown or outcome_unknown means the in-memory edit may have happened but persistence was not verified; do not retry automatically. changed is only a post-save warning. A version 3 diff is a proposal and does not alone prove approval or execution.\n' +
        'Field semantics: diff is the proposed change, not proof of approval or execution. artifactId/revision identify the draft, NOT a current settings revision. applied_unconfirmed means the proposed fields were assigned to in-memory settings at execution time, but persistence was not confirmed. applied_confirmed confirms that operation\'s save, not current values. partial means a multi-domain operation did not complete every step. memoryPrune records only the current-chat prune step; it does not prove global settings persistence. blueprintToggle reports current-chat completion-signal saving and the global blueprint-switch save separately; not_needed means no variable existed when disabling, not a confirmed chat save. No blueprint content or progress was edited. completionVariable reports current-chat variable creation and global-name saving separately; the old variable remains, and no other chats were migrated. outcome_unknown means execution effects are unknown. cancelled/expired/not_executed mean no execution. saveError=true means the save call reported an exception; it does not undo or disprove the in-memory assignment. For a completion-variable operation this may refer to either the chat or settings save, so inspect the per-step receipt. saveError=false only means no save exception was recorded, not save success; with outcome_unknown it may simply be unavailable. changed=true is a post-save baseline/replacement warning: settings changed again during the save wait, the settings object was replaced, or verification was unavailable. It is NOT whether this operation made a change. changed=false is only absence of that warning, NOT no mutation, no success, or proof of current values; with outcome_unknown the flag may be unavailable. No current configuration values or persistence probe results are provided.\n' +
        JSON.stringify(values.map(value => ({ ...value, historicalExplanation: receiptText(value, 'en') }))) : '';
}
