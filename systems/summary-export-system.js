/**
 * Summary Export System — export/import chat summaries as standalone JSON.
 *
 * Unlike Profile/NPC, this is intentionally simple:
 *   Export  — only the currently active live summary (from chatSummarySystem)
 *   Import  — each import adds one entry to importedSummaries[]
 *   Panel   — user enables/disables entries, {{importedSummary}} renders enabled ones
 *
 * Storage: chat_metadata[EXT_KEY].importedSummaries
 * Completely independent of the live summary active/basedOn chain.
 */

const SUMMARY_EXPORT_VERSION = 1;

function validateExportFormat(obj) {
    if (!obj || typeof obj !== 'object') return { ok: false, error: 'Not a valid JSON object' };
    if (obj.type !== 'summary-export') return { ok: false, error: 'Not a summary export file (missing "type":"summary-export")' };
    if (!obj.version || obj.version < 1) return { ok: false, error: `Unsupported version: ${obj.version}` };
    if (!obj.summary || typeof obj.summary !== 'object') return { ok: false, error: 'Missing or invalid "summary" object' };
    if (!obj.summary.content && obj.summary.content !== '') return { ok: false, error: 'Missing "summary.content"' };
    return { ok: true };
}

function buildExportJson(opts) {
    const { activeSummary, groupNote, settings, getCurrentGroup, defaultSummaryPrompt } = opts;
    const group = getCurrentGroup();

    return {
        version: SUMMARY_EXPORT_VERSION,
        type: 'summary-export',
        exportedAt: new Date().toISOString(),
        source: {
            groupName: group?.name || '',
            groupNote: groupNote || '',
        },
        template: {
            summaryPrompt: settings.summaryPrompt || defaultSummaryPrompt,
        },
        summary: {
            content: activeSummary?.content || '',
            timestamp: activeSummary?.timestamp || Date.now(),
        },
    };
}

let _idCounter = 0;
function generateId() {
    return `sum_${Date.now()}_${++_idCounter}`;
}

export function createSummaryExportSystem(deps) {
    const {
        settings, EXT_KEY, getChatMetadata, saveChatConditional, log,
    } = deps;

    const chatSummarySystem = deps.chatSummarySystem;

    function getImportedSummaries() {
        const cm = getChatMetadata();
        if (!cm[EXT_KEY]) cm[EXT_KEY] = {};
        if (!cm[EXT_KEY].importedSummaries) cm[EXT_KEY].importedSummaries = [];
        return cm[EXT_KEY].importedSummaries;
    }

    async function save() {
        await saveChatConditional();
    }

    function getActiveLiveSummary() {
        return chatSummarySystem?.getLatestActive?.() || null;
    }

    const isZh = () => (settings.lang || 'zh') === 'zh';

    // ── Export ──────────────────────────────────────────────────────

    function exportActiveSummary(groupNote) {
        const active = getActiveLiveSummary();
        if (!active || !active.content) {
            return null; // caller shows toast
        }
        const json = buildExportJson({
            activeSummary: active,
            groupNote,
            settings,
            getCurrentGroup: deps.getCurrentGroup,
            defaultSummaryPrompt: deps.defaultSummaryPrompt || '',
        });
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const dateStr = new Date().toISOString().slice(0, 10);
        const sourceName = json.source.groupNote || json.source.groupName || 'summary';
        const safeName = sourceName.replace(/[^a-zA-Z0-9一-鿿\-_]/g, '_').substring(0, 40);
        a.download = `summary-${safeName}-${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        log(`Exported active summary`);
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

    async function addImportedSummary(data, name) {
        const entry = {
            id: generateId(),
            name: name || data.source?.groupNote || data.source?.groupName || `Import ${new Date().toLocaleString()}`,
            content: data.summary?.content || '',
            enabled: true,
            sourcePrompt: data.template?.summaryPrompt || '',
            createdAt: Date.now(),
        };
        getImportedSummaries().push(entry);
        await save();
        log(`Added imported summary: "${entry.name}"`);
        return entry;
    }

    async function updateImportedSummary(id, updates) {
        const list = getImportedSummaries();
        const entry = list.find(s => s.id === id);
        if (!entry) return;
        Object.assign(entry, updates);
        await save();
    }

    async function deleteImportedSummary(id) {
        const list = getImportedSummaries();
        const idx = list.findIndex(s => s.id === id);
        if (idx < 0) return;
        list.splice(idx, 1);
        await save();
    }

    async function setEnabled(id, enabled) {
        await updateImportedSummary(id, { enabled });
    }

    /** Returns the rendered text of all enabled imported summaries, for the Provider. */
    function renderEnabledSummaries() {
        const list = getImportedSummaries();
        const enabled = list.filter(s => s.enabled !== false && s.content);
        if (!enabled.length) return { content: '', data: { all: [], count: 0 } };
        const content = enabled.map(s =>
            `[${isZh() ? '导入摘要' : 'Imported Summary'}: ${s.name}]\n${s.content}`
        ).join('\n\n');
        return {
            content,
            data: {
                all: enabled,
                count: enabled.length,
                names: enabled.map(s => s.name),
            },
        };
    }

    return {
        getImportedSummaries,
        getActiveLiveSummary,
        exportActiveSummary,
        parseImportFile,
        addImportedSummary,
        updateImportedSummary,
        deleteImportedSummary,
        setEnabled,
        renderEnabledSummaries,
    };
}
