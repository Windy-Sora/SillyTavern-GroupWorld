import test from 'node:test';
import assert from 'node:assert/strict';
import { matchEnabledCharacter, messageMatchesCharacter } from '../../utils/character-identity.js';
import { normalizeDirectorPlan, normalizeDirectorScripts, recoverDirectorPlan } from '../../systems/director-plan.js';
import { register as registerCharacters } from '../../assets/providers/characters.js';
import { register as registerLore } from '../../assets/providers/character-lore.js';
import { providers, unregisterProvider } from '../../provider-registry.js';

const cards = [{ name: 'Alice', avatar: 'a.png' }, { name: 'Alice', avatar: 'b.png' }, { name: 'Bob', avatar: 'c.png' }];
const members = cards.map(c => c.avatar);
const match = (name, enabled) => matchEnabledCharacter(name, enabled, cards);

test('speaker references reject ambiguous names and tied partial matches but accept enabled avatar ids', () => {
    assert.equal(match('Alice', members), null);
    assert.equal(match('alice', members), null);
    assert.equal(match('Ali', members), null);
    assert.equal(match('b.png', members), cards[1]);
    assert.equal(match('Bob', members), cards[2]);
    assert.equal(match('bob', members), cards[2]);
    assert.equal(match('Bo', members), cards[2]);
    assert.equal(match('b.png', ['a.png']), null);
    assert.equal(match('Alice', ['a.png']), cards[0]);
});

test('same-name Director scripts and history recovery keep avatar identity', () => {
    const options = { enabledMembers: members, matchCharacterByName: match };
    const plan = normalizeDirectorPlan({ speakers: ['Alice', 'b.png', 'a.png'] }, options);
    assert.deepEqual(plan.speakers, ['b.png', 'a.png']);
    assert.deepEqual(normalizeDirectorScripts({ Alice: 'ambiguous', 'a.png': 'A', 'b.png': 'B' }, options), { 'a.png': 'A', 'b.png': 'B' });
    const recovered = recoverDirectorPlan({ speakers: ['Alice'], speakerAvatars: ['b.png'], scripts: { 'b.png': 'B' } }, options);
    assert.deepEqual(recovered.avatars, ['b.png']);
    assert.deepEqual(recovered.scripts, { 'b.png': 'B' });
    assert.equal(recoverDirectorPlan({ speakers: ['Alice'], scripts: { Alice: 'ambiguous' } }, options), null);
    assert.deepEqual(normalizeDirectorScripts({ Alice: 'A' }, { ...options, enabledMembers: ['a.png'], characters: cards }), { 'a.png': 'A' });
});

test('explicit ST message avatar wins over a shared or renamed display name', () => {
    assert.equal(messageMatchesCharacter({ name: 'Alice', original_avatar: 'b.png' }, cards[0]), false);
    assert.equal(messageMatchesCharacter({ name: 'renamed', original_avatar: 'b.png' }, cards[1]), true);
    assert.equal(messageMatchesCharacter({ name: 'Alice' }, cards[0], true), false);
    assert.equal(messageMatchesCharacter({ name: 'Bob' }, cards[2]), true);
});

test('characters Provider disambiguates duplicate cards even with profiles enabled', t => {
    assert.equal(providers.has('characters'), false);
    registerCharacters({ profileEnabled: true }, cards, () => 'profiles');
    t.after(() => unregisterProvider('characters'));
    const text = providers.get('characters').render({ enabledMembers: members }).content;
    assert.match(text, /Alice \[speaker id: a\.png\]/);
    assert.match(text, /Alice \[speaker id: b\.png\]/);
    assert.match(text, /exact speaker id/);
    const unique = providers.get('characters').render({ enabledMembers: ['c.png'] }).content;
    assert.equal(unique, '- Bob');
});

test('lore Provider rejects ambiguous legacy assignments and reads avatar-keyed assignments', t => {
    assert.equal(providers.has('characterLore'), false);
    registerLore(() => [{ loreAssignments: { Alice: ['shared'], 'b.png': ['B lore'] } }]);
    t.after(() => unregisterProvider('characterLore'));
    const provider = providers.get('characterLore');
    assert.equal(provider.render({ character: 'Alice', avatar: 'a.png', characterNameAmbiguous: true }).content, '');
    assert.equal(provider.render({ character: 'Alice', avatar: 'b.png', characterNameAmbiguous: true }).content, '[World lore: B lore]');
    assert.equal(provider.render({ character: 'Alice' }).content, '[World lore: shared]');
});
