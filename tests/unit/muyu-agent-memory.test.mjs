import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentMemoryPort } from '../../muyu/host/agent-memory.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { openSettingsHistoryStore } from '../../muyu/sessions/settings-store.js';
import { historyScope } from '../../muyu/sessions/contract.js';
import { createMemoryWorkbench } from '../../muyu/memory/workbench.js';
import { createAgentMemoryModule } from '../../muyu/modules/agent-memory/index.js';
import { validateNoteData, NOTE_LIMITS } from '../../muyu/memory/contract.js';
import { validateJson } from '../../muyu/core/json-contract.js';
import { createBuiltins } from '../../muyu/modules/builtins.js';
import { createConfigProfileSubject } from './helpers/config-profile-subject.mjs';
import { sanitizeImportedSettings } from '../../systems/config-profile-validation.js';
import { deferred } from './helpers/muyu-subject.mjs';

const a = { kind: 'chat', userKey: 'page:test', chatKey: 'A' }, b = { ...a, chatKey: 'B' };
const input = (content = '简洁回答', scope = 'chat') => ({ title: content.slice(0, 80), content, scope });
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(save = async () => {}) {
    let settings = { other: 7, muyuAgentMemoryEnabled: false }, target = a, account = { enabled: false };
    const port = createAgentMemoryPort({ getAccount: async () => account, getSettings: () => settings, saveSettings: save, getTarget: () => target, now: () => 10 });
    return { port, get settings() { return settings; }, get target() { return target; }, switch(target_) { target = target_; }, replace(settings_) { settings = settings_; }, account(value) { account = value; } };
}
function moduleFor(f, question = '记住：简洁回答', budget = 50000) {
    const module = createAgentMemoryModule({ port: f.port, budget: () => budget });
    module.bindRun({ id: 'run' }, { userQuestion: question });
    const ctx = { runId: 'run', target: f.target, signal: new AbortController().signal };
    return { module, ctx, call: (id, args) => module.handlers['muyu.notes.' + id](args, ctx) };
}

test('Account notes require affirmative scope, never quoted keywords, negation or conflicting corrections', async () => {
    for (const question of ['记住：中文回答，仅当前聊天，不要全局保存', '记住：中文回答，仅当前聊天',
        '记住：中文回答，不要全局保存', '记住：「account」这个词',
        '全局记住：中文回答，但只用于当前聊天', '记住：不要全局，改成全局保存中文回答',
        'globally remember: Chinese, not for all chats']) {
        const f = fixture(); f.settings.muyuAgentMemoryEnabled = true;
        const quote = question.includes('中文回答') ? '中文回答' : question.includes('account') ? 'account' : 'Chinese';
        assert.equal((await moduleFor(f, question).call('remember', { quote, scope: 'account' })).status, 'invalid_intent', question);
        assert.deepEqual(await f.port.list(a), []);
    }
    for (const question of ['全局记住：中文回答', '请在所有聊天记住：中文回答', 'globally remember: 中文回答', 'for all chats remember: 中文回答']) {
        const f = fixture(); f.settings.muyuAgentMemoryEnabled = true;
        assert.equal((await moduleFor(f, question).call('remember', { quote: '中文回答', scope: 'account' })).status, 'saved', question);
        f.switch(b); assert.equal((await f.port.list(b))[0].scope, 'account');
    }
    const f = fixture(); f.settings.muyuAgentMemoryEnabled = true;
    assert.equal((await moduleFor(f, '记住：中文回答，仅当前聊天，不要全局保存').call('remember', { quote: '中文回答', scope: 'chat' })).status, 'saved');
    f.switch(b); assert.deepEqual(await f.port.list(b), []);
});

