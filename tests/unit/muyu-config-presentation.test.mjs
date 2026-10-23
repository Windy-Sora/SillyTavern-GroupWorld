import test from 'node:test';
import assert from 'node:assert/strict';
import { configFields, configDomains, fieldDefinition } from '../../muyu/config/registry.js';
import { configPresentation, configLabel, configValue, configDiffText } from '../../muyu/config/presentation.js';
import { uiLabel } from '../../ui/i18n.js';
import { createSettingsModule } from '../../muyu/modules/settings/index.js';
import { DEFAULT_SETTINGS } from '../../settings.js';
import { renderConfigDiff } from '../../muyu/ui/config-diff-view.js';
import { receiptText } from '../../muyu/actions/receipts.js';
import { diagnosticPresentation, readPresentationSchema, memoryConfigPresentation, settingDisplayValues, settingAnswerView } from '../../muyu/config/read-presentation.js';
import { validateJson } from '../../muyu/core/json-contract.js';
import { settingReadEvidence } from '../../muyu/config/read-evidence.js';

test('Every editable setting has bilingual UI labels, sections and contract metadata', () => {
    for (const id of configFields) {
        const p = configPresentation(id);
        for (const lang of ['zh', 'en']) {
            assert.ok(p.label[lang], id); assert.ok(p.section[lang], id);
            assert.doesNotMatch(p.label[lang], /<[^>]*>/);
        }
        assert.deepEqual(fieldDefinition(id).presentation, p);
    }
    assert.equal(configLabel('critiqueEnabled'), uiLabel('critiqueEnabled'));
    assert.equal(configPresentation('__proto__'), null);
    assert.equal(configLabel('notRegistered'), '未登记的配置项');
});

test('Config contracts bound inference without changing values or write schemas', () => {
    const target = { kind: 'global', userKey: 'test' };
    const module = createSettingsModule({ getTarget: () => target, getSettings: () => DEFAULT_SETTINGS });
    const result = JSON.parse(module.handlers['muyu.settings.contract']({ fields: ['llmMaxSpeakers', 'autoMemoryEnabled'] }, { target, signal: new AbortController().signal }).text);
    assert.match(result[0].description, /上限.*不是实际选择结果/);
    assert.match(result[1].description, /自动提取关闭只停用自动提取路径/);
    assert.deepEqual(result[0].schema, { type: 'integer', minimum: 1, maximum: 20 });
    assert.deepEqual(result[1].schema, { type: 'boolean' });
    module.dispose();
});

test('Readable values retain empty, missing, null and text distinctions without default claims', () => {
    assert.equal(configValue('memoryEnabled', false), '关闭');
    assert.equal(configValue('memoryEnabled', 'true', 'en', { serialized: true }), 'On');
    assert.equal(configValue('llmPrompt', 'false'), 'false');
    assert.equal(configValue('llmPrompt', '"false"', 'zh', { serialized: true }), 'false');
    assert.equal(configValue('llmPrompt', ''), '空文本');
    assert.equal(configValue('llmPrompt', null), '空值（null）');
    assert.equal(configValue('llmPrompt', '(missing)', 'zh', { serialized: true }), '缺失／未读取');
    assert.equal(configValue('providerTimeoutMs', 10000), '10 秒');
    assert.equal(configValue('providerTimeoutMs', 0), '不限制超时');
    assert.equal(configValue('memoryMaxEntries', 10), '10 条');
    assert.equal(configValue('worldBookSourceMode', 'manual'), uiLabel('worldBookSourceManual'));
    assert.match(configValue('llmPrompt', 'a'.repeat(181)), /预览截断/);
    const diff = { field: 'memoryEnabled', before: 'false', after: 'true' }, before = structuredClone(diff);
    assert.equal(configDiffText(diff), `${uiLabel('memoryEnabled')}：关闭 → 开启`);
    assert.deepEqual(diff, before);
});

test('Catalog is host-independent and all-field reads/contracts stay inside tool output bounds', () => {
    let reads = 0; const target = { kind: 'global', userKey: 'test' };
    const module = createSettingsModule({ getTarget: () => target, getSettings: () => { reads++; return DEFAULT_SETTINGS; } });
    const ctx = { target, signal: new AbortController().signal };
    const catalog = module.handlers['muyu.settings.catalog']({}, ctx);
    assert.equal(reads, 0); assert.equal(JSON.parse(catalog.text).labels.memoryEnabled.zh, uiLabel('memoryEnabled'));
    assert.equal(JSON.parse(catalog.text).fieldCount, configFields.length);
    assert.equal(JSON.parse(catalog.text).domainCount, configDomains.length);
    const read = module.handlers['muyu.settings.read']({ fields: [...configFields] }, ctx);
    assert.equal(JSON.parse(read.text).values.memoryEnabled, DEFAULT_SETTINGS.memoryEnabled);
    assert.equal(JSON.parse(read.text).displayValues.memoryEnabled.zh, configValue('memoryEnabled', DEFAULT_SETTINGS.memoryEnabled));
    for (const result of [catalog, read, ...configDomains.map(domain => module.handlers['muyu.settings.contract']({ domain }, ctx))]) {
        assert.ok(result.text.length <= 24000);
        assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 32768);
    }
    module.dispose();
});

