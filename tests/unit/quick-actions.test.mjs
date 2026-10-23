import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuickActions, getQuickActions, quickResultText } from '../../ui/quick-actions.js';
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
function fixture() {
    let chat = [], metadata = {}, group = { id: 1, members: ['a', 'b', 'c'], disabled_members: ['c'] };
    const calls = [];
    const deps = {
        settings: { lang: 'zh', mode: 'formula', topN: 1, llmMaxSpeakers: 3, profileEnabled: true, memoryEnabled: true, summaryEnabled: true, storyBlueprintEnabled: true },
        getChat: () => chat, getChatMetadata: () => metadata, getCurrentGroup: () => group,
        saveSettings() { calls.push('save'); }, isRoundActive: () => false,
        memorySystem: { async generateForCharacter(a) { calls.push(a); return [{}]; } },
        summarySystem: { async generateSummary() { calls.push('summary'); return { rangeEnd: 8 }; } },
        storyBlueprintSystem: { getBlueprint: () => ({}), async generateBlueprint(mode) { calls.push(mode); } },
        detectCharacterChanges() { calls.push('profiles'); },
    };
    return { deps, calls, actions: createQuickActions(deps), switchChat() { chat = []; metadata = {}; group = { ...group, id: group.id + 1 }; }, noGroup() { group = null; } };
}
test('quick actions reject disabled/non-group/locked contexts without implicit activation or generation', async () => {
    const f = fixture(); f.deps.settings.summaryEnabled = false;
    assert.equal((await f.actions.run('summary')).reason, 'disabled');
    assert.equal(f.deps.settings.summaryEnabled, false); assert.deepEqual(f.calls, []);
    f.noGroup(); assert.equal((await f.actions.run('memory')).reason, 'no-group');
    const g = fixture(); g.deps.isRoundActive = () => true;
    assert.equal((await g.actions.run('blueprint')).reason, 'round-active');
});
test('shared action instance survives rebuild and prevents duplicate and overlapping starts', async () => {
    const f = fixture(), wait = deferred();
    f.deps.summarySystem.generateSummary = () => { f.calls.push('summary'); return wait.promise; };
    const actions = getQuickActions(f.deps), first = actions.run('summary');
    assert.equal(actions.state('summary').status, 'running');
    const rebuilt = getQuickActions({ ...f.deps }); assert.equal(rebuilt, actions);
    assert.equal((await rebuilt.run('summary')).reason, 'busy');
    assert.equal((await rebuilt.run('memory')).reason, 'busy');
    wait.resolve({ rangeEnd: 4 }); assert.equal((await first).status, 'success');
    assert.deepEqual(f.calls, ['summary']);
});
test('batch reports partial and total failure from actual outcomes, skipping disabled members', async () => {
    const f = fixture(); f.deps.memorySystem.generateForCharacter = async a => { f.calls.push(a); if (a === 'b') throw Error('rejected'); return [{}]; };
    const result = await f.actions.run('memory');
    assert.equal(result.status, 'partial'); assert.equal(result.done, 1); assert.equal(result.failed, 1);
    assert.deepEqual(f.calls, ['a', 'b']); assert.match(quickResultText(result), /1 个成功，1 个失败/);
    f.deps.memorySystem.generateForCharacter = async () => { throw Error('failed'); };
    assert.equal((await f.actions.run('memory')).status, 'failed');
});
test('chat switching during batch stops remaining members and hides old result from the new chat', async () => {
    const f = fixture(), wait = deferred();
    f.deps.memorySystem.generateForCharacter = a => { f.calls.push(a); return wait.promise; };
    const work = f.actions.run('memory'); f.switchChat();
    assert.equal(f.actions.state('memory'), null);
    wait.resolve([]); const result = await work;
    assert.equal(result.status, 'stale'); assert.equal(f.actions.isCurrent(result), false);
    assert.deepEqual(f.calls, ['a']); assert.equal(f.actions.state('memory'), null);
});
test('errors settle the lock and listeners unsubscribe without cancelling the task', async () => {
    const f = fixture(); let notifications = 0;
    const off = f.actions.subscribe(() => notifications++);
    f.deps.summarySystem.generateSummary = async () => { throw Error('save rejected'); };
    const result = await f.actions.run('summary');
    assert.equal(result.status, 'failed'); assert.equal(quickResultText(result), 'save rejected');
    assert.equal(f.actions.unavailable('memory'), null); assert.ok(notifications >= 2);
    off(); const count = notifications; await f.actions.run('profiles'); assert.equal(notifications, count);
});
test('mode and speaker edits share validation and never modify the other mode limit', () => {
    const f = fixture();
    assert.equal(f.actions.setMode('wrong'), false);
    assert.equal(f.actions.setSpeakers('0'), false); assert.equal(f.actions.setSpeakers('2.5'), false);
    assert.equal(f.actions.setSpeakers('4', 'llm'), true);
    assert.equal(f.deps.settings.topN, 1); assert.equal(f.deps.settings.llmMaxSpeakers, 4);
    assert.equal(f.actions.setMode('off'), true); assert.equal(f.actions.setSpeakers(2), false);
    f.deps.isRoundActive = () => true; assert.equal(f.actions.setMode('formula'), false);
});
