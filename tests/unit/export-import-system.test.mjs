import test from 'node:test';
import assert from 'node:assert/strict';

import { createExportImportSystem } from '../../systems/export-import-system.js';

function installBrowser(JSZipClass) {
    const original = {
        window: globalThis.window,
        document: globalThis.document,
        URL: globalThis.URL,
        fetch: globalThis.fetch,
    };
    const notices = { warning: [], error: [], success: [], info: [] };
    const toastr = Object.fromEntries(Object.keys(notices).map(level => [level, message => notices[level].push(message)]));
    const anchor = { clicked: 0, click() { this.clicked++; } };
    const resources = { created: 0, revoked: 0, appended: 0, removed: 0 };
    globalThis.window = { JSZip: JSZipClass, toastr };
    globalThis.document = {
        createElement: () => anchor,
        head: { appendChild() {} },
        body: {
            appendChild() { resources.appended++; },
            removeChild() { resources.removed++; },
        },
    };
    globalThis.URL = {
        createObjectURL: () => { resources.created++; return 'blob:zip'; },
        revokeObjectURL() { resources.revoked++; },
    };
    return {
        notices,
        anchor,
        resources,
        restore() {
            globalThis.window = original.window;
            globalThis.document = original.document;
            globalThis.URL = original.URL;
            globalThis.fetch = original.fetch;
        },
    };
}

function importZip(groupData, characterNames = [], worldNames = []) {
    return {
        folder(name) {
            const names = name === 'characters' ? characterNames : name === 'worlds' ? worldNames : [];
            return { file: () => names.map(path => ({
                name: path,
                async: async format => format === 'text' ? JSON.stringify({ entries: {} }) : new Blob([path]),
            })) };
        },
        file: name => name === 'group.json'
            ? { async: async () => JSON.stringify(groupData) } : null,
    };
}

function importBrowser(zip) {
    class ImportZip { static async loadAsync() { return zip; } }
    return installBrowser(ImportZip);
}

class ExportZip {
    static latest;
    constructor() {
        ExportZip.latest = this;
        this.rootFiles = new Map();
        this.folderFiles = new Map();
    }
    file(name, value) { this.rootFiles.set(name, value); return this; }
    folder(name) {
        if (!this.folderFiles.has(name)) this.folderFiles.set(name, new Map());
        return { file: (fileName, value) => this.folderFiles.get(name).set(fileName, value) };
    }
    async generateAsync() { return new Blob(['zip']); }
}

function createSystem(overrides = {}) {
    return createExportImportSystem({
        settings: { lang: 'en' },
        getCurrentGroup: () => ({
            name: 'Test / Group',
            members: ['alice.png', 'disabled.png'],
            disabled_members: ['disabled.png'],
            activation_strategy: 1,
            generation_mode: 0,
        }),
        getChat: () => [],
        characters: [],
        world_names: ['Primary', 'Selected', 'Lore'],
        selected_world_info: ['Selected', 'Missing'],
        world_info: { charLore: [{ name: 'Lore' }, { name: 'Primary' }] },
        getChatMetadata: () => ({ world_info: 'Primary' }),
        log: () => {},
        ...overrides,
    });
}

test('group export collects unique active books and packages enabled characters', async () => {
    const browser = installBrowser(ExportZip);
    const requests = [];
    try {
        globalThis.fetch = async (url, options = {}) => {
            requests.push([url, options]);
            if (url === '/csrf-token') return { json: async () => ({ token: 'csrf' }) };
            if (url === '/api/characters/export') return { ok: true, blob: async () => new Blob(['character']) };
            if (url === '/api/worldinfo/get') return { ok: true, json: async () => ({ entries: {} }) };
            throw new Error(`Unexpected URL: ${url}`);
        };
        const system = createSystem();
        assert.deepEqual(system.getActivatedWorldBooks(), ['Primary', 'Selected', 'Lore']);
        await system.exportGroup();

        assert.equal(ExportZip.latest.folderFiles.get('characters').size, 1);
        assert.equal(ExportZip.latest.folderFiles.get('worlds').size, 3);
        assert.ok(ExportZip.latest.rootFiles.has('group.json'));
        assert.equal(requests.filter(([url]) => url === '/csrf-token').length, 1);
        assert.equal(requests.slice(1).every(([, options]) => options.headers['X-CSRF-Token'] === 'csrf'), true);
        assert.match(browser.anchor.download, /^group_export_Test _ Group\.zip$/);
        assert.equal(browser.notices.success.length, 1);
    } finally { browser.restore(); }
});

