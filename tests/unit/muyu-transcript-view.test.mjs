import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranscriptView } from '../../muyu/ui/transcript-view.js';

class Element {
    constructor(tag, doc) { this.tagName = tag; this.ownerDocument = doc; this.children = []; this.textContent = ''; this.attrs = {}; }
    append(el) { el.remove(); this.children.push(el); el.parentElement = this; }
    insertBefore(el, reference) { if (el === reference) return; el.remove(); this.children.splice(reference ? this.children.indexOf(reference) : this.children.length, 0, el); el.parentElement = this; }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
    replaceChildren() { for (const child of [...this.children]) child.remove(); }
    setAttribute(name, value) { this.attrs[name] = value; }
    getAttribute(name) { return this.attrs[name]; }
    removeAttribute(name) { delete this.attrs[name]; }
    get attributes() { return Object.entries(this.attrs).map(([name, value]) => ({ name, value })); }
}
const descendants = root => [root, ...root.children.flatMap(descendants)];

for (const lang of ['zh', 'en']) test('Answer time is local, exact and stable; missing or invalid old timestamps are omitted / ' + lang, () => {
    const f = fixture(lang), at = new Date(2026, 9, 9, 14, 7).getTime();
    f.state.messages = [{ role: 'assistant', runId: 'r', content: 'Answer' }, { role: 'assistant', runId: 'old', content: 'Old archive' }];
    f.state.runs = [{ id: 'r', answeredAt: at }, { id: 'old', answeredAt: NaN }]; f.view.update(f.state);
    const times = descendants(f.history).filter(el => el.tagName === 'time'); assert.equal(times.length, 1);
    assert.equal(times[0].textContent, '14:07'); assert.equal(times[0].attrs.datetime, new Date(at).toISOString());
    assert.match(times[0].attrs['aria-label'], lang === 'en' ? /^Answered at:/ : /^回答时间：/);
    f.state.notice = 'unchanged'; f.view.update(f.state); assert.equal(descendants(f.history).find(el => el.tagName === 'time'), times[0]);
    f.state.messages.push({ role: 'user', content: 'Next' }); f.view.update(f.state); assert.ok(descendants(f.history).includes(times[0]));
    f.state.viewToken++; f.state.runs = []; f.view.update(f.state); assert.equal(descendants(f.history).some(el => el.tagName === 'time'), false);
    f.view.dispose();
});

for (const lang of ['zh', 'en']) test('Full original answer copy survives append and expires on structural replacement / ' + lang, async () => {
    const f = fixture(lang), copied = [];
    f.history.ownerDocument.defaultView = { navigator: { clipboard: { writeText: async text => copied.push(text) } } };
    const original = '**Original**\n' + 'long text'.repeat(5000);
    f.state.messages = [{ role: 'assistant', content: original }]; f.view.update(f.state);
    const button = descendants(f.history).find(el => el.tagName === 'button' && el.attrs['aria-label'] === (lang === 'en' ? 'Copy the full original of this Muyu answer' : '复制这条暮羽回答的完整原文'));
    assert.equal(button.textContent, ''); assert.equal(button.children[0].attrs['aria-hidden'], 'true');
    assert.equal(button.title, lang === 'en' ? 'Copy original' : '复制原文');
    const old = button.onclick; await old(); assert.deepEqual(copied, [original]);
    assert.ok(descendants(f.history).some(el => el.tagName === 'small' && /truncated|截断/.test(el.textContent)));
    f.state.messages.push({ role: 'user', content: 'Next' }); f.view.update(f.state);
    assert.ok(descendants(f.history).includes(button)); await button.onclick(); assert.equal(copied.length, 2);
    f.state.messages[0].content = 'Edited'; f.view.update(f.state); await old(); assert.equal(copied.length, 2);
    const fresh = descendants(f.history).find(el => el.tagName === 'button'), captured = fresh.onclick;
    f.view.dispose(); await captured(); assert.equal(copied.length, 2);
});
function fixture(lang = 'en') {
    const doc = { createElement: tag => new Element(tag, doc) }, history = doc.createElement('div'), cards = doc.createElement('div');
    const state = { viewToken: 1, viewKey: 'a', mode: 'assistant', messages: [], runs: [], artifacts: [], input: '' };
    let renders = 0, calls = 0;
    const views = { layout: kind => kind === 'inline' ? 'inline' : 'anchored-details', title: kind => kind,
        render: (_, { node, button, artifact }) => { renders++; node('span', artifact.id); button('test action').onclick = () => calls++; return true; } };
    const options = { doc, history, cards, lang, views, controller: { snapshot: () => structuredClone(state) }, act: fn => fn() };
    return { state, history, cards, view: createTranscriptView(options), remount: () => createTranscriptView(options), renders: () => renders, calls: () => calls };
}