test('Diagnostic names reuse GUI labels while runtime facts cannot masquerade as settings', () => {
    const state = { mode: 'llm', respectOrder: 'off', interval: 15, speakersOnly: 'on', lastChatLength: -1, roundActive: 'off', baselineSource: 'legacy', members: [{ slot: 0, intervalStatus: 'pending' }] };
    const before = structuredClone(state), rows = diagnosticPresentation(state);
    validateJson(readPresentationSchema, rows);
    const row = field => rows.find(r => r.field === field);
    assert.equal(row('mode').value.zh, configValue('mode', 'llm'));
    assert.equal(row('respectOrder').label.zh, configLabel('llmRespectOrder'));
    assert.equal(row('respectOrder').value.zh, '关闭');
    assert.equal(row('interval').value.zh, configValue('autoMemoryInterval', 15));
    assert.equal(row('roundActive').kind, 'runtime'); assert.equal(row('roundActive').section.zh, '');
    assert.equal(row('lastChatLength').value.zh, '未知');
    assert.equal(row('baselineSource').value.en, 'Legacy record');
    assert.ok(row('members.intervalStatus'));
    assert.deepEqual(state, before);
    assert.deepEqual(diagnosticPresentation(JSON.parse('{"__proto__":"x","constructor":"x"}')), []);
    assert.equal(diagnosticPresentation({ mode: 'off' })[0].value.zh, configValue('mode', 'off'));
});

test('Display annotations preserve raw config states and avoid repeating Prompt bodies', () => {
    const fields = [{ field: 'memoryEnabled', state: 'value', value: 'false' }, { field: 'autoMemoryEnabled', state: 'missing', value: '' }, { field: 'autoMemoryInterval', state: 'unsupported', value: '' }];
    const before = structuredClone(fields), rows = memoryConfigPresentation({ fields });
    validateJson(readPresentationSchema, rows);
    assert.equal(rows[0].value.zh, '关闭'); assert.equal(rows[1].value.zh, '缺失／未读取');
    assert.match(rows[2].value.zh, /不受支持/); assert.deepEqual(fields, before);
    const values = { mode: 'llm', memoryEnabled: false, llmPrompt: 'LONG_PRIVATE_BODY'.repeat(1000), providerTimeoutMs: 10000 };
    const display = settingDisplayValues(values);
    assert.equal(display.providerTimeoutMs.zh, '10 秒'); assert.equal(display.mode.en, configValue('mode', 'llm', 'en'));
    assert.equal(Object.hasOwn(display, 'llmPrompt'), false);
});

test('Small setting answer views reuse GUI names without copying free text or replacing raw values', () => {
    const values = { autoMemoryEnabled: false, autoMemoryInterval: 15, llmPrompt: 'PRIVATE_PROMPT', mode: 'llm' };
    const before = structuredClone(values), view = settingAnswerView(values);
    assert.equal(view[0].zh, `${configLabel('autoMemoryEnabled')}：关闭`);
    assert.equal(view[1].en, `${configLabel('autoMemoryInterval', 'en')}: ${configValue('autoMemoryInterval', 15, 'en')}`);
    assert.doesNotMatch(JSON.stringify(view), /PRIVATE_PROMPT|autoMemoryEnabled|autoMemoryInterval/);
    assert.deepEqual(values, before);
    assert.equal(settingAnswerView(Object.fromEntries(configFields.slice(0, 9).map(id => [id, true]))), null);
    assert.deepEqual(settingAnswerView({ llmPrompt: '', memoryEnabled: null }), []);
});