test('group export stops cleanly outside group chat', async () => {
    const browser = installBrowser(ExportZip);
    try {
        await createSystem({ getCurrentGroup: () => null }).exportGroup();
        assert.equal(browser.notices.warning.length, 1);
    } finally { browser.restore(); }
});

test('group import remaps renamed character files before creating the group', async () => {
    const characterFile = { name: 'characters/alice.png', async: async () => new Blob(['character']) };
    const worldFile = {
        name: 'worlds/Primary.json',
        async: async format => format === 'text' ? JSON.stringify({ entries: {} }) : new Blob(['world']),
    };
    const groupFile = {
        async: async () => JSON.stringify({
            name: 'Imported',
            members: ['alice.png'],
            disabled_members: [],
            activation_strategy: 2,
        }),
    };
    const loadedZip = {
        folder(name) {
            if (name === 'characters') return { file: () => [characterFile] };
            if (name === 'worlds') return { file: () => [worldFile] };
            return null;
        },
        file: name => name === 'group.json' ? groupFile : null,
    };
    class ImportZip { static async loadAsync() { return loadedZip; } }

    const browser = installBrowser(ImportZip);
    let createBody;
    try {
        globalThis.fetch = async (url, options = {}) => {
            if (url === '/csrf-token') return { json: async () => ({ token: 'csrf' }) };
            if (url === '/api/characters/import') return { ok: true, json: async () => ({ file_name: 'alice_1' }) };
            if (url === '/api/worldinfo/import') return { ok: true };
            if (url === '/api/groups/create') {
                createBody = JSON.parse(options.body);
                return { ok: true, json: async () => ({ id: 'g2' }) };
            }
            throw new Error(`Unexpected URL: ${url}`);
        };
        const result = await createSystem().importGroup(new ArrayBuffer(2));
        assert.deepEqual(createBody.members, ['alice_1.png']);
        assert.equal(result.ok, true);
        assert.equal(result.partial, false);
        assert.equal(browser.notices.success.length, 1);
        assert.equal(browser.notices.info.length, 1);
    } finally { browser.restore(); }
});

test('character filename aliases cannot overwrite another imported member mapping', async () => {
    const browser = importBrowser(importZip(
        { members: ['alice.png', 'alice.png.png'] },
        ['characters/alice.png', 'characters/alice.png.png'],
    ));
    let importCount = 0;
    let createBody;
    try {
        globalThis.fetch = async (url, options = {}) => {
            if (url === '/csrf-token') return { json: async () => ({ token: 'csrf' }) };
            if (url === '/api/characters/import') {
                return { ok: true, json: async () => ({ file_name: `Imported${++importCount}` }) };
            }
            if (url === '/api/groups/create') {
                createBody = JSON.parse(options.body);
                return { ok: true, json: async () => ({ id: 'g2' }) };
            }
            throw new Error(`Unexpected URL: ${url}`);
        };
        const result = await createSystem().importGroup(new ArrayBuffer(2));
        assert.equal(result.ok, true);
        assert.deepEqual(createBody.members, ['Imported1.png', 'Imported2.png']);
        assert.equal(new Set(createBody.members).size, 2);
    } finally { browser.restore(); }
});

