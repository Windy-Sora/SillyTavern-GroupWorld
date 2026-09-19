import assert from 'node:assert/strict';
import test from 'node:test';
import { createCritiqueSystem } from '../../systems/critique-system.js';

function deferred() {
    let resolve;
    const promise = new Promise(ok => { resolve = ok; });
    return { promise, resolve };
}

function harness() {
    const settings = { critiqueEnabled: true, critiqueReusePrevious: true, lang: 'en', agentConfigs: {} };
    let metadata = {};
    let chat = [];
    let response = '{"directorCritique":{"pacing":"good"},"characterCritiques":{"Alice":{"consistency":"good"}}}';
    let saves = 0;
    let save = async () => {};
    const system = createCritiqueSystem({
        settings,
        getChatMetadata: () => metadata,
        getChat: () => chat,
        EXT_KEY: 'gd',
        saveChatConditional: async () => { saves++; await save(); },
        generateRaw: async () => '',
        inject_ids: { QUIET_PROMPT: 'quiet' },
        extension_prompt_types: { IN_PROMPT: 'prompt' },
        setExtensionPrompt: () => {},
        log: () => {},
        createCaller: () => ({ generate: prompt => typeof response === 'function' ? response(prompt) : response }),
    });
    return {
        system, settings,
        get metadata() { return metadata; }, set metadata(value) { metadata = value; },
        get chat() { return chat; }, set chat(value) { chat = value; },
        set response(value) { response = value; },
        set save(value) { save = value; },
        saves: () => saves,
    };
}

test('critique system generates validated history and reuses previous coverage', async () => {
    const h = harness();
    h.chat = [{ name: 'User', mes: 'hello' }, { name: 'Alice', mes: 'hi' }];
    const first = await h.system.generateCritique();
    assert.equal(first.rangeEnd, 2);
    assert.equal(h.system.getActiveDirectorCritiqueText(), '[pacing] good');
    h.chat.push({ name: 'Bob', mes: 'welcome' });
    h.response = prompt => {
        assert.match(prompt, /\[Previous critique\]/);
        assert.match(prompt, /Bob: welcome/);
        return 'plain critique';
    };
    const second = await h.system.generateCritique();
    assert.equal(second.basedOn, 0);
    assert.equal(second.data.directorCritique.pacing, 'plain critique');
    await h.system.revertLastCritique();
    assert.equal(h.system.getLatestActive(), first);
});

test('generation reports stale when chat switches during result save', async () => {
    const h = harness();
    const gate = deferred();
    h.chat = [{ name: 'User', mes: 'old' }];
    h.save = () => gate.promise;
    const oldMetadata = h.metadata;
    const pending = h.system.generateCritique();
    while (h.saves() === 0) await Promise.resolve();
    h.metadata = {};
    h.chat = [{ name: 'User', mes: 'new' }];
    gate.resolve();
    await assert.rejects(pending, { name: 'StaleExecutionError' });
    assert.equal(oldMetadata.gd.critiques.length, 1);
});

test('regeneration reports stale when chat switches during result save', async () => {
    const h = harness();
    h.chat = [{ name: 'User', mes: 'old' }];
    await h.system.generateCritique();
    const gate = deferred();
    h.save = () => gate.promise;
    const oldMetadata = h.metadata;
    const pending = h.system.regenerateLastCritique();
    while (h.saves() < 2) await Promise.resolve();
    h.metadata = {};
    h.chat = [{ name: 'User', mes: 'new' }];
    gate.resolve();
    await assert.rejects(pending, { name: 'StaleExecutionError' });
    assert.equal(oldMetadata.gd.critiques.length, 1);
});

test('critique system rejects stale generation results after a chat switch', async () => {
    const h = harness();
    const pending = deferred();
    h.chat = [{ name: 'User', mes: 'old chat' }];
    h.response = () => pending.promise;
    const generation = h.system.generateCritique();
    await Promise.resolve();
    h.metadata = {};
    h.chat = [{ name: 'User', mes: 'new chat' }];
    pending.resolve('{"directorCritique":{},"characterCritiques":{}}');
    await assert.rejects(generation, error => error.name === 'StaleExecutionError');
    assert.equal(h.system.getCritiques().length, 0);
    assert.equal(h.saves(), 0);
});

