import assert from 'node:assert/strict';
import test from 'node:test';
import { createVariableSystem } from '../../systems/variable-system.js';

function createSubject() {
    const chatMetadata = {};
    let saves = 0;
    const characters = [
        { avatar: 'alice.png', name: 'Alice' },
        { avatar: 'bob.png', name: 'Bob' },
        { avatar: 'eve.png', name: 'Eve' },
    ];
    const subject = createVariableSystem({
        chat_metadata: chatMetadata,
        EXT_KEY: 'group-director',
        getChatMetadata: () => chatMetadata,
        saveChatConditional: () => { saves += 1; },
        getCharacters: () => characters,
        getCurrentGroup: () => ({ members: ['alice.png', 'bob.png'], disabled_members: ['bob.png'] }),
        getChat: () => [{ mes: 'A fresh message' }],
        getLang: () => 'en',
        log: () => {},
    });
    return { subject, chatMetadata, getSaves: () => saves };
}

test('variable system applies typed updates, clamps deltas, and respects active group members', () => {
    const { subject, getSaves } = createSubject();
    subject.upsertDefinition({ id: 'funds', label: 'Funds', type: 'number', updateMode: 'delta', min: 0, max: 100, value: 10 });
    subject.upsertDefinition({ id: 'trust', label: 'Trust', scope: 'character', type: 'number', updateMode: 'delta', min: 0, max: 100, value: 50 });

    const result = subject.applyUpdates({
        global: { funds: { value: '+200', reason: 'reward' } },
        character: {
            Alice: { trust: { value: '-60', reason: 'argument' } },
            Bob: { trust: { value: '+10', reason: 'disabled member' } },
        },
    });

    assert.deepEqual(result, {
        applied: 2,
        ignored: 1,
        errors: ['trust: unknown character target "Bob"'],
    });
    assert.equal(subject.getValue(subject.getDefinition('funds')), 100);
    assert.equal(subject.getValue(subject.getDefinition('trust'), 'Alice'), 0);
    assert.equal(subject.getValue(subject.getDefinition('trust'), 'Bob'), 50);
    assert.ok(getSaves() >= 4);
});

test('variable system refuses automatic updates to locked or manual variables without corrupting values', () => {
    const { subject } = createSubject();
    subject.upsertDefinition({ id: 'locked_note', type: 'string', value: 'keep', locked: true });
    subject.upsertDefinition({ id: 'manual_note', type: 'string', value: 'keep', autoUpdate: false });

    const result = subject.applyUpdates({
        global: {
            locked_note: { value: 'replace' },
            manual_note: { value: 'replace' },
            missing: { value: 'ignored' },
        },
    });

    assert.deepEqual(result, { applied: 0, ignored: 3, errors: [] });
    assert.equal(subject.getValue(subject.getDefinition('locked_note')), 'keep');
    assert.equal(subject.getValue(subject.getDefinition('manual_note')), 'keep');
});

test('variable exports and imports preserve definitions and isolate imported data', async () => {
    const { subject } = createSubject();
    subject.upsertDefinition({ id: 'inventory', type: 'array', updateMode: 'append', value: [] });
    subject.setValue('inventory', ['key']);

    const exported = subject.buildExportFile();
    exported.variables.values.global.inventory.push('mutated outside');
    assert.deepEqual(subject.getValue(subject.getDefinition('inventory')), ['key']);

    const { subject: target } = createSubject();
    const imported = await target.applyImportData(subject.buildExportFile(), { mode: 'replace' });
    assert.deepEqual(imported, { ok: true, count: 1 });
    assert.deepEqual(target.getValue(target.getDefinition('inventory')), ['key']);
    assert.deepEqual(await target.applyImportData({ type: 'wrong' }), { ok: false, error: 'Not a variables export file' });
});