test('sequential imports reserve world-book names and read the latest host list', async () => {
    let loadedZip;
    class ImportZip { static async loadAsync() { return loadedZip; } }
    const browser = installBrowser(ImportZip);
    let currentWorldNames = [];
    const uploadedNames = [];
    let characterCount = 0;
    try {
        globalThis.fetch = async (url, options = {}) => {
            if (url === '/csrf-token') return { json: async () => ({ token: 'csrf' }) };
            if (url === '/api/characters/import') {
                return { ok: true, json: async () => ({ file_name: `Imported${++characterCount}` }) };
            }
            if (url === '/api/worldinfo/import') {
                uploadedNames.push(options.body.get('avatar').name);
                return { ok: true };
            }
            if (url === '/api/groups/create') return { ok: true, json: async () => ({ id: 'g2' }) };
            throw new Error(`Unexpected URL: ${url}`);
        };
        const system = createSystem({
            world_names: currentWorldNames,
            getWorldNames: () => currentWorldNames,
        });
        loadedZip = importZip(
            { members: ['alice.png'] }, ['characters/alice.png'], ['worlds/Lore.json'],
        );
        assert.equal((await system.importGroup(new ArrayBuffer(2))).ok, true);

        currentWorldNames = ['External'];
        loadedZip = importZip(
            { members: ['bob.png'] }, ['characters/bob.png'],
            ['worlds/Lore.json', 'worlds/External.json'],
        );
        assert.equal((await system.importGroup(new ArrayBuffer(2))).ok, true);
        assert.deepEqual(uploadedNames, ['Lore.json', 'Lore_1.json', 'External_1.json']);
    } finally { browser.restore(); }
});

test('invalid group archives never upload characters, world books, or a group', async () => {
    const cases = [
        importZip(null, ['characters/alice.png']),
        importZip({ members: ['alice.png'] }, []),
        importZip({ members: ['alice.png'] }, ['characters/alice.png', 'characters/extra.png']),
        importZip({ members: ['alice.png'] }, ['characters/alice.png', 'characters/ALICE.png']),
        importZip({ members: ['alice.png'] }, ['characters/alice.png', 'characters/sub/alice.png']),
        importZip({ members: ['alice.png', 'ALICE.png'] }, ['characters/alice.png']),
        importZip({ members: ['ALICE.png'] }, ['characters/alice.png']),
        importZip({ members: ['../alice.png'] }, ['characters/alice.png']),
        importZip({ members: ['alice.png'], activation_strategy: 'bad' }, ['characters/alice.png']),
        importZip({ members: ['alice.png'] }, ['characters/alice.png'], ['worlds/sub/lore.json']),
    ];
    for (const zip of cases) {
        const browser = importBrowser(zip);
        let requests = 0;
        try {
            globalThis.fetch = async () => { requests++; throw new Error('unexpected request'); };
            const result = await createSystem().importGroup(new ArrayBuffer(2));
            assert.equal(result.ok, false);
            assert.equal(result.partial, false);
            assert.equal(requests, 0);
            assert.equal(browser.notices.error.length, 1);
            assert.equal(browser.notices.success.length, 0);
        } finally { browser.restore(); }
    }
});

test('a corrupt world book is detected before any remote import', async () => {
    const zip = importZip({ members: ['alice.png'] }, ['characters/alice.png']);
    const originalFolder = zip.folder;
    zip.folder = name => name === 'worlds'
        ? { file: () => [{ name: 'worlds/Lore.json', async: async () => '{broken' }] }
        : originalFolder(name);
    const browser = importBrowser(zip);
    let requests = 0;
    try {
        globalThis.fetch = async () => { requests++; throw new Error('unexpected request'); };
        const result = await createSystem().importGroup(new ArrayBuffer(2));
        assert.equal(result.ok, false);
        assert.equal(result.partial, false);
        assert.equal(requests, 0);
        assert.equal(browser.notices.error.length, 1);
    } finally { browser.restore(); }
});