test('Assistant notes persist independently, are copied, scoped and readable after host reconstruction', async () => {
    const f = fixture(); const local = await f.port.save(input(), { target: a });
    const global = await f.port.save(input('偏好中文', 'account'), { target: a });
    assert.equal(local.revision, 1); assert.equal(Object.isFrozen(f.settings.muyuAgentMemoryData.notes), true);
    local.content = 'not shared'; assert.equal((await f.port.get(local.id, a)).content, '简洁回答');
    f.switch(b); assert.deepEqual((await f.port.list(b)).map(note => note.id), [global.id]);
    assert.equal(await f.port.get(local.id, b), null);
    const settings = JSON.parse(JSON.stringify(f.settings));
    const restored = createAgentMemoryPort({ getAccount: async () => ({ enabled: false }), getSettings: () => settings, saveSettings: async () => {}, getTarget: () => a });
    assert.equal((await restored.list(a)).length, 2); assert.equal(settings.other, 7);
    assert.equal(Object.hasOwn(settings, 'muyuHistoryData'), false); assert.equal(Object.hasOwn(settings, 'memory'), false);
});

test('Note updates/delete require exact revisions and cannot target another ST chat', async () => {
    const f = fixture(), note = await f.port.save(input(), { target: a });
    const updated = await f.port.save(input('详细回答'), { target: a, id: note.id, revision: note.revision });
    assert.equal(updated.revision, 2);
    await assert.rejects(f.port.save(input('stale'), { target: a, id: note.id, revision: 1 }), /NOTE_CONFLICT/);
    await assert.rejects(f.port.remove(note.id, 1, a), /NOTE_CONFLICT/);
    f.switch(b); await assert.rejects(f.port.remove(note.id, 2, b), /NOTE_CONFLICT/);
    await assert.rejects(f.port.list(a), /NOTE_STALE_TARGET/);
    f.switch(a); await f.port.remove(note.id, 2, a);
    await assert.rejects(f.port.save(input(), { target: a, id: note.id, revision: 2 }), /NOTE_CONFLICT/);
    assert.deepEqual(await f.port.list(a), []);
});

test('Async save failure restores only the note projection and leaves unrelated settings untouched', async () => {
    const wait = deferred(), started = deferred(); const f = fixture(() => { started.resolve(); return wait.promise; });
    const pending = f.port.save(input(), { target: a }); await started.promise;
    f.settings.other = 'concurrent'; wait.reject(Error('private raw host failure'));
    await assert.rejects(pending, /^Error: NOTE_SAVE_UNKNOWN$/);
    assert.equal(f.settings.muyuAgentMemoryData, undefined); assert.equal(f.settings.other, 'concurrent');
    assert.deepEqual(await f.port.list(a), []);
});

test('Pending note saves serialize edits, and reads never expose unconfirmed optimistic notes', async () => {
    const wait = deferred(), started = deferred(); let calls = 0;
    const f = fixture(() => { if (++calls === 1) { started.resolve(); return wait.promise; } });
    const first = f.port.save(input('first'), { target: a }); await started.promise;
    const second = f.port.save(input('second'), { target: a }); let readDone = false;
    const reading = f.port.list(a).then(value => { readDone = true; return value; });
    await tick(); assert.equal(readDone, false); assert.equal(calls, 1);
    wait.reject(Error('failed')); await assert.rejects(first, /NOTE_SAVE_UNKNOWN/); await second;
    assert.deepEqual((await reading).map(note => note.content), ['second']); assert.equal(calls, 2);
});

test('Save failure cannot overwrite a concurrent repository replacement', async () => {
    const wait = deferred(), started = deferred(), f = fixture(() => { started.resolve(); return wait.promise; });
    const pending = f.port.save(input(), { target: a }); await started.promise;
    const replacement = { ...f.settings.muyuAgentMemoryData, notes: [] }; f.settings.muyuAgentMemoryData = replacement;
    wait.reject(Error('failed')); await assert.rejects(pending, /NOTE_SAVE_UNKNOWN/);
    assert.equal(f.settings.muyuAgentMemoryData, replacement);
});