test('Transcript change result distinguishes message changes from state-only notifications', () => {
    const f = fixture(); f.history.scrollTop = 31;
    assert.equal(f.view.update(f.state), true); const fallback = f.history.children[0];
    assert.equal(f.view.update(f.state), false); assert.equal(f.history.children[0], fallback);
    f.state.messages.push({ role: 'assistant', content: 'Answer' }); assert.equal(f.view.update(f.state), true);
    const message = f.history.children[1]; f.state.notice = 'NOTICE'; f.state.input = 'Draft';
    assert.equal(f.view.update(f.state), false); assert.equal(f.history.children[1], message);
    f.state.messages[0].content = 'Edited'; assert.equal(f.view.update(f.state), true); assert.notEqual(f.history.children[1], message);
    assert.equal(f.history.scrollTop, 31, 'view must not own scrolling'); f.view.dispose();
});

test('Transcript owns anchored, legacy-report and inline placements without duplicate containers', () => {
    const f = fixture();
    f.state.messages = [{ role: 'assistant', runId: 'r', content: 'Answer' }];
    f.state.artifacts = [{ id: 'anchored', kind: 'plan', sourceRunId: 'r', revision: 1, content: {} }, { id: 'legacy', kind: 'report', revision: 1, content: {} }, { id: 'inline', kind: 'inline', revision: 1, content: {} }];
    f.view.update(f.state);
    const anchored = f.history.children[2], legacy = f.history.children[0];
    assert.equal(anchored.children[0].children[0].children[0].textContent, 'plan · v1');
    assert.equal(legacy.children[0].children[0].children[0].textContent, 'report · v1');
    assert.equal(f.cards.children.length, 1);
    assert.equal(f.view.update(f.state), false); assert.equal(anchored.children.length, 1); assert.equal(legacy.children.length, 1);
    f.state.messages.push({ role: 'user', content: 'Next' }); f.view.update(f.state);
    assert.equal(f.history.children[2], anchored); assert.equal(f.history.children[0], legacy);
    f.view.dispose();
});

test('Disposal invalidates captured actions, clears owned DOM and prevents late updates', () => {
    const f = fixture(); f.state.artifacts = [{ id: 'action', kind: 'inline', revision: 1, content: {} }]; f.view.update(f.state);
    const button = descendants(f.cards).find(e => e.tagName === 'button'), captured = button.onclick;
    captured(); assert.equal(f.calls(), 1);
    f.view.dispose(); f.view.dispose(); assert.equal(button.disabled, true); captured(); assert.equal(f.calls(), 1);
    assert.equal(f.history.children.length, 0); assert.equal(f.cards.children.length, 0);
    assert.equal(f.view.update(f.state), false); assert.equal(f.renders(), 1);
    const next = f.remount(); assert.equal(next.update(f.state), true); assert.equal(f.renders(), 2);
    captured(); assert.equal(f.calls(), 1); next.dispose();
});

test('Transcript instances never share message caches, process nodes or disposal state', () => {
    const a = fixture(), b = fixture();
    for (const f of [a, b]) { f.state.messages = [{ role: 'user', runId: 'same', content: 'Question' }]; f.state.runs = [{ id: 'same', process: { phase: 'running', rows: [] } }]; f.view.update(f.state); }
    const processA = descendants(a.history).find(e => e.className === 'gd-muyu-process'), processB = descendants(b.history).find(e => e.className === 'gd-muyu-process');
    assert.notEqual(processA, processB); a.view.dispose(); assert.ok(descendants(b.history).includes(processB));
    assert.equal(b.view.update(b.state), false); b.view.dispose();
});

test('Process retention removes forgotten runs and remounts new details in the existing anchor', () => {
    const f = fixture(); f.state.messages = [{ role: 'user', runId: 'r', content: 'Question' }];
    const run = { id: 'r', process: { phase: 'running', rows: [] } }; f.state.runs = [run]; f.view.update(f.state);
    const old = descendants(f.history).find(e => e.className === 'gd-muyu-process');
    f.state.runs = []; assert.equal(f.view.update(f.state), false); assert.ok(!descendants(f.history).includes(old));
    f.state.runs = [run]; f.view.update(f.state);
    const current = descendants(f.history).filter(e => e.className === 'gd-muyu-process'); assert.equal(current.length, 1); assert.notEqual(current[0], old);
    f.view.dispose();
});