test('a card that cannot be extracted is detected before any remote import', async () => {
    const zip = importZip({ members: ['alice.png', 'bob.png'] }, [
        'characters/alice.png', 'characters/bob.png',
    ]);
    const originalFolder = zip.folder;
    zip.folder = name => name === 'characters'
        ? { file: () => [
            { name: 'characters/alice.png', async: async () => new Blob(['card']) },
            { name: 'characters/bob.png', async: async () => { throw new Error('corrupt card'); } },
        ] }
        : originalFolder(name);
    const browser = importBrowser(zip);
    let requests = 0;
    try {
        globalThis.fetch = async () => { requests++; throw new Error('unexpected request'); };
        const result = await createSystem().importGroup(new ArrayBuffer(2));
        assert.equal(result.ok, false);
        assert.equal(result.partial, false);
        assert.equal(requests, 0);
        assert.equal(browser.notices.error.length, 1);
    } finally { browser.restore(); }
});

test('failed required character upload leaves partial resources but never creates a broken group', async () => {
    const browser = importBrowser(importZip(
        { name: 'Imported', members: ['alice.png', 'bob.png'] },
        ['characters/alice.png', 'characters/bob.png'], ['worlds/Lore.json'],
    ));
    const requests = [];
    try {
        globalThis.fetch = async (url, options = {}) => {
            requests.push([url, options]);
            if (url === '/csrf-token') return { json: async () => ({ token: 'csrf' }) };
            if (url === '/api/characters/import') {
                return options.body.get('avatar').name === 'alice.png'
                    ? { ok: true, json: async () => ({ file_name: 'Alice1' }) }
                    : { ok: false, status: 400 };
            }
            if (url === '/api/worldinfo/import') return { ok: true };
            throw new Error(`Unexpected URL: ${url}`);
        };
        const result = await createSystem({ world_names: ['Lore'] }).importGroup(new ArrayBuffer(2));
        assert.deepEqual(result, {
            ok: false, partial: true, groupCreated: false,
            characters: { imported: 1, failed: 1 }, worldBooks: { imported: 1, failed: 0 },
        });
        assert.equal(requests.some(([url]) => url === '/api/groups/create'), false);
        assert.equal(requests.find(([url]) => url === '/api/characters/import')[1].body.has('preserved_name'), false);
        assert.equal(requests.find(([url]) => url === '/api/worldinfo/import')[1].body.get('avatar').name, 'Lore_1.json');
        assert.equal(browser.notices.warning.length, 1);
        assert.equal(browser.notices.success.length, 0);
        assert.equal(browser.notices.info.length, 1);
    } finally { browser.restore(); }
});

test('a successful HTTP response without a character filename is not counted as an import', async () => {
    const browser = importBrowser(importZip({ members: ['alice.png'] }, ['characters/alice.png']));
    const requests = [];
    try {
        globalThis.fetch = async url => {
            requests.push(url);
            if (url === '/csrf-token') return { json: async () => ({ token: 'csrf' }) };
            if (url === '/api/characters/import') return { ok: true, json: async () => ({ error: true }) };
            throw new Error(`Unexpected URL: ${url}`);
        };
        const result = await createSystem().importGroup(new ArrayBuffer(2));
        assert.equal(result.ok, false);
        assert.equal(result.partial, true);
        assert.equal(result.characters.failed, 1);
        assert.equal(requests.includes('/api/groups/create'), false);
        assert.equal(browser.notices.success.length, 0);
        assert.equal(browser.notices.warning.length, 1);
    } finally { browser.restore(); }
});

test('two character responses mapping to one avatar cannot create a duplicate-member group', async () => {
    const browser = importBrowser(importZip(
        { members: ['alice.png', 'bob.png'] }, ['characters/alice.png', 'characters/bob.png'],
    ));
    const requests = [];
    try {
        globalThis.fetch = async url => {
            requests.push(url);
            if (url === '/csrf-token') return { json: async () => ({ token: 'csrf' }) };
            if (url === '/api/characters/import') return { ok: true, json: async () => ({ file_name: 'Same' }) };
            throw new Error(`Unexpected URL: ${url}`);
        };
        const result = await createSystem().importGroup(new ArrayBuffer(2));
        assert.equal(result.ok, false);
        assert.equal(result.partial, true);
        assert.equal(result.characters.imported, 1);
        assert.equal(result.characters.failed, 1);
        assert.equal(requests.includes('/api/groups/create'), false);
        assert.equal(browser.notices.warning.length, 1);
    } finally { browser.restore(); }
});