test('Account conversation saves cannot serialize an unconfirmed note working copy', async () => {
    const wait = deferred(), started = deferred(); let calls = 0, savedSnapshot;
    const f = fixture(() => { calls++; if (calls === 1) { started.resolve(); return wait.promise; } savedSnapshot = JSON.parse(JSON.stringify(f.settings)); });
    const history = openSettingsHistoryStore({ namespace: crypto.randomUUID(), getSettings: () => f.settings, saveSettings: async () => { calls++; savedSnapshot = JSON.parse(JSON.stringify(f.settings)); } });
    const note = f.port.save(input(), { target: a }); await started.promise;
    const record = { version: 5, id: crypto.randomUUID(), revision: 0, scope: historyScope('assistant', a), title: 'conversation', createdAt: 1, updatedAt: 1,
        messages: [], required: [], status: 'idle', archived: false, imported: false, contextSummary: null, receipts: [] };
    const savingHistory = history.create(record); await tick(); assert.equal(calls, 1);
    wait.reject(Error('host failed')); await assert.rejects(note, /NOTE_SAVE_UNKNOWN/); await savingHistory;
    assert.equal(savedSnapshot.muyuAgentMemoryData, undefined); assert.equal(savedSnapshot.muyuHistoryData.records.length, 1);
    history.close();
});

test('A retained editor draft cannot be saved into a replaced account settings owner', async () => {
    const f = fixture(), workbench = createMemoryWorkbench({ port: f.port, getTarget: () => f.target });
    workbench.setDraft({ title: 'old account', content: 'retain me' }); f.replace({ muyuAgentMemoryEnabled: false });
    assert.equal(workbench.snapshot().stale, true); await assert.rejects(workbench.save(), /NOTE_STALE_TARGET/);
    assert.equal(workbench.snapshot().draft.content, 'retain me'); assert.equal(f.settings.muyuAgentMemoryData, undefined);
    workbench.newNote(); assert.equal(workbench.snapshot().stale, false); workbench.dispose();
});

test('Account identity cannot fall back on failure, cross-account reads fail closed, owner replacement rejects', async () => {
    const f = fixture(); await f.port.save(input(), { target: a });
    f.account({ enabled: true, handle: 'other', created: 1 }); await assert.rejects(f.port.list(a), /NOTE_INVALID/);
    f.account(null); await assert.rejects(f.port.list(a), /NOTE_IDENTITY/);
    f.account({ enabled: false });
    const gate = deferred(); const port = createAgentMemoryPort({ getAccount: async () => { await gate.promise; return { enabled: false }; }, getSettings: () => f.settings, saveSettings: async () => {}, getTarget: () => a });
    const reading = port.list(a); f.replace({ other: 'new' }); gate.resolve();
    await assert.rejects(reading, /NOTE_IDENTITY/); assert.equal(f.settings.muyuAgentMemoryData, undefined);
});

test('Cancellation and chat changes during persistence are not reported as successful writes', async () => {
    const wait = deferred(), started = deferred(), f = fixture(() => { started.resolve(); return wait.promise; });
    const abort = new AbortController(); abort.abort();
    await assert.rejects(f.port.save(input(), { target: a, signal: abort.signal }), /NOTE_CANCELLED/);
    const pending = f.port.save(input(), { target: a }); await started.promise; f.switch(b); wait.resolve();
    await assert.rejects(pending, /NOTE_SAVE_UNKNOWN/); assert.equal(f.settings.muyuAgentMemoryData, undefined);
});

test('Closed memory DTO rejects extra fields, oversized notes, credentials, malformed data and duplicates', async () => {
    const f = fixture();
    await assert.rejects(f.port.save({ ...input(), hidden: 'extra' }, { target: a }), /NOTE_INVALID/);
    await assert.rejects(f.port.save(input('x'.repeat(NOTE_LIMITS.chars + 1)), { target: a }), /NOTE_INVALID/);
    await assert.rejects(f.port.save(input('sk-' + 'x'.repeat(30)), { target: a }), /NOTE_SECRET/);
    await assert.rejects(f.port.save(input('Bearer ' + 'x'.repeat(30)), { target: a }), /NOTE_SECRET/);
    await f.port.save(input(), { target: a }); const data = JSON.parse(JSON.stringify(f.settings.muyuAgentMemoryData));
    assert.throws(() => validateNoteData({ ...data, extra: true }, data.namespace), /NOTE_INVALID/);
    assert.throws(() => validateNoteData({ ...data, notes: [...data.notes, data.notes[0]] }, data.namespace), /NOTE_INVALID/);
    assert.throws(() => validateNoteData({ ...data, notes: Array(257).fill(data.notes[0]) }, data.namespace), /NOTE_CAPACITY/);
});