test('Changes of view identity discard old message and anchor owners even with identical content', () => {
    const f = fixture(); f.state.messages = [{ role: 'assistant', runId: 'r', content: 'Answer' }]; f.view.update(f.state);
    const before = [...f.history.children]; f.state.viewKey = 'b'; assert.equal(f.view.update(f.state), true);
    assert.ok(before.every(el => !descendants(f.history).includes(el)));
    const next = [...f.history.children]; f.state.viewToken++; assert.equal(f.view.update(f.state), true);
    assert.ok(next.every(el => !descendants(f.history).includes(el))); f.view.dispose();
});

const processRun = (id, taskId = 'task', sessionId = 'session', phase = 'yielded') => ({ id, taskId, sessionId,
    process: { phase, terminal: phase === 'running' ? null : phase, cleaned: true, rows: [], toolFailures: 0,
        budget: { modelCalls: 2, toolCalls: 3, elapsedMs: 1000 } } });
const messageFor = run => ({ role: 'user', runId: run.id, content: 'Synthetic question' });
const groupOf = f => descendants(f.history).find(el => el.className === 'gd-muyu-process-group');

for (const lang of ['zh', 'en']) test('Continuation grouping preserves existing segment and message nodes / ' + lang, () => {
    const f = fixture(lang), first = processRun('r1'); f.state.runs = [first]; f.state.messages = [messageFor(first)]; f.view.update(f.state);
    const original = descendants(f.history).find(el => el.className === 'gd-muyu-process'), oldMessage = f.history.children[1]; original.open = true;
    const second = processRun('r2', 'task', 'session', 'succeeded'); f.state.runs.push(second); f.state.messages.push(messageFor(second), { role: 'assistant', runId: second.id, content: 'Final answer' });
    const before = JSON.stringify(f.state); f.view.update(f.state);
    const group = groupOf(f); assert.ok(group); assert.equal(group.open, true);
    assert.equal(f.history.children[1], oldMessage); assert.equal(group.children[2].children[0], original); assert.equal(original.open, true);
    assert.match(group.children[0].textContent, lang === 'en' ? /Answer completed.*2 segments/ : /回答完成.*2 执行段/);
    assert.match(group.children[1].textContent, lang === 'en' ? /model 4 calls · tools 6 calls.*2.0s/ : /模型 4 次 · 工具 6 次.*2.0s/);
    assert.equal(descendants(f.history).filter(el => el.className === 'gd-muyu-process-group').length, 1);
    assert.equal(descendants(f.history).filter(el => el.className === 'gd-muyu-process').length, 2);
    assert.equal(JSON.stringify(f.state), before); group.open = false;
    f.state.notice = 'notification'; f.view.update(f.state); assert.equal(groupOf(f), group); assert.equal(group.open, false);
    assert.equal(group.children[2].children[0], original); assert.equal(original.open, true); f.view.dispose();
});

for (const lang of ['zh', 'en']) test('Latest segment state and earlier failures remain distinguishable / ' + lang, () => {
    const f = fixture(lang), first = processRun('r1'), second = processRun('r2', 'task', 'session', 'succeeded');
    first.process.rows = [{ type: 'tool.failed', attemptId: 1, error: 'PERMISSION_DENIED', durationMs: 1 }]; first.process.toolFailures = 1;
    f.state.runs = [first, second]; f.state.messages = f.state.runs.map(messageFor); f.view.update(f.state);
    const group = groupOf(f); assert.match(group.children[0].textContent, lang === 'en' ? /Answer completed.*Earlier segments contain issue records/ : /回答完成.*较早执行段含异常记录/);
    assert.equal(group.getAttribute('data-state'), 'warning');
    assert.doesNotMatch(group.children[0].textContent, lang === 'en' ? /Run failed/ : /任务失败/);
    second.process.phase = 'failed'; second.process.terminal = 'failed'; second.process.error = 'MODEL_AUTH_ERROR'; f.view.update(f.state);
    assert.equal(groupOf(f), group); assert.equal(group.getAttribute('data-state'), 'error');
    assert.match(group.children[0].textContent, lang === 'en' ? /Authentication/ : /认证/);
    second.process.phase = 'yielded'; second.process.terminal = 'yielded'; second.process.error = null; f.view.update(f.state);
    assert.equal(group.getAttribute('data-state'), 'waiting'); f.view.dispose();
});

