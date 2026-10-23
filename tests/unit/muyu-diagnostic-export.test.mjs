import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticExport } from '../../muyu/application/diagnostic-export.js';
import { createProcessStore } from '../../muyu/application/process-store.js';
import { createDiagnosticExportView } from '../../muyu/ui/diagnostic-export-view.js';

const sentinel = 'PRIVATE_SENTINEL';
const run = () => ({ id: sentinel, sessionId: sentinel + '-session', taskId: sentinel + '-task', status: 'failed',
    input: sentinel, target: { chatKey: sentinel }, skills: [{ text: sentinel }],
    process: { phase: 'failed', terminal: 'failed', error: 'MODEL_HISTORY_LIMIT', dropped: 8, cleaned: true,
        rows: [{ type: 'model.failed', attemptId: 3, error: 'MODEL_HISTORY_LIMIT', diagnosticStage: 'history', raw: sentinel },
            { type: 'tool.completed', tool: 'muyu.provider.read', attemptId: 2, args: sentinel,
                read: { source: 'stPresetContent', status: 'ok', characters: 2000, paged: true, nextOffset: 4000,
                    text: sentinel, continuationToken: sentinel, revision: sentinel } }] } });

test('Diagnostic export reconstructs a closed projection and aliases execution relationships', () => {
    const first = run(), second = { ...run(), id: 'other' };
    const snapshot = { input: sentinel, messages: [{ content: sentinel }], connection: { apiKey: sentinel, endpoint: sentinel },
        context: { summary: sentinel }, runConfig: { modelCalls: 12, apiKey: sentinel }, contextConfig: { inputTokens: null, prompt: sentinel }, runs: [first, second] }, before = JSON.stringify(snapshot);
    const text = diagnosticExport(snapshot, 1), data = JSON.parse(text);
    assert.doesNotMatch(text, /PRIVATE_SENTINEL/); assert.equal(JSON.stringify(snapshot), before);
    assert.equal(data.format, 'muyu-diagnostics'); assert.equal(data.version, 1);
    assert.equal(data.exportedAt, '1970-01-01T00:00:00.001Z');
    assert.equal(data.configuredBudgets.modelCalls, 12); assert.equal(data.configuredBudgets.inputTokenMode, 'request-body-only');
    assert.equal(data.runs[0].task, data.runs[1].task); assert.equal(data.runs[0].session, 'session-1');
    assert.notEqual(data.runs[0].run, data.runs[1].run);
    assert.equal(data.runs[0].rows[0].error, 'MODEL_HISTORY_LIMIT'); assert.equal(data.runs[0].rows[0].diagnosticStage, 'history');
    assert.equal(data.runs[0].rows[1].read.nextOffset, 4000); assert.equal(data.runs[0].droppedRows, 8);
});

test('Diagnostic export bounds records, drops unknown vocabulary and handles absent runtime history', () => {
    const r = run(); r.process.rows = Array.from({ length: 60 }, () => ({ type: sentinel, tool: sentinel,
        diagnosticStage: sentinel, error: sentinel, read: { source: sentinel } }));
    const data = JSON.parse(diagnosticExport({ runs: Array.from({ length: 130 }, () => r) }, 1));
    assert.equal(data.runs.length, 128); assert.equal(data.omittedRuns, 2);
    assert.equal(data.runs[0].rows.length, 48); assert.equal(data.runs[0].exportOmittedRows, 12);
    assert.equal(data.runs[0].rows[0].error, 'UNKNOWN_ERROR');
    assert.doesNotMatch(JSON.stringify(data), /PRIVATE_SENTINEL/);
    assert.deepEqual(JSON.parse(diagnosticExport({}, 1)).runs, []);
});