test('Enabled preference is explicitly persisted and rolls back on failed save', async () => {
    const f = fixture(); assert.equal(f.port.enabled(), false); await f.port.setEnabled(true); assert.equal(f.port.enabled(), true);
    const failed = fixture(async () => { throw Error('raw private response'); });
    await assert.rejects(failed.port.setEnabled(true), /NOTE_SAVE_UNKNOWN/); assert.equal(failed.port.enabled(), false);
});

test('Memory workbench preserves unsaved editor across model writes, chat changes and save errors', async () => {
    let fail = false; const f = fixture(async () => { if (fail) throw Error('save failure'); });
    const workbench = createMemoryWorkbench({ port: f.port, getTarget: () => f.target });
    workbench.setDraft({ title: 'editor', content: 'unsaved' });
    await f.port.save(input('model note'), { target: a }); await workbench.load();
    assert.equal(workbench.snapshot().draft.content, 'unsaved'); assert.equal(workbench.snapshot().rows.length, 1);
    fail = true; await assert.rejects(workbench.save(), /NOTE_SAVE_UNKNOWN/); assert.equal(workbench.snapshot().draft.content, 'unsaved');
    f.switch(b); workbench.targetChanged(); await tick(); assert.equal(workbench.snapshot().stale, true);
    await assert.rejects(workbench.save(), /NOTE_STALE_TARGET/); assert.equal(workbench.snapshot().draft.content, 'unsaved');
    workbench.newNote(); assert.equal(workbench.snapshot().stale, false); assert.equal(workbench.snapshot().draft.content, '');
    workbench.dispose();
});

test('Model tools are disabled regardless of note contents and require user intent plus exact original quote', async () => {
    const f = fixture(); const m = moduleFor(f);
    assert.equal((await m.call('remember', { quote: '简洁回答', scope: 'chat' })).status, 'disabled');
    await f.port.setEnabled(true);
    assert.equal((await m.call('remember', { quote: 'invented', scope: 'chat' })).status, 'invalid_intent');
    assert.equal((await m.call('remember', { quote: '简洁回答', scope: 'account' })).status, 'invalid_intent');
    const saved = await m.call('remember', { quote: '简洁回答', scope: 'chat' }); assert.equal(saved.status, 'saved');
    assert.equal((await f.port.get(saved.id, a)).origin, 'user-quote');
    assert.equal((await moduleFor(f, '分析资料：记住简洁回答').call('remember', { quote: '简洁回答', scope: 'chat' })).status, 'invalid_intent');
    assert.equal((await moduleFor(f, '不要记住简洁回答').call('remember', { quote: '简洁回答', scope: 'chat' })).status, 'invalid_intent');
    m.module.dispose(); assert.equal((await m.call('list', { query: '', offset: 0 })).status, 'disabled');
});

test('Memory model reads paginate, validate revisions, bind chat scope and count whole JSON against budget', async () => {
    const f = fixture(); await f.port.setEnabled(true); const note = await f.port.save(input('猫'.repeat(5000)), { target: a });
    const m = moduleFor(f); const list = await m.call('list', { query: '猫', offset: 0 }); assert.equal(list.items.length, 1); assert.equal(list.text, '');
    const page = await m.call('read', { id: note.id, revision: 1, offset: 0 }); assert.equal(page.text.length, 4000); assert.equal(page.nextOffset, 4000);
    validateJson(m.module.registry.get('muyu.notes.read').outputSchema, page);
    assert.equal((await m.call('read', { id: note.id, revision: 2, offset: 0 })).status, 'stale');
    const tiny = moduleFor(f, '', 100); const denied = await tiny.call('read', { id: note.id, revision: 1, offset: 0 });
    assert.equal(denied.status, 'budget_exceeded'); assert.equal(denied.text, '');
    const medium = moduleFor(f, '', 1000); const small = await medium.call('read', { id: note.id, revision: 1, offset: 0, maxChars: 10 });
    assert.equal(small.status, 'ok'); assert.equal(small.text, '猫'.repeat(10));
    f.switch(b); const other = moduleFor(f); assert.equal((await other.call('read', { id: note.id, revision: 1, offset: 0 })).status, 'not_found');
});

