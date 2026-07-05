/**
 * Critique Export System — export/import chat critiques as standalone JSON.
 *
 * Same pattern as Summary Export:
 *   Export  — only the currently active live critique (from critiqueSystem)
 *   Import  — each import adds one entry to importedCritiques[]
 *   Panel   — user enables/disables entries, {{importedCritique}} renders enabled ones
 *
 * Storage: chat_metadata[EXT_KEY].importedCritiques
 * Completely independent of the live critique active/basedOn chain.
 */

const CRITIQUE_EXPORT_VERSION = 1;

function validateExportFormat(obj) {
    if (!obj || typeof obj !== 'object') return { ok: false, error: 'Not a valid JSON object' };
    if (obj.type !== 'critique-export') return { ok: false, error: 'Not a critique export file (missing "type":"critique-export")' };
    if (!obj.version || obj.version < 1) return { ok: false, error: `Unsupported version: ${obj.version}` };
    if (!obj.critique || typeof obj.critique !== 'object') return { ok: false, error: 'Missing or invalid "critique" object' };
    if (!obj.critique.content && obj.critique.content !== '') return { ok: false, error: 'Missing "critique.content"' };
    if (!obj.critique.data || typeof obj.critique.data !== 'object') return { ok: false, error: 'Missing or invalid "critique.data"' };
    return { ok: true };
}

function buildExportJson(opts) {
    const { activeCritique, groupNote, settings, getCurrentGroup, defaultCritiquePrompt } = opts;
    const group = getCurrentGroup();

    return {
        version: CRITIQUE_EXPORT_VERSION,
        type: 'critique-export',
        exportedAt: new Date().toISOString(),
        source: {
            groupName: group?.name || '',
            groupNote: groupNote || '',
        },
        template: {
            critiquePrompt: settings.critiquePrompt || defaultCritiquePrompt,
            critiqueSchema: settings.critiqueSchema || '',
        },
        critique: {
            content: activeCritique?.content || '',
            data: activeCritique?.data || { directorCritique: {}, characterCritiques: {} },
            timestamp: activeCritique?.timestamp || Date.now(),
        },
    };
}

let _idCounter = 0;
function generateId() {
    return `cri_${Date.now()}_${++_idCounter}`;
}

