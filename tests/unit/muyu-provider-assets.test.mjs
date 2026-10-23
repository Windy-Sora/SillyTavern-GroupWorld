import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareProviderDraft } from '../../muyu/providers/draft.js';
import { createProviderAssetPort } from '../../muyu/host/provider-assets.js';
import { createProviderAssetModule } from '../../muyu/modules/provider-assets/index.js';
import { createUserProviderLoader } from '../../systems/user-provider-loader.js';
import { createProviderInstallActions } from '../../muyu/actions/provider-install.js';
import { actionReceipt, validateReceipt, receiptContext } from '../../muyu/actions/receipts.js';
import { requiredSources } from '../../muyu/application/capabilities.js';
import { renderProviderInstall } from '../../muyu/ui/provider-install-view.js';

const source = 'export function register({registerProvider}) { registerProvider({id:"gold",placeholder:"{{gold}}",render:()=>({content:"10"})}); }';
const draft = () => prepareProviderDraft({ name: 'gold-system', source, ids: ['gold'] });
const fillProviders = (f, count) => { f.settings.userProviders = Array.from({ length: count }, (_, i) => ({ name: 'Saved ' + i, source: 'export function register() {}', ids: [] })); };
test('BUG-91F-03 Provider allows 256th and refuses 257th before loading code or saving', async () => runtime(async () => {
    let saves = 0; const f = fixture(async () => { saves++; }); fillProviders(f, 255);
    assert.equal((await f.port.install(draft())).status, 'saved_unconfirmed');
    assert.equal(f.settings.userProviders.length, 256);
    const next = prepareProviderDraft({ name: 'capacity', source: 'globalThis.__capacityProbe++; ' + source.replaceAll('gold', 'extra'), ids: ['extra'] });
    globalThis.__capacityProbe = 0;
    try { await assert.rejects(f.port.install(next), /PROVIDER_ASSET_CAPACITY/); assert.equal(globalThis.__capacityProbe, 0); }
    finally { delete globalThis.__capacityProbe; }
    assert.equal(saves, 1); assert.equal(f.port.list().items.length, 32);
}));
test('BUG-91F-03 concurrent capacity fill during digest prevents module execution', async () => runtime(async () => {
    let saves = 0; const f = fixture(async () => { saves++; }); fillProviders(f, 255);
    globalThis.__capacityProbe = 0;
    try {
        const content = prepareProviderDraft({ name: 'digest-race', source: 'globalThis.__capacityProbe++; ' + source, ids: ['gold'] });
        const pending = f.port.install(content); fillProviders(f, 256);
        assert.equal((await pending).status, 'outcome_unknown');
        assert.equal(globalThis.__capacityProbe, 0); assert.equal(saves, 0); assert.equal(f.registered.size, 0);
    } finally { delete globalThis.__capacityProbe; }
}));
test('BUG-91F-03 final Provider append check catches fill after registration', async () => runtime(async () => {
    let saves = 0; const f = fixture(async () => { saves++; }); fillProviders(f, 255);
    globalThis.__fillProviderCapacity = () => f.settings.userProviders.push({ name: 'Concurrent', source: '', ids: [] });
    try {
        const content = prepareProviderDraft({ name: 'register-race', source: source.replace('}); }', '}); globalThis.__fillProviderCapacity(); }'), ids: ['gold'] });
        assert.equal((await f.port.install(content)).status, 'outcome_unknown');
        assert.equal(f.settings.userProviders.length, 256); assert.equal(saves, 0); assert.equal(f.registered.size, 0);
        assert.ok(f.settings.userProviders.some(r => r.name === 'Concurrent'));
    } finally { delete globalThis.__fillProviderCapacity; }
}));
test('BUG-91F-03 over-limit legacy Provider collection remains readable and deletable', async () => {
    const f = fixture(); fillProviders(f, 257);
    const row = f.port.list().items[0]; assert.ok(f.port.read(row.name, row.revision).text);
    assert.equal((await f.port.install(f.port.previewDelete(row))).status, 'saved_unconfirmed');
    assert.equal(f.settings.userProviders.length, 256); assert.equal(f.port.list().items.length, 32);
});
function fixture(save = async () => {}, registrationTimeoutMs) {
    const settings = {}, registered = new Map();
    const registerProvider = p => { registered.set(p.id, p); return p; };
    const loader = createUserProviderLoader({ extension_settings: { gd: settings }, EXT_KEY: 'gd', saveSettings: save, log: () => {},
        getRegisteredProviderIds: () => [...registered.keys()], getRegisteredProvider: id => registered.get(id),
        registrationTimeoutMs, unregisterProvider: (id, owner) => {
            const p = registered.get(id); return p?._gdOwner === owner.owner && p?._gdOwnerId === owner.ownerId && registered.delete(id);
        } });
    const port = createProviderAssetPort({ getSettings: () => settings, loader, getProviders: () => [...registered.values()], registerProvider });
    return { port, loader, settings, registered };
}
async function runtime(fn) {
    const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
    const OriginalBlob = globalThis.Blob;
    let src;
    globalThis.Blob = class { constructor(parts) { src = parts.join(''); } };
    URL.createObjectURL = () => 'data:text/javascript,' + encodeURIComponent(src);
    URL.revokeObjectURL = () => {};
    try { await fn(); } finally { globalThis.Blob = OriginalBlob; URL.createObjectURL = create; URL.revokeObjectURL = revoke; }
}
test('Provider draft checks never execute top-level code and reject invalid/importing formats', () => {
    globalThis.__providerDraftProbe = 0;
    prepareProviderDraft({ name: 'probe', source: 'globalThis.__providerDraftProbe++; ' + source, ids: ['gold'] });
    assert.equal(globalThis.__providerDraftProbe, 0); delete globalThis.__providerDraftProbe;
    for (const change of [{ name: '../x' }, { ids: [] }, { ids: ['gold', 'gold'] }, { source: 'export const x = 1' }, { source: 'import x from "./x.js"; ' + source }]) assert.throws(() => prepareProviderDraft({ name: 'gold-system', source, ids: ['gold'], ...change }));
});
test('Provider asset reads are paginated, versioned, authorized and charged before returning', () => {
    const f = fixture(); f.settings.userProviders = [{ name: 'existing', source: 'x'.repeat(16001), ids: ['old'] }];
    const listed = f.port.list().items[0];
    assert.equal(f.port.read(listed.name, listed.revision).nextOffset, 8000);
    assert.equal(f.port.read(listed.name, listed.revision, 16000).text, 'x');
    f.settings.userProviders[0].source += 'new';
    assert.throws(() => f.port.read(listed.name, listed.revision), /STALE/);
    assert.deepEqual(requiredSources('muyu.provider.source', {}), ['source:providerAssets']);
    const m = createProviderAssetModule({ port: f.port, charge: () => false });
    assert.throws(() => m.handlers['muyu.provider.assets']({}, { runId: 'r' }), /BUDGET/);
    m.dispose();
});
test('Approved import registers exactly once and records a portable historical receipt without source', async () => runtime(async () => {
    let saves = 0; const f = fixture(async () => { saves++; });
    const content = draft(), artifact = { id: 'a', revision: 1, sessionId: 's', kind: 'provider-draft', content };
    const actions = createProviderInstallActions({ getArtifact: () => artifact, validate: () => f.port.assertNew(content), getTarget: () => ({ kind: 'global', userKey: 'u' }), writer: f.port });
    const approval = actions.prepare('a', 1);
    assert.equal(saves, 0); assert.equal(f.registered.size, 0);
    const pending = actions.approve(approval.id);
    assert.throws(() => actions.approve(approval.id), /STALE/);
    const done = await pending;
    assert.equal(done.status, 'saved_unconfirmed'); assert.equal(saves, 1); assert.equal(f.registered.size, 1);
    assert.equal((await f.registered.get('gold').render()).content, '10');
    const receipt = actionReceipt(done); assert.equal(receipt.version, 6);
    assert.deepEqual(validateReceipt(receipt), receipt); assert.doesNotMatch(receiptContext([receipt]), /export function/);
    await assert.rejects(f.port.install(content), /EXISTS/);
}));
test('Mismatched registration and failed saves roll back owned registration but report unknown side effects', async () => runtime(async () => {
    for (const failSave of [false, true]) {
        const f = fixture(async () => { if (failSave) throw Error('save failed'); });
        const content = failSave ? draft() : prepareProviderDraft({ name: 'empty', source: 'export function register(deps) {}', ids: ['gold'] });
        const result = await f.port.install(content);
        assert.equal(result.status, 'outcome_unknown'); assert.equal(f.registered.size, 0);
        assert.deepEqual(f.settings.userProviders, []);
    }
}));
test('New Provider draft fails closed on existing asset names or built-in IDs before code dispatch', async () => {
    const f = fixture(); f.registered.set('gold', { id: 'gold' });
    await assert.rejects(f.port.install(draft()), /EXISTS/);
    f.registered.clear(); f.settings.userProviders = [{ name: 'gold-system', source, ids: [] }];
    assert.throws(() => f.port.assertNew(draft()), /EXISTS/);
});
test('Exact-source import approval avoids duplicate dangerous-API confirmation without running render', async () => runtime(async () => {
    const f = fixture();
    const content = prepareProviderDraft({ name: 'network-provider', ids: ['gold'], source: source.replace('content:"10"', 'content:"10", network:()=>fetch("https://example.test")') });
    const result = await f.port.install(content);
    assert.equal(result.status, 'saved_unconfirmed');
    assert.equal(f.registered.size, 1);
}));
test('Provider import card renders source as text, requires confirmation and retains unknown outcomes', () => {
    const doc = { createElement: tag => ({ tag, children: [], append(el) { this.children.push(el); } }) };
    const card = doc.createElement('div'); let prepared = 0, installed = 0;
    const content = draft(), artifact = { id: 'a', revision: 1, content };
    const controller = { prepareProviderInstall() { prepared++; }, approveProviderInstall() { installed++; } };
    const render = state => { card.children = []; renderProviderInstall({ doc, card, artifact, state: { canInstallProvider: true, ...state }, controller, act: fn => fn(), lang: 'en' }); };
    render({});
    assert.equal(card.children.find(el => el.tag === 'details').children[1].children[0].textContent, source);
    assert.equal(installed, 0); card.children.find(el => el.tag === 'button').onclick(); assert.equal(prepared, 1);
    render({ providerActions: [{ id: 'action', artifactId: 'a', revision: 1, status: 'pending' }] });
    assert.equal(card.children.find(el => el.tag === 'details').open, true);
    card.children.find(el => el.textContent === 'Import and register').onclick(); assert.equal(installed, 1);
    render({ providerActions: [{ id: 'action', artifactId: 'a', revision: 1, status: 'outcome_unknown' }] });
    assert.equal(card.children.some(el => el.tag === 'button'), false);
    assert.ok(card.children.some(el => String(el.textContent).includes('do not retry')));
});

