import { openIndexedHistoryStore } from '../sessions/indexeddb-store.js';
import { openServerHistoryStore } from '../sessions/server-store.js';
import { openSettingsHistoryStore } from '../sessions/settings-store.js';
import { sha256 } from '../runtime/crypto.js';
import { openRecoveryStore } from '../recovery/indexeddb-store.js';
import { openStWorldBookHistoryStore } from './worldbook-history.js';
import { serializeSettings } from '../storage/settings-queue.js';
import { openRoutedHistoryStore, HISTORY_SOURCES, historyTargets } from '../sessions/routed-store.js';
import { volumeTargetMiB } from '../sessions/worldbook-volume.js';

export function historyStorageChoice(settings) {
    const choice = settings.muyuHistoryStorage;
    if (choice == null) return settings.muyuHistoryAccountStorage === true ? 'account-settings' : 'auto';
    return ['auto', 'world-book', 'account-settings'].includes(choice) ? choice : 'invalid';
}
/** Only the host composition layer supplies account identity, never the model or an import. */
export function createHistoryPort({ getAccount, getSettings, saveSettings, openStore = openIndexedHistoryStore, openRecovery = openRecoveryStore, openServer = openServerHistoryStore, openWorldBook = openStWorldBookHistoryStore, fetcher = null, getHeaders = () => ({}) }) {
    const activeStorage = historyStorageChoice(getSettings());
    const initialReadSource = getSettings().muyuHistoryReadSource;
    let resolvedSource = null;
    async function setRouting({ readSource, writeTargets }) {
        if (!HISTORY_SOURCES.includes(readSource)) throw Error('HISTORY_INVALID');
        const targets = historyTargets(writeTargets), settings = getSettings();
        return serializeSettings(settings, async () => {
            if (getSettings() !== settings) throw Error('HISTORY_IDENTITY_UNAVAILABLE');
            const previous = { muyuHistoryReadSource: settings.muyuHistoryReadSource, muyuHistoryWriteTargets: settings.muyuHistoryWriteTargets };
            const next = { muyuHistoryReadSource: readSource, muyuHistoryWriteTargets: targets };
            Object.assign(settings, next);
            try { await saveSettings(); if (getSettings() !== settings) throw Error('HISTORY_IDENTITY_UNAVAILABLE'); }
            catch {
                for (const key of Object.keys(next)) if (settings[key] === next[key]) { if (previous[key] === undefined) delete settings[key]; else settings[key] = previous[key]; }
                throw Error('HISTORY_SETTINGS_FAILED');
            }
        });
    }
    async function setStorage(choice) {
        if (!['auto', 'world-book', 'account-settings'].includes(choice)) throw Error('HISTORY_INVALID');
        const settings = getSettings();
        return serializeSettings(settings, async () => {
            if (getSettings() !== settings) throw Error('HISTORY_IDENTITY_UNAVAILABLE');
            const previous = { muyuHistoryStorage: settings.muyuHistoryStorage, muyuHistoryAccountStorage: settings.muyuHistoryAccountStorage };
            const next = { muyuHistoryStorage: choice, muyuHistoryAccountStorage: choice === 'account-settings' };
            Object.assign(settings, next);
            try { await saveSettings(); if (getSettings() !== settings) throw Error('HISTORY_IDENTITY_UNAVAILABLE'); }
            catch {
                for (const key of Object.keys(next)) if (settings[key] === next[key]) {
                    if (previous[key] === undefined) delete settings[key]; else settings[key] = previous[key];
                }
                throw Error('HISTORY_SETTINGS_FAILED');
            }
        });
    }
    async function accountKey() {
        let account;
        try { account = await getAccount?.(); } catch { throw Error('HISTORY_IDENTITY_UNAVAILABLE'); }
        // Single-user mode is an explicit host fact, not a fallback on lookup failure.
        if (account?.enabled === false) return JSON.stringify(['single-user']);
        if (account?.enabled !== true || typeof account.handle !== 'string' || !account.handle || account.handle.length > 256 || !Number.isSafeInteger(account.created) || account.created < 0) throw Error('HISTORY_IDENTITY_UNAVAILABLE');
        return JSON.stringify(['account', account.handle, account.created]);
    }
    const port = {
        enabled: () => getSettings().muyuHistoryEnabled === true,
        worldBookTargetMiB: () => volumeTargetMiB(getSettings().muyuHistoryVolumeMiB),
        async setWorldBookTargetMiB(value) {
            value = volumeTargetMiB(value);
            const settings = getSettings();
            return serializeSettings(settings, async () => {
                if (getSettings() !== settings) throw Error('HISTORY_IDENTITY_UNAVAILABLE');
                const previous = settings.muyuHistoryVolumeMiB;
                settings.muyuHistoryVolumeMiB = value;
                try { await saveSettings(); if (getSettings() !== settings) throw Error('HISTORY_IDENTITY_UNAVAILABLE'); }
                catch {
                    if (settings.muyuHistoryVolumeMiB === value) {
                        if (previous === undefined) delete settings.muyuHistoryVolumeMiB; else settings.muyuHistoryVolumeMiB = previous;
                    }
                    throw Error('HISTORY_SETTINGS_FAILED');
                }
            });
        },
        routing() {
            const readSource = getSettings().muyuHistoryReadSource ?? resolvedSource ?? (activeStorage === 'auto' ? null : activeStorage);
            return { readSource, writeTargets: getSettings().muyuHistoryWriteTargets == null ? HISTORY_SOURCES.includes(readSource) ? [readSource] : [] : historyTargets(getSettings().muyuHistoryWriteTargets) };
        },
        setRouting,
        openSource: source => port.open({ source }),
        async openRecovery() {
            const identity = await accountKey();
            const digest = await sha256('gd-muyu-recovery-v1:' + identity);
            const namespace = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
            const store = await openRecovery({ namespace });
            const check = async () => { if (await accountKey() !== identity) throw Error('HISTORY_IDENTITY_UNAVAILABLE'); };
            try { await check(); } catch (e) { store.close(); throw e; }
            return {
                async list() { await check(); const rows = await store.list(); await check(); return rows; },
                async write(value, revision) { await check(); const saved = await store.write(value, revision); await check(); return saved; },
                async remove(id, revision) { await check(); const result = await store.remove(id, revision); await check(); return result; },
                close: () => store.close(),
            };
        },
        storageChoice: () => historyStorageChoice(getSettings()),
        activeStorage: () => activeStorage,
        setStorage,
        accountStorage: () => historyStorageChoice(getSettings()) === 'account-settings',
        activeAccountStorage: () => activeStorage === 'account-settings',
        async setAccountStorage(enabled) {
            if (typeof enabled !== 'boolean') throw Error('HISTORY_INVALID');
            return setStorage(enabled ? 'account-settings' : 'auto');
        },
        async setEnabled(enabled) {
            const settings = getSettings(), previous = settings.muyuHistoryEnabled;
            settings.muyuHistoryEnabled = enabled;
            try { await saveSettings(); }
            catch { if (settings.muyuHistoryEnabled === enabled) settings.muyuHistoryEnabled = previous; throw Error('HISTORY_SETTINGS_FAILED'); }
        },
        async open({ source = initialReadSource } = {}) {
            if (source == null && activeStorage === 'invalid' || source != null && !HISTORY_SOURCES.includes(source)) throw Error('HISTORY_INVALID');
            const identity = await accountKey();
            const check = async () => { if (await accountKey() !== identity) throw Error('HISTORY_IDENTITY_UNAVAILABLE'); };
            // Stable across first-enable races. Hashing reduces raw identifiers at rest;
            // this is NOT encryption or a boundary against hostile same-origin scripts.
            const digest = await sha256('gd-muyu-history-v1:' + identity);
            const hex = [...new Uint8Array(digest)].slice(0, 16).map(n => n.toString(16).padStart(2, '0')).join('');
            const namespace = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
            let initialServer = null;
            if (source == null) {
                if (activeStorage !== 'auto') source = activeStorage;
                else if (resolvedSource) source = resolvedSource;
                else { initialServer = await openServer({ namespace, fetcher, headers: getHeaders }); source = initialServer ? 'server' : 'browser'; }
            }
            await check();
            const opened = await openRoutedHistoryStore({ source, namespace, check,
                getTargets: () => getSettings().muyuHistoryWriteTargets == null ? [source] : historyTargets(getSettings().muyuHistoryWriteTargets),
                open: async key => {
                    await check();
                    if (key === 'browser') return openStore({ namespace });
                    if (key === 'world-book') return openWorldBook({ namespace, fetcher, getHeaders, assertIdentity: check, getTargetMiB: port.worldBookTargetMiB });
                    if (key === 'server') { const server = initialServer; initialServer = null; return server || openServer({ namespace, fetcher, headers: getHeaders }); }
                    return openSettingsHistoryStore({ namespace, getSettings, saveSettings: async () => { await check(); await saveSettings(); await check(); } });
                } });
            if (resolvedSource === null) resolvedSource = source;
            return opened;
        },
    };
    return port;
}