test('Note keyword coverage is not an inventory and excludes notes from other chats', async () => {
    const f = fixture(); await f.port.setEnabled(true);
    for (let i = 0; i < 10; i++) await f.port.save(input('背景资料' + i), { target: a });
    await f.port.save(input('偏好中文回答', 'account'), { target: a });
    f.switch(b); await f.port.save(input('另一聊天秘密'), { target: b }); f.switch(a);
    const m = moduleFor(f), found = await m.call('list', { query: '中文', offset: 0 });
    assert.deepEqual(found.coverage, { query: '中文', kind: 'query_matches', matchedCount: 1, offset: 0, complete: true, scope: 'account-and-current-chat' });
    validateJson(m.module.registry.get('muyu.notes.list').outputSchema, found);
    const missing = await m.call('list', { query: '不存在', offset: 0 }); assert.equal(missing.coverage.matchedCount, 0); assert.equal(missing.coverage.kind, 'query_matches');
    const first = await m.call('list', { query: '', offset: 0 }); assert.equal(first.coverage.kind, 'visible_inventory'); assert.equal(first.coverage.matchedCount, 11);
    assert.equal(first.items.length, 8); assert.equal(first.coverage.complete, false); assert.equal(first.nextOffset, 8);
    const last = await m.call('list', { query: '', offset: first.nextOffset }); assert.equal(last.coverage.offset, 8); assert.equal(last.coverage.complete, true); assert.equal(last.items.length, 3);
    assert.doesNotMatch(JSON.stringify(first) + JSON.stringify(last), /另一聊天秘密/);
    assert.equal((await moduleFor(f, '', 100).call('list', { query: '中文', offset: 0 })).coverage, undefined);
});

test('Successful note writes disclose scope and on-demand recall, never automatic injection', async () => {
    const f = fixture(); await f.port.setEnabled(true);
    for (const [scope, question] of [['chat', '记住：简洁回答'], ['account', '全局记住：中文回答']]) {
        const m = moduleFor(f, question), args = { quote: scope === 'chat' ? '简洁回答' : '中文回答', scope };
        const saved = await m.call('remember', args); assert.equal(saved.status, 'saved');
        assert.deepEqual(saved.writeReceipt, { scope, recallMode: 'on_demand', automaticContextInjection: false, creationStatus: 'not_reported', semanticDuplicateCheck: 'not_performed' });
        validateJson(m.module.registry.get('muyu.notes.remember').outputSchema, saved);
        assert.deepEqual((await m.call('remember', args)).writeReceipt, saved.writeReceipt);
    }
    const fail = fixture(async () => { throw Error('save failed'); }); fail.settings.muyuAgentMemoryEnabled = true;
    const unknown = await moduleFor(fail).call('remember', { quote: '简洁回答', scope: 'chat' }); assert.equal(unknown.status, 'save_unknown'); assert.equal(unknown.writeReceipt, undefined);
});

test('Model cannot store derived tool text, change scope, delete unnamed notes or bypass a revision', async () => {
    const f = fixture(); await f.port.setEnabled(true); const note = await f.port.save(input('简洁回答'), { target: a });
    const m = moduleFor(f, '更新偏好：简洁回答，改成详细回答');
    assert.equal((await m.call('remember', { quote: 'private tool result', scope: 'chat', id: note.id, revision: 1 })).status, 'invalid_intent');
    const saved = await m.call('remember', { quote: '详细回答', scope: 'chat', id: note.id, revision: 1 }); assert.equal(saved.status, 'saved');
    assert.equal((await moduleFor(f, '更新偏好：简洁回答，改成详细回答').call('remember', { quote: '详细回答', scope: 'chat', id: note.id, revision: 1 })).status, 'stale');
    const unnamed = moduleFor(f, '删除一个记忆'); assert.equal((await unnamed.call('forget', { id: note.id, revision: 2 })).status, 'invalid_intent');
    const remove = moduleFor(f, '忘记简洁回答'); assert.equal((await remove.call('forget', { id: note.id, revision: 2 })).status, 'removed');
    assert.equal((await moduleFor(f, '忘记简洁回答').call('forget', { id: note.id, revision: 2 })).status, 'stale');
});