test('Imported user assets can be replaced and deleted; exact versions and portable operation receipts are retained', async () => runtime(async () => {
    const f = fixture(); await f.loader.importSource('gold-system', source, { registerProvider: p => { f.registered.set(p.id, p); return p; } });
    const baseline = f.port.list().items[0], old = f.registered.get('gold');
    const content = f.port.previewUpdate({ name: baseline.name, revision: baseline.revision, source: source.replace('content:"10"', 'content:"20"'), ids: ['gold'] });
    assert.equal(f.registered.get('gold'), old); assert.equal(content.previous.source, source);
    const artifact = { id: 'update', revision: 1, sessionId: 's', kind: 'provider-draft', content };
    const actions = createProviderInstallActions({ getArtifact: () => artifact, validate: () => f.port.assertDraft(content), getTarget: () => ({ kind: 'global', userKey: 'u' }), writer: f.port });
    const done = await actions.approve(actions.prepare('update', 1).id);
    assert.equal(done.status, 'saved_unconfirmed'); assert.equal((await f.registered.get('gold').render()).content, '20');
    assert.notEqual(f.registered.get('gold'), old);
    const receipt = actionReceipt(done); assert.equal(receipt.version, 7); assert.equal(receipt.operation, 'update'); assert.deepEqual(validateReceipt(receipt), receipt);
    assert.doesNotMatch(receiptContext([receipt]), /export function/);
    assert.throws(() => f.port.assertDraft(content), /STALE/);
    const now = f.port.list().items[0], deletion = f.port.previewDelete({ name: now.name, revision: now.revision });
    assert.equal(f.settings.userProviders.length, 1);
    const deleted = await f.port.install(deletion);
    assert.equal(deleted.status, 'saved_unconfirmed'); assert.equal(f.settings.userProviders.length, 0); assert.equal(f.registered.size, 0);
    const deleteReceipt = actionReceipt({ id: 'del', artifactId: 'delete', revision: 1, status: deleted.status, content: deletion, result: deleted });
    assert.equal(validateReceipt(deleteReceipt).operation, 'delete');
}));

