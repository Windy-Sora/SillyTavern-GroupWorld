import test from 'node:test';
import assert from 'node:assert/strict';
import { createDirectorModule } from '../../muyu/modules/director/index.js';
import { createContextModule } from '../../muyu/modules/context/index.js';
import { validateJson } from '../../muyu/core/json-contract.js';

function fixture() {
    let target = { kind: 'chat', userKey: 'test', chatKey: 'A' };
    const settings = { mode: 'formula', topN: 1, llmMaxSpeakers: 3, consecutivePenalty: 15, llmPrompt: 'PRIVATE' };
    const entry = { speakers: ['PRIVATE'], _chatLength: 12 };
    Object.defineProperty(entry, 'reason', { get() { throw Error('Reason body must not be read'); } });
    const metadata = { gd: { directorHistory: [entry] } };
    const ports = { extensionKey: 'gd', getTarget: () => target, getSettings: () => settings, getMetadata: () => metadata,
        getGroup: () => ({ members: ['PRIVATE', 'DISABLED'], disabled_members: ['DISABLED'] }),
        getGuards: () => ({ roundActive: false, takeoverRemaining: 0, takeoverPending: false, takeoverFailed: false }) };
    const module = createDirectorModule({ ports });
    const ctx = { target: { ...target }, runId: 'r', signal: new AbortController().signal };
    return { module, ports, settings, metadata, ctx, switchTarget: () => { target = { ...target, chatKey: 'B' }; }, read: () => module.handlers['muyu.director.inspect']({}, ctx) };
}
test('Director projection reads only whitelist and history structure, including editable/empty/missing history', () => {
    const f = fixture(), r = f.read();
    validateJson(f.module.registry.get('muyu.director.inspect').outputSchema, r);
    assert.equal(r.state.mode, 'formula'); assert.equal(r.state.enabledMembers, 1); assert.equal(r.state.reasonFieldPresent, 'on');
    assert.doesNotMatch(JSON.stringify(r), /PRIVATE|DISABLED|llmPrompt/);
    assert.ok(r.findings.some(x => x.code === 'HISTORY_LIMIT'));
    assert.equal(r.presentation.find(x => x.field === 'roundActive').kind, 'runtime');
    assert.doesNotMatch(r.findings.map(x => x.text).join(' '), /formula|reason/);
    f.metadata.gd.directorHistory = [{}]; assert.equal(f.read().state.lastSpeakerCount, -1);
    delete f.metadata.gd.directorHistory; assert.ok(f.read().findings.some(x => x.code === 'NO_HISTORY'));
    f.module.dispose();
});
test('Director facts handle off/LLM/non-group and never claim historical causation', () => {
    const f = fixture(); f.settings.mode = 'off'; assert.ok(f.read().findings.some(x => x.code === 'DIRECTOR_OFF'));
    assert.doesNotMatch(f.read().findings.find(x => x.code === 'CURRENT_MODE').text, /模型仍可少选/);
    f.settings.mode = 'llm'; assert.equal(f.read().state.llmMaxSpeakers, 3);
    f.ports.getGroup = () => ({ members: ['a', 'b', 'c'] });
    const sameLimit = f.read();
    assert.equal(sameLimit.state.enabledMembers, sameLimit.state.llmMaxSpeakers);
    assert.match(sameLimit.findings.find(x => x.code === 'CURRENT_MODE').text, /不代表每轮全选/);
    f.ports.getGroup = () => null; assert.ok(f.read().findings.some(x => x.code === 'NO_GROUP'));
    assert.ok(f.read().findings.some(x => x.code === 'NO_CHARACTER_EVIDENCE')); f.module.dispose();
});
test('Director rejects wrong target, settings races and publication after changed evidence', () => {
    const f = fixture(); f.read(); f.settings.topN = 2;
    assert.throws(() => f.module.publishReport({}, 'r'), /STALE_EVIDENCE/);
    f.switchTarget(); assert.throws(f.read, /TARGET_UNAVAILABLE/); f.module.dispose();
    const g = fixture(); let count = 0; g.ports.getSettings = () => ({ mode: 'formula', topN: ++count });
    assert.throws(g.read, /STALE_EVIDENCE/); g.module.dispose();
});
test('Context catalog covers implemented static documents, resolves exact IDs and reports omissions', () => {
    const m = createContextModule(), list = m.handlers['muyu.context.list'](); assert.equal(list.length, 7);
    assert.ok(list.every(d => !Object.hasOwn(d, 'text')));
    const out = m.handlers['muyu.context.read']({ ids: ['director.scoring', 'memory.automation', '../../private'] });
    assert.equal(out.complete, false); assert.equal(out.documents.length, 2); assert.deepEqual(out.missing, ['../../private']);
    validateJson(m.registry.get('muyu.context.read').outputSchema, out); m.dispose();
});
