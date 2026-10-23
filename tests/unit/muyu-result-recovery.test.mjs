import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcLibraryChatModule } from '../../muyu/modules/npc-library-chat/index.js';
import { createProfileLibraryChatModule } from '../../muyu/modules/profile-library-chat/index.js';
import { createAgentMemoryModule } from '../../muyu/modules/agent-memory/index.js';
import { validateJson } from '../../muyu/core/json-contract.js';
import { composeInstructions } from '../../muyu/instructions/compose.js';

const identity = { id: 'run', taskId: 'task', target: { kind: 'chat', chatKey: 'A', userKey: 'test' } };
const ctx = { runId: 'run', target: identity.target, signal: new AbortController().signal };
for (const [create, prefix] of [[createNpcLibraryChatModule, 'muyu.npc_library_chat'], [createProfileLibraryChatModule, 'muyu.library_chat']]) {
    test(`${prefix}: skipped apply is a schema-valid no-op and invalidates old candidate`, () => {
        let skip = false;
        const m = create({ port: { clearPlans() {}, prepareApply() { if (skip) throw Error('LIBRARY_NO_CHANGES'); return { name: 'test', count: 1 }; } } });
        m.bindRun(identity);
        const handler = m.handlers[prefix + '.apply_preview'];
        const old = handler({ id: 'x', revision: 'r' }, ctx);
        assert.ok(old.candidateId);
        skip = true;
        const result = handler({ id: 'x', revision: 'r', apply: true }, ctx);
        validateJson(m.registry.get(prefix + '.apply_preview').outputSchema, result);
        assert.equal(result.candidateId, ''); assert.equal(result.applyRequested, undefined);
        const detail = JSON.parse(result.text);
        assert.equal(detail.state, 'no_changes'); assert.equal(detail.writesStarted, false);
        assert.equal(detail.retryRecommended, false);
        assert.throws(() => m.publishDraft({ snapshot: () => ({ runs: [{ ...identity, status: 'succeeded' }] }) }, identity.id, old.candidateId), /INVALID_CANDIDATE_SOURCE/);
        m.dispose();
    });
    test(`${prefix}: stale and protected errors are not swallowed as no changes`, () => {
        const m = create({ port: { clearPlans() {}, prepareApply() { throw Error('STALE_LIBRARY'); } } }); m.bindRun(identity);
        assert.throws(() => m.handlers[prefix + '.apply_preview']({ id: 'x', revision: 'r' }, ctx), /STALE_LIBRARY/);
        m.dispose();
    });
}
test('Note update intent rejection gives non-retry recovery without writing or creating a duplicate', async () => {
    let saves = 0;
    const m = createAgentMemoryModule({ port: { enabled: () => true, get: async () => ({ id: 'note', revision: 1, title: '旧约定', scope: 'chat' }), save: async () => { saves++; } } });
    m.bindRun(identity, { userQuestion: '记住：简洁回答' });
    const result = await m.handlers['muyu.notes.remember']({ quote: '简洁回答', scope: 'chat', id: 'note', revision: 1 }, ctx);
    validateJson(m.registry.get('muyu.notes.remember').outputSchema, result);
    assert.equal(result.status, 'invalid_intent'); assert.equal(result.recovery.retryRecommended, false); assert.equal(saves, 0);
    m.dispose();
});
test('Unknown note save is explicit and identical same-run call does not retry', async () => {
    let saves = 0;
    const m = createAgentMemoryModule({ port: { enabled: () => true, save: async () => { saves++; throw Error('NOTE_SAVE_UNKNOWN'); } } });
    m.bindRun(identity, { userQuestion: '记住：简洁回答' });
    const args = { quote: '简洁回答', scope: 'chat' };
    const result = await m.handlers['muyu.notes.remember'](args, ctx);
    validateJson(m.registry.get('muyu.notes.remember').outputSchema, result);
    assert.equal(result.status, 'save_unknown'); assert.match(result.recovery.notice, /unconfirmed/);
    await m.handlers['muyu.notes.remember'](args, ctx); assert.equal(saves, 1); m.dispose();
});
test('Evidence/recovery instructions remain bounded and do not authorize semantic note updates', () => {
    const value = composeInstructions('assistant');
    assert.ok(value.base.length <= 4000 && value.task.length <= 4000);
    assert.match(value.task, /上限增大是放宽容量/);
    assert.match(value.task, /不代表必须四次批准/);
    assert.match(value.base, /语义相似不授权更新/);
    assert.doesNotMatch(value.base, /有则按id\/revision更新/);
});