test('critique generation keeps start coverage on append and rejects covered message edits', async () => {
    const h = harness();
    let pending = deferred();
    h.chat = [{ name: 'User', mes: 'first' }];
    h.response = () => pending.promise;
    const generation = h.system.generateCritique();
    await Promise.resolve();
    h.chat.push({ name: 'Alice', mes: 'second' });
    pending.resolve('{"directorCritique":{},"characterCritiques":{}}');
    const entry = await generation;
    assert.equal(entry.rangeEnd, 1);

    const edited = harness();
    pending = deferred();
    edited.chat = [{ name: 'User', mes: 'original' }];
    edited.response = () => pending.promise;
    const stale = edited.system.generateCritique();
    await Promise.resolve();
    edited.chat[0].mes = 'edited';
    pending.resolve('{"directorCritique":{},"characterCritiques":{}}');
    await assert.rejects(stale, { name: 'StaleExecutionError' });
    assert.equal(edited.saves(), 0);
});

test('ordinary generation records and reuses the prompt actually sent', async () => {
    const h = harness();
    h.settings.critiquePrompt = 'prompt A';
    h.chat = [{ name: 'User', mes: 'one' }];
    const pending = deferred();
    const sentPrompts = [];
    h.response = prompt => {
        sentPrompts.push(prompt);
        return sentPrompts.length === 1
            ? pending.promise
            : '{"directorCritique":{"pacing":"regenerated"},"characterCritiques":{}}';
    };
    const generation = h.system.generateCritique();
    await Promise.resolve();
    h.settings.critiquePrompt = 'prompt B';
    pending.resolve('{"directorCritique":{"pacing":"generated"},"characterCritiques":{}}');

    const entry = await generation;
    await h.system.regenerateLastCritique();
    assert.match(sentPrompts[0], /^prompt A/);
    assert.equal(entry.promptUsed, 'prompt A');
    assert.match(sentPrompts[1], /^prompt A/);
});

test('ordinary generation records and reuses the resolved default prompt', async () => {
    const h = harness();
    h.settings.critiquePrompt = '';
    h.settings.lang = 'en';
    h.chat = [{ name: 'User', mes: 'one' }];
    const pending = deferred();
    const sentPrompts = [];
    h.response = prompt => {
        sentPrompts.push(prompt);
        return sentPrompts.length === 1
            ? pending.promise
            : '{"directorCritique":{"pacing":"regenerated"},"characterCritiques":{}}';
    };
    const generation = h.system.generateCritique();
    await Promise.resolve();
    h.settings.critiquePrompt = 'prompt B';
    pending.resolve('{"directorCritique":{"pacing":"generated"},"characterCritiques":{}}');

    const entry = await generation;
    await h.system.regenerateLastCritique();
    assert.match(sentPrompts[0], /^You are an objective group-chat critique system\./);
    assert.match(entry.promptUsed, /^You are an objective group-chat critique system\./);
    assert.match(sentPrompts[1], /^You are an objective group-chat critique system\./);
});

test('regeneration updates the active predecessor after a revert', async () => {
    const h = harness();
    h.chat = [{ name: 'User', mes: 'one' }];
    const first = await h.system.generateCritique();
    h.chat.push({ name: 'Alice', mes: 'two' });
    await h.system.generateCritique();
    await h.system.revertLastCritique();
    assert.equal(h.system.getLatestActive(), first);
    h.response = '{"directorCritique":{"pacing":"regenerated active"},"characterCritiques":{}}';
    const regenerated = await h.system.regenerateLastCritique();
    assert.equal(regenerated, first);
    assert.equal(h.system.getLatestActive().data.directorCritique.pacing, 'regenerated active');
});

test('regeneration rejects covered edits and records the prompt actually sent', async () => {
    const h = harness();
    h.settings.critiquePrompt = 'original prompt';
    h.chat = [{ name: 'User', mes: 'original' }];
    await h.system.generateCritique();
    let pending = deferred();
    let sentPrompt = '';
    h.response = prompt => {
        sentPrompt = prompt;
        return pending.promise;
    };
    const regeneration = h.system.regenerateLastCritique();
    await Promise.resolve();
    h.settings.critiquePrompt = 'changed while waiting';
    pending.resolve('{"directorCritique":{"pacing":"regenerated"},"characterCritiques":{}}');
    const regenerated = await regeneration;
    assert.match(sentPrompt, /^original prompt/);
    assert.equal(regenerated.promptUsed, 'original prompt');

    const edited = harness();
    edited.chat = [{ name: 'User', mes: 'original' }];
    await edited.system.generateCritique();
    pending = deferred();
    edited.response = () => pending.promise;
    const stale = edited.system.regenerateLastCritique();
    await Promise.resolve();
    edited.chat[0].mes = 'edited while regenerating';
    pending.resolve('{"directorCritique":{"pacing":"stale"},"characterCritiques":{}}');
    await assert.rejects(stale, { name: 'StaleExecutionError' });
    assert.equal(edited.system.getLatestActive().data.directorCritique.pacing, 'good');
    assert.equal(edited.saves(), 1);
});

