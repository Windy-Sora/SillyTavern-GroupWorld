import assert from 'node:assert/strict';
import test from 'node:test';
import { createCritiqueRepository } from '../../systems/critique-repository.js';

function subject(entries = [], save = async () => {}) {
    const metadata = { gd: { critiques: entries } };
    return { metadata, repository: createCritiqueRepository({ getChatMetadata: () => metadata, EXT_KEY: 'gd', saveChatConditional: save }) };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

test('critique repository owns activation, revert, reset, and prune invariants', async () => {
    const first = { rangeEnd: 2, active: true, basedOn: null };
    const { metadata, repository } = subject([first]);
    const second = { rangeEnd: 5, active: true, basedOn: 0 };
    await repository.add(second);
    assert.equal(first.active, false);
    assert.equal(repository.getLatestActive(), second);
    await repository.revert();
    assert.equal(first.active, true);
    assert.equal(second.active, false);
    second.active = true;
    first.active = false;
    await repository.prune(3);
    assert.equal(first.active, true);
    assert.equal(second.active, false);
    await repository.reset();
    assert.equal(metadata.gd.critiques.some(item => item.active), false);
});

test('critique repository rolls live state back when persistence fails', async () => {
    const first = { rangeEnd: 2, active: true, basedOn: null };
    const { repository } = subject([first], async () => { throw new Error('disk unavailable'); });
    await assert.rejects(repository.add({ rangeEnd: 3, active: true, basedOn: 0 }), /disk unavailable/);
    assert.deepEqual(repository.getCritiques(), [first]);
    assert.equal(first.active, true);
});

test('failed add removes its own entry without discarding a concurrent add', async () => {
    const pendingSave = deferred();
    let saves = 0;
    const first = { active: true };
    const { repository } = subject([first], () => ++saves === 1 ? pendingSave.promise : Promise.resolve());
    const failed = { active: true };
    const pending = repository.add(failed);
    const later = { active: true };
    await repository.add(later);
    pendingSave.reject(new Error('disk unavailable'));
    await assert.rejects(pending, /disk unavailable/);
    assert.deepEqual(repository.getCritiques(), [first, later]);
    assert.equal(first.active, false);
    assert.equal(later.active, true);
});

test('failed update preserves a newer update to the same critique', async () => {
    const pendingSave = deferred();
    let saves = 0;
    const entry = { active: true, content: 'before' };
    const { repository } = subject([entry], () => ++saves === 1 ? pendingSave.promise : Promise.resolve());
    const pending = repository.update(entry, { content: 'failed' });
    await repository.update(entry, { content: 'newer' });
    pendingSave.reject(new Error('disk unavailable'));
    await assert.rejects(pending, /disk unavailable/);
    assert.equal(entry.content, 'newer');
});

test('failed content update rolls back despite a concurrent active-flag change', async () => {
    const pendingSave = deferred();
    let saves = 0;
    const entry = { active: true, content: 'before' };
    const { repository } = subject([entry], () => ++saves === 1 ? pendingSave.promise : Promise.resolve());
    const pending = repository.update(entry, { content: 'failed' });
    await repository.reset();
    pendingSave.reject(new Error('disk unavailable'));
    await assert.rejects(pending, /disk unavailable/);
    assert.equal(entry.content, 'before');
    assert.equal(entry.active, false);
});

test('failed add restores an old active flag despite a concurrent content edit', async () => {
    const pendingSave = deferred();
    let saves = 0;
    const first = { active: true, content: 'before' };
    const { repository } = subject([first], () => ++saves === 1 ? pendingSave.promise : Promise.resolve());
    const pending = repository.add({ active: true });
    await repository.update(first, { content: 'newer' });
    pendingSave.reject(new Error('disk unavailable'));
    await assert.rejects(pending, /disk unavailable/);
    assert.equal(first.active, true);
    assert.equal(first.content, 'newer');
});

test('failed reset does not reactivate entries after a newer reset', async () => {
    const pendingSave = deferred();
    let saves = 0;
    const entry = { active: true };
    const { repository } = subject([entry], () => ++saves === 1 ? pendingSave.promise : Promise.resolve());
    const pending = repository.reset();
    await repository.reset();
    pendingSave.reject(new Error('disk unavailable'));
    await assert.rejects(pending, /disk unavailable/);
    assert.equal(entry.active, false);
});

test('failed revert does not overwrite a newer reset', async () => {
    const pendingSave = deferred();
    let saves = 0;
    const first = { active: false, basedOn: null };
    const second = { active: true, basedOn: 0 };
    const { repository } = subject([first, second], () => ++saves === 1 ? pendingSave.promise : Promise.resolve());
    const pending = repository.revert();
    await repository.reset();
    pendingSave.reject(new Error('disk unavailable'));
    await assert.rejects(pending, /disk unavailable/);
    assert.equal(first.active, false);
    assert.equal(second.active, false);
});

test('failed prune does not overwrite a newer reset', async () => {
    const pendingSave = deferred();
    let saves = 0;
    const first = { active: false, rangeEnd: 1 };
    const second = { active: true, rangeEnd: 4, basedOn: 0 };
    const { repository } = subject([first, second], () => ++saves === 1 ? pendingSave.promise : Promise.resolve());
    const pending = repository.prune(2);
    await repository.reset();
    pendingSave.reject(new Error('disk unavailable'));
    await assert.rejects(pending, /disk unavailable/);
    assert.equal(first.active, false);
    assert.equal(second.active, false);
});
