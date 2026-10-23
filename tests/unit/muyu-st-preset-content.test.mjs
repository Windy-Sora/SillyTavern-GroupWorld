import test from 'node:test';
import assert from 'node:assert/strict';
import { readStPresetContent } from '../../muyu/host/st-preset-content.js';
import { createProviderPort } from '../../muyu/host/providers.js';
import { createProviderModule } from '../../muyu/modules/providers/index.js';
import { createPermissions } from '../../muyu/application/permissions.js';
import { assistantToolAccess } from '../../muyu/application/capabilities.js';
import { validateJson } from '../../muyu/core/json-contract.js';

function fixture() {
    let fetched = 0, writes = 0;
    const names = ['Default', 'Story'];
    const base = { temperature: 0.7, openai_max_tokens: 2048, prompts: [
        { identifier: 'main', name: '主提示词', role: 'system', content: 'SAVED_BODY {{char}}', system_prompt: true, marker: false, apiKey: 'PRIVATE_PROMPT_KEY' },
        { identifier: 'chatHistory', name: '聊天历史', marker: true },
    ], prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] }],
        apiKey: 'PRIVATE_KEY', custom_include_headers: 'Authorization: PRIVATE_HEADER', reverse_proxy: 'https://private.example', proxy_password: 'PRIVATE_PASSWORD',
        extensions: { private: 'PRIVATE_EXTENSION' } };
    const saved = { Default: structuredClone(base), Story: structuredClone(base) };
    const ctx = { mainApi: 'openai', chatCompletionSettings: { ...structuredClone(base), temp_openai: 0.9, temperature: 999 },
        getPresetManager: id => id === 'openai' ? manager : null };
    let selected = 'Story';
    const manager = { getAllPresets: () => names, getSelectedPresetName: () => selected,
        getCompletionPresetByName: name => { fetched++; return saved[name]; },
        getPresetSettings() { throw Error('must not use current settings export for saved resources'); },
        selectPreset() { writes++; }, savePreset() { writes++; }, updatePreset() { writes++; } };
    const target = { kind: 'global', userKey: 'u' };
    const port = createProviderPort({ getContext: () => ctx, getSettings: () => ({}), extensionKey: 'gd' });
    const module = createProviderModule({ providerPort: port, globalTarget: target, currentTarget: () => null });
    const read = (selector = '', revision = '', offset = 0, runId = 'r') => module.handlers['muyu.provider.read']({ id: 'stPresetContent', selector, revision, offset }, { runId, target });
    const raw = selector => readStPresetContent(selector, () => ctx);
    return { ctx, saved, names, manager, port, module, read, raw, target, fetched: () => fetched, writes: () => writes, select: value => { selected = value; } };
}

