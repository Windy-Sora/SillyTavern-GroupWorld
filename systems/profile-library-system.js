/**
 * Profile Library System — saved local profile packages backed by extension_settings.
 *
 * This is a convenience layer over profile-export-system:
 * - library entries keep the same profile-export payload shape
 * - applying an entry reuses parseImportFile/applyImport after remapping profiles
 *   onto the current group's avatar keys
 */

const PROFILE_LIBRARY_VERSION = 1;

function clone(value) {
    return JSON.parse(JSON.stringify(value ?? null));
}

function escFileName(name) {
    return String(name || 'profiles')
        .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_')
        .substring(0, 50) || 'profiles';
}

export function createProfileLibrarySystem({
    settings,
    extension_settings,
    EXT_KEY,
    saveSettings,
    saveChatConditional,
    getProfiles,
    getCurrentGroup,
    getCharacters,
    getDefaultProfileGeneratorPrompt,
    getDefaultProfileSchema,
    getDefaultProfileRenderTemplate,
    parseImportFile,
    applyImport,
    refreshProfileManagementUI,
    hashChar,
    log = console.log,
}) {
    let _idCounter = 0;
    let autoLoadBusy = false;
    let lastAutoLoadKey = '';
    let mutationQueue = Promise.resolve();

    function genId() {
        return `plib_${Date.now()}_${++_idCounter}`;
    }

    function getLibraries() {
        if (!Array.isArray(settings.profileLibraries)) settings.profileLibraries = [];
        return settings.profileLibraries;
    }

    function ensureAutoLoadSettings() {
        if (!settings.profileLibraryAutoLoad || typeof settings.profileLibraryAutoLoad !== 'object') {
            settings.profileLibraryAutoLoad = {};
        }
        const defaults = {
            enabled: false,
            mode: 'best',
            fixedId: '',
            matchHash: true,
            matchAvatarName: true,
            matchNameOnly: false,
            overwriteExisting: false,
            importTemplate: false,
        };
        for (const [key, value] of Object.entries(defaults)) {
            if (settings.profileLibraryAutoLoad[key] === undefined) {
                settings.profileLibraryAutoLoad[key] = value;
            }
        }
        return settings.profileLibraryAutoLoad;
    }

    function getAutoLoadSettings() {
        return clone(ensureAutoLoadSettings());
    }

    async function saveAll() {
        extension_settings[EXT_KEY] = settings;
        await saveSettings();
    }

    function enqueueMutation(work) {
        const task = mutationQueue.then(work, work);
        mutationQueue = task.catch(() => {});
        return task;
    }

    function readyProfileEntries() {
        const profiles = getProfiles?.() || {};
        return Object.entries(profiles).filter(([, prof]) => prof && prof.state === 'ready' && prof.profile);
    }

    function buildExportJson(name, description) {
        const group = getCurrentGroup?.();
        const chars = getCharacters?.() || [];
        const entries = readyProfileEntries();
        const profiles = entries.map(([avatar, prof]) => {
            const char = chars.find(c => c.avatar === avatar);
            return {
                avatar,
                name: char?.name || prof.name || avatar,
                hash: prof.hash || '',
                profile: clone(prof.profile) || {},
            };
        });

        return {
            version: 1,
            type: 'profile-export',
            exportedAt: new Date().toISOString(),
            source: {
                groupName: group?.name || '',
                groupNote: description || '',
            },
            template: {
                generatorPrompt: settings.profileGeneratorPrompt || getDefaultProfileGeneratorPrompt(),
                jsonSchema: settings.profileJsonSchema || getDefaultProfileSchema(),
                renderTemplate: settings.profileRenderTemplate || getDefaultProfileRenderTemplate(),
            },
            libraryMeta: {
                version: PROFILE_LIBRARY_VERSION,
                name,
                description: description || '',
                createdAt: Date.now(),
                updatedAt: Date.now(),
            },
            profiles,
        };
    }

    async function saveCurrentAsLibrary(name, description = '') {
        const title = String(name || '').trim();
        if (!title) throw new Error('Library name is required');
        const exportData = buildExportJson(title, description);
        if (!exportData.profiles.length) throw new Error('No ready character profiles to save');

        const entry = {
            id: genId(),
            name: title,
            description: description || '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            sourceGroupName: exportData.source.groupName || '',
            profileCount: exportData.profiles.length,
            exportData,
        };
        return enqueueMutation(async () => {
            const list = getLibraries();
            list.push(entry);
            try { await saveAll(); }
            catch (error) {
                const index = list.indexOf(entry);
                if (index >= 0) list.splice(index, 1);
                throw error;
            }
            log(`[GroupDirector] Profile library saved: "${title}" (${entry.profileCount})`);
            return entry;
        });
    }

    async function deleteLibrary(id) {
        return enqueueMutation(async () => {
            const list = getLibraries();
            const idx = list.findIndex(x => x.id === id);
            if (idx < 0) return false;
            const before = list[idx - 1];
            const after = list[idx + 1];
            const [removed] = list.splice(idx, 1);
            const auto = ensureAutoLoadSettings();
            const autoBefore = {};
            const autoApplied = {};
            if (auto.fixedId === id) {
                Object.assign(autoBefore, { fixedId: auto.fixedId, mode: auto.mode, enabled: auto.enabled });
                Object.assign(autoApplied, { fixedId: '', mode: 'best', enabled: false });
                Object.assign(auto, autoApplied);
            }
            try { await saveAll(); }
            catch (error) {
                if (!list.includes(removed)) {
                    const afterIndex = after ? list.indexOf(after) : -1;
                    const beforeIndex = before ? list.indexOf(before) : -1;
                    const restoreIndex = afterIndex >= 0 ? afterIndex : beforeIndex >= 0 ? beforeIndex + 1 : Math.min(idx, list.length);
                    list.splice(restoreIndex, 0, removed);
                }
                for (const [key, value] of Object.entries(autoApplied)) {
                    if (Object.is(auto[key], value)) auto[key] = autoBefore[key];
                }
                throw error;
            }
            return true;
        });
    }

    async function updateAutoLoadSettings(patch = {}) {
        return enqueueMutation(async () => {
            const auto = ensureAutoLoadSettings();
            const keys = Object.keys(patch).filter(key => Object.hasOwn(auto, key));
            const previous = Object.fromEntries(keys.map(key => [key, auto[key]]));
            const applied = Object.fromEntries(keys.map(key => [key, patch[key]]));
            Object.assign(auto, applied);
            try { await saveAll(); }
            catch (error) {
                for (const key of keys) {
                    if (Object.is(auto[key], applied[key])) auto[key] = previous[key];
                }
                throw error;
            }
            return auto;
        });
    }

    function getLibrary(id) {
        return getLibraries().find(x => x.id === id) || null;
    }

    function normalizeLibraryEntry(entry) {
        if (!entry) return null;
        if (entry.exportData?.type === 'profile-export') return entry.exportData;
        if (entry.type === 'profile-export') return entry;
        return null;
    }

    function currentMembers() {
        const group = getCurrentGroup?.();
        const chars = getCharacters?.() || [];
        const charsByAvatar = new Map(chars.map(c => [c.avatar, c]));
        const avatars = group?.members?.filter(a => !group.disabled_members?.includes(a)) || [];
        return avatars.map(avatar => {
            const char = charsByAvatar.get(avatar);
            const hash = char && hashChar ? hashChar(char.description, char.personality, char.scenario) : '';
            return char ? { avatar, name: char.name, hash, char } : null;
        }).filter(Boolean);
    }

    function matchLibraryProfiles(libraryOrData, options = {}) {
        const data = normalizeLibraryEntry(libraryOrData) || libraryOrData;
        const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
        const members = Array.isArray(options.members) ? options.members : currentMembers();
        const liveProfiles = getProfiles?.() || {};
        const opts = {
            matchHash: true,
            matchAvatarName: true,
            matchNameOnly: false,
            overwriteExisting: false,
            ...options,
        };

        const usedProfiles = new Set();
        const matches = [];
        const unmatchedMembers = [];

        for (const member of members) {
            let candidate = null;
            let matchType = '';
            if (opts.matchHash) {
                candidate = profiles.find((p, i) => !usedProfiles.has(i) && p.hash && member.hash === p.hash);
                if (candidate) matchType = 'hash';
            }
            if (!candidate && opts.matchAvatarName) {
                candidate = profiles.find((p, i) => !usedProfiles.has(i) && p.avatar === member.avatar && p.name === member.name);
                if (candidate) matchType = 'avatar+name';
            }
            if (!candidate && opts.matchNameOnly) {
                candidate = profiles.find((p, i) => !usedProfiles.has(i) && p.name === member.name);
                if (candidate) matchType = 'name';
            }

            if (!candidate) {
                unmatchedMembers.push(member);
                continue;
            }

            const sourceIndex = profiles.indexOf(candidate);
            usedProfiles.add(sourceIndex);
            const existing = liveProfiles[member.avatar];
            const skipped = !!existing && existing.state === 'ready' && !opts.overwriteExisting;
            matches.push({
                sourceIndex,
                sourceAvatar: candidate.avatar,
                sourceName: candidate.name,
                targetAvatar: member.avatar,
                targetName: member.name,
                targetHash: member.hash,
                matchType,
                skipped,
                profile: candidate,
            });
        }

        const unmatchedLibrary = profiles.filter((_, i) => !usedProfiles.has(i));
        return { matches, unmatchedMembers, unmatchedLibrary, profileCount: profiles.length, memberCount: members.length };
    }

    function translatedExportData(library, matches) {
        const data = normalizeLibraryEntry(library);
        if (!data) throw new Error('Invalid profile library entry');
        const profiles = matches.filter(m => !m.skipped).map(match => ({
            avatar: match.targetAvatar,
            name: match.targetName,
            hash: match.targetHash || match.profile.hash || '',
            profile: clone(match.profile.profile) || {},
        }));
        return {
            ...clone(data),
            profiles,
        };
    }

    async function applyLibrary(id, options = {}) {
        const entry = getLibrary(id);
        if (!entry) throw new Error('Profile library not found');
        const auto = ensureAutoLoadSettings();
        const opts = {
            matchHash: auto.matchHash,
            matchAvatarName: auto.matchAvatarName,
            matchNameOnly: auto.matchNameOnly,
            overwriteExisting: auto.overwriteExisting,
            importTemplate: auto.importTemplate,
            ...options,
        };
        const preview = matchLibraryProfiles(entry, opts);
        const data = translatedExportData(entry, preview.matches);
        if (!data.profiles.length) {
            return { applied: 0, skipped: preview.matches.filter(m => m.skipped).length, preview };
        }

        const parsed = parseImportFile(JSON.stringify(data));
        if (!parsed.ok) throw new Error(parsed.error || 'Invalid profile library data');
        const selected = data.profiles.map(p => p.avatar);
        const result = await applyImport(parsed.data, selected, { importTemplate: !!opts.importTemplate });
        refreshProfileManagementUI?.();
        return { ...result, preview };
    }

    function exportLibrary(id) {
        const entry = getLibrary(id);
        if (!entry) throw new Error('Profile library not found');
        const data = normalizeLibraryEntry(entry);
        if (!data) throw new Error('Invalid profile library data');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        let a;
        let appended = false;
        try {
            a = document.createElement('a');
            a.href = url;
            a.download = `profiles-${escFileName(entry.name)}.json`;
            document.body.appendChild(a);
            appended = true;
            a.click();
        } finally {
            try { if (appended) document.body.removeChild(a); }
            finally { URL.revokeObjectURL(url); }
        }
        return data;
    }

    async function importFileToLibrary(file) {
        const text = await file.text();
        const parsed = parseImportFile(text);
        if (!parsed.ok) throw new Error(parsed.error || 'Invalid profile export');
        const data = JSON.parse(text);
        const name = data.libraryMeta?.name || data.source?.groupName || file.name.replace(/\.json$/i, '') || 'Imported Profiles';
        const entry = {
            id: genId(),
            name,
            description: data.libraryMeta?.description || data.source?.groupNote || '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            sourceGroupName: data.source?.groupName || '',
            profileCount: Array.isArray(data.profiles) ? data.profiles.length : 0,
            exportData: data,
        };
        return enqueueMutation(async () => {
            const list = getLibraries();
            list.push(entry);
            try { await saveAll(); }
            catch (error) {
                const index = list.indexOf(entry);
                if (index >= 0) list.splice(index, 1);
                throw error;
            }
            return entry;
        });
    }

    function findBestLibrary(options = {}) {
        const auto = ensureAutoLoadSettings();
        const members = Array.isArray(options.members) ? options.members : currentMembers();
        const opts = {
            matchHash: auto.matchHash,
            matchAvatarName: auto.matchAvatarName,
            matchNameOnly: false,
            overwriteExisting: auto.overwriteExisting,
            members,
            ...options,
        };
        let best = null;
        for (const entry of getLibraries()) {
            const preview = matchLibraryProfiles(entry, opts);
            const usable = preview.matches.filter(m => !m.skipped).length;
            const totalMatches = preview.matches.length;
            const rate = preview.memberCount ? totalMatches / preview.memberCount : 0;
            if (usable <= 0) continue;
            if (totalMatches < 2 && rate < 0.5) continue;
            const score = usable * 100 + totalMatches * 10 + rate;
            if (!best || score > best.score) best = { entry, preview, score };
        }
        return best;
    }

    async function autoLoadForCurrentGroup(reason = 'auto') {
        const auto = ensureAutoLoadSettings();
        if (!auto.enabled || autoLoadBusy) return { applied: 0, reason: 'disabled' };
        const group = getCurrentGroup?.();
        if (!group) return { applied: 0, reason: 'no-group' };
        const key = `${group.id || group.name || 'group'}:${reason}:${getLibraries().length}`;
        if (lastAutoLoadKey === key) return { applied: 0, reason: 'deduped' };
        autoLoadBusy = true;
        try {
            let target = null;
            const members = currentMembers();
            if (auto.mode === 'fixed' && auto.fixedId) {
                const entry = getLibrary(auto.fixedId);
                if (entry) target = { entry, preview: matchLibraryProfiles(entry, { ...auto, matchNameOnly: false, members }) };
            } else {
                target = findBestLibrary({ matchNameOnly: false, members });
            }
            if (!target) return { applied: 0, reason: 'no-match' };
            const result = await applyLibrary(target.entry.id, { ...auto, matchNameOnly: false });
            lastAutoLoadKey = key;
            return { ...result, library: target.entry };
        } finally {
            autoLoadBusy = false;
        }
    }

    function resetAutoLoadDedup() {
        lastAutoLoadKey = '';
    }

    return {
        getLibraries,
        getAutoLoadSettings,
        updateAutoLoadSettings,
        saveCurrentAsLibrary,
        deleteLibrary,
        getLibrary,
        matchLibraryProfiles,
        applyLibrary,
        exportLibrary,
        importFileToLibrary,
        findBestLibrary,
        autoLoadForCurrentGroup,
        resetAutoLoadDedup,
        saveAll,
    };
}
