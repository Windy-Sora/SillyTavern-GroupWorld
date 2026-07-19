/**
 * Custom Prompts System — user-defined prompt templates registered as Providers.
 *
 * Storage: settings.customPrompts = [{ id, name, content, enabled }]
 * Each enabled entry auto-registers as {{name}} Provider on init and on change.
 */

const NAME_RE = /^\w+$/;

// ST built-in macros that use {{name}} syntax — prevent name collisions.
// These run in ST's own pipeline AFTER our Provider rendering, but naming
// a custom prompt the same as a ST macro would cause confusing behavior.
const ST_MACRO_NAMES = new Set([
    // env-macros
    'user', 'char', 'group', 'groupNotMuted', 'notChar', 'persona', 'original',
    'model', 'charPrompt', 'charInstruction', 'charDescription', 'charPersonality',
    'charScenario', 'charDepthPrompt', 'charCreatorNotes', 'charFirstMessage',
    'charVersion', 'mesExamples', 'mesExamplesRaw',
    // time-macros
    'time', 'date', 'weekday', 'isotime', 'isodate', 'datetimeformat', 'idleDuration', 'timeDiff',
    // core-macros
    'random', 'roll', 'pick', 'if', 'else', 'input', 'trim', 'noop', 'space', 'newline',
    'reverse', 'maxPrompt', 'maxContext', 'maxResponse', 'banned', 'outlet',
    // variable-macros
    'setvar', 'getvar', 'hasvar', 'deletevar', 'addvar', 'incvar', 'decvar',
    'setglobalvar', 'getglobalvar', 'hasglobalvar', 'deleteglobalvar',
    'addglobalvar', 'incglobalvar', 'decglobalvar',
    // chat-macros
    'lastMessage', 'lastMessageId', 'lastUserMessage', 'lastCharMessage',
    'firstIncludedMessageId', 'firstDisplayedMessageId', 'lastSwipeId',
    'currentSwipeId', 'allChatRange',
    // state-macros
    'lastGenerationType', 'hasExtension', 'isMobile',
    // instruct-macros
    'systemPrompt',
    // comment
    '//',
    // extensions (commonly installed)
    'summary', 'authorsNote', 'charAuthorsNote', 'defaultAuthorsNote',
    'charPrefix', 'charNegativePrefix',
]);

