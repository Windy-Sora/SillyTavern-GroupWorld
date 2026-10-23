import { randomUUID } from '../runtime/crypto.js';
import { jsonKey } from '../core/json-contract.js';
import { prepareProviderDraft } from '../providers/draft.js';
import { checkedSyntheticReport } from '../providers/test-contract.js';

export function createProviderAssetPort({ getSettings, loader, getProviders, registerProvider, testRunner, changed = () => {} }) {
    let busy = false;
    const protectedIds = new Set();
    const liveProviders = () => {
        const rows = getProviders?.() || [];
        for (const p of rows) if (p._gdOwner !== 'group-director/user-provider') protectedIds.add(p.id);
        return rows;
    };
    liveProviders();
    const store = () => {
        const rows = getSettings()?.userProviders ?? [];
        if (!Array.isArray(rows) || rows.length > 4096) throw Error('PROVIDER_STORE_UNAVAILABLE');
        return rows;
    };
    const revisions = new Map();
    function revision(row) {
        const old = revisions.get(row.name);
        const fingerprint = JSON.stringify(row), instances = (row.ids || []).map(id => (getProviders?.() || []).find(p => p.id === id));
        if (!old || old.row !== row || old.fingerprint !== fingerprint || instances.some((p, i) => p !== old.instances[i])) revisions.set(row.name, { row, fingerprint, instances, id: randomUUID() });
        return revisions.get(row.name).id;
    }
    function assertNew(content) {
        const checked = prepareProviderDraft(content);
        if (jsonKey(checked) !== jsonKey(content)) throw Error('INVALID_PROVIDER_DRAFT');
        if (store().length >= 256) throw Error('PROVIDER_ASSET_CAPACITY');
        const current = liveProviders();
        if (store().some(row => row.name === content.name) || content.ids.some(id => protectedIds.has(id) || store().some(row => (row.ids || []).includes(id))) || current.some(p => content.ids.includes(p.id))) throw Error('PROVIDER_ASSET_EXISTS');
    }
    const owned = (provider, name) => provider?._gdOwner === 'group-director/user-provider' && provider._gdOwnerId === name;
    function existing(name, expected) {
        const row = store().find(row => row.name === name);
        if (!row || revision(row) !== expected) throw Error('STALE_PROVIDER_ASSET');
        if (store().filter(item => item.name === name).length !== 1) throw Error('PROVIDER_PROTECTED');
        if (!Array.isArray(row.ids) || row.ids.length > 8 || new Set(row.ids).size !== row.ids.length || row.ids.some(id => typeof id !== 'string' || id.length > 80)) throw Error('PROVIDER_ASSET_UNSUPPORTED');
        // Even legacy stored metadata cannot authorize a system/foreign registration.
        const current = liveProviders();
        if (row.ids.some(id => protectedIds.has(id) || current.some(p => p.id === id && !owned(p, name)))) throw Error('PROVIDER_PROTECTED');
        if (store().some(other => other !== row && (other.ids || []).some(id => row.ids.includes(id)))) throw Error('PROVIDER_PROTECTED');
        return row;
    }
    function previewUpdate({ name, revision: expected, source, ids }) {
        const row = existing(name, expected), draft = prepareProviderDraft({ name, source, ids }, { existingName: true });
        if (typeof row.source !== 'string' || row.source.length > 24000) throw Error('PROVIDER_ASSET_UNSUPPORTED');
        if (ids.some(id => protectedIds.has(id) || liveProviders().some(p => p.id === id && (!row.ids.includes(id) || !owned(p, name))) || store().some(other => other !== row && (other.ids || []).includes(id)))) throw Error('PROVIDER_PROTECTED');
        return { ...draft, operation: 'update', baseRevision: expected, previous: { source: row.source, ids: [...row.ids] }, warnings: [...draft.warnings.slice(0, 2), '仅替换此用户资产；省略的旧 ID 将卸载。系统与其他资产 ID 不可覆盖。'] };
    }
    function previewDelete({ name, revision: expected }) {
        const row = existing(name, expected);
        return { module: 'provider-asset', operation: 'delete', name, ids: [...row.ids], baseRevision: expected,
            warnings: ['删除此用户源码资产并卸载它仍拥有的 Provider ID；其他模板引用不会自动修复。', '删除后自动加载将不再恢复此资产；保存失败或结果未知时不要自动重试。'] };
    }
    function assertDraft(content) {
        if (!content.operation) return assertNew(content);
        const checked = content.operation === 'update' ? previewUpdate({ ...content, revision: content.baseRevision }) : content.operation === 'delete' ? previewDelete({ ...content, revision: content.baseRevision }) : null;
        if (!checked || jsonKey(checked) !== jsonKey(content)) throw Error('INVALID_PROVIDER_DRAFT');
    }
    return Object.freeze({
        list(offset = 0) {
            const rows = store();
            const liveNames = new Set(rows.map(row => row.name));
            for (const name of revisions.keys()) if (!liveNames.has(name)) revisions.delete(name);
            return { items: rows.slice(offset, offset + 32).map(row => ({ name: row.name, revision: revision(row), ids: [...(row.ids || [])].slice(0, 8), editable: !(row.ids || []).some(id => (getProviders?.() || []).some(p => p.id === id && !owned(p, row.name))) })),
                nextOffset: offset + 32 < rows.length ? offset + 32 : -1 };
        },
        read(name, expected, offset = 0) {
            const row = store().find(row => row.name === name);
            if (!row || revision(row) !== expected) throw Error('STALE_PROVIDER_ASSET');
            if (typeof row.source !== 'string' || row.source.length > 1048576 || offset > row.source.length) throw Error('PROVIDER_SOURCE_UNAVAILABLE');
            const text = row.source.slice(offset, offset + 8000);
            return { name, revision: expected, text, nextOffset: offset + text.length < row.source.length ? offset + text.length : -1 };
        },
        assertNew, assertDraft, previewUpdate, previewDelete,
        canTest: typeof testRunner === 'function',
        async test(content, { signal } = {}) {
            const checked = prepareProviderDraft(content, { existingName: content.operation === 'update' });
            if (content.operation) { assertDraft(content); if (content.operation !== 'update') throw Error('INVALID_PROVIDER_DRAFT'); }
            else if (jsonKey(checked) !== jsonKey(content)) throw Error('INVALID_PROVIDER_DRAFT');
            if (signal?.aborted) return { status: 'cancelled', phase: 'startup', rows: [] };
            if (typeof testRunner !== 'function') return { status: 'unavailable', phase: 'startup', rows: [] };
            return checkedSyntheticReport(await testRunner(checked, { signal }), checked.ids);
        },
        async install(content) {
            if (busy || !loader || typeof registerProvider !== 'function') throw Error('WRITE_UNAVAILABLE');
            if (content.operation) {
                assertDraft(content);
                const row = existing(content.name, content.baseRevision), settings = getSettings();
                const beforeInstances = new Map((getProviders?.() || []).map(p => [p.id, p]));
                const validate = () => {
                    if (getSettings() !== settings) throw Error('STALE_PROVIDER_ASSET');
                    assertDraft(content);
                    if (content.ids.some(id => (getProviders?.() || []).find(p => p.id === id) !== beforeInstances.get(id))) throw Error('STALE_PROVIDER_ASSET');
                };
                busy = true;
                try {
                    if (content.operation === 'delete') {
                        if (typeof loader.deleteAsset !== 'function') throw Error('WRITE_UNAVAILABLE');
                        validate();
                        const ok = await loader.deleteAsset(content.name, 'provider', row);
                        const gone = !store().some(item => item.name === content.name) && !content.ids.some(id => (getProviders?.() || []).some(p => p.id === id && owned(p, content.name)));
                        return { status: ok && gone && getSettings() === settings ? 'saved_unconfirmed' : 'outcome_unknown', name: content.name, registered: false, persistence: ok && gone ? 'unconfirmed' : 'unknown' };
                    }
                    if (typeof loader.replaceProviderSource !== 'function') throw Error('WRITE_UNAVAILABLE');
                    const result = await loader.replaceProviderSource(content.name, content.source, content.ids, { registerProvider }, { expectedEntry: row, validate, restoreProvider: registerProvider });
                    return { status: result.ok && getSettings() === settings ? 'saved_unconfirmed' : 'outcome_unknown', name: content.name, registered: result.ok, persistence: result.ok ? 'unconfirmed' : 'unknown' };
                } catch (error) {
                    if (error.message === 'WRITE_UNAVAILABLE') throw error;
                    return { status: 'outcome_unknown', name: content.name, registered: false, persistence: 'unknown' };
                } finally { busy = false; try { changed(); } catch { /* UI only. */ } }
            }
            assertNew(content); busy = true;
            const settings = getSettings();
            const validate = expectedRows => {
                if (getSettings() !== settings) throw Error('STALE_PROVIDER_ASSET');
                const rows = store();
                if (expectedRows && rows !== expectedRows) throw Error('STALE_PROVIDER_ASSET');
                if (rows.length >= 256) throw Error('PROVIDER_ASSET_CAPACITY');
                if (rows.some(row => row.name === content.name)) throw Error('PROVIDER_ASSET_EXISTS');
            };
            let started = false;
            try {
                const registered = new Set();
                const guardedRegister = provider => {
                    validate();
                    if (!provider || typeof provider.render !== 'function' || typeof provider.placeholder !== 'string' || !provider.placeholder || !content.ids.includes(provider.id) || registered.has(provider.id) || (getProviders() || []).some(p => p.id === provider.id)) throw Error('PROVIDER_REGISTRATION_CONFLICT');
                    const result = registerProvider(provider);
                    if (!result || typeof result.render !== 'function') throw Error('PROVIDER_REGISTRATION_INVALID');
                    registered.add(provider.id); return result;
                };
                started = true;
                const result = await loader.importSource(content.name, content.source, { registerProvider: guardedRegister,
                    log: () => {}, verifyRegistration: ids => ids.length === content.ids.length && content.ids.every(id => ids.includes(id)) }, { approvedSource: content.source, validate });
                try { changed(); } catch { /* Rendering cannot change the import result. */ }
                // Loader return cannot prove persistence, nor undo arbitrary top-level effects.
                return { status: result.ok ? 'saved_unconfirmed' : 'outcome_unknown', name: content.name,
                    registered: result.ok, persistence: result.ok ? 'unconfirmed' : 'unknown' };
            } catch (error) {
                if (!started) throw error;
                return { status: 'outcome_unknown', name: content.name, registered: false, persistence: 'unknown' };
            } finally { busy = false; }
        },
    });
}