test('a saved manual edit wins over an older in-flight regeneration', async () => {
    const h = harness();
    h.chat = [{ name: 'User', mes: 'unchanged chat' }];
    await h.system.generateCritique();
    const pending = deferred();
    h.response = () => pending.promise;
    const regeneration = h.system.regenerateLastCritique();
    await Promise.resolve();

    await h.system.updateActiveContent('{"directorCritique":{"pacing":"manual edit"},"characterCritiques":{}}');
    pending.resolve('{"directorCritique":{"pacing":"regenerated stale"},"characterCritiques":{}}');

    await assert.rejects(regeneration, { name: 'StaleExecutionError' });
    assert.equal(h.system.getLatestActive().data.directorCritique.pacing, 'manual edit');
    assert.equal(h.saves(), 2);
});

test('a saved manual edit invalidates ordinary generation from the older critique', async () => {
    const h = harness();
    h.chat = [{ name: 'User', mes: 'one' }];
    const original = await h.system.generateCritique();
    h.chat.push({ name: 'Alice', mes: 'two' });
    const pending = deferred();
    h.response = () => pending.promise;
    const generation = h.system.generateCritique();
    await Promise.resolve();

    await h.system.updateActiveContent('{"directorCritique":{"pacing":"manual edit"},"characterCritiques":{}}');
    pending.resolve('{"directorCritique":{"pacing":"stale generation"},"characterCritiques":{}}');

    await assert.rejects(generation, { name: 'StaleExecutionError' });
    assert.equal(h.system.getLatestActive(), original);
    assert.equal(original.data.directorCritique.pacing, 'manual edit');
    assert.equal(h.system.getCritiques().length, 1);
    assert.equal(h.saves(), 2);
});

test('revert and reset invalidate ordinary generation from an obsolete active critique', async () => {
    for (const mutation of ['revert', 'reset']) {
        const h = harness();
        h.chat = [{ name: 'User', mes: 'one' }];
        const first = await h.system.generateCritique();
        h.chat.push({ name: 'Alice', mes: 'two' });
        await h.system.generateCritique();
        h.chat.push({ name: 'Bob', mes: 'three' });
        const pending = deferred();
        h.response = () => pending.promise;
        const generation = h.system.generateCritique();
        await Promise.resolve();

        if (mutation === 'revert') await h.system.revertLastCritique();
        else await h.system.resetAll();
        pending.resolve('{"directorCritique":{"pacing":"stale generation"},"characterCritiques":{}}');

        await assert.rejects(generation, { name: 'StaleExecutionError' });
        assert.equal(h.system.getCritiques().length, 2);
        assert.equal(h.system.getLatestActive(), mutation === 'revert' ? first : null);
        assert.equal(h.saves(), 3);
    }
});

test('reverting the active critique invalidates its in-flight regeneration', async () => {
    const h = harness();
    h.chat = [{ name: 'User', mes: 'one' }];
    const first = await h.system.generateCritique();
    h.chat.push({ name: 'Alice', mes: 'two' });
    await h.system.generateCritique();
    const pending = deferred();
    h.response = () => pending.promise;
    const regeneration = h.system.regenerateLastCritique();
    await Promise.resolve();

    await h.system.revertLastCritique();
    pending.resolve('{"directorCritique":{"pacing":"regenerated stale"},"characterCritiques":{}}');

    await assert.rejects(regeneration, { name: 'StaleExecutionError' });
    assert.equal(h.system.getLatestActive(), first);
    assert.equal(h.saves(), 3);
});

test('critique result editing is validated and persisted through the system boundary', async () => {
    const h = harness();
    h.chat = [{ name: 'User', mes: 'hello' }];
    await h.system.generateCritique();
    await h.system.updateActiveContent('{"directorCritique":{"pacing":"edited"},"characterCritiques":{}}');
    assert.equal(h.system.getLatestActive().data.directorCritique.pacing, 'edited');
    await assert.rejects(h.system.updateActiveContent('{"directorCritique":[],"characterCritiques":{}}'), /Invalid critique content/);
    assert.equal(h.system.getLatestActive().data.directorCritique.pacing, 'edited');
});