test('New preset source has its own permission; names and broad chat grants cannot authorize content', () => {
    const f = fixture(), permissions = createPermissions(), chat = { ...f.target, kind: 'chat', chatKey: 'a' };
    permissions.grant('chat', chat);
    permissions.decide({ source: 'stPresets', reason: 'names', taskId: 't', target: chat }, 'chat', () => {});
    const access = () => assistantToolAccess({ id: 'muyu.provider.read', effect: 'read' }, { id: 'stPresetContent' }, chat, 't', permissions, f.port);
    assert.deepEqual(access().missingSources, ['source:stPresetContent']);
    permissions.decide({ source: 'stPresetContent', reason: 'inspect', taskId: 't', target: chat }, 'task', () => {});
    assert.equal(access().decision, true);
    permissions.forgetTask(chat, 't');
    assert.deepEqual(access().missingSources, ['source:stPresetContent']); f.module.dispose();
});
test('Preset content catalog is static and root does not read saved or live prompt bodies', () => {
    const f = fixture(), catalog = f.module.handlers['muyu.provider.list']();
    validateJson(f.module.registry.get('muyu.provider.list').outputSchema, catalog);
    assert.equal(f.fetched(), 0);
    const root = f.read(); assert.equal(root.status, 'ok'); assert.equal(root.readHint.kind, 'directory');
    assert.match(root.text, /Story/); assert.doesNotMatch(root.text, /SAVED_BODY|PRIVATE_/); assert.equal(f.fetched(), 0); f.module.dispose();
});
test('Saved nonselected preset reads saved object, not current settings or getPresetSettings', () => {
    const f = fixture(); f.saved.Default.temperature = 0.2;
    const root = f.read(), page = f.read('saved:0', root.revision);
    assert.equal(page.status, 'ok');
    const data = JSON.parse(page.text); assert.equal(data.kind, 'saved-resource');
    assert.equal(data.parameters.find(p => p.field === 'temperature').value, 0.2);
    assert.equal(data.name, 'Default'); assert.equal(f.writes(), 0); assert.equal(f.manager.getSelectedPresetName(), 'Story');
    assert.equal(page.readHint.kind, 'directory');
    assert.doesNotMatch(page.text, /SAVED_BODY|PRIVATE_/); f.module.dispose();
});
test('Current settings use live field aliases and project only allowed parameters with GUI labels', () => {
    const f = fixture(), data = JSON.parse(f.raw('current').text);
    assert.equal(data.parameters.find(p => p.field === 'temperature').value, 0.9);
    assert.equal(data.parameters.find(p => p.field === 'temperature').label, '温度');
    assert.doesNotMatch(JSON.stringify(data), /PRIVATE_|reverse_proxy|custom_include_headers|apiKey/);
    assert.equal(data.prompts[0].contentChars, 'SAVED_BODY {{char}}'.length);
    assert.equal(data.order[0].order[0].enabled, true); f.module.dispose();
});
test('Prompt detail requires the matching overview revision and remains raw unrendered content', () => {
    const f = fixture(), root = f.read();
    assert.equal(f.read('saved:0:prompt:0', root.revision).status, 'STALE_SOURCE');
    const overview = f.read('saved:0', root.revision), detail = f.read('saved:0:prompt:0', overview.revision);
    assert.equal(detail.status, 'ok'); assert.match(detail.text, /SAVED_BODY {{char}}/); assert.doesNotMatch(detail.text, /PRIVATE_/);
    assert.equal(f.read('saved:0:prompt:5', overview.revision).status, 'INVALID_SELECTOR'); f.module.dispose();
});
test('Comparison reports parameter, prompt body and order differences without repeating bodies', () => {
    const f = fixture(); f.ctx.chatCompletionSettings.prompts[0].content = 'CURRENT_BODY';
    f.ctx.chatCompletionSettings.prompt_order[0].order[0].enabled = false;
    const data = JSON.parse(f.raw('compare:1').text);
    assert.equal(data.equalWithinProjection, false); assert.equal(data.parameters[0].saved, 0.7); assert.equal(data.parameters[0].current, 0.9);
    assert.deepEqual(data.prompts[0].changedFields, ['content']); assert.equal(data.orderChanged, true);
    assert.doesNotMatch(JSON.stringify(data), /SAVED_BODY|CURRENT_BODY|PRIVATE_/); assert.equal(f.writes(), 0); f.module.dispose();
});
test('Missing fields and missing prompt arrays are not invented as defaults or equal data', () => {
    const f = fixture(); delete f.saved.Story.temperature; delete f.saved.Story.prompts;
    const data = JSON.parse(f.raw('compare:1').text);
    assert.equal(data.parameters.find(p => p.field === 'temperature').savedPresent, false);
    assert.equal(data.promptsPresenceChanged, true); assert.equal(data.equalWithinProjection, false);
    f.saved.Story.prompts = []; delete f.saved.Story.prompt_order;
    assert.equal(JSON.parse(f.raw('saved:1').text).orderPresent, false); f.module.dispose();
});
test('Equal comparison only confirms the projection, never persistence or final injection', () => {
    const f = fixture(); f.ctx.chatCompletionSettings.temp_openai = 0.7;
    const data = JSON.parse(f.raw('compare:1').text);
    assert.equal(data.equalWithinProjection, true); assert.match(data.notice, /不证明磁盘当前值/); assert.match(data.notice, /最终注入/); f.module.dispose();
});
test('Directory rename/reorder/selection changes invalidate selectors; saved/body edits invalidate paging', () => {
    for (const mutate of [f => f.names.reverse(), f => f.select('Default')]) {
        const f = fixture(), root = f.read(); mutate(f); assert.equal(f.read('saved:1', root.revision).status, 'STALE_SOURCE'); f.module.dispose();
    }
    const f = fixture(); f.saved.Story.prompts[0].content = 'x'.repeat(7000);
    const root = f.read(), overview = f.read('saved:1', root.revision), first = f.read('saved:1:prompt:0', overview.revision);
    assert.ok(first.nextOffset > 0);
    f.saved.Story.prompts[0].content += 'changed';
    assert.equal(f.read('saved:1:prompt:0', first.revision, first.nextOffset).status, 'STALE_SOURCE');
    f.ctx.chatCompletionSettings.temp_openai = 0.1;
    const cmp = f.read('compare:1', root.revision); assert.equal(cmp.status, 'ok');
    f.ctx.chatCompletionSettings.temp_openai = 0.2;
    assert.equal(f.read('compare:1', cmp.revision).status, 'STALE_SOURCE'); f.module.dispose();
});
test('Long prompt paging preserves Unicode, charges shared budget and does not reexecute any rendering', () => {
    const f = fixture(); f.saved.Default.prompts[0].content = '猫🦉'.repeat(2100);
    const root = f.read(), overview = f.read('saved:0', root.revision);
    let page = f.read('saved:0:prompt:0', overview.revision), all = page.text;
    while (page.nextOffset >= 0) {
        page = f.module.handlers['muyu.provider.read']({ id: 'stPresetContent', continuationToken: page.readHint.continuation.token }, { runId: 'r', target: f.target });
        assert.equal(page.status, 'ok'); all += page.text;
    }
    assert.equal(JSON.parse(all).prompt.content, f.saved.Default.prompts[0].content); assert.equal(f.writes(), 0);
    assert.ok(f.module.usage('r').used > 0);
    f.module.bindRun('small', 6000); const smallRoot = f.read('', '', 0, 'small'), smallOverview = f.read('saved:0', smallRoot.revision, 0, 'small');
    let small = f.read('saved:0:prompt:0', smallOverview.revision, 0, 'small');
    while (small.status === 'ok' && small.nextOffset >= 0) small = f.read('saved:0:prompt:0', small.revision, small.nextOffset, 'small');
    assert.equal(small.status, 'BUDGET_EXCEEDED'); f.module.dispose();
});

