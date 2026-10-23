import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderPort } from '../../muyu/host/providers.js';
import { createProviderModule } from '../../muyu/modules/providers/index.js';
import { createPermissions } from '../../muyu/application/permissions.js';
import { assistantToolAccess } from '../../muyu/application/capabilities.js';

function fixture() {
    const target = { kind: 'chat', userKey: 'u', chatKey: 'a' };
    let current = target;
    const ctx = {
        characterId: 0,
        characters: [
            { avatar: 'private-alice.png', name: 'Alice', data: { description: 'PRIVATE_CARD' } },
            { avatar: 'private-bob.png', name: 'Bob', data: { description: 'PRIVATE_OTHER_CARD' } },
        ],
        groups: [{ id: 'private-group-id', name: 'Friends', members: ['private-alice.png', 'private-bob.png'], secret: 'PRIVATE_GROUP' }],
        chat: [{ mes: 'PRIVATE_MESSAGE' }],
    };
    const port = createProviderPort({ getContext: () => ctx, getSettings: () => ({}), extensionKey: 'gd', bindings: [], getProviders: () => [] });
    const module = createProviderModule({ providerPort: port, currentTarget: () => current });
    const read = (id, selector = '', revision = '', runId = 'r') => module.handlers['muyu.provider.read']({ id, selector, revision, offset: 0 }, { runId, target });
    return { ctx, port, module, target, read, switchChat: () => { current = { ...target, chatKey: 'b' }; } };
}

test('ST source grants are exact and old GD grants cannot read ST directories', () => {
    const f = fixture(), permissions = createPermissions();
    const access = id => assistantToolAccess({ id: 'muyu.provider.read', effect: 'read' }, { id }, f.target, 'task', permissions, f.port);
    permissions.grant('chat', f.target);
    assert.deepEqual(access('stCharacters').missingSources, ['source:stCharacters']);
    permissions.decide({ source: 'stCharacters', reason: 'Find character names', target: f.target, taskId: 'task' }, 'task', () => {});
    assert.equal(access('stCharacters').decision, true);
    assert.deepEqual(access('stGroups').missingSources, ['source:stGroups']);
    assert.deepEqual(access('stChat').missingSources, ['source:stChat']);
    f.module.dispose();
});

test('ST chat overview and bounded name search expose no card, message or raw identifiers', () => {
    const f = fixture();
    const chat = f.read('stChat');
    assert.match(chat.text, /type=character/);
    assert.match(chat.text, /name="Alice"/);
    assert.match(chat.text, /messages=1/);
    const characters = f.read('stCharacters');
    assert.match(characters.text, /total=2/);
    const search = f.read('stCharacters', 'search:ali', characters.revision);
    assert.match(search.text, /character\[0\] "Alice"/);
    assert.doesNotMatch(JSON.stringify({ chat: chat.text, directory: characters.text, search: search.text }), /PRIVATE_|\.png/);
    const groups = f.read('stGroups');
    assert.match(groups.text, /group\[0\] "Friends"/);
    assert.doesNotMatch(groups.text, /private-group-id|PRIVATE_GROUP|private-alice/);
    f.module.dispose();
});

test('ST source selectors, directory revisions and chat target fail closed', () => {
    const f = fixture();
    assert.equal(f.read('stCharacters', 'search:Alice').status, 'STALE_SOURCE');
    const directory = f.read('stCharacters');
    assert.equal(f.read('stCharacters', 'search:').status, 'INVALID_SELECTOR');
    assert.equal(f.read('stCharacters', 'search:Alice\nsecret', directory.revision).status, 'INVALID_SELECTOR');
    const search = f.read('stCharacters', 'search:Alice', directory.revision);
    assert.equal(search.status, 'ok');
    f.ctx.characters.reverse();
    assert.equal(f.read('stCharacters', 'search:Alice', directory.revision).status, 'STALE_SOURCE');
    f.switchChat();
    assert.equal(f.read('stChat').status, 'TARGET_UNAVAILABLE');
    f.module.dispose();
});

test('ST directory and search results are bounded even with many entities', () => {
    const f = fixture();
    f.ctx.characters = Array.from({ length: 90 }, (_, i) => ({ avatar: `id-${i}`, name: `Hero ${i}` }));
    const directory = f.read('stCharacters');
    assert.match(directory.text, /total=90; shown=40/);
    assert.equal(directory.truncated, true);
    const search = f.read('stCharacters', 'search:Hero', directory.revision);
    assert.match(search.text, /matches=90; shown=20/);
    assert.equal(search.truncated, true);
    f.ctx.characters = Array.from({ length: 2049 }, (_, i) => ({ name: `Hero ${i}` }));
    assert.equal(f.read('stCharacters', '', '', 'other').status, 'SOURCE_TOO_LARGE');
    f.module.dispose();
});

test('Long names are marked incomplete, with full private names retained only as revision evidence', () => {
    const f = fixture();
    f.ctx.characters[0].name = 'Alice ' + 'x'.repeat(160);
    const directory = f.read('stCharacters');
    assert.equal(directory.truncated, true);
    assert.doesNotMatch(directory.text, /x{140}/);
    f.ctx.characters[0].name = 'Alice ' + 'x'.repeat(159) + 'y';
    assert.equal(f.read('stCharacters', '', directory.revision).status, 'STALE_SOURCE');
    f.module.dispose();
});
