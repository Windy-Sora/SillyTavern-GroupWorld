import { randomUUID } from '../runtime/crypto.js';
import { copyJson, jsonKey } from '../core/json-contract.js';
import { prepareGeneratedProfile } from '../config/generated-profile.js';

/** Only stores a reviewed, portable profile. It never applies the profile. */
export function createProfileWriter({ getSettings, saveSettings, getDrawerKeys, onSaved = () => {} }) {
    if (typeof getSettings !== 'function' || typeof saveSettings !== 'function' || typeof getDrawerKeys !== 'function') throw TypeError('INVALID_PROFILE_WRITER');
    let busy = false;
    return Object.freeze({
        async save(content) {
            if (busy) throw Error('WRITE_UNAVAILABLE');
            busy = true;
            try {
                const checked = prepareGeneratedProfile({ name: content.name, description: content.description, changes: content.settings });
                if (jsonKey(checked) !== jsonKey(content)) throw Error('INVALID_PROFILE_DRAFT');
                const settings = getSettings();
                if (!settings || typeof settings !== 'object') throw Error('PROFILE_STORE_UNAVAILABLE');
                if (settings.configProfiles === undefined) settings.configProfiles = [];
                if (!Array.isArray(settings.configProfiles)) throw Error('PROFILE_STORE_UNAVAILABLE');
                const list = settings.configProfiles;
                const names = new Set(list.map(row => String(row.name || '').trim().toLocaleLowerCase()));
                if (names.has(content.name.toLocaleLowerCase())) throw Error('PROFILE_NAME_EXISTS');
                const drawers = {};
                for (const [drawer, fields] of Object.entries(getDrawerKeys())) {
                    if (content.fields.some(field => fields.includes(field))) drawers[drawer] = true;
                }
                const profile = copyJson({ id: 'cfg_' + randomUUID(), name: content.name, description: content.description,
                    createdAt: Date.now(), drawers, settings: content.settings });
                list.push(profile);
                let confirmation;
                try { confirmation = await saveSettings(); }
                catch { try { onSaved(); } catch { /* UI refresh only. */ }
                    return { status: 'outcome_unknown', profileId: profile.id, persistence: 'unknown', activeSettingsChanged: false }; }
                const stillPresent = getSettings() === settings && settings.configProfiles === list && list.includes(profile);
                const status = confirmation?.confirmed === true && stillPresent ? 'saved_confirmed' : 'saved_unconfirmed';
                try { onSaved(); } catch { /* UI refresh does not control persistence. */ }
                return { status, profileId: profile.id, persistence: status === 'saved_confirmed' ? 'confirmed' : 'unconfirmed', activeSettingsChanged: false };
            } finally { busy = false; }
        },
    });
}