export function createCustomPromptsSystem(deps) {
    const { settings, saveSettings, registerProvider, unregisterProvider, getProviders, log } = deps;

    let _idCounter = 0;
    function genId() { return `cp_${Date.now()}_${++_idCounter}`; }

    function getList() {
        if (!settings.customPrompts) settings.customPrompts = [];
        return settings.customPrompts;
    }

    // ── Validation ──────────────────────────────────────────────────

    function validateName(name, skipId) {
        if (!name || !NAME_RE.test(name)) {
            return { ok: false, error: '仅限字母、数字、下划线 (a-z, 0-9, _)' };
        }
        if (ST_MACRO_NAMES.has(name)) {
            return { ok: false, error: `"${name}" 与 ST 内置宏冲突，请换一个名称` };
        }
        const providers = getProviders();
        const builtins = new Set(providers.map(p => p.placeholder));
        if (builtins.has(`{{${name}}}`)) {
            const list = getList();
            if (!list.some(e => e.name === name && e.id === skipId)) {
                return { ok: false, error: `"${name}" 与内置 Provider 冲突` };
            }
        }
        const dup = getList().find(e => e.name === name && e.id !== skipId);
        if (dup) {
            return { ok: false, error: `"${name}" 已被其他自定义 prompt 使用` };
        }
        return { ok: true };
    }

    function hasSelfReference(name, content) {
        return content.includes(`{{${name}}}`);
    }

    // ── Provider sync ───────────────────────────────────────────────

    function syncOne(entry) {
        unregisterProvider(entry.name);
        const masterOn = settings.customPromptsEnabled !== false;
        if (entry.enabled && masterOn && entry.name && NAME_RE.test(entry.name)) {
            registerProvider({
                id: entry.name,
                placeholder: `{{${entry.name}}}`,
                render: () => ({ content: entry.content || '', data: null }),
            });
        }
    }

    function syncAll() {
        getList().forEach(e => unregisterProvider(e.name));
        if (settings.customPromptsEnabled !== false) {
            getList().forEach(e => syncOne(e));
        }
    }

    function setMasterEnabled(on) {
        settings.customPromptsEnabled = !!on;
        syncAll();
        saveSettings();
    }

    // ── CRUD ──────────────────────────────────────────────────────

    function add(name, content, enabled = true) {
        const valid = validateName(name);
        if (!valid.ok) throw new Error(valid.error);
        const selfRef = hasSelfReference(name, content);
        const entry = { id: genId(), name, content, enabled };
        getList().push(entry);
        syncOne(entry);
        saveSettings();
        log(`Custom prompt added: {{${name}}}${selfRef ? ' (self-ref — may render empty)' : ''}`);
        return { entry, selfRef };
    }

    function update(id, updates) {
        const list = getList();
        const entry = list.find(e => e.id === id);
        if (!entry) throw new Error('Not found');
        if (updates.name !== undefined && updates.name !== entry.name) {
            const valid = validateName(updates.name, id);
            if (!valid.ok) throw new Error(valid.error);
        }
        unregisterProvider(entry.name);
        Object.assign(entry, updates);
        syncOne(entry);
        saveSettings();
    }

    function remove(id) {
        const list = getList();
        const idx = list.findIndex(e => e.id === id);
        if (idx < 0) return;
        unregisterProvider(list[idx].name);
        const removed = list.splice(idx, 1)[0];
        saveSettings();
        log(`Custom prompt removed: {{${removed.name}}}`);
        return removed;
    }

    function toggle(id) {
        const list = getList();
        const entry = list.find(e => e.id === id);
        if (!entry) return;
        entry.enabled = !entry.enabled;
        syncOne(entry);
        saveSettings();
    }

    function initAll() {
        syncAll();
        const list = getList();
        if (list.length) log(`${list.filter(e => e.enabled).length}/${list.length} custom prompts enabled`);
    }

    // ── Export/Import ───────────────────────────────────────────────

    function exportPrompts(selectedIds) {
        const list = getList();
        const selected = list.filter(e => selectedIds.includes(e.id));
        if (!selected.length) return null;
        const json = {
            version: 1,
            type: 'custom-prompt-export',
            exportedAt: new Date().toISOString(),
            prompts: selected.map(e => ({ name: e.name, content: e.content, enabled: e.enabled })),
        };
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const dateStr = new Date().toISOString().slice(0, 10);
        a.download = `custom-prompts-${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        log(`Exported ${selected.length} custom prompt(s)`);
        return json;
    }

    function parseImportFile(jsonText) {
        let obj;
        try { obj = JSON.parse(jsonText); } catch (e) {
            return { ok: false, error: `Invalid JSON: ${e.message}` };
        }
        if (obj.type !== 'custom-prompt-export') return { ok: false, error: 'Not a custom prompt export file' };
        if (!Array.isArray(obj.prompts)) return { ok: false, error: 'Missing prompts array' };
        return { ok: true, data: obj };
    }

    function importPrompts(data, overwriteConflicts = false) {
        const list = getList();
        const existingNames = new Set(list.map(e => e.name));
        let added = 0;
        let overwritten = 0;
        const actualConflicts = [];

        for (const p of data.prompts) {
            if (!p.name || !NAME_RE.test(p.name)) continue;
            const nameCheck = validateName(p.name);
            if (!nameCheck.ok) {
                console.warn(`[GroupDirector] Import prompt skipped: "${p.name}" — ${nameCheck.error}`);
                continue;
            }
            const existing = list.find(e => e.name === p.name);
            if (existing) {
                if (overwriteConflicts) {
                    existing.content = p.content;
                    existing.enabled = p.enabled !== false;
                    syncOne(existing);
                    overwritten++;
                } else {
                    actualConflicts.push(p.name);
                }
            } else {
                const entry = { id: genId(), name: p.name, content: p.content || '', enabled: p.enabled !== false };
                list.push(entry);
                syncOne(entry);
                added++;
            }
        }
        saveSettings();
        log(`Imported custom prompts: ${added} added, ${overwritten} overwritten`);
        return { added, overwritten, conflicts: actualConflicts };
    }

    return { getList, add, update, remove, toggle, initAll, validateName, hasSelfReference, exportPrompts, parseImportFile, importPrompts, setMasterEnabled };
}