test('Grouping never guesses relationships without both explicit identities', () => {
    const f = fixture(); f.state.runs = [processRun('r1', undefined), processRun('r2', undefined)];
    for (const run of f.state.runs) delete run.taskId;
    f.state.messages = f.state.runs.map(messageFor); f.view.update(f.state);
    assert.equal(groupOf(f), undefined); assert.equal(descendants(f.history).filter(el => el.className === 'gd-muyu-process').length, 2);
    for (const run of f.state.runs) { run.taskId = 'task'; delete run.sessionId; } f.view.update(f.state); assert.equal(groupOf(f), undefined);
    f.state.runs[0].sessionId = 'a'; f.state.runs[1].sessionId = 'b'; f.view.update(f.state); assert.equal(groupOf(f), undefined);
    f.state.runs[1].sessionId = 'a'; f.state.runs[1].taskId = 'different'; f.view.update(f.state); assert.equal(groupOf(f), undefined); f.view.dispose();
});

test('Duplicate run IDs do not double-count usage, and partial reports are labeled', () => {
    const f = fixture(), first = processRun('r1'), second = processRun('r2'); delete second.process.budget;
    f.state.runs = [first, second, first]; f.state.messages = [messageFor(first), messageFor(second)]; f.view.update(f.state);
    const group = groupOf(f); assert.equal(group.children[2].children.length, 2);
    assert.match(group.children[1].textContent, /model 2 calls · tools 3 calls.*reported segments only/);
    second.process.budget = { modelCalls: 1, toolCalls: 1, elapsedMs: 500 }; f.view.update(f.state);
    assert.match(group.children[1].textContent, /model 3 calls · tools 4 calls.*1.5s/); assert.doesNotMatch(group.children[1].textContent, /reported segments only/); f.view.dispose();
});

test('Group remains stable across segment removal and is cleared on view change and disposal', () => {
    const f = fixture(), first = processRun('r1'), second = processRun('r2'); f.state.runs = [first, second]; f.state.messages = f.state.runs.map(messageFor); f.view.update(f.state);
    const original = groupOf(f); original.open = true; f.state.runs = [first]; f.view.update(f.state);
    assert.equal(groupOf(f), original); assert.equal(original.open, true); assert.equal(original.children[2].children.length, 1);
    f.state.runs.push(second); f.view.update(f.state); assert.equal(original.children[2].children.length, 2);
    f.state.viewToken++; f.view.update(f.state); assert.notEqual(groupOf(f), original); assert.ok(!descendants(f.history).includes(original));
    f.view.dispose(); assert.equal(f.history.children.length, 0); assert.equal(f.view.update(f.state), false);
});

test('All display levels retain grouped trace identity without changing execution data', () => {
    const f = fixture(), first = processRun('r1'), second = processRun('r2');
    first.process.rows = [{ type: 'tool.requested', tool: 'muyu.memory.inspect', attemptId: 1, error: null, durationMs: null }, { type: 'tool.completed', tool: 'muyu.memory.inspect', attemptId: 1, error: null, durationMs: 2 }];
    f.state.runs = [first, second]; f.state.messages = f.state.runs.map(messageFor); f.view.update(f.state); const group = groupOf(f), child = group.children[2].children[0]; group.open = child.open = true;
    const before = JSON.stringify(f.state.runs);
    for (const detail of ['compact', 'standard', 'detailed', 'verbose']) { f.state.displayConfig = { processDetail: detail }; f.view.update(f.state); assert.equal(groupOf(f), group); assert.equal(group.open, true); assert.equal(group.children[2].children[0], child); assert.equal(child.open, true); }
    assert.equal(JSON.stringify(f.state.runs), before); assert.equal(child.getAttribute('data-run-id'), 'r1'); f.view.dispose();
});

test('A grouped continuation without its own message anchor still joins its known task', () => {
    const f = fixture(), first = processRun('r1'), second = processRun('r2'); f.state.runs = [first, second]; f.state.messages = [messageFor(first)]; f.view.update(f.state);
    assert.equal(groupOf(f).children[2].children.length, 2);
    f.state.runs = []; f.view.update(f.state); assert.equal(groupOf(f), undefined); f.view.dispose();
});
