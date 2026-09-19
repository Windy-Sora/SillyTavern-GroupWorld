import test from 'node:test';
import assert from 'node:assert/strict';

import { createSummaryExportSystem } from '../../systems/summary-export-system.js';

function installDownloadDom() {
    const original = { document: globalThis.document, URL: globalThis.URL };
    const anchor = { click() {} };
    globalThis.document = { createElement: () => anchor, body: { appendChild() {}, removeChild() {} } };
    globalThis.URL = { createObjectURL: () => 'blob:summary', revokeObjectURL() {} };
    return { anchor, restore() { globalThis.document = original.document; globalThis.URL = original.URL; } };
}

function fixture(overrides = {}) {
    const settings = { lang: 'en' };
    const metadata = {};
    const calls = { saved: 0 };
    const dependencies = {
        settings,
        EXT_KEY: 'gd',
        getChatMetadata: () => metadata,
        saveChatConditional: async () => calls.saved++,
        getCurrentGroup: () => ({ name: 'Campaign' }),
        defaultSummaryPrompt: 'summarize',
        chatSummarySystem: { getLatestActive: () => ({ content: 'The party arrived.', timestamp: 10 }) },
        log: () => {},
        ...overrides,
    };
    return { system: createSummaryExportSystem(dependencies), metadata, calls };
}