test('System and foreign Provider IDs are protected even if old asset metadata claims them', async () => runtime(async () => {
    const f = fixture(); await f.port.install(draft());
    f.registered.set('system', { id: 'system', placeholder: '{{system}}', render: () => 'core' });
    f.registered.set('foreign', { id: 'foreign', _gdOwner: 'other-plugin', _gdOwnerId: 'x' });
    const baseline = f.port.list().items[0];
    for (const id of ['system', 'foreign']) assert.throws(() => f.port.previewUpdate({ name: baseline.name, revision: baseline.revision, source: source.replace('id:"gold"', `id:"${id}"`), ids: [id] }), /PROTECTED/);
    f.settings.userProviders[0].ids.push('system');
    const fresh = f.port.list().items[0]; assert.equal(fresh.editable, false);
    assert.throws(() => f.port.previewDelete({ name: fresh.name, revision: fresh.revision }), /PROTECTED/);
    assert.equal(f.registered.get('system').render(), 'core');
}));

test('Replacement failure restores exact old source and instances without deleting unrelated edits', async () => runtime(async () => {
    let fail = false; const f = fixture(async () => { if (fail) { f.settings.userProviders.push({ name: 'concurrent', source: 'new', ids: [] }); throw Error('save failed'); } });
    await f.port.install(draft()); const old = f.registered.get('gold'), before = f.settings.userProviders[0]; fail = true;
    const baseline = f.port.list().items[0], content = f.port.previewUpdate({ name: baseline.name, revision: baseline.revision, source: source.replace('content:"10"', 'content:"20"'), ids: ['gold'] });
    const result = await f.port.install(content);
    assert.equal(result.status, 'outcome_unknown'); assert.equal(f.settings.userProviders[0], before); assert.equal(f.registered.get('gold'), old);
    assert.equal(f.settings.userProviders[1].name, 'concurrent');
}));

