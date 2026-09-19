import test from 'node:test';
import assert from 'node:assert/strict';

import { createVariableSystem } from '../../systems/variable-system.js';

function fixture() {
    const metadata = {};
    const chat = [{ name: 'Alice', mes: 'Original', is_user: false, is_system: false }];
    const characters = [{ avatar: 'alice.png', name: 'Alice' }];
    const logs = [];
    const system = createVariableSystem({
        chat_metadata: metadata,
        getChatMetadata: () => metadata,
        EXT_KEY: 'gd',
        saveChatConditional: () => {},
        getCharacters: () => characters,
        getCurrentGroup: () => ({ members: ['alice.png'], disabled_members: [] }),
        getChat: () => chat,
        getLang: () => 'en',
        log: (...args) => logs.push(args),
    });
    return { system, metadata, chat, logs };
}

test('variable logs capture message provenance and detect changed or deleted source messages', () => {
    const { system, chat } = fixture();
    system.upsertDefinition({ id: 'phase', type: 'string', value: 'start' });
    system.setValue('phase', 'middle', { source: 'director', reason: 'scene changed' });
    let status = system.getValueStatus('phase');
    assert.equal(status.stale, false);
    assert.equal(status.latest.messageId, 0);
    assert.equal(status.latest.chatLength, 1);
    assert.equal(status.latest.reason, 'scene changed');

    chat[0].mes = 'Edited';
    assert.deepEqual(system.getValueStatus('phase').reason, 'message-changed');
    chat.splice(0);
    assert.deepEqual(system.getValueStatus('phase').reason, 'message-missing');
});

test('manual logs never become stale and unknown definitions have neutral status', () => {
    const { system, chat } = fixture();
    system.upsertDefinition({ id: 'phase', type: 'string' });
    system.setValue('phase', 'manual', { source: 'manual' });
    chat.splice(0);
    assert.deepEqual(system.getValueStatus('phase'), {
        stale: false,
        reason: '',
        latest: system.getLog().at(-1),
    });
    assert.deepEqual(system.getValueStatus('missing'), { stale: false, reason: '', latest: null });
});

test('variable rollback restores the latest old value for global and character targets', () => {
    const { system } = fixture();
    system.upsertDefinition({ id: 'phase', type: 'string', value: 'start' });
    system.setValue('phase', 'middle', { source: 'director' });
    assert.deepEqual(system.revertValue('phase'), { ok: true, value: 'start' });
    assert.equal(system.getValue('phase'), 'start');

    system.upsertDefinition({ id: 'trust', scope: 'character', type: 'number', value: 50 });
    system.setValue('trust', 75, { target: 'Alice', source: 'director' });
    assert.equal(system.getValueStatus('trust', 'alice.png').latest.target, 'alice.png');
    assert.deepEqual(system.revertValue('trust', 'ALICE'), { ok: true, value: 50 });
    assert.equal(system.getValue('trust', 'Alice'), 50);
    assert.equal(system.revertValue('missing').error, 'unknown variable');
});

test('rollback reports missing records and invalid character targets', () => {
    const { system } = fixture();
    system.upsertDefinition({ id: 'phase', type: 'string' });
    assert.equal(system.revertValue('phase').error, 'no previous record');
    system.upsertDefinition({ id: 'trust', scope: 'character', type: 'number' });
    assert.equal(system.revertValue('trust', 'Missing').error, 'unknown character target');
});

test('automatic updates log ignored values and report malformed character targets', () => {
    const { system, logs } = fixture();
    system.upsertDefinition({ id: 'locked', type: 'string', value: 'keep', locked: true });
    system.upsertDefinition({ id: 'trust', scope: 'character', type: 'number', value: 50 });
    assert.deepEqual(system.applyUpdates(null), { applied: 0, ignored: 0, errors: [] });
    const result = system.applyUpdates({
        global: { locked: { value: 'replace', reason: 'bad' }, missing: 'ignored' },
        character: { Nobody: { trust: { value: 10, reason: 'unknown' } }, Alice: null },
    });
    assert.deepEqual(result, {
        applied: 0,
        ignored: 3,
        errors: ['trust: unknown character target "Nobody"'],
    });
    assert.equal(system.getLog().filter(entry => entry.ignored).length, 2);
    assert.equal(system.getValueStatus('locked').latest, null);
    assert.equal(logs.length, 1);
});

test('variable history keeps only the latest one hundred entries', () => {
    const { system } = fixture();
    system.upsertDefinition({ id: 'counter', type: 'number', value: 0 });
    for (let index = 1; index <= 105; index++) system.setValue('counter', index);
    const log = system.getLog();
    assert.equal(log.length, 100);
    assert.equal(log[0].newValue, 6);
    assert.equal(log.at(-1).newValue, 105);
});
