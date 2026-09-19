import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorldBookScanner } from '../../systems/world-book-scanner.js';

function entry(overrides = {}) {
    return {
        uid: 1, comment: 'Entry', content: 'Line one\nLine two', constant: true,
        depth: 10, probability: 100, sticky: 2, order: 100,
        key: ['magic'], keysecondary: ['spell'],
        characterFilter: { names: ['Alice'], tags: ['mage'] },
        ...overrides,
    };
}

test('world book scanner selects sources, deduplicates concurrent loads, and caches results', async () => {
    let source = 'st';
    let loads = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const scanner = createWorldBookScanner({
        world_names: ['A', 'B'],
        loadWorldInfo: async name => { loads++; await gate; return { entries: { 1: entry({ uid: name }) } }; },
        getSelection: () => ({ A: false, B: true }),
        getMaxEntries: () => 20,
        getSourceMode: () => source,
        getStSelection: () => ['A', 'A', 'missing'],
        log: () => {},
    });
    assert.deepEqual(scanner.getSelectedNames(), ['A']);
    const first = scanner.scanAll();
    const second = scanner.scanAll();
    await Promise.resolve();
    assert.equal(loads, 1);
    release();
    assert.equal(await first, await second);
    assert.equal((await scanner.scanAll())[0].entries[0].uid, 'A');
    assert.equal(loads, 1);
    scanner.clearCache();
    await scanner.scanAll();
    assert.equal(loads, 2);
    source = 'gd';
    assert.deepEqual(scanner.getSelectedNames(), ['B']);
});

test('world book scanner normalizes entries, scores importance, renders macros, and builds snapshots', async t => {
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    t.after(() => { console.warn = original; });
    const scanner = createWorldBookScanner({
        world_names: ['Book'],
        loadWorldInfo: async () => ({ entries: {
            1: entry({ comment: '{{name}}', content: '{{name}} lore', group: '{{name}}' }),
            2: entry({ uid: 2, comment: 'Disabled', disable: true, constant: false }),
        } }),
        getSourceMode: () => 'gd',
        getSelection: () => ({ Book: true }),
        getMaxEntries: () => 20,
        renderMacros: value => value === '{{bad}}' ? (() => { throw new Error('macro'); })() : value.replaceAll('{{name}}', 'Alice'),
        log: () => {},
    });
    const books = await scanner.getRenderedBooks();
    assert.equal(books[0].entries[0].comment, 'Alice');
    assert.equal(books[0].entries[0].contentPreview, 'Alice lore');
    const scores = scanner.calculateImportance(books);
    assert.equal(scores[0].importance, 0.92);
    assert.match(scores[0].factors, /always-on/);
    assert.equal(scores.at(-1).importance, 0);
    const snapshot = await scanner.buildSnapshot();
    assert.deepEqual(snapshot.names, ['Book']);
    assert.equal(snapshot.fullEntries.length, 1);
    assert.equal(snapshot.constantEntries.length, 1);
    assert.match(snapshot.fullText, /## \[Book\] Alice/);
    assert.equal(snapshot.stats.entryCount, 1);
});

test('world book scanner isolates failed books and empty selections', async t => {
    const original = console.warn;
    console.warn = () => {};
    t.after(() => { console.warn = original; });
    const empty = createWorldBookScanner({ world_names: [], loadWorldInfo: async () => {}, getSourceMode: () => 'st', getStSelection: () => [] });
    assert.deepEqual(await empty.scanAll(), []);
    const scanner = createWorldBookScanner({
        world_names: ['Bad'], getSourceMode: () => 'gd', getSelection: () => ({ Bad: true }), getMaxEntries: () => 20,
        loadWorldInfo: async () => { throw new Error('broken'); },
    });
    assert.deepEqual(await scanner.scanAll(), []);
});