test('Memory model result never claims success after async save failure', async () => {
    const f = fixture(async () => { throw Error('private error'); }); f.settings.muyuAgentMemoryEnabled = true;
    const m = moduleFor(f); const response = await m.call('remember', { quote: '简洁回答', scope: 'chat' });
    assert.equal(response.status, 'save_unknown'); assert.doesNotMatch(JSON.stringify(response), /private error/); assert.deepEqual(await f.port.list(a), []);
});

test('Repeated model remember operations do not duplicate notes or re-execute confirmed writes after handoff', async () => {
    let saves = 0; const f = fixture(async () => { saves++; }); await f.port.setEnabled(true); const m = moduleFor(f);
    const args = { quote: '简洁回答', scope: 'chat' }, first = await m.call('remember', args), count = saves;
    assert.equal((await m.call('remember', args)).id, first.id); assert.equal(saves, count);
    m.module.transferRun('run', { id: 'continued' });
    assert.equal((await m.module.handlers['muyu.notes.remember'](args, { ...m.ctx, runId: 'continued' })).id, first.id); assert.equal(saves, count);
    const later = moduleFor(f); assert.equal((await later.call('remember', args)).id, first.id);
    assert.equal((await f.port.list(a)).length, 1);
});

test('A model repeated unknown write cannot silently retry its host save under a different call ID', async () => {
    let saves = 0; const f = fixture(async () => { saves++; throw Error('raw host failure'); }); f.settings.muyuAgentMemoryEnabled = true;
    const m = moduleFor(f), args = { quote: '简洁回答', scope: 'chat' };
    assert.equal((await m.call('remember', args)).status, 'save_unknown');
    assert.equal((await m.call('remember', args)).status, 'save_unknown'); assert.equal(saves, 1);
});

test('Memory read usage shares the Provider budget and survives run transfer without a reset', async () => {
    const f = fixture(); await f.port.setEnabled(true); await f.port.save(input('猫'.repeat(1000)), { target: a });
    const builtins = createBuiltins(createHostBridge({ getContext: () => ({ groupId: 'g', chatId: 'A' }), getSettings: () => f.settings, extensionKey: 'gd', agentMemory: f.port, pageId: 'test' }));
    const identity = { id: 'r1', target: a, taskId: 'task' }; builtins.tasks.assistant.bind(identity, { userQuestion: 'read', fields: [] }); builtins.bindBudget('r1', 6000);
    const ctx = { runId: 'r1', target: a, signal: new AbortController().signal };
    await builtins.handlers['muyu.notes.list']({ query: '', offset: 0 }, ctx); const usage = builtins.resourceUsage('r1'); assert.ok(usage.used > 100);
    builtins.transferRun('r1', { ...identity, id: 'r2' }, { fields: [] }); builtins.bindBudget('r2', 6000, 'r1');
    assert.equal(builtins.resourceUsage('r2').used, usage.used);
    builtins.dispose();
});

test('Private assistant note fields cannot be exported/imported/applied through configuration profiles', async t => {
    const previous = globalThis.document;
    globalThis.document = { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } };
    t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
    const privateData = { marker: 'PRIVATE_ASSISTANT_NOTE' };
    const f = createConfigProfileSubject({ muyuAgentMemoryEnabled: true, muyuAgentMemoryData: privateData });
    const saved = f.subject.saveCurrentAsProfile('test', '', { agentsTools: true, contextLedger: true });
    assert.equal(Object.hasOwn(saved.settings, 'muyuAgentMemoryData'), false);
    saved.settings.muyuAgentMemoryData = { injected: true }; saved.settings.muyuAgentMemoryEnabled = false;
    assert.doesNotMatch(JSON.stringify(f.subject.exportProfileAsJson(saved.id)), /muyuAgentMemoryData|muyuAgentMemoryEnabled/);
    await f.subject.applyProfile(saved.id); assert.deepEqual(f.settings.muyuAgentMemoryData, privateData); assert.equal(f.settings.muyuAgentMemoryEnabled, true);
    assert.deepEqual(sanitizeImportedSettings({ muyuAgentMemoryData: privateData, muyuAgentMemoryEnabled: true }), {});
});