test('Settings responses distinguish directory coverage, observed values and preview baselines', () => {
    const target = { kind: 'global', userKey: 'test' }, settings = { autoMemoryInterval: 10 };
    const module = createSettingsModule({ getTarget: () => target, getSettings: () => settings });
    const ctx = { target, runId: 'r', signal: new AbortController().signal };
    module.bindRun({ id: 'r', taskId: 't', target });
    assert.match(JSON.parse(module.handlers['muyu.settings.catalog']({}, ctx).text).interpretation, /not a GUI inventory/);
    const read = JSON.parse(module.handlers['muyu.settings.read']({ fields: ['autoMemoryInterval'] }, ctx).text);
    assert.equal(read.values.autoMemoryInterval, 10);
    assert.match(read.observation, /at this read only/);
    const result = module.handlers['muyu.settings.preview']({ changes: { autoMemoryInterval: 15 } }, ctx);
    const preview = JSON.parse(result.text);
    assert.match(preview.interpretation, /before.*not proof of the current value/);
    assert.equal(settings.autoMemoryInterval, 10);
    // Interpretation is response-only: artifact equality/freshness must keep the original contract.
    const app = { snapshot: () => ({ runs: [{ id: 'r', taskId: 't', target, status: 'succeeded' }] }), createArtifact: value => ({ ...value, id: 'artifact:settings', revision: 1 }) };
    const artifact = module.publishDraft(app, 'r', result.candidateId);
    assert.equal(Object.hasOwn(artifact.content.preview, 'interpretation'), false);
    assert.deepEqual(preview.diff, artifact.content.preview.diff);
    settings.autoMemoryInterval = 99;
    assert.match(preview.interpretation, /not executed/);
    assert.equal(preview.diff[0].before, '10');
    module.dispose();
});

test('Settings tools distinguish discovery from a request to read every field', () => {
    const target = { kind: 'global', userKey: 'test' };
    const module = createSettingsModule({ getTarget: () => target, getSettings: () => DEFAULT_SETTINGS });
    const definitions = module.registry.list();
    assert.match(definitions.find(t => t.id === 'muyu.settings.catalog').description, /不要求随后全量读取/);
    assert.match(definitions.find(t => t.id === 'muyu.settings.read').description, /局部问题只选目标及必要依赖/);
    assert.deepEqual(definitions.find(t => t.id === 'muyu.settings.read').inputSchema.properties.fields.items.enum, configFields);
    assert.equal(definitions.find(t => t.id === 'muyu.settings.read').effect, 'read');
    module.dispose();
});

test('A speaker-limit read flags missing mode evidence without silently reading an additional field', () => {
    const target = { kind: 'global', userKey: 'test' }, settings = { mode: 'llm', topN: 1, llmMaxSpeakers: 3 };
    const module = createSettingsModule({ getTarget: () => target, getSettings: () => settings });
    const ctx = { target, signal: new AbortController().signal };
    const read = fields => JSON.parse(module.handlers['muyu.settings.read']({ fields }, ctx).text);
    const single = read(['llmMaxSpeakers']);
    assert.match(single.applicability, /not established.*Read mode if allowed/);
    assert.deepEqual(single.fields, ['llmMaxSpeakers']);
    assert.deepEqual(single.values, { llmMaxSpeakers: 3 });
    assert.equal(Object.hasOwn(read(['mode', 'llmMaxSpeakers']), 'applicability'), false);
    assert.equal(Object.hasOwn(read(['autoMemoryEnabled']), 'applicability'), false);
    delete settings.mode;
    assert.match(read(['mode', 'topN']).applicability, /not established/);
    module.dispose();
});

test('Settings evidence counts returned values, preserves null/false/empty and covers only this read', () => {
    const fields = ['memoryEnabled', 'autoMemoryEnabled', 'autoMemoryInterval', 'memoryPrompt'];
    const values = { autoMemoryEnabled: false, autoMemoryInterval: null, memoryPrompt: '' }, before = structuredClone(values);
    const evidence = settingReadEvidence(fields, values);
    assert.equal(evidence.requestedCount, 4); assert.equal(evidence.returnedCount, 3);
    assert.deepEqual(evidence.missingFields, ['memoryEnabled']);
    assert.equal(evidence.coverage, 'this-read-only');
    assert.equal(evidence.runtime, 'not-observed'); assert.equal(evidence.persistence, 'unknown');
    assert.deepEqual(values, before); assert.equal(fields.length, 4);
    assert.match(evidence.interpretation, /not execution.*conditional mechanisms/);
    assert.equal(settingReadEvidence(['memoryEnabled'], {}).returnedCount, 0);
});

test('Settings output exposes mechanical read evidence without defaulting missing configuration', () => {
    const target = { kind: 'global', userKey: 'test' }, settings = { autoMemoryEnabled: false };
    const module = createSettingsModule({ getTarget: () => target, getSettings: () => settings });
    const result = module.handlers['muyu.settings.read']({ fields: ['memoryEnabled', 'autoMemoryEnabled'] }, { target, signal: new AbortController().signal });
    const data = JSON.parse(result.text);
    assert.deepEqual(data.values, { autoMemoryEnabled: false });
    assert.equal(data.evidence.requestedCount, 2); assert.equal(data.evidence.returnedCount, 1);
    assert.deepEqual(data.evidence.missingFields, ['memoryEnabled']);
    assert.deepEqual(settings, { autoMemoryEnabled: false });
    assert.equal(Object.hasOwn(data.evidence, 'success'), false);
    module.dispose();
});