test('group creation failure reports partial import after character creation', async () => {
    const browser = importBrowser(importZip({ members: ['alice.png'] }, ['characters/alice.png']));
    try {
        globalThis.fetch = async url => {
            if (url === '/csrf-token') return { json: async () => ({ token: 'csrf' }) };
            if (url === '/api/characters/import') return { ok: true, json: async () => ({ file_name: 'Alice1' }) };
            if (url === '/api/groups/create') return { ok: false, status: 500 };
            throw new Error(`Unexpected URL: ${url}`);
        };
        const result = await createSystem().importGroup(new ArrayBuffer(2));
        assert.equal(result.ok, false);
        assert.equal(result.partial, true);
        assert.equal(result.groupCreated, false);
        assert.equal(browser.notices.warning.length, 1);
        assert.equal(browser.notices.success.length, 0);
    } finally { browser.restore(); }
});

test('a failed world-book upload leaves a created group but reports partial import', async () => {
    const browser = importBrowser(importZip(
        { members: ['alice.png'] }, ['characters/alice.png'], ['worlds/Lore.json'],
    ));
    let groupBody;
    try {
        globalThis.fetch = async (url, options = {}) => {
            if (url === '/csrf-token') return { json: async () => ({ token: 'csrf' }) };
            if (url === '/api/characters/import') return { ok: true, json: async () => ({ file_name: 'Alice1' }) };
            if (url === '/api/worldinfo/import') return { ok: false, status: 400 };
            if (url === '/api/groups/create') {
                groupBody = JSON.parse(options.body);
                return { ok: true, json: async () => ({ id: 'g2' }) };
            }
            throw new Error(`Unexpected URL: ${url}`);
        };
        const result = await createSystem().importGroup(new ArrayBuffer(2));
        assert.equal(result.groupCreated, true);
        assert.equal(result.ok, false);
        assert.equal(result.partial, true);
        assert.deepEqual(groupBody.members, ['Alice1.png']);
        assert.equal(browser.notices.warning.length, 1);
        assert.equal(browser.notices.success.length, 0);
    } finally { browser.restore(); }
});

test('partial export packages only cards that were actually exported', async () => {
    const browser = installBrowser(ExportZip);
    try {
        globalThis.fetch = async (url, options = {}) => {
            if (url === '/csrf-token') return { json: async () => ({ token: 'csrf' }) };
            if (url === '/api/characters/export') {
                return JSON.parse(options.body).avatar_url === 'alice.png'
                    ? { ok: true, blob: async () => new Blob(['card']) }
                    : { ok: false, status: 404 };
            }
            throw new Error(`Unexpected URL: ${url}`);
        };
        const result = await createSystem({
            getCurrentGroup: () => ({ name: 'Group', members: ['alice.png', 'bob.png'], disabled_members: [] }),
            selected_world_info: [], world_info: {}, getChatMetadata: () => ({}),
        }).exportGroup();
        const groupData = JSON.parse(ExportZip.latest.rootFiles.get('group.json'));
        assert.deepEqual(groupData.members, ['alice.png']);
        assert.deepEqual(groupData.disabled_members, []);
        assert.equal(result.partial, true);
        assert.equal(browser.notices.warning.length, 1);
        assert.equal(browser.notices.success.length, 0);
    } finally { browser.restore(); }
});

test('export does not offer an archive when every character card request fails', async () => {
    const browser = installBrowser(ExportZip);
    try {
        globalThis.fetch = async url => {
            if (url === '/csrf-token') return { json: async () => ({ token: 'csrf' }) };
            if (url === '/api/characters/export') return { ok: false, status: 404 };
            throw new Error(`Unexpected URL: ${url}`);
        };
        const result = await createSystem().exportGroup();
        assert.equal(result.ok, false);
        assert.equal(browser.resources.created, 0);
        assert.equal(browser.notices.error.length, 1);
        assert.equal(browser.notices.success.length, 0);
    } finally { browser.restore(); }
});