export function createCritiqueExportSystem(deps) {
    const {
        settings, EXT_KEY, getChatMetadata, saveChatConditional, log,
    } = deps;

    const critiqueSystem = deps.critiqueSystem;

    function getImportedCritiques() {
        const cm = getChatMetadata();
        if (!cm[EXT_KEY]) cm[EXT_KEY] = {};
        if (!cm[EXT_KEY].importedCritiques) cm[EXT_KEY].importedCritiques = [];
        return cm[EXT_KEY].importedCritiques;
    }

    async function save() {
        await saveChatConditional();
    }

    function getActiveLiveCritique() {
        return critiqueSystem?.getLatestActive?.() || null;
    }

    const isZh = () => (settings.lang || 'zh') === 'zh';

    // ── Export ──────────────────────────────────────────────────────

    function exportActiveCritique(groupNote) {
        const active = getActiveLiveCritique();
        if (!active || !active.content) {
            return null; // caller shows toast
        }
        const json = buildExportJson({
            activeCritique: active,
            groupNote,
            settings,
            getCurrentGroup: deps.getCurrentGroup,
            defaultCritiquePrompt: deps.defaultCritiquePrompt || '',
        });
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const dateStr = new Date().toISOString().slice(0, 10);
        const sourceName = json.source.groupNote || json.source.groupName || 'critique';
        const safeName = sourceName.replace(/[^a-zA-Z0-9一-鿿\-_]/g, '_').substring(0, 40);
        a.download = `critique-${safeName}-${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        log(`Exported active critique`);
        return json;
    }

    // ── Import ──────────────────────────────────────────────────────

    function parseImportFile(jsonText) {
        let obj;
        try { obj = JSON.parse(jsonText); } catch (e) {
            return { ok: false, error: `Invalid JSON: ${e.message}` };
        }
        const valid = validateExportFormat(obj);
        if (!valid.ok) return valid;
        return { ok: true, data: obj };
    }

    async function addImportedCritique(data, name) {
        const rawData = data.critique?.data;
        const safeData = (rawData && typeof rawData === 'object' && !Array.isArray(rawData))
            ? rawData
            : { directorCritique: {}, characterCritiques: {} };
        const entry = {
            id: generateId(),
            name: name || data.source?.groupNote || data.source?.groupName || `Import ${new Date().toLocaleString()}`,
            content: data.critique?.content || '',
            data: safeData,
            enabled: true,
            sourcePrompt: data.template?.critiquePrompt || '',
            createdAt: Date.now(),
        };
        getImportedCritiques().push(entry);
        await save();
        log(`Added imported critique: "${entry.name}"`);
        return entry;
    }

    async function updateImportedCritique(id, updates) {
        const list = getImportedCritiques();
        const entry = list.find(s => s.id === id);
        if (!entry) return;
        Object.assign(entry, updates);
        await save();
    }

    async function deleteImportedCritique(id) {
        const list = getImportedCritiques();
        const idx = list.findIndex(s => s.id === id);
        if (idx < 0) return;
        list.splice(idx, 1);
        await save();
    }

    async function setEnabled(id, enabled) {
        await updateImportedCritique(id, { enabled });
    }

    /**
     * Format a single character critique into readable text lines.
     */
    function formatCharacterCritique(name, cc) {
        const lines = [];
        lines.push(`[${name}]`);
        for (const [k, v] of Object.entries(cc)) {
            if (Array.isArray(v)) {
                if (v.length) {
                    lines.push(`  [${k}]`);
                    v.forEach(item => lines.push(`    - ${String(item)}`));
                }
            } else if (v !== null && v !== undefined && v !== '') {
                lines.push(`  [${k}] ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
            }
        }
        return lines;
    }

    /** Returns the rendered text of all enabled imported critiques, for the Provider. */
    function renderEnabledCritiques() {
        const list = getImportedCritiques();
        const enabled = list.filter(s => s.enabled !== false && s.content);
        if (!enabled.length) return { content: '', data: { all: [], count: 0 } };

        const blocks = [];
        let allData = [];

        for (const s of enabled) {
            const lines = [];
            const prefix = isZh() ? '导入批判' : 'Imported Critique';
            lines.push(`[${prefix}: ${s.name}]`);

            // Director critique
            const dc = s.data?.directorCritique;
            if (dc) {
                lines.push(isZh() ? '导演评估：' : 'Director Assessment:');
                for (const [k, v] of Object.entries(dc)) {
                    if (Array.isArray(v)) {
                        if (v.length) {
                            lines.push(`  [${k}]`);
                            v.forEach(item => lines.push(`    - ${String(item)}`));
                        }
                    } else if (v !== null && v !== undefined && v !== '') {
                        lines.push(`  [${k}] ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
                    }
                }
            }

            // Character critiques
            const cc = s.data?.characterCritiques;
            if (cc && typeof cc === 'object' && Object.keys(cc).length) {
                lines.push(isZh() ? '角色批判：' : 'Character Critiques:');
                for (const [charName, crit] of Object.entries(cc)) {
                    if (crit && typeof crit === 'object') {
                        lines.push(...formatCharacterCritique(charName, crit));
                    }
                }
            }

            blocks.push(lines.join('\n'));

            // Build structured data array for the provider
            const entryData = {
                name: s.name,
                directorCritique: dc || {},
                characterCritiques: cc || {},
            };
            allData.push(entryData);
        }

        return {
            content: blocks.join('\n\n'),
            data: {
                all: allData,
                count: enabled.length,
                names: enabled.map(s => s.name),
            },
        };
    }

    return {
        getImportedCritiques,
        getActiveLiveCritique,
        exportActiveCritique,
        parseImportFile,
        addImportedCritique,
        updateImportedCritique,
        deleteImportedCritique,
        setEnabled,
        renderEnabledCritiques,
    };
}
