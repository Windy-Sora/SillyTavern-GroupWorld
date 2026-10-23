import { randomUUID, sha256 } from '../runtime/crypto.js';
import { noteCopy, noteBytes, NOTE_LIMITS, validateNoteData, validateNoteInput, noteVisible } from '../memory/contract.js';
import { serializeSettings, waitSettingsWrites } from '../storage/settings-queue.js';

/** Independent account-settings repository. No archive, role-memory or model permissions are reused. */
export function createAgentMemoryPort({ getAccount, getSettings, saveSettings, getTarget, now = Date.now, makeId = () => randomUUID() }) {
    const listeners = new Set();
    const changed = () => { for (const fn of listeners) { try { fn(); } catch { /* A view cannot fail persistence. */ } } };
    async function identity() {
        let account; try { account = await getAccount?.(); } catch { throw Error('NOTE_IDENTITY'); }
        if (account?.enabled === false) return JSON.stringify(['single-user']);
        if (account?.enabled !== true || typeof account.handle !== 'string' || !account.handle || account.handle.length > 256 || !Number.isSafeInteger(account.created) || account.created < 0) throw Error('NOTE_IDENTITY');
        return JSON.stringify(['account', account.handle, account.created]);
    }
    async function capture(target) {
        const owner = getSettings(), account = await identity();
        const digest = await sha256('gd-muyu-notes-v1:' + account);
        const namespace = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
        async function check(signal) {
            if (signal?.aborted) throw Error('NOTE_CANCELLED');
            if (getSettings() !== owner || await identity() !== account) throw Error('NOTE_IDENTITY');
            if (getSettings() !== owner) throw Error('NOTE_IDENTITY');
            const current = getTarget?.();
            if (target?.kind === 'chat' && (current?.kind !== 'chat' || current.chatKey !== target.chatKey || current.userKey !== target.userKey)) throw Error('NOTE_STALE_TARGET');
        }
        await check();
        return { owner, namespace, check };
    }
    async function read(target) {
        const c = await capture(target); await waitSettingsWrites(c.owner); await c.check();
        const data = validateNoteData(c.owner.muyuAgentMemoryData, c.namespace); await c.check();
        return data.notes.filter(note => noteVisible(note, target));
    }
    async function mutate(target, work, signal, allowed = () => true) {
        const c = await capture(target);
        return serializeSettings(c.owner, async () => {
            await c.check(signal);
            if (!allowed()) throw Error('NOTE_DISABLED');
            const data = validateNoteData(c.owner.muyuAgentMemoryData, c.namespace), result = work(data);
            validateNoteData(data, c.namespace);
            if (noteBytes(data) > NOTE_LIMITS.totalBytes) throw Error('NOTE_CAPACITY');
            await c.check(signal);
            if (!allowed()) throw Error('NOTE_DISABLED');
            const previous = c.owner.muyuAgentMemoryData;
            // Private repository snapshots are immutable. Callers edit through versioned commands,
            // not by mutating the optimistic object while its whole-document save is pending.
            data.notes.forEach(Object.freeze); Object.freeze(data.notes); Object.freeze(data);
            c.owner.muyuAgentMemoryData = data;
            try {
                await saveSettings(); await c.check();
                if (c.owner.muyuAgentMemoryData !== data) throw Error('NOTE_CONFLICT');
                changed(); return noteCopy(result);
            } catch (error) {
                if (c.owner.muyuAgentMemoryData === data) c.owner.muyuAgentMemoryData = previous;
                changed();
                // A rejected host save may already have reached disk; never report "not started".
                throw Error('NOTE_SAVE_UNKNOWN');
            }
        });
    }
    return Object.freeze({
        enabled: () => getSettings().muyuAgentMemoryEnabled === true,
        ownerToken: () => getSettings(), // Opaque local identity for editor binding, never model data.
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        async setEnabled(enabled) {
            if (typeof enabled !== 'boolean') throw Error('NOTE_INVALID');
            // Share the note queue so no optimistic value is reported as persisted.
            const c = await capture(null);
            return serializeSettings(c.owner, async () => {
                await c.check(); const previous = c.owner.muyuAgentMemoryEnabled; c.owner.muyuAgentMemoryEnabled = enabled;
                try { await saveSettings(); await c.check(); if (c.owner.muyuAgentMemoryEnabled !== enabled) throw Error('NOTE_CONFLICT'); }
                catch { if (c.owner.muyuAgentMemoryEnabled === enabled) c.owner.muyuAgentMemoryEnabled = previous; throw Error('NOTE_SAVE_UNKNOWN'); }
                changed();
            });
        },
        list: read,
        async get(id, target) { return (await read(target)).find(note => note.id === id) || null; },
        async save(input, { target, id = null, revision = null, origin = 'manual', signal } = {}) {
            const fields = validateNoteInput(input);
            if (!['manual', 'user-quote'].includes(origin)) throw Error('NOTE_INVALID');
            if (fields.scope === 'chat' && target?.kind !== 'chat') throw Error('NOTE_STALE_TARGET');
            return mutate(target, data => {
                if (origin === 'user-quote' && getSettings().muyuAgentMemoryEnabled !== true) throw Error('NOTE_DISABLED');
                if (!id && origin === 'user-quote') {
                    const existing = data.notes.find(note => note.content === fields.content && note.scope === fields.scope && (fields.scope === 'account' || note.chatKey === target.chatKey));
                    if (existing) return existing; // Explicit repeats do not grow duplicate notes.
                }
                let previous = null;
                if (id) {
                    previous = data.notes.find(note => note.id === id && noteVisible(note, target));
                    if (!previous || previous.revision !== revision) throw Error('NOTE_CONFLICT');
                    // Scope changes are explicit GUI actions, never inferred from existing content.
                } else if (revision !== null) throw Error('NOTE_INVALID');
                const time = Math.max(now(), previous?.updatedAt || 0);
                const note = { id: previous?.id || makeId(), revision: (previous?.revision || 0) + 1, ...fields,
                    chatKey: fields.scope === 'chat' ? target.chatKey : null, createdAt: previous?.createdAt ?? time, updatedAt: time, origin };
                if (previous) data.notes[data.notes.indexOf(previous)] = note; else data.notes.push(note);
                return note;
            }, signal, () => origin !== 'user-quote' || getSettings().muyuAgentMemoryEnabled === true);
        },
        async remove(id, revision, target, signal, model = false) {
            return mutate(target, data => {
                const index = data.notes.findIndex(note => note.id === id && noteVisible(note, target));
                if (index < 0 || data.notes[index].revision !== revision) throw Error('NOTE_CONFLICT');
                data.notes.splice(index, 1); return { removed: true };
            }, signal, () => !model || getSettings().muyuAgentMemoryEnabled === true);
        },
    });
}