test('Replacement registration mismatch rolls back; omitted owned IDs unload only after successful save', async () => runtime(async () => {
    const f = fixture(); await f.port.install(draft()); const old = f.registered.get('gold');
    let baseline = f.port.list().items[0];
    const bad = f.port.previewUpdate({ name: baseline.name, revision: baseline.revision, source: 'export function register(deps) {}', ids: ['gold'] });
    assert.equal((await f.port.install(bad)).status, 'outcome_unknown'); assert.equal(f.registered.get('gold'), old);
    baseline = f.port.list().items[0];
    const next = f.port.previewUpdate({ name: baseline.name, revision: baseline.revision, source: source.replace('id:"gold"', 'id:"silver"'), ids: ['silver'] });
    assert.equal((await f.port.install(next)).status, 'saved_unconfirmed'); assert.equal(f.registered.has('gold'), false); assert.equal(f.registered.has('silver'), true);
}));

test('A fresh same-source runtime registration invalidates the previous mutation draft', async () => runtime(async () => {
    const f = fixture(); await f.port.install(draft());
    const baseline = f.port.list().items[0], content = f.port.previewDelete({ name: baseline.name, revision: baseline.revision });
    const old = f.registered.get('gold'); f.registered.set('gold', { ...old });
    await assert.rejects(f.port.install(content), /STALE/); assert.equal(f.settings.userProviders.length, 1);
}));

test('Delete save failure and concurrent reimport retain live user assets and registrations', async () => runtime(async () => {
    for (const rejectSave of [true, false]) {
        let mutate = false;
        const f = fixture(async () => { if (mutate) {
            const other = { ...old, render: () => ({ content: 'concurrent' }) };
            f.registered.set('gold', other); f.settings.userProviders.push({ ...before, source: 'concurrent source' });
            if (rejectSave) throw Error('save failed');
        } });
        await f.port.install(draft()); const old = f.registered.get('gold'), before = f.settings.userProviders[0];
        const baseline = f.port.list().items[0], content = f.port.previewDelete({ name: baseline.name, revision: baseline.revision }); mutate = true;
        assert.equal((await f.port.install(content)).status, 'outcome_unknown');
        assert.equal(f.settings.userProviders.length, 1); assert.equal(f.settings.userProviders[0].source, 'concurrent source');
        assert.equal((await f.registered.get('gold').render()).content, 'concurrent');
    }
}));

test('Replacement save failure cannot erase concurrent replacement source or registration', async () => runtime(async () => {
    let mutate = false; const f = fixture(async () => { if (mutate) {
        f.settings.userProviders[0].source = 'concurrent source';
        f.registered.set('gold', { ...f.registered.get('gold'), render: () => 'concurrent' }); throw Error('save failed');
    } });
    await f.port.install(draft()); const baseline = f.port.list().items[0]; mutate = true;
    const content = f.port.previewUpdate({ name: baseline.name, revision: baseline.revision, source: source.replace('content:"10"', 'content:"20"'), ids: ['gold'] });
    assert.equal((await f.port.install(content)).status, 'outcome_unknown');
    assert.equal(f.settings.userProviders[0].source, 'concurrent source'); assert.equal(f.registered.get('gold').render(), 'concurrent');
}));

