import test from 'node:test';
import assert from 'node:assert/strict';
import { historyBookName } from '../../muyu/sessions/worldbook-contract.js';
import { readWorldBookOverview, readWorldBookEntries } from '../../muyu/host/st-world-books.js';
import { createWorldBookEditorPort } from '../../muyu/host/worldbook-editor.js';
import { createWorldBookControls } from '../../muyu/host/worldbook-controls.js';
import { createSelectionEditorPort } from '../../muyu/host/selection-editor.js';
import { createWorldBookScanner } from '../../systems/world-book-scanner.js';
import { createWorldInfoSystem } from '../../systems/world-info-system.js';
import { register as registerBooks } from '../../assets/providers/world-books.js';
import { getProviders, unregisterProvider } from '../../provider-registry.js';

const hidden = historyBookName(crypto.randomUUID(), crypto.randomUUID());
const internal = () => ({ extensions: { gdMuyuHistory: { schema: 'gd-muyu-history-worldbook' } }, entries: { 0: { uid: 0, content: 'PRIVATE_ARCHIVE' } } });
const ordinary = () => ({ entries: { 0: { uid: 0, comment: 'Lore', content: 'PUBLIC_LORE', key: ['lore'], keysecondary: [] } } });
const target = { kind: 'global', userKey: 'u' };
const state = () => ({ names: [hidden, 'Atlas'], global: [hidden, 'Atlas'], chat: hidden, characterPrimary: hidden, characterAdditional: [hidden], persona: hidden });

test('Read directories exclude archives before limits, pagination and selector indexes', async () => {
    const s = state(); s.names = [...Array.from({ length: 600 }, () => historyBookName(crypto.randomUUID(), crypto.randomUUID())), 'Atlas'];
    s.global = s.names.slice(); const loaded = [];
    const overview = readWorldBookOverview('', () => s);
    assert.match(overview.text, /books=1/); assert.doesNotMatch(overview.text, /GD-Muyu-History/);
    const directory = readWorldBookEntries('', () => s);
    assert.match(directory.text, /book\[0\] "Atlas"/);
    const body = await readWorldBookEntries('entry:0:0', () => s, async name => { loaded.push(name); return ordinary(); });
    assert.match(body.text, /PUBLIC_LORE/); assert.deepEqual(loaded, ['Atlas']);
    await assert.rejects(async () => readWorldBookEntries('book:1', () => s, async () => internal()), /INVALID_SELECTOR/);
});

test('Renamed archive content never appears in world-book detail or keyword search', async () => {
    for (const selector of ['book:0', 'entry:0:0', 'search:0:PRIVATE']) {
        await assert.rejects(readWorldBookEntries(selector, () => ({ names: ['Renamed'] }), async () => internal()), /SOURCE_UNAVAILABLE/);
    }
});

test('Editor targets only visible books, refuses reserved names and blocks renamed archive contents', async () => {
    const s = state(); let loads = 0, saves = 0;
    const editor = createWorldBookEditorPort({ getTarget: () => target, getState: () => s,
        load: async () => { loads++; return ordinary(); }, save: async () => { saves++; } });
    const directory = editor.list(target);
    assert.deepEqual(directory.books.map(row => row.name), ['Atlas']);
    const book = await editor.read(target, 'book:0', directory.revision);
    assert.match(book.text, /Atlas/); assert.equal(loads, 1);
    await assert.rejects(editor.preview(target, { operation: 'create_book', selector: '', revision: directory.revision, changes: {}, name: hidden }), /INVALID_WORLD_BOOK_EDIT/);
    await assert.rejects(editor.preview(target, { operation: 'copy_book', selector: 'book:0', revision: book.revision, changes: {}, name: hidden }), /INVALID_WORLD_BOOK_EDIT/);
    const renamed = createWorldBookEditorPort({ getTarget: () => target, getState: () => ({ names: ['Renamed'] }), load: async () => internal() });
    await assert.rejects(renamed.read(target, 'book:0', renamed.list(target).revision), /INVALID_WORLD_BOOK_EDIT/);
    assert.equal(saves, 0);
});

test('Activation and deletion controls cannot target internal archives, including renamed bindings', async () => {
    const s = state(); let writes = 0;
    const controls = createWorldBookControls({ getTarget: () => target, getState: () => s, getChatTarget: () => ({ ...target, kind: 'chat', chatKey: 'A' }),
        load: async name => name === 'Renamed' ? internal() : ordinary(), setGlobal: async () => { writes++; }, setChat: async () => { writes++; } });
    const view = controls.read(target);
    assert.deepEqual(view.global, ['Atlas']); assert.equal(view.chat, '');
    await assert.rejects(controls.preview(target, { operation: 'set_global_binding', selector: '', revision: view.revision, changes: { names: [hidden] } }), /INVALID_WORLD_BOOK_EDIT/);
    await assert.rejects(controls.preview(target, { operation: 'set_chat_binding', selector: '', revision: view.revision, changes: { name: hidden } }), /INVALID_WORLD_BOOK_EDIT/);
    s.names.push('Renamed');
    await assert.rejects(controls.preview(target, { operation: 'set_global_binding', selector: '', revision: controls.read(target).revision, changes: { names: ['Renamed'] } }), /INVALID_WORLD_BOOK_EDIT/);
    assert.equal(writes, 0);
});

test('GD manual-selection editor hides archive names and rejects their selection', () => {
    const settings = { worldBookSourceMode: 'manual', worldBookSelection: { [hidden]: true, Atlas: true } };
    const editor = createSelectionEditorPort({ getTarget: () => target, getSettings: () => settings, getWorldNames: () => state().names });
    const view = editor.read(target, 'worldbooks');
    assert.deepEqual(view.available, ['Atlas']); assert.deepEqual(view.current.selection, { Atlas: true });
    assert.throws(() => editor.preview(target, { kind: 'worldbooks', revision: view.revision, changes: { selectedNames: [hidden] } }), /WORLD_BOOK_NOT_FOUND/);
});

test('Scanner and built-in world-book Provider exclude archive names, bodies and renamed markers', async () => {
    const loads = [], scanner = createWorldBookScanner({ world_names: [hidden, 'Atlas', 'Renamed'],
        getSourceMode: () => 'manual', getSelection: () => ({ [hidden]: true, Atlas: true, Renamed: true }),
        loadWorldInfo: async name => { loads.push(name); return name === 'Renamed' ? internal() : ordinary(); } });
    assert.deepEqual(scanner.getSelectedNames(), ['Atlas', 'Renamed']);
    registerBooks(scanner);
    try {
        const result = await getProviders().find(row => row.id === 'worldBooks').render();
        assert.deepEqual(loads, ['Atlas', 'Renamed']);
        assert.doesNotMatch(JSON.stringify(result), /GD-Muyu-History|PRIVATE_ARCHIVE/);
        assert.match(JSON.stringify(result), /PUBLIC_LORE/);
    } finally { unregisterProvider('worldBooks'); }
});

test('Director does not fall back to combined private text after filtering all activated archive entries', async () => {
    const system = createWorldInfoSystem({ settings: { llmWorldInfoEnabled: true }, getChat: () => [], getCharacters: () => [], getContext: () => ({}),
        power_user: {}, log() {}, checkWorldInfo: async () => ({ allActivatedEntries: new Set([{ world: hidden, content: 'PRIVATE_ARCHIVE' }]), worldInfoBefore: 'PRIVATE_ARCHIVE' }) });
    assert.deepEqual(await system.buildDirectorWorldInfo([]), { text: '', entries: [] });
});
