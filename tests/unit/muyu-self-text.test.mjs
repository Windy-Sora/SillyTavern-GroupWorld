import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelfModule } from '../../muyu/modules/self/index.js';
import { sanitizeSelfText, projectConnectionText } from '../../muyu/self/text.js';
import { requiredSources, assistantToolAccess } from '../../muyu/application/capabilities.js';
import { createPermissions } from '../../muyu/application/permissions.js';
import { createTaskEvidence } from '../../muyu/application/task-evidence.js';
import { createToolBroker } from '../../muyu/tools/broker.js';
import { validateJson } from '../../muyu/core/json-contract.js';
import { createConnectionForm } from '../../muyu/ui/connection-form.js';

const identity = { id: 'r', taskId: 't', target: { kind: 'global', userKey: 'u' } };
const context = () => ({ runId: 'r', target: identity.target, signal: new AbortController().signal });
function fixture() {
    let value = { text: '甲'.repeat(1999) + '🦉' + '乙'.repeat(2200), owner: 'panel-1', dirty: true }, allowed = true;
    const charges = [], reads = [];
    const module = createSelfModule({ readText: item => { reads.push(item); return value; }, charge: (id, bytes) => { charges.push(bytes); return allowed; }, now: () => 0 });
    module.bindRun(identity);
    return { module, charges, reads, set: next => { value = next; }, denyBudget: () => { allowed = false; },
        read: (args = {}, ctx = context()) => module.handlers['muyu.self.read_text']({ item: 'draft-instructions', ...args }, ctx) };
}
test('sanitizer removes known credentials, conventional keys, auth headers and URL credentials/query/fragment', () => {
    const result = sanitizeSelfText('Keep {{getvar}} and prose. apiKey="abc" Bearer private-token https://name:pass@example.test/path?token=secret#private sk-123456789 abc-custom', ['abc-custom']);
    assert.doesNotMatch(result, /abc-custom|private-token|name:pass|token=secret|#private|sk-123456789|="abc"/);
    assert.match(result, /Keep \{\{getvar\}\} and prose/); assert.match(result, /https:\/\/example.test\/path/);
});
test('connection projection allowlists fields and redacts before truncation', () => {
    const secret = 'X'.repeat(300);
    const result = projectConnectionText({ endpoint: 'https://user:pass@example.test/chat/completions?key=x#y', model: secret, apiKey: 'DO_NOT_RETURN', password: 'HIDDEN', extra: 'PRIVATE' }, [secret]);
    const value = JSON.parse(result); assert.match(value.model, /REDACTED/); assert.equal(value.endpoint, 'https://example.test/chat/completions');
    assert.doesNotMatch(result, /DO_NOT_RETURN|HIDDEN|PRIVATE|XXXXX/);
});
test('pages use the whole UTF-8 envelope budget and never split a surrogate pair', () => {
    const f = fixture(), first = f.read(), page = JSON.parse(first.text);
    validateJson(f.module.registry.get('muyu.self.read_text').outputSchema, first);
    assert.equal(page.text.length, 1999); assert.equal(page.nextOffset, 1999); assert.equal(page.draft, true);
    assert.equal(f.charges[0], Buffer.byteLength(JSON.stringify(first)));
    const next = JSON.parse(f.read({ offset: page.nextOffset, revision: page.revision }).text);
    assert.ok(next.text.startsWith('🦉')); assert.equal(next.revision, page.revision); assert.equal(next.complete, false);
    const last = JSON.parse(f.read({ offset: next.nextOffset, revision: page.revision }).text);
    assert.equal(last.complete, true); assert.equal(last.nextOffset, null);
});
test('continuations require a matching live revision and reject edited content or recreated panels', () => {
    const f = fixture(), page = JSON.parse(f.read().text), request = { offset: page.nextOffset, revision: page.revision };
    assert.equal(f.read({ offset: page.nextOffset }).status, 'stale_source');
    f.set({ text: 'changed', owner: 'panel-1' }); assert.equal(f.read(request).status, 'stale_source');
    const fresh = JSON.parse(f.read().text); assert.notEqual(fresh.revision, page.revision);
    f.set({ text: 'changed', owner: 'panel-2' }); assert.equal(f.read({ revision: fresh.revision }).status, 'stale_source');
});
test('empty text is a valid observation while unavailable or reader failure is not empty', () => {
    const f = fixture(); f.set({ text: '', owner: 'saved' }); assert.equal(JSON.parse(f.read().text).complete, true);
    f.set(null); assert.deepEqual(f.read(), { status: 'unavailable', text: '' });
    const module = createSelfModule({ readText: () => { throw Error('SECRET'); }, charge: () => true }); module.bindRun(identity);
    assert.deepEqual(module.handlers['muyu.self.read_text']({ item: 'draft-instructions' }, context()), { status: 'unavailable', text: '' });
});
test('bad offsets and spent budget disclose no partial content', () => {
    const f = fixture(), page = JSON.parse(f.read().text);
    assert.equal(f.read({ offset: 2000, revision: page.revision }).status, 'invalid_offset');
    assert.equal(f.read({ offset: 8000, revision: page.revision }).status, 'invalid_offset');
    f.denyBudget(); assert.deepEqual(f.read(), { status: 'budget_exceeded', text: '' });
});
test('foreign run/target and cancellation cannot read draft callbacks', () => {
    const f = fixture();
    assert.equal(f.read({}, { ...context(), runId: 'foreign' }).status, 'unavailable');
    assert.equal(f.read({}, { ...context(), target: { ...identity.target, userKey: 'other' } }).status, 'unavailable');
    const signal = new AbortController(); signal.abort(); assert.throws(() => f.read({}, { ...context(), signal: signal.signal }), /CANCELLED/);
    f.module.dispose(); assert.equal(f.read().status, 'unavailable'); assert.equal(f.reads.length, 0);
});
test('same task transfer retains text revisions without granting a different task or resetting budget', () => {
    const f = fixture(), page = JSON.parse(f.read().text);
    f.module.transferRun('r', { ...identity, id: 'r2' });
    assert.equal(f.read().status, 'unavailable');
    assert.equal(f.read({ revision: page.revision, offset: page.nextOffset }, { ...context(), runId: 'r2' }).status, 'ok');
    f.module.forgetRun('r2'); assert.equal(f.read({}, { ...context(), runId: 'r2' }).status, 'unavailable');
});
test('parameter grants never authorize bodies and explicit denials win over allow-reads', () => {
    const f = fixture(), permissions = createPermissions({ readAccess: () => false });
    permissions.grantSource('source:muyuSelfConfig', identity.target);
    const definition = f.module.registry.get('muyu.self.read_text'), check = () => assistantToolAccess(definition, { item: 'draft-instructions' }, identity.target, 't', permissions).decision;
    assert.deepEqual(requiredSources('muyu.self.read_text', {}), ['source:muyuSelfText']); assert.equal(check(), 'permission_required');
    permissions.grantSource('source:muyuSelfText', identity.target); assert.equal(check(), true);
    permissions.decide({ source: 'muyuSelfText', target: identity.target, taskId: 't', reason: 'test' }, 'deny', () => {}); assert.equal(check(), 'user_denied');
});
test('broker rejects arbitrary paths, writes and unrelated resource bodies before the reader', async () => {
    const f = fixture(), broker = createToolBroker({ registry: f.module.registry, handlers: f.module.handlers, runId: 'r', target: identity.target, allowedTools: ['muyu.self.read_text'], maxCalls: 6, signal: context().signal, policy: () => true });
    for (const [i, args] of [{ item: 'apiKey' }, { item: 'draft-instructions', apply: true }, { item: 'chat' }, { item: 'draft-instructions', path: 'anything' }].entries()) {
        const result = await broker.call({ toolId: 'muyu.self.read_text', version: 1, callId: 'c' + i, args }); assert.equal(result.error.code, 'INVALID_ARGUMENT');
    }
    assert.equal(f.reads.length, 0);
});
test('read evidence stores no body and a final continuation page does not imply full coverage', () => {
    const f = fixture(), first = f.read(), body = JSON.parse(first.text);
    const last = f.read({ offset: 4000, revision: body.revision });
    const evidence = createTaskEvidence();
    evidence.observe({ toolId: 'muyu.self.read_text', callId: 'p', args: { item: 'draft-instructions', offset: 4000 } }, { ok: true, data: last }, 'r');
    assert.equal(evidence.snapshot().observations[0].outcome, 'self-text-page'); assert.doesNotMatch(JSON.stringify(evidence.snapshot()), /甲|乙|revision/);
});
test('form reader observes current allowed fields and strips its unsaved credential before leaving the view', () => {
    const doc = { createElement: () => ({ children: [], append(el) { this.children.push(el); }, addEventListener() {}, setAttribute() {} }) };
    const parent = doc.createElement('div'), form = createConnectionForm({ doc, parent, lang: 'en' });
    form.key.value = 'custom-opaque-form-secret';
    form.endpoint.value = 'https://user:pass@draft.test/chat/completions?token=private';
    form.model.value = 'custom-opaque-form-secret model';
    const value = form.readSelfDraft(); assert.equal(value.endpoint, 'https://draft.test/chat/completions');
    assert.equal(value.model, '[REDACTED] model'); assert.equal(value.apiKey, undefined);
    assert.equal(form.key.value, 'custom-opaque-form-secret', 'reading must not erase/edit a draft field');
    form.model.value = 'changed'; assert.equal(form.readSelfDraft().model, 'changed');
});