test('Mutation drafts render before/after source and explicit deletion rather than import controls', () => {
    const doc = { createElement: tag => ({ tag, children: [], append(el) { this.children.push(el); } }) }, card = doc.createElement('div');
    const content = { ...draft(), operation: 'update', baseRevision: 'v', previous: { source: 'OLD_SOURCE', ids: ['old'] } }, artifact = { id: 'a', revision: 1, content };
    const state = { canInstallProvider: true, providerActions: [{ id: 'p', artifactId: 'a', revision: 1, status: 'pending' }] };
    renderProviderInstall({ doc, card, artifact, state, controller: {}, act: fn => fn(), lang: 'en' });
    assert.ok(card.children.some(el => el.textContent === 'Replace and register'));
    assert.match(JSON.stringify(card), /OLD_SOURCE/);
    card.children = []; artifact.content = { ...content, operation: 'delete' };
    renderProviderInstall({ doc, card, artifact, state, controller: {}, act: fn => fn(), lang: 'en' });
    assert.ok(card.children.some(el => el.textContent === 'Delete and unload'));
    assert.doesNotMatch(JSON.stringify(card), /OLD_SOURCE/);
});

test('Timed-out replacement restores prior instances and prevents its late register calls', async () => runtime(async () => {
    let release; globalThis.__replacementWait = new Promise(resolve => { release = resolve; });
    const f = fixture(async () => {}, 20); await f.port.install(draft()); const before = f.registered.get('gold');
    const baseline = f.port.list().items[0];
    const code = 'export async function register({registerProvider}) {registerProvider({id:"gold",placeholder:"{{gold}}",render:()=>"new"}); await globalThis.__replacementWait; registerProvider({id:"silver",placeholder:"{{silver}}",render:()=>"late"});}';
    const content = f.port.previewUpdate({ name: baseline.name, revision: baseline.revision, source: code, ids: ['gold', 'silver'] });
    try {
        assert.equal((await f.port.install(content)).status, 'outcome_unknown'); assert.equal(f.registered.get('gold'), before);
        release(); await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(f.registered.has('silver'), false);
    } finally { release(); delete globalThis.__replacementWait; }
}));

test('Protected IDs remain reserved after their runtime instance disappears', async () => runtime(async () => {
    const f = fixture(); f.registered.set('system', { id: 'system' }); await f.port.install(draft());
    f.registered.delete('system'); const baseline = f.port.list().items[0];
    assert.throws(() => f.port.previewUpdate({ name: baseline.name, revision: baseline.revision, source: source.replace('id:"gold"', 'id:"system"'), ids: ['system'] }), /PROTECTED/);
}));

test('Existing Unicode asset names can be replaced without opening path-like new asset names', async () => runtime(async () => {
    const f = fixture(); await f.loader.importAsset({ name: '金币系统.js' }, 'provider', { registerProvider: p => { f.registered.set(p.id, p); return p; } }, source);
    const baseline = f.port.list().items[0];
    const content = f.port.previewUpdate({ name: baseline.name, revision: baseline.revision, source: source.replace('content:"10"', 'content:"20"'), ids: ['gold'] });
    assert.equal((await f.port.install(content)).status, 'saved_unconfirmed'); assert.equal((await f.registered.get('gold').render()).content, '20');
}));

test('Successful save with concurrent source or omitted-instance changes reports unknown without pruning them', async () => runtime(async () => {
    for (const mode of ['source', 'omitted']) {
        let mutate = false; const f = fixture(async () => { if (mutate) {
            if (mode === 'source') f.settings.userProviders[0].source = 'concurrent source';
            else f.registered.set('gold', { ...f.registered.get('gold'), render: () => 'concurrent' });
        } });
        await f.port.install(draft()); const baseline = f.port.list().items[0]; mutate = true;
        const content = f.port.previewUpdate({ name: baseline.name, revision: baseline.revision, source: source.replace('id:"gold"', 'id:"silver"'), ids: ['silver'] });
        assert.equal((await f.port.install(content)).status, 'outcome_unknown');
        if (mode === 'source') assert.equal(f.settings.userProviders[0].source, 'concurrent source');
        else assert.equal(f.registered.get('gold').render(), 'concurrent');
    }
}));
