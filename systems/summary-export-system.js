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

function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function validateExportFormat(obj) {
    if (!isPlainObject(obj)) return { ok: false, error: 'Not a valid JSON object' };
    if (obj.type !== 'summary-export') return { ok: false, error: 'Not a summary export file (missing "type":"summary-export")' };
    if (!Number.isInteger(obj.version) || obj.version < 1) return { ok: false, error: `Unsupported version: ${obj.version}` };
    if (!isPlainObject(obj.summary)) return { ok: false, error: 'Missing or invalid "summary" object' };
    if (typeof obj.summary.content !== 'string') return { ok: false, error: 'Missing or invalid "summary.content"' };
    if (obj.source !== undefined && !isPlainObject(obj.source)) return { ok: false, error: 'Invalid "source" object' };
    if (obj.source && ['groupName', 'groupNote'].some(key => obj.source[key] !== undefined && typeof obj.source[key] !== 'string')) return { ok: false, error: 'Invalid source name' };
    if (obj.template !== undefined && !isPlainObject(obj.template)) return { ok: false, error: 'Invalid "template" object' };
    if (obj.template?.summaryPrompt !== undefined && typeof obj.template.summaryPrompt !== 'string') return { ok: false, error: 'Invalid "template.summaryPrompt"' };
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
    const fieldRevisions = new WeakMap();

    function getImportedSummaries(cm = getChatMetadata()) {
        if (!isPlainObject(cm[EXT_KEY])) cm[EXT_KEY] = {};
        if (!Array.isArray(cm[EXT_KEY].importedSummaries)) cm[EXT_KEY].importedSummaries = [];
        return cm[EXT_KEY].importedSummaries;
    }

    function bumpFieldRevision(entry, key) {
        let fields = fieldRevisions.get(entry);
        if (!fields) {
            fields = new Map();
            fieldRevisions.set(entry, fields);
        }
        const revision = (fields.get(key) || 0) + 1;
        fields.set(key, revision);
        return revision;
    }

    function assertCurrentChat(metadata) {
        if (getChatMetadata() === metadata) return;
        const error = new Error('Imported summary became stale after the chat changed');
        error.name = 'StaleExecutionError';
        throw error;
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
        let a;
        let appended = false;
        try {
            a = document.createElement('a');
            a.href = url;
            const dateStr = new Date().toISOString().slice(0, 10);
            const sourceName = json.source.groupNote || json.source.groupName || 'summary';
            const safeName = sourceName.replace(/[^a-zA-Z0-9一-鿿\-_]/g, '_').substring(0, 40);
            a.download = `summary-${safeName}-${dateStr}.json`;
            document.body.appendChild(a);
            appended = true;
            a.click();
        } finally {
            try { if (appended) document.body.removeChild(a); }
            finally { URL.revokeObjectURL(url); }
        }
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
        const validation = validateExportFormat(data);
        if (!validation.ok) throw new TypeError(validation.error);
        if (name !== undefined && typeof name !== 'string') throw new TypeError('Imported summary name must be a string');
        const entry = {
            id: generateId(),
            name: name || data.source?.groupNote || data.source?.groupName || `Import ${new Date().toLocaleString()}`,
            content: data.summary?.content || '',
            enabled: true,
            sourcePrompt: data.template?.summaryPrompt || '',
            createdAt: Date.now(),
        };
        const metadata = getChatMetadata();
        const list = getImportedSummaries(metadata);
        list.push(entry);
        try { await save(); }
        catch (error) {
            const index = list.indexOf(entry);
            if (index >= 0) list.splice(index, 1);
            throw error;
        }
        assertCurrentChat(metadata);
        log(`Added imported summary: "${entry.name}"`);
        return entry;
    }

    async function updateImportedSummary(id, updates) {
        if (!isPlainObject(updates)) throw new TypeError('Imported summary updates must be an object');
        const metadata = getChatMetadata();
        const list = getImportedSummaries(metadata);
        const entry = list.find(s => s?.id === id);
        if (!entry) return;
        const allowed = {};
        if (Object.hasOwn(updates, 'name')) allowed.name = String(updates.name || '').trim() || entry.name;
        if (Object.hasOwn(updates, 'content')) {
            if (typeof updates.content !== 'string') throw new TypeError('Imported summary content must be a string');
            allowed.content = updates.content;
        }
        if (Object.hasOwn(updates, 'enabled')) allowed.enabled = !!updates.enabled;
        const previous = new Map(Object.keys(allowed).map(key => [key, { value: entry[key], present: Object.hasOwn(entry, key) }]));
        const revisions = new Map(Object.keys(allowed).map(key => [key, bumpFieldRevision(entry, key)]));
        Object.assign(entry, allowed);
        try { await save(); }
        catch (error) {
            for (const [key, before] of previous) {
                if (fieldRevisions.get(entry)?.get(key) !== revisions.get(key) || !Object.is(entry[key], allowed[key])) continue;
                if (before.present) entry[key] = before.value;
                else delete entry[key];
                bumpFieldRevision(entry, key);
            }
            throw error;
        }
        assertCurrentChat(metadata);
    }

    async function deleteImportedSummary(id) {
        const metadata = getChatMetadata();
        const list = getImportedSummaries(metadata);
        const idx = list.findIndex(s => s?.id === id);
        if (idx < 0) return;
        const before = list[idx - 1];
        const after = list[idx + 1];
        const [removed] = list.splice(idx, 1);
        try { await save(); }
        catch (error) {
            if (!list.includes(removed)) {
                const afterIndex = after ? list.indexOf(after) : -1;
                const beforeIndex = before ? list.indexOf(before) : -1;
                const restoreIndex = afterIndex >= 0 ? afterIndex : beforeIndex >= 0 ? beforeIndex + 1 : Math.min(idx, list.length);
                list.splice(restoreIndex, 0, removed);
            }
            throw error;
        }
        assertCurrentChat(metadata);
    }

    async function setEnabled(id, enabled) {
        await updateImportedSummary(id, { enabled });
    }

    /** Returns the rendered text of all enabled imported summaries, for the Provider. */
    function renderEnabledSummaries() {
        const list = getImportedSummaries();
        const enabled = list.filter(s => s && typeof s === 'object' && s.enabled !== false && typeof s.content === 'string' && s.content);
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
