import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AREAS, FEATURES, UI_PREFERENCE_KEY, normalizePreference, readPreference,
    writePreference, navigatePreference, routeForCard,
    PRIMARY_AREAS, partitionFeatures,
} from '../../ui/navigation-model.js';

test('progressive navigation keeps every feature reachable without overwhelming the first level', () => {
    assert.equal(PRIMARY_AREAS.length, 4);
    assert.ok(PRIMARY_AREAS.every(id => AREAS.some(([area]) => area === id)));
    for (const [area] of AREAS) {
        const { primary, more } = partitionFeatures(area);
        assert.ok(primary.length > 0 && primary.length <= 3);
        assert.deepEqual(new Set([...primary, ...more].map(f => f.id)),
            new Set(FEATURES.filter(f => f.area === area).map(f => f.id)));
        assert.equal(primary.length + more.length, FEATURES.filter(f => f.area === area).length);
        for (const f of more) {
            const state = navigatePreference(normalizePreference(null), f.id);
            assert.equal(state.last[area], f.id);
            assert.equal(state.area, area);
        }
    }
});

test('new users, corrupt preferences and unavailable storage use the classic layout', () => {
    for (const storage of [undefined, { getItem: () => '{bad' }, { getItem() { throw Error('denied'); } }]) {
        const state = readPreference(storage);
        assert.equal(state.layout, 'classic');
        assert.equal(state.area, 'overview');
    }
    assert.equal(normalizePreference({ version: 9, layout: 'preview' }).layout, 'classic');
});

test('each navigation area remembers its own feature and rejects cross-area targets', () => {
    let state = normalizePreference(null);
    state = navigatePreference(state, 'memory');
    state = navigatePreference(state, 'agents');
    assert.equal(state.area, 'resources');
    assert.equal(state.last.story, 'memory');
    assert.equal(state.last.resources, 'agents');
    const corrupt = normalizePreference({ last: { story: 'agents' }, area: 'invalid' });
    assert.equal(corrupt.area, 'overview');
    assert.equal(corrupt.last.story, 'profile');
    assert.deepEqual(navigatePreference(state, 'missing'), state);
});

test('switching presentation retains navigation and cannot mutate business settings', () => {
    const settings = { mode: 'llm', profileEnabled: true };
    const before = structuredClone(settings);
    const state = navigatePreference(normalizePreference(null), 'storyBlueprint');
    const preview = normalizePreference({ ...state, layout: 'preview', settings });
    const classic = normalizePreference({ ...preview, layout: 'classic' });
    assert.equal(classic.last.story, 'storyBlueprint');
    assert.deepEqual(settings, before);
    assert.equal('settings' in preview, false);
});

test('browser preferences exclude drafts, chat state and credentials and survive reload', () => {
    const values = new Map();
    const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
    const state = navigatePreference(normalizePreference({ version: 1, layout: 'preview' }), 'profile-library');
    assert.equal(writePreference(storage, { ...state, draft: 'private chat', apiKey: 'secret' }), true);
    assert.deepEqual(readPreference(storage), state);
    assert.deepEqual([...values.keys()], [UI_PREFERENCE_KEY]);
    assert.doesNotMatch(values.get(UI_PREFERENCE_KEY), /private chat|secret|draft|apiKey/);
});

test('failed preference storage leaves the current session selection intact', () => {
    const state = normalizePreference({ version: 1, layout: 'preview' });
    assert.equal(writePreference({ setItem() { throw Error('quota'); } }, state), false);
    assert.equal(writePreference(undefined, state), false);
    assert.equal(state.layout, 'preview');
});

test('feature IDs are unique and every area has a reachable default', () => {
    assert.equal(new Set(FEATURES.map(f => f.id)).size, FEATURES.length);
    for (const [area] of AREAS) assert.ok(FEATURES.some(f => f.area === area));
    assert.equal(routeForCard('jsonSchema'), 'rules');
    assert.equal(routeForCard('variablesMaintenancePreview'), 'variables');
    assert.equal(routeForCard('missing'), null);
});