test('Large preset overview continues beyond 91 entries and explicitly separates metadata from bodies', () => {
    const f = fixture();
    f.saved.Default.prompts = Array.from({ length: 120 }, (_, index) => ({ identifier: 'synthetic-' + index,
        name: 'Synthetic instruction ' + index, role: 'system', injection_depth: 2, content: 'BODY_' + index }));
    const root = f.read(); let page = f.read('saved:0', root.revision), text = page.text, pages = 1;
    assert.equal(page.readHint.pageState, 'more');
    assert.match(page.readHint.readingAdvice, /page boundary is not budget exhaustion/);
    assert.match(page.readHint.readingAdvice, /NOT Prompt bodies/);
    while (page.nextOffset >= 0) {
        validateJson(f.module.registry.get('muyu.provider.read').outputSchema, page);
        page = f.module.handlers['muyu.provider.read']({ id: 'stPresetContent', continuationToken: page.readHint.continuation.token }, { runId: 'r', target: f.target });
        assert.equal(page.status, 'ok'); text += page.text; pages++;
    }
    validateJson(f.module.registry.get('muyu.provider.read').outputSchema, page);
    assert.equal(page.readHint.pageState, 'last'); assert.ok(pages > 1);
    const data = JSON.parse(text); assert.equal(data.prompts.length, 120);
    assert.equal(data.prompts[119].index, 119); assert.doesNotMatch(text, /BODY_/);
    const body = f.read('saved:0:prompt:119', page.revision);
    assert.equal(body.status, 'ok'); assert.equal(body.readHint.kind, 'content');
    assert.equal(JSON.parse(body.text).prompt.content, 'BODY_119');
    assert.equal(f.writes(), 0); f.module.dispose();
});