for (const code of ['MODEL_HISTORY_LIMIT', 'MODEL_RESPONSE_TOO_LARGE', 'MODEL_REQUEST_TOO_LARGE']) test('Process logs preserve safe model capacity codes / ' + code, () => {
    const store = createProcessStore(); store.create('r');
    store.event('r', { runId: 'r', seq: 1, type: 'model.failed', payload: { attemptId: 1, error: code, diagnosticStage: 'transport', raw: sentinel } });
    store.lifecycle('r', 'failed', code);
    assert.equal(store.snapshot('r').error, code); assert.equal(store.snapshot('r').rows[0].error, code);
    assert.doesNotMatch(JSON.stringify(store.snapshot('r')), /PRIVATE_SENTINEL/);
});

test('Process read offsets expose numeric progress without tokens or body', () => {
    const store = createProcessStore(); store.create('r');
    for (const [seq, nextOffset] of [2000, 4000, -1].entries()) store.event('r', { runId: 'r', seq: seq + 1, type: 'tool.completed', payload: { attemptId: seq + 1, toolId: 'muyu.provider.read', result: { data: {
        source: 'stPresetContent', status: 'ok', text: sentinel, nextOffset, sourceLimited: true, truncated: nextOffset !== -1,
        readHint: { continuation: { token: sentinel } },
    } } } });
    assert.deepEqual(store.snapshot('r').rows.map(r => r.read.nextOffset), [2000, 4000, -1]);
    assert.doesNotMatch(JSON.stringify(store.snapshot('r')), /PRIVATE_SENTINEL/);
});

function ui(lang, download = false, fail = false) {
    class Element {
        constructor(tag) { this.tag = tag; this.children = []; }
        append(el) { this.children.push(el); el.parent = this; }
        setAttribute(key, value) { this[key] = value; }
        remove() { if (this.parent) this.parent.children = this.parent.children.filter(e => e !== this); }
        click() { if (this.tag === 'a' && fail) throw Error(sentinel); }
    }
    const created = [], revoked = [], snapshots = [];
    const doc = { createElement: tag => new Element(tag), defaultView: download ? { Blob, URL: {
        createObjectURL(blob) { created.push(blob); return 'blob:local'; }, revokeObjectURL(url) { revoked.push(url); },
    } } : {} };
    const parent = doc.createElement('div'), state = { runs: [run()] };
    const view = createDiagnosticExportView({ doc, parent, lang, controller: { snapshot() { snapshots.push(true); return state; } } });
    const root = parent.children[0], button = root.children.find(e => e.tag === 'button'), manual = root.children.find(e => e.tag === 'details'), output = manual.children.find(e => e.tag === 'textarea');
    return { view, state, parent, root, button, manual, output, created, revoked, snapshots };
}

for (const lang of ['zh', 'en']) test('Explicit export falls back to manual copy without download APIs / ' + lang, () => {
    const f = ui(lang); assert.equal(f.snapshots.length, 0);
    f.button.onclick(); assert.equal(f.snapshots.length, 1); assert.equal(f.manual.hidden, false); assert.equal(f.manual.open, true);
    assert.doesNotMatch(f.output.value, /PRIVATE_SENTINEL/); assert.equal(f.output.readOnly, true);
    assert.match(f.root.children.at(-1).textContent, lang === 'en' ? /copy the log/ : /手动复制/);
    const stale = f.button.onclick; f.view.dispose(); stale(); assert.equal(f.snapshots.length, 1); assert.equal(f.output.value, '');
    assert.equal(f.parent.children.length, 0); f.view.dispose();
});

for (const fail of [false, true]) test('Download object URLs are revoked and errors remain private / ' + fail, async () => {
    const f = ui('en', true, fail); f.button.onclick();
    assert.equal(f.created.length, 1); assert.doesNotMatch(await f.created[0].text(), /PRIVATE_SENTINEL/);
    assert.equal(f.root.children.some(e => e.tag === 'a'), false);
    f.view.dispose(); assert.deepEqual(f.revoked, ['blob:local']);
    assert.doesNotMatch(f.root.children.at(-1).textContent, /PRIVATE_SENTINEL/);
});
