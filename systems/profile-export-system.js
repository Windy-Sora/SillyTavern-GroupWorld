/**
 * Profile Export System — export/import character profiles as standalone JSON files.
 *
 * Export: packs ready profiles + current template config into a single JSON.
 * Import: validates format, checks template compatibility, lets user pick which
 *         profiles to merge (with overwrite/new/skip indicators).
 *
 * Pure factory — all state dependencies injected.
 */

import { djb2Hash } from '../utils/string-utils.js';
import { profilePresets } from '../assets/profiles/manifest.js';

/** Current export file format version. */
const PROFILE_EXPORT_VERSION = 1;

/**
 * Validate that a loaded object is a valid profile export file.
 * Returns { ok, error }.
 */
function validateExportFormat(obj) {
    if (!obj || typeof obj !== 'object') return { ok: false, error: 'Not a valid JSON object' };
    if (obj.type !== 'profile-export') return { ok: false, error: 'Not a profile export file (missing "type":"profile-export")' };
    if (!obj.version || obj.version < 1) return { ok: false, error: `Unsupported version: ${obj.version}` };
    if (!Array.isArray(obj.profiles)) return { ok: false, error: 'Missing or invalid "profiles" array' };
    if (!obj.template || typeof obj.template !== 'object') return { ok: false, error: 'Missing or invalid "template" object' };
    return { ok: true };
}

/**
 * Compare imported template against current settings.
 * Returns { consistent, diffs: [{key, label, currentHash, importHash}] }.
 */
function checkTemplateConsistency(importedTemplate, currentSettings, getDefaults) {
    const diffs = [];

    const defaultGen = getDefaults.generatorPrompt?.() || '';
    const defaultSchema = getDefaults.schema?.() || '';
    const defaultRender = getDefaults.renderTemplate?.() || '';

    const currentGen = currentSettings.profileGeneratorPrompt || defaultGen;
    const currentSchema = currentSettings.profileJsonSchema || defaultSchema;
    const currentRender = currentSettings.profileRenderTemplate || defaultRender;

    const importGen = importedTemplate.generatorPrompt || '';
    const importSchema = importedTemplate.jsonSchema || '';
    const importRender = importedTemplate.renderTemplate || '';

    const curGenHash = djb2Hash(currentGen);
    const impGenHash = djb2Hash(importGen);
    if (curGenHash !== impGenHash) {
        diffs.push({ key: 'generatorPrompt', label: 'Generator Prompt', currentHash: curGenHash, importHash: impGenHash });
    }

    const curSchemaHash = djb2Hash(currentSchema);
    const impSchemaHash = djb2Hash(importSchema);
    if (curSchemaHash !== impSchemaHash) {
        diffs.push({ key: 'jsonSchema', label: 'JSON Schema', currentHash: curSchemaHash, importHash: impSchemaHash });
    }

    const curRenderHash = djb2Hash(currentRender);
    const impRenderHash = djb2Hash(importRender);
    if (curRenderHash !== impRenderHash) {
        diffs.push({ key: 'renderTemplate', label: 'Render Template', currentHash: curRenderHash, importHash: impRenderHash });
    }

    return { consistent: diffs.length === 0, diffs };
}

/**
 * Build the export JSON from current profiles + template settings.
 *
 * @param {Object} opts
 * @param {string[]} opts.avatars - selected avatars to export
 * @param {string} opts.groupNote - user note for the export
 * @param {Object} opts.settings - current settings
 * @param {Function} opts.getProfiles - () => profiles map
 * @param {Function} opts.getCurrentGroup - () => group object
 * @param {Function} opts.getDefaultProfileGeneratorPrompt
 * @param {Function} opts.getDefaultProfileSchema
 * @param {Function} opts.getDefaultProfileRenderTemplate
 * @param {Function} opts.getCharacters - () => characters array
 * @returns {Object} export JSON
 */
function buildExportJson(opts) {
    const {
        avatars, groupNote, settings,
        getProfiles, getCurrentGroup,
        getDefaultProfileGeneratorPrompt, getDefaultProfileSchema, getDefaultProfileRenderTemplate,
        getCharacters,
    } = opts;

    const profilesMap = getProfiles();
    const group = getCurrentGroup();
    const chars = getCharacters();

    const profiles = avatars.map(avatar => {
        const prof = profilesMap[avatar];
        const char = chars.find(c => c.avatar === avatar);
        return {
            avatar,
            name: char?.name || prof?.name || avatar,
            hash: prof?.hash || '',
            profile: prof?.profile ? { ...prof.profile } : {},
        };
    }).filter(p => p.profile && Object.keys(p.profile).length > 0);

    return {
        version: PROFILE_EXPORT_VERSION,
        type: 'profile-export',
        exportedAt: new Date().toISOString(),
        source: {
            groupName: group?.name || '',
            groupNote: groupNote || '',
        },
        template: {
            generatorPrompt: settings.profileGeneratorPrompt || getDefaultProfileGeneratorPrompt(),
            jsonSchema: settings.profileJsonSchema || getDefaultProfileSchema(),
            renderTemplate: settings.profileRenderTemplate || getDefaultProfileRenderTemplate(),
        },
        profiles,
    };
}