test('export does not package an empty successful character response', async () => {
    const browser = installBrowser(ExportZip);
    try {
        globalThis.fetch = async url => {
            if (url === '/csrf-token') return { json: async () => ({ token: 'csrf' }) };
            if (url === '/api/characters/export') return { ok: true, blob: async () => new Blob([]) };
            throw new Error(`Unexpected URL: ${url}`);
        };
        const result = await createSystem().exportGroup();
        assert.equal(result.ok, false);
        assert.equal(browser.resources.created, 0);
        assert.equal(browser.notices.success.length, 0);
    } finally { browser.restore(); }
});

test('export skips a world-book response that its importer would reject', async () => {
    const browser = installBrowser(ExportZip);
    try {
        globalThis.fetch = async url => {
            if (url === '/csrf-token') return { json: async () => ({ token: 'csrf' }) };
            if (url === '/api/characters/export') return { ok: true, blob: async () => new Blob(['card']) };
            if (url === '/api/worldinfo/get') return { ok: true, json: async () => ({}) };
            throw new Error(`Unexpected URL: ${url}`);
        };
        const result = await createSystem().exportGroup();
        assert.equal(result.partial, true);
        assert.equal(ExportZip.latest.folderFiles.get('worlds').size, 0);
        assert.equal(browser.notices.warning.length, 1);
        assert.equal(browser.notices.success.length, 0);
    } finally { browser.restore(); }
});

test('export keeps its original group and world-book selection across an asynchronous request', async () => {
    const browser = installBrowser(ExportZip);
    let releaseCharacter;
    const characterGate = new Promise(resolve => { releaseCharacter = resolve; });
    let characterRequested;
    const requested = new Promise(resolve => { characterRequested = resolve; });
    let group = { name: 'Before', members: ['alice.png'], disabled_members: [] };
    let chatMetadata = { world_info: 'BeforeWorld' };
    const worldRequests = [];
    try {
        globalThis.fetch = async (url, options = {}) => {
            if (url === '/csrf-token') return { json: async () => ({ token: 'csrf' }) };
            if (url === '/api/characters/export') {
                characterRequested();
                await characterGate;
                return { ok: true, blob: async () => new Blob(['card']) };
            }
            if (url === '/api/worldinfo/get') {
                worldRequests.push(JSON.parse(options.body).name);
                return { ok: true, json: async () => ({ entries: {} }) };
            }
            throw new Error(`Unexpected URL: ${url}`);
        };
        const exporting = createSystem({
            getCurrentGroup: () => group,
            getChatMetadata: () => chatMetadata,
            world_names: ['BeforeWorld', 'AfterWorld'], selected_world_info: [], world_info: {},
        }).exportGroup();
        await requested;
        group = { name: 'After', members: ['bob.png'], disabled_members: [] };
        chatMetadata = { world_info: 'AfterWorld' };
        releaseCharacter();
        await exporting;
        assert.deepEqual(worldRequests, ['BeforeWorld']);
        assert.equal(JSON.parse(ExportZip.latest.rootFiles.get('group.json')).name, 'Before');
        assert.equal(ExportZip.latest.folderFiles.get('characters').has('alice.png'), true);
    } finally { browser.restore(); }
});

test('failed archive download releases its temporary anchor and object URL', async () => {
    const browser = installBrowser(ExportZip);
    browser.anchor.click = () => { throw new Error('click failed'); };
    try {
        globalThis.fetch = async url => {
            if (url === '/csrf-token') return { json: async () => ({ token: 'csrf' }) };
            if (url === '/api/characters/export') return { ok: true, blob: async () => new Blob(['card']) };
            if (url === '/api/worldinfo/get') return { ok: true, json: async () => ({ entries: {} }) };
            throw new Error(`Unexpected URL: ${url}`);
        };
        const result = await createSystem().exportGroup();
        assert.equal(result.ok, false);
        assert.deepEqual(browser.resources, { created: 1, revoked: 1, appended: 1, removed: 1 });
        assert.equal(browser.notices.error.length, 1);
        assert.equal(browser.notices.success.length, 0);
    } finally { browser.restore(); }
});