test('Budget rejection is explicit and never presented as another readable page', () => {
    const f = fixture(); f.saved.Default.prompts[0].content = '猫'.repeat(8000);
    f.module.bindRun('small', 6000);
    const root = f.read('', '', 0, 'small'), overview = f.read('saved:0', root.revision, 0, 'small');
    let page = f.read('saved:0:prompt:0', overview.revision, 0, 'small');
    while (page.status === 'ok' && page.nextOffset >= 0) page = f.module.handlers['muyu.provider.read']({ id: 'stPresetContent', continuationToken: page.readHint.continuation.token }, { runId: 'small', target: f.target });
    assert.equal(page.status, 'BUDGET_EXCEEDED'); assert.equal(page.readHint.recovery, 'stop');
    assert.equal(page.readHint.pageState, undefined); assert.equal(page.readHint.continuation, undefined);
    assert.equal(page.readHint.error.field, 'budget'); f.module.dispose();
});
test('Unsupported host does not fall back to selecting/exporting a preset; unavailable is not empty', () => {
    const f = fixture(), root = f.read(); delete f.manager.getCompletionPresetByName;
    assert.equal(f.read('saved:1', root.revision).status, 'SOURCE_UNAVAILABLE'); assert.equal(f.writes(), 0);
    f.ctx.chatCompletionSettings = null; assert.throws(() => f.raw('current'), /SOURCE_UNAVAILABLE/);
    f.module.dispose();
});
test('Inactive chat-completion settings are labeled, and API switches invalidate body evidence', () => {
    const f = fixture(), root = f.read(), overview = f.read('current', root.revision);
    f.ctx.mainApi = 'textgenerationwebui';
    assert.equal(f.read('current:prompt:0', overview.revision).status, 'STALE_SOURCE');
    const data = JSON.parse(f.raw('current').text);
    assert.equal(data.chatCompletionSelected, false); assert.equal(data.mainApi, 'textgenerationwebui');
    f.manager.getCompletionPresetByName = () => Promise.resolve(f.saved.Story);
    assert.throws(() => f.raw('saved:1'), /SOURCE_UNSUPPORTED/); f.module.dispose();
});
test('Malformed, duplicate or oversized data is rejected, and arbitrary selectors cannot access raw settings', () => {
    for (const selector of ['openai', 'saved:-1', 'saved:9', 'compare:0:prompt:0', 'current:secret', 'saved:0:prompt:01']) {
        const f = fixture(); assert.throws(() => f.raw(selector), /INVALID_SELECTOR/); f.module.dispose();
    }
    const f = fixture();
    f.saved.Default.prompts.push({ ...f.saved.Default.prompts[0] }); assert.throws(() => f.raw('saved:0'), /SOURCE_UNSUPPORTED/);
    f.saved.Default.prompts = Array.from({ length: 513 }, (_, i) => ({ identifier: String(i) })); assert.throws(() => f.raw('saved:0'), /SOURCE_TOO_LARGE/);
    f.saved.Default.prompts = [{ identifier: 'main', content: 'x'.repeat(131073) }]; assert.throws(() => f.raw('saved:0'), /SOURCE_TOO_LARGE/);
    f.saved.Default.prompts = [{ identifier: 'main', content: { apiKey: 'PRIVATE' } }]; assert.throws(() => f.raw('saved:0'), /SOURCE_UNSUPPORTED/); f.module.dispose();
});