/**
 * Label for a profile-to-import: what will happen on merge.
 * 'new' = no existing profile for this avatar; 'overwrite' = exists, will replace.
 */
function classifyImportProfile(avatar, existingProfiles) {
    if (existingProfiles[avatar]) return 'overwrite';
    return 'new';
}

export function createProfileExportSystem(deps) {
    const {
        settings, getProfiles, saveSettings,
        getDefaultProfileGeneratorPrompt, getDefaultProfileSchema, getDefaultProfileRenderTemplate,
        getCurrentGroup, getCharacters, saveChatConditional,
        refreshProfileManagementUI, log,
    } = deps;

    const isZh = () => (settings.lang || 'zh') === 'zh';

    // ── Export ───────────────────────────────────────────────────────

    function exportProfiles(avatars, groupNote) {
        const json = buildExportJson({
            avatars, groupNote, settings,
            getProfiles, getCurrentGroup,
            getDefaultProfileGeneratorPrompt, getDefaultProfileSchema, getDefaultProfileRenderTemplate,
            getCharacters,
        });

        const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const groupName = json.source.groupName || 'profiles';
        const safeName = groupName.replace(/[^a-zA-Z0-9一-鿿\-_]/g, '_').substring(0, 50);
        const dateStr = new Date().toISOString().slice(0, 10);
        a.download = `profiles-${safeName}-${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        log(`Exported ${json.profiles.length} profile(s)`);
        return json;
    }

    // ── Import ───────────────────────────────────────────────────────

    function parseImportFile(jsonText) {
        let obj;
        try {
            obj = JSON.parse(jsonText);
        } catch (e) {
            return { ok: false, error: `Invalid JSON: ${e.message}` };
        }
        const valid = validateExportFormat(obj);
        if (!valid.ok) return valid;

        // Check template consistency
        const consistency = checkTemplateConsistency(obj.template, settings, {
            generatorPrompt: getDefaultProfileGeneratorPrompt,
            schema: getDefaultProfileSchema,
            renderTemplate: getDefaultProfileRenderTemplate,
        });

        // Classify each profile
        const existingProfiles = getProfiles();
        const profiles = obj.profiles.map(p => ({
            ...p,
            _action: classifyImportProfile(p.avatar, existingProfiles),
        }));

        return {
            ok: true,
            data: {
                ...obj,
                profiles,
                _templateConsistent: consistency.consistent,
                _templateDiffs: consistency.diffs,
            },
        };
    }

    /**
     * Apply the imported profiles to chat_metadata, and optionally import templates.
     * @param {Object} importData - parsed and validated import data
     * @param {string[]} selectedAvatars - user-checked avatars to apply
     * @param {Object} [options] - { importTemplate?: boolean }
     * @returns {{ applied: number, skipped: number, templateImported: boolean }}
     */
    async function applyImport(importData, selectedAvatars, options = {}) {
        const selectedSet = new Set(selectedAvatars);
        const profiles = importData.profiles.filter(p => selectedSet.has(p.avatar));
        if (!profiles.length && !options.importTemplate) return { applied: 0, skipped: 0, templateImported: false };

        let applied = 0;
        const existingProfiles = getProfiles();

        for (const p of profiles) {
            if (!p.avatar || p.avatar === '__proto__' || p.avatar === 'constructor') continue;
            const existing = existingProfiles[p.avatar];
            existingProfiles[p.avatar] = {
                avatar: p.avatar,
                name: p.name,
                hash: p.hash || '',
                profile: { ...p.profile },
                state: 'ready',
                updatedAt: Date.now(),
                // Preserve manualEdited flag if overwriting an existing profile
                manualEdited: existing?.manualEdited || false,
            };
            applied++;
        }

        let templateImported = false;
        if (options.importTemplate && importData.template) {
            const t = importData.template;
            if (t.generatorPrompt !== undefined) {
                settings.profileGeneratorPrompt = t.generatorPrompt;
            }
            if (t.jsonSchema !== undefined) {
                settings.profileJsonSchema = t.jsonSchema;
            }
            if (t.renderTemplate !== undefined) {
                settings.profileRenderTemplate = t.renderTemplate;
            }
            saveSettings();
            templateImported = true;
            log('Profile templates imported');
        }

        await saveChatConditional();
        log(`Imported ${applied} profile(s)${templateImported ? ' + templates' : ''}`);
        return { applied, skipped: profiles.length - applied, templateImported };
    }

    /**
     * Load a preset file from assets/profiles/ by name (without .json).
     */
    async function loadPreset(name) {
        try {
            const resp = await fetch(`scripts/extensions/third-party/SillyTavern-GroupDirector/assets/profiles/${name}.json`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const text = await resp.text();
            return parseImportFile(text);
        } catch (e) {
            return { ok: false, error: `Failed to load preset "${name}": ${e.message}` };
        }
    }

    return {
        exportProfiles,
        parseImportFile,
        applyImport,
        loadPreset,
        getPresetNames: () => [...profilePresets],
    };
}