function validExport() {
    return { version: 1, type: 'summary-export', source: { groupName: 'Group' }, template: { summaryPrompt: 'prompt' }, summary: { content: 'Previously...' } };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function transactionFixture(saveChatConditional = async () => {}) {
    let metadata = {};
    const system = createSummaryExportSystem({
        settings: { lang: 'en' }, EXT_KEY: 'gd',
        getChatMetadata: () => metadata, saveChatConditional,
        getCurrentGroup: () => null, chatSummarySystem: { getLatestActive: () => null }, log: () => {},
    });
    return { system, get metadata() { return metadata; }, set metadata(value) { metadata = value; } };
}

test('summary export returns null without content and downloads an active summary', () => {
    const empty = fixture({ chatSummarySystem: { getLatestActive: () => null } }).system;
    assert.equal(empty.exportActiveSummary(), null);

    const dom = installDownloadDom();
    try {
        const { system } = fixture();
        const data = system.exportActiveSummary('Session 1');
        assert.equal(data.summary.content, 'The party arrived.');
        assert.equal(data.template.summaryPrompt, 'summarize');
        assert.match(dom.anchor.download, /^summary-Session_1-/);
    } finally { dom.restore(); }
});

test('summary import validates the envelope and manages imported entries', async () => {
    const { system, calls } = fixture();
    assert.equal(system.parseImportFile('{').ok, false);
    assert.equal(system.parseImportFile('{}').ok, false);
    const data = { version: 1, type: 'summary-export', source: { groupName: 'Old Group' }, template: { summaryPrompt: 'old' }, summary: { content: 'Previously...' } };
    assert.equal(system.parseImportFile(JSON.stringify(data)).ok, true);

    const entry = await system.addImportedSummary(data);
    assert.equal(entry.name, 'Old Group');
    assert.equal(entry.enabled, true);
    await system.updateImportedSummary(entry.id, { name: 'Renamed' });
    await system.setEnabled(entry.id, false);
    assert.equal(system.renderEnabledSummaries().content, '');
    await system.setEnabled(entry.id, true);
    const rendered = system.renderEnabledSummaries();
    assert.equal(rendered.data.count, 1);
    assert.deepEqual(rendered.data.names, ['Renamed']);
    assert.match(rendered.content, /Previously/);
    await system.deleteImportedSummary(entry.id);
    assert.equal(system.getImportedSummaries().length, 0);
    assert.equal(calls.saved, 5);
});

test('summary updates and deletes ignore unknown identifiers', async () => {
    const { system, calls } = fixture();
    await system.updateImportedSummary('missing', { enabled: false });
    await system.deleteImportedSummary('missing');
    assert.equal(calls.saved, 0);
});

test('summary import rejects malformed nested data before mutating the chat', async () => {
    const h = transactionFixture();
    for (const malformed of [
        [],
        { ...validExport(), version: '1' },
        { ...validExport(), summary: [] },
        { ...validExport(), summary: { content: 42 } },
        { ...validExport(), source: [] },
        { ...validExport(), template: { summaryPrompt: 42 } },
    ]) {
        assert.equal(h.system.parseImportFile(JSON.stringify(malformed)).ok, false);
        await assert.rejects(h.system.addImportedSummary(malformed), TypeError);
        assert.deepEqual(h.metadata, {});
    }
});

test('summary update cannot replace an internal identifier or accept non-text content', async () => {
    const h = transactionFixture();
    const entry = await h.system.addImportedSummary(validExport());
    await h.system.updateImportedSummary(entry.id, { id: 'hijacked', createdAt: 0, content: 'edited' });
    assert.notEqual(entry.id, 'hijacked');
    assert.notEqual(entry.createdAt, 0);
    assert.equal(entry.content, 'edited');
    await assert.rejects(h.system.updateImportedSummary(entry.id, { content: 42 }), TypeError);
    assert.equal(entry.content, 'edited');
});

test('summary imported store and provider tolerate malformed legacy entries', () => {
    const h = transactionFixture();
    h.metadata.gd = { importedSummaries: {} };
    assert.deepEqual(h.system.getImportedSummaries(), []);
    h.metadata.gd.importedSummaries = [null, { name: 'bad', content: 42 }, { id: 'ok', name: 'Good', content: 'ready', enabled: true }];
    const rendered = h.system.renderEnabledSummaries();
    assert.equal(rendered.data.count, 1);
    assert.deepEqual(rendered.data.names, ['Good']);
});

test('failed summary add removes only its own entry after a later add', async () => {
    const gate = deferred();
    let saves = 0;
    const h = transactionFixture(() => ++saves === 1 ? gate.promise : Promise.resolve());
    const pending = h.system.addImportedSummary(validExport(), 'failed');
    const later = await h.system.addImportedSummary(validExport(), 'later');
    gate.reject(new Error('disk unavailable'));
    await assert.rejects(pending, /disk unavailable/);
    assert.deepEqual(h.system.getImportedSummaries(), [later]);
});

test('failed summary update restores only fields not superseded by newer writes', async () => {
    const gate = deferred();
    let saves = 0;
    const h = transactionFixture(() => ++saves === 2 ? gate.promise : Promise.resolve());
    const entry = await h.system.addImportedSummary(validExport(), 'before');
    const pending = h.system.updateImportedSummary(entry.id, { name: 'failed', content: 'failed content' });
    await h.system.updateImportedSummary(entry.id, { name: 'newer' });
    gate.reject(new Error('disk unavailable'));
    await assert.rejects(pending, /disk unavailable/);
    assert.equal(entry.name, 'newer');
    assert.equal(entry.content, 'Previously...');
});

test('failed summary update preserves a newer same-value write', async () => {
    const gate = deferred();
    let saves = 0;
    const h = transactionFixture(() => ++saves === 2 ? gate.promise : Promise.resolve());
    const entry = await h.system.addImportedSummary(validExport(), 'before');
    const pending = h.system.updateImportedSummary(entry.id, { name: 'shared' });
    await h.system.updateImportedSummary(entry.id, { name: 'shared' });
    gate.reject(new Error('disk unavailable'));
    await assert.rejects(pending, /disk unavailable/);
    assert.equal(entry.name, 'shared');
});

test('failed summary update removes a field absent before the operation', async () => {
    const gate = deferred();
    let saves = 0;
    const h = transactionFixture(() => ++saves === 2 ? gate.promise : Promise.resolve());
    const entry = await h.system.addImportedSummary(validExport());
    delete entry.enabled;
    const pending = h.system.updateImportedSummary(entry.id, { enabled: false });
    gate.reject(new Error('disk unavailable'));
    await assert.rejects(pending, /disk unavailable/);
    assert.equal(Object.hasOwn(entry, 'enabled'), false);
});

test('failed summary delete restores relative to surviving neighbors', async () => {
    const gate = deferred();
    let saves = 0;
    const h = transactionFixture(() => ++saves === 4 ? gate.promise : Promise.resolve());
    const first = await h.system.addImportedSummary(validExport(), 'first');
    const middle = await h.system.addImportedSummary(validExport(), 'middle');
    const last = await h.system.addImportedSummary(validExport(), 'last');
    const pending = h.system.deleteImportedSummary(middle.id);
    await h.system.deleteImportedSummary(first.id);
    gate.reject(new Error('disk unavailable'));
    await assert.rejects(pending, /disk unavailable/);
    assert.deepEqual(h.system.getImportedSummaries(), [middle, last]);
});

test('summary mutations reject a chat switch during save without touching the new chat', async () => {
    for (const operation of ['add', 'update', 'delete']) {
        const gate = deferred();
        let saves = 0;
        const h = transactionFixture(() => ++saves === (operation === 'add' ? 1 : 2) ? gate.promise : Promise.resolve());
        const entry = operation === 'add' ? null : await h.system.addImportedSummary(validExport());
        const pending = operation === 'add' ? h.system.addImportedSummary(validExport())
            : operation === 'update' ? h.system.updateImportedSummary(entry.id, { name: 'changed' })
                : h.system.deleteImportedSummary(entry.id);
        h.metadata = {};
        gate.resolve();
        await assert.rejects(pending, { name: 'StaleExecutionError' });
        assert.deepEqual(h.system.getImportedSummaries(), []);
    }
});

test('summary export releases its temporary node and URL on click failure', () => {
    const original = { document: globalThis.document, URL: globalThis.URL };
    const events = [];
    globalThis.document = {
        createElement: () => ({ click() { throw new Error('click failed'); } }),
        body: { appendChild() { events.push('append'); }, removeChild() { events.push('remove'); } },
    };
    globalThis.URL = { createObjectURL: () => 'blob:summary', revokeObjectURL() { events.push('revoke'); } };
    try {
        const { system } = fixture();
        assert.throws(() => system.exportActiveSummary(), /click failed/);
        assert.deepEqual(events, ['append', 'remove', 'revoke']);
    } finally {
        globalThis.document = original.document;
        globalThis.URL = original.URL;
    }
});

test('summary export revokes its URL when creating the temporary node fails', () => {
    const original = { document: globalThis.document, URL: globalThis.URL };
    const events = [];
    globalThis.document = { createElement() { throw new Error('DOM unavailable'); } };
    globalThis.URL = { createObjectURL: () => 'blob:summary', revokeObjectURL() { events.push('revoke'); } };
    try {
        const { system } = fixture();
        assert.throws(() => system.exportActiveSummary(), /DOM unavailable/);
        assert.deepEqual(events, ['revoke']);
    } finally {
        globalThis.document = original.document;
        globalThis.URL = original.URL;
    }
});