test('Field contracts distinguish scheduling thresholds, history controls and world-book paths', () => {
    assert.match(fieldDefinition('autoMemoryInterval').description, /调度阈值.*才可能执行.*不证明发生或成功/);
    assert.match(fieldDefinition('llmHistoryEnabled').description, /不证明已产生决策.*持久化成功/);
    assert.match(fieldDefinition('llmWorldInfoEnabled').description, /不控制 worldBooks\/worldBookImportance/);
    assert.match(fieldDefinition('llmWorldInfoEnabled').description, /不证明实际有激活条目/);
    assert.match(fieldDefinition('memoryJsonSchema').description, /空串维持原有宽松解析/);
    assert.deepEqual(fieldDefinition('autoMemoryInterval').schema, { type: 'integer', minimum: 1, maximum: 200 });
    assert.match(fieldDefinition('autoMemoryInterval').readCaution, /不能改述为.*就触发/);
});

test('Read cautions come from the field owner, preserve single-field scope and omit unrelated cautions', () => {
    const target = { kind: 'global', userKey: 'test' }, module = createSettingsModule({ getTarget: () => target, getSettings: () => DEFAULT_SETTINGS });
    const read = fields => JSON.parse(module.handlers['muyu.settings.read']({ fields }, { target, signal: new AbortController().signal }).text);
    const value = read(['autoMemoryInterval']);
    assert.deepEqual(value.readCautions, [{ field: 'autoMemoryInterval', interpretation: fieldDefinition('autoMemoryInterval').readCaution }]);
    assert.deepEqual(value.fields, ['autoMemoryInterval']);
    assert.deepEqual(Object.keys(value.values), ['autoMemoryInterval']);
    assert.equal(Object.hasOwn(read(['llmMaxSpeakers']), 'readCautions'), false);
    module.dispose();
});

test('GUI shows translated summaries and keeps exact unmodified fields in collapsed details', () => {
    const doc = { createElement: tag => ({ tag, children: [], append(el) { this.children.push(el); }, setAttribute() {} }) };
    const parent = doc.createElement('section');
    const diff = [{ field: 'memoryEnabled', before: 'false', after: 'true' }, { field: 'llmPrompt', before: '""', after: JSON.stringify('<script>' + 'a'.repeat(250)) }];
    const snapshot = structuredClone(diff);
    renderConfigDiff({ doc, parent, diff });
    assert.match(parent.children[0].textContent, /关闭 → 开启/);
    assert.doesNotMatch(parent.children[0].textContent, /memoryEnabled/);
    assert.match(parent.children[1].textContent, /预览截断/);
    const details = parent.children.at(-1); assert.equal(details.tag, 'details'); assert.ok(!details.open);
    assert.deepEqual(JSON.parse(details.children[1].textContent), diff);
    assert.deepEqual(diff, snapshot);
});

test('Historical config receipts translate labels without changing facts or raw records', () => {
    const r = { version: 2, at: 1, status: 'applied_unconfirmed', diff: [{ field: 'memoryEnabled', before: 'false', after: 'true' }], saveError: false, changed: false };
    const snapshot = structuredClone(r);
    for (const lang of ['zh', 'en']) {
        const text = receiptText(r, lang);
        assert.ok(text.includes(configLabel('memoryEnabled', lang)));
        assert.doesNotMatch(text, /memoryEnabled/);
        assert.match(text, lang === 'en' ? /persistence unconfirmed/ : /持久化保存未确认/);
    }
    assert.deepEqual(r, snapshot);
    const bundle = { version: 4, at: 1, status: 'partial', steps: [{ kind: 'variable', id: 'gold', status: 'applied_unconfirmed', chatSave: 'unconfirmed', diff: [{ field: 'defaultValue', before: '0', after: '10' }] }, { kind: 'settings', status: 'applied_unconfirmed', settingsSave: 'unconfirmed', diff: r.diff }] };
    const text = receiptText(bundle);
    assert.match(text, /defaultValue: 0 → 10/); assert.doesNotMatch(text, /memoryEnabled/);
    assert.ok(receiptText({ version: 5, at: 1, status: 'saved_unconfirmed', profileName: 'test', profileId: 'p', persistence: 'unconfirmed', fields: ['memoryEnabled'] }).includes(configLabel('memoryEnabled')));
});
