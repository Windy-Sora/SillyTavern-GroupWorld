import { randomUUID } from '../runtime/crypto.js';
import { peekProfiles, peekMemories, latestActiveSummary } from '../../systems/provider-read-data.js';
import { providerCatalog } from '../modules/providers/catalog.js';
import { readExtendedSource } from './extended-sources.js';
import { readMemoryConfig } from './config-read.js';
import { readVariables, readVariableDiagnostics, readBlueprint } from './story-sources.js';
import { readStSource } from './st-sources.js';
import { readWorldBookOverview, readWorldBookEntries } from './st-world-books.js';
import { readStPresets, readStPersonas, readStExtensions } from './st-directories.js';
import { readStPresetContent } from './st-preset-content.js';
import { copyJson } from '../core/json-contract.js';
import { contextRequirements, missingContext, providerContext } from './provider-context.js';
import { getTrustedProviderDigest } from '../../systems/user-provider-loader.js';
export { providerCatalog } from '../modules/providers/catalog.js';
const text = value => typeof value === 'string' ? value : '';
const bounded = value => { if (value.length > 131072) throw Error('SOURCE_TOO_LARGE'); return value; };
/** Fixed built-in identities captured by the extension, not discovered from model input. */
export function createProviderPort({ getContext, getSettings, extensionKey, bindings = [], getProviders, worldBooks, stDirectories, stDiagnostics, stPromptSnapshots, services, trustedDigest = getTrustedProviderDigest }) {
    const trusted = new Map(bindings.map(p => [p.id, { object: p, render: p.render, enabled: p.enabled }]));
    const exposed = new Map();
    const stableDigest = (p, requirements) => {
        const digest = trustedDigest(p);
        return p._gdOwner === 'group-director/user-provider' && /^[0-9a-f]{64}$/.test(digest)
            ? `${digest}-${Number(requirements.includes('chatMessages')) + 2 * Number(requirements.includes('characterCard'))}` : null;
    };
    function discover() {
        const entries = getProviders?.() || [];
        if (!Array.isArray(entries) || entries.length > 256) return [];
        const found = [];
        for (const p of entries) {
            if (!p || typeof p.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(p.id) || typeof p.render !== 'function' || p.enabled === false || providerCatalog.some(s => s.id === p.id)) continue;
            const requirements = contextRequirements(p);
            if (!requirements) continue;
            const old = exposed.get(p.id);
            if (!old || old.object !== p || old.render !== p.render || old.enabled !== p.enabled || old.context.join(',') !== requirements.join(',')) {
                const mutated = old?.object === p;
                exposed.set(p.id, { object: p, render: p.render, enabled: p.enabled,
                    context: requirements, revision: !mutated && stableDigest(p, requirements) || randomUUID(), instance: randomUUID() });
            }
            found.push({ id: p.id, revision: exposed.get(p.id).revision, origin: p._gdOwner === 'group-director/user-provider' ? 'user' : 'registered', description: typeof p.placeholder === 'string' ? p.placeholder.slice(0, 120) : '', context: requirements, missingContext: missingContext(requirements, getContext()) });
            if (found.length >= 256) break;
        }
        for (const id of exposed.keys()) if (!found.some(p => p.id === id)) exposed.delete(id);
        return found;
    }
    function describe(id, revision) { return discover().find(p => p.id === id && p.revision === revision) || null; }
    async function execute(id, revision, signal, projection = 'content') {
        const descriptor = describe(id, revision);
        if (!descriptor) throw Error('SOURCE_UNAVAILABLE');
        if (descriptor.missingContext.length) throw Error('CONTEXT_UNAVAILABLE');
        const p = exposed.get(id);
        const instance = p.instance;
        let rendered;
        const chat = getContext();
        const context = providerContext(chat, p.context);
        try { if (typeof p.enabled === 'function' && !p.enabled(context)) throw Error('SOURCE_DISABLED'); } catch { throw Error('OUTCOME_UNKNOWN'); }
        try { rendered = await p.render(context, signal); } catch { throw Error('OUTCOME_UNKNOWN'); }
        if (!describe(id, revision) || exposed.get(id)?.instance !== instance) throw Error('OUTCOME_UNKNOWN');
        let value;
        try { value = projection === 'data' ? JSON.stringify(copyJson(rendered?.data)) : typeof rendered === 'string' ? rendered : rendered?.content; }
        catch { throw Error('OUTCOME_UNKNOWN'); }
        if (typeof value !== 'string') throw Error('OUTCOME_UNKNOWN');
        if (value.length > 131072) throw Error('OUTCOME_UNKNOWN');
        return value;
    }
    function available(id) {
        const source = providerCatalog.find(p => p.id === id);
        if (source?.reader === 'st') return typeof getContext === 'function';
        if (source?.reader === 'stWorldBooks') return typeof worldBooks?.getState === 'function';
        if (source?.reader === 'stWorldBookEntries') return typeof worldBooks?.getState === 'function' && typeof worldBooks?.load === 'function';
        if (source?.reader === 'stPresets') return typeof getContext === 'function';
        if (source?.reader === 'stPresetContent') return typeof getContext === 'function';
        if (source?.reader === 'stPromptOverview' || source?.reader === 'stPromptText') return typeof stPromptSnapshots?.read === 'function';
        if (source?.reader === 'stDiagnostics') return typeof stDiagnostics?.read === 'function';
        if (source?.reader === 'serviceDiagnostics') return typeof services?.readDiagnostics === 'function';
        if (source?.reader === 'stPersonas') return typeof getContext === 'function';
        if (source?.reader === 'stExtensions') return typeof stDirectories?.getExtensions === 'function';
        if (source && source.reader !== 'legacy') return typeof getSettings === 'function' && typeof getContext === 'function';
        id = providerCatalog.find(p => p.id === id)?.provider;
        const saved = trusted.get(id), current = getProviders?.().find(p => p.id === id);
        return !!saved && current === saved.object && current.render === saved.render && current.enabled === saved.enabled && !current._gdOwner;
    }
    function legacyRead(id, selector) {
        if (!providerCatalog.some(p => p.id === id) || !available(id)) throw Error('SOURCE_UNAVAILABLE');
        const ctx = getContext(), metadata = ctx.chatMetadata, settings = getSettings();
        if (providerCatalog.find(p => p.id === id)?.permission === 'extended') return readExtendedSource(id, selector, ctx, extensionKey, { text, bounded });
        if (id === 'recentMessages') {
            if (selector) throw Error('INVALID_SELECTOR');
            const all = Array.isArray(ctx.chat) ? ctx.chat : [], start = Math.max(0, all.length - 50);
            let content = '';
            for (let i = start; i < all.length; i++) {
                const m = all[i]; content = bounded(content + `[${i}] ${text(m?.name) || (m?.is_user ? 'User' : 'Character')}: ${text(m?.mes)}\n`);
            }
            return { text: content, limited: start > 0 };
        }
        if (id === 'chatSummary') {
            if (selector) throw Error('INVALID_SELECTOR');
            if (!settings.summaryEnabled) throw Error('SOURCE_DISABLED');
            return { text: bounded(text(latestActiveSummary(metadata?.[extensionKey]?.summaries)?.content)), limited: false };
        }
        const profiles = id === 'character_profiles', store = profiles ? peekProfiles(metadata, extensionKey) : peekMemories(metadata, extensionKey);
        const keys = Object.keys(store);
        if (keys.length > 256) throw Error('SOURCE_TOO_LARGE');
        const entries = keys.filter(k => profiles ? store[k]?.state === 'ready' : Array.isArray(store[k]) && store[k].length);
        const name = k => profiles ? text(store[k]?.name) : text(ctx.characters?.find(c => c.avatar === k)?.name) || 'Character';
        if (!selector) return { text: bounded(entries.map((k, i) => `character:${i} ${name(k).slice(0, 200)}`).join('\n')), limited: false, directory: entries };
        if (!/^character:(0|[1-9]\d{0,2})$/.test(selector)) throw Error('INVALID_SELECTOR');
        const k = entries[Number(selector.slice(10))]; if (k === undefined) throw Error('INVALID_SELECTOR');
        let content = name(k) + '\n';
        if (profiles) {
            // Fixed textual fields only; no arbitrary raw-schema serialization.
            const profile = store[k]?.profile || {};
            for (const field of ['summary', 'motivation', 'relationships']) content = bounded(content + field + ': ' + text(profile[field]) + '\n');
            if (Array.isArray(profile.tags)) { if (profile.tags.length > 128) throw Error('SOURCE_TOO_LARGE'); content = bounded(content + 'tags: ' + profile.tags.map(text).join(', ')); }
        } else {
            const memories = store[k]; if (memories.length > 2048) throw Error('SOURCE_TOO_LARGE');
            for (let i = 0; i < memories.length; i++) content = bounded(content + `[${i}] ${text(memories[i]?.event)} [${text(memories[i]?.mood)}]\n`);
        }
        // Include the directory in the private revision evidence, never expose avatar paths.
        return { text: content, limited: profiles && Object.keys(store[k]?.profile || {}).some(field => !['summary', 'motivation', 'relationships', 'tags'].includes(field)), identity: k, directory: entries.map(key => [key, name(key)]) };
    }
    const readers = Object.freeze({
        legacy: legacyRead,
        memoryConfig: (_id, selector) => { if (selector) throw Error('INVALID_SELECTOR'); return { data: readMemoryConfig(getSettings) }; },
        variables: (_id, selector) => readVariables(selector, getContext(), extensionKey),
        variableDiagnostics: (_id, selector) => readVariableDiagnostics(selector, getContext(), extensionKey),
        storyBlueprint: (_id, selector) => readBlueprint(selector, getContext(), extensionKey, getSettings()),
        st: (id, selector) => readStSource(id, selector, getContext()),
        stWorldBooks: (_id, selector) => readWorldBookOverview(selector, worldBooks?.getState),
        stWorldBookEntries: (_id, selector) => readWorldBookEntries(selector, worldBooks?.getState, worldBooks?.load),
        stPresets: (_id, selector) => readStPresets(selector, getContext),
        stPresetContent: (_id, selector) => readStPresetContent(selector, getContext),
        stPromptOverview: (_id, selector) => stPromptSnapshots.read(selector, false),
        stPromptText: (_id, selector) => stPromptSnapshots.read(selector, true),
        stDiagnostics: (_id, selector) => stDiagnostics.read(selector),
        serviceDiagnostics: (_id, selector) => services.readDiagnostics(selector),
        stPersonas: (_id, selector) => readStPersonas(selector, getContext, stDirectories?.getSelectedPersona),
        stExtensions: (_id, selector) => readStExtensions(selector, stDirectories?.getExtensions),
    });
    function read(id, selector) {
        const source = providerCatalog.find(p => p.id === id);
        if (!source || !available(id) || !Object.hasOwn(readers, source.reader)) throw Error('SOURCE_UNAVAILABLE');
        return readers[source.reader](id, selector);
    }
    function searchSource(id, selector = '') {
        if (!available(id)) throw Error('SOURCE_UNAVAILABLE');
        const ctx = getContext();
        if (id === 'chatHistory') {
            if (selector) throw Error('INVALID_SELECTOR');
            const messages = Array.isArray(ctx.chat) ? ctx.chat : [];
            if (messages.length > 65536) throw Error('SOURCE_TOO_LARGE');
            return { identity: 'chatHistory', length: messages.length, at: index => {
                const m = messages[index];
                if (text(m?.name).length + text(m?.mes).length > 1048576) throw Error('SOURCE_TOO_LARGE');
                return m ? { role: m.is_system ? 'system' : m.is_user ? 'user' : 'character', content: text(m.name) + ': ' + text(m.mes) } : undefined;
            } };
        }
        if (id !== 'charMemory' || !/^character:(0|[1-9]\d{0,2})$/.test(selector)) throw Error('INVALID_SELECTOR');
        const store = peekMemories(ctx.chatMetadata, extensionKey), keys = Object.keys(store).filter(k => Array.isArray(store[k]) && store[k].length);
        if (keys.length > 256) throw Error('SOURCE_TOO_LARGE');
        const key = keys[Number(selector.slice(10))];
        if (key === undefined) throw Error('INVALID_SELECTOR');
        const memories = store[key];
        if (memories.length > 2048) throw Error('SOURCE_TOO_LARGE');
        return { identity: key, length: memories.length, at: index => {
            const m = memories[index];
            if (text(m?.event).length + text(m?.mood).length > 1048576) throw Error('SOURCE_TOO_LARGE');
            return m ? { role: 'memory', content: text(m.event) + ' [' + text(m.mood) + ']' } : undefined;
        } };
    }
    return Object.freeze({ available, read, discover, describe, execute, searchSource });
}
