/**
 * Custom Prompts System — user-defined prompt templates registered as Providers.
 * Storage: settings.customPrompts = [{ id, name, content, dataJson, scope, enabled }]
 */

import {
    CUSTOM_PROMPT_NAME_RE,
    generateCustomPromptId,
    normalizeCustomPrompt,
    normalizeCustomPromptList,
    parseCustomPromptData,
    validateCustomPromptExport,
} from './custom-prompt-validation.js';

const PROVIDER_OWNER = 'group-director/custom-prompt';
const ST_MACRO_NAMES = new Set([
    'user', 'char', 'group', 'groupNotMuted', 'notChar', 'persona', 'original',
    'model', 'charPrompt', 'charInstruction', 'charDescription', 'charPersonality',
    'charScenario', 'charDepthPrompt', 'charCreatorNotes', 'charFirstMessage',
    'charVersion', 'mesExamples', 'mesExamplesRaw',
    'time', 'date', 'weekday', 'isotime', 'isodate', 'datetimeformat', 'idleDuration', 'timeDiff',
    'random', 'roll', 'pick', 'if', 'else', 'input', 'trim', 'noop', 'space', 'newline',
    'reverse', 'maxPrompt', 'maxContext', 'maxResponse', 'banned', 'outlet',
    'setvar', 'getvar', 'hasvar', 'deletevar', 'addvar', 'incvar', 'decvar',
    'setglobalvar', 'getglobalvar', 'hasglobalvar', 'deleteglobalvar',
    'addglobalvar', 'incglobalvar', 'decglobalvar',
    'lastMessage', 'lastMessageId', 'lastUserMessage', 'lastCharMessage',
    'firstIncludedMessageId', 'firstDisplayedMessageId', 'lastSwipeId',
    'currentSwipeId', 'allChatRange', 'lastGenerationType', 'hasExtension', 'isMobile',
    'systemPrompt', '//', 'summary', 'authorsNote', 'charAuthorsNote', 'defaultAuthorsNote',
    'charPrefix', 'charNegativePrefix',
]);

export function createCustomPromptsSystem(deps) {
    const { settings, saveSettings, registerProvider, unregisterProvider, getProviders, log } = deps;
    const managed = new Map();
    let mutationQueue = Promise.resolve();

    function getList() {
        if (!Array.isArray(settings.customPrompts)) settings.customPrompts = [];
        return settings.customPrompts;
    }

    function enqueue(work) {
        const result = mutationQueue.then(work, work);
        mutationQueue = result.catch(() => {});
        return result;
    }

    function isOwned(provider, ownerId) {
        return provider?._gdOwner === PROVIDER_OWNER
            && (ownerId === undefined || provider._gdOwnerId === ownerId);
    }

    function validateName(name, skipId) {
        if (!name || !CUSTOM_PROMPT_NAME_RE.test(name)) {
            return { ok: false, error: '仅限字母、数字、下划线 (a-z, 0-9, _)' };
        }
        if (ST_MACRO_NAMES.has(name)) {
            return { ok: false, error: `"${name}" 与 ST 内置宏冲突，请换一个名称` };
        }
        const provider = getProviders().find(item => item.id === name || item.placeholder === `{{${name}}}`);
        if (provider && !isOwned(provider, skipId)) {
            return { ok: false, error: `"${name}" 与内置 Provider 冲突` };
        }
        const duplicate = (Array.isArray(settings.customPrompts) ? settings.customPrompts : []).find(entry => entry.name === name && entry.id !== skipId);
        if (duplicate) return { ok: false, error: `"${name}" 已被其他自定义 prompt 使用` };
        return { ok: true };
    }

    function hasSelfReference(name, content) {
        return String(content ?? '').includes(`{{${name}}}`);
    }

    function validateDataJson(dataJson) {
        try {
            parseCustomPromptData(dataJson);
            return { ok: true };
        } catch (error) {
            return { ok: false, error: `JSON 数据无效: ${error.message}` };
        }
    }

    function unregisterOwned(name, entryId) {
        return unregisterProvider(name, { owner: PROVIDER_OWNER, ownerId: entryId });
    }

    function registerOne(entry) {
        registerProvider({
            id: entry.name,
            placeholder: `{{${entry.name}}}`,
            _gdOwner: PROVIDER_OWNER,
            _gdOwnerId: entry.id,
            render: () => ({
                content: entry.content || '',
                data: parseCustomPromptData(entry.dataJson),
            }),
        });
        const previousName = managed.get(entry.id);
        managed.set(entry.id, entry.name);
        if (previousName && previousName !== entry.name) unregisterOwned(previousName, entry.id);
    }

    function reconcile({ strict = false } = {}) {
        const desired = new Set();
        const seenIds = new Set();
        const list = getList();
        const masterOn = settings.customPromptsEnabled !== false;
        for (let index = 0; index < list.length; index++) {
            const rawEntry = list[index];
            try {
                const entry = normalizeCustomPrompt(rawEntry, {
                    path: `customPrompts[${index}]`,
                    id: rawEntry?.id,
                });
                if (!entry.id) throw new Error('custom prompt id is required');
                if (seenIds.has(entry.id)) throw new Error(`duplicate custom prompt id "${entry.id}"`);
                seenIds.add(entry.id);
                const valid = validateName(entry.name, entry.id);
                if (!valid.ok) throw new Error(valid.error);
                if (entry.enabled && masterOn) {
                    registerOne(rawEntry);
                    desired.add(entry.id);
                }
            } catch (error) {
                if (strict) throw error;
                console.warn(`[GroupDirector] Custom prompt skipped: ${error.message}`);
            }
        }
        for (const [entryId, name] of [...managed]) {
            if (desired.has(entryId)) continue;
            unregisterOwned(name, entryId);
            managed.delete(entryId);
        }
    }

    function restoreFields(entry, before, applied) {
        for (const key of Object.keys(applied)) {
            if (Object.is(entry[key], applied[key])) entry[key] = before[key];
        }
    }

    async function persistOrRollback(rollback) {
        try {
            await saveSettings();
        } catch (error) {
            rollback();
            reconcile();
            throw error;
        }
    }

    function setMasterEnabled(on, { beforeApply = () => {} } = {}) {
        return enqueue(async () => {
            beforeApply(settings);
            const before = settings.customPromptsEnabled;
            const applied = !!on;
            settings.customPromptsEnabled = applied;
            try {
                reconcile({ strict: true });
                await persistOrRollback(() => {
                    if (settings.customPromptsEnabled === applied) settings.customPromptsEnabled = before;
                });
            } catch (error) {
                if (settings.customPromptsEnabled === applied) settings.customPromptsEnabled = before;
                reconcile();
                throw error;
            }
        });
    }

    function add(name, content, enabled = true, extra = {}, { beforeApply = () => {} } = {}) {
        return enqueue(async () => {
            beforeApply(settings);
            const valid = validateName(name);
            if (!valid.ok) throw new Error(valid.error);
            const entry = normalizeCustomPrompt({ name, content, enabled, ...extra }, {
                id: generateCustomPromptId(),
            });
            const selfRef = hasSelfReference(entry.name, entry.content);
            const list = getList();
            list.push(entry);
            const rollback = () => {
                const index = list.indexOf(entry);
                if (index >= 0) list.splice(index, 1);
            };
            try {
                reconcile({ strict: true });
                await persistOrRollback(rollback);
            } catch (error) {
                rollback();
                reconcile();
                throw error;
            }
            log(`Custom prompt added: {{${name}}}${selfRef ? ' (self-ref — may render empty)' : ''}`);
            return { entry, selfRef };
        });
    }

    function update(id, updates, { beforeApply = () => {} } = {}) {
        return enqueue(async () => {
            beforeApply(settings);
            const entry = getList().find(item => item.id === id);
            if (!entry) throw new Error('Not found');
            const candidate = normalizeCustomPrompt({ ...entry, ...updates }, { id });
            const valid = validateName(candidate.name, id);
            if (!valid.ok) throw new Error(valid.error);
            const before = { ...entry };
            Object.assign(entry, candidate);
            const rollback = () => restoreFields(entry, before, candidate);
            try {
                reconcile({ strict: true });
                await persistOrRollback(rollback);
            } catch (error) {
                rollback();
                reconcile();
                throw error;
            }
            return entry;
        });
    }

    function remove(id, { beforeApply = () => {} } = {}) {
        return enqueue(async () => {
            beforeApply(settings);
            const list = getList();
            const index = list.findIndex(entry => entry.id === id);
            if (index < 0) return undefined;
            const removed = list.splice(index, 1)[0];
            const rollback = () => {
                if (!list.some(entry => entry.id === id)) list.splice(Math.min(index, list.length), 0, removed);
            };
            try {
                reconcile({ strict: true });
                await persistOrRollback(rollback);
            } catch (error) {
                rollback();
                reconcile();
                throw error;
            }
            log(`Custom prompt removed: {{${removed.name}}}`);
            return removed;
        });
    }

    function toggle(id) {
        return enqueue(async () => {
            const entry = getList().find(item => item.id === id);
            if (!entry) return undefined;
            const before = entry.enabled;
            const applied = !before;
            entry.enabled = applied;
            const rollback = () => {
                if (entry.enabled === applied) entry.enabled = before;
            };
            try {
                reconcile({ strict: true });
                await persistOrRollback(rollback);
            } catch (error) {
                rollback();
                reconcile();
                throw error;
            }
            return entry.enabled;
        });
    }

    function initAll() {
        reconcile();
        const list = getList();
        if (list.length) log(`${list.filter(entry => entry.enabled).length}/${list.length} custom prompts enabled`);
    }

    function exportPrompts(selectedIds) {
        const selected = getList().filter(entry => selectedIds.includes(entry.id));
        if (!selected.length) return null;
        const json = {
            version: 1,
            type: 'custom-prompt-export',
            exportedAt: new Date().toISOString(),
            prompts: selected.map(({ name, content, dataJson = '', scope = 'global', enabled }) => ({
                name, content, dataJson, scope, enabled,
            })),
        };
        const url = URL.createObjectURL(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }));
        const anchor = document.createElement('a');
        let attached = false;
        try {
            anchor.href = url;
            anchor.download = `custom-prompts-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(anchor);
            attached = true;
            anchor.click();
        } finally {
            try {
                if (attached && anchor.parentNode) anchor.parentNode.removeChild(anchor);
                else if (attached) document.body.removeChild(anchor);
            } finally {
                URL.revokeObjectURL(url);
            }
        }
        log(`Exported ${selected.length} custom prompt(s)`);
        return json;
    }

    function parseImportFile(jsonText) {
        try {
            const data = JSON.parse(jsonText);
            data.prompts = validateCustomPromptExport(data);
            return { ok: true, data };
        } catch (error) {
            return { ok: false, error: error.message };
        }
    }

    function importPrompts(data, overwriteConflicts = false) {
        return enqueue(async () => {
            const imported = normalizeCustomPromptList(data?.prompts, { path: 'prompts', preserveIds: false });
            const list = getList();
            for (const prompt of imported) {
                const existing = list.find(entry => entry.name === prompt.name);
                const valid = validateName(prompt.name, existing?.id);
                if (!valid.ok) throw new Error(valid.error);
            }
            const addedEntries = [];
            const overwrittenEntries = [];
            const conflicts = [];
            for (const prompt of imported) {
                const existing = list.find(entry => entry.name === prompt.name);
                if (existing) {
                    if (!overwriteConflicts) {
                        conflicts.push(prompt.name);
                        continue;
                    }
                    const before = { ...existing };
                    const applied = { ...prompt, id: existing.id };
                    Object.assign(existing, applied);
                    overwrittenEntries.push({ entry: existing, before, applied });
                } else {
                    const entry = { ...prompt, id: generateCustomPromptId() };
                    list.push(entry);
                    addedEntries.push(entry);
                }
            }
            const rollback = () => {
                for (const entry of addedEntries) {
                    const index = list.indexOf(entry);
                    if (index >= 0) list.splice(index, 1);
                }
                for (const item of overwrittenEntries) restoreFields(item.entry, item.before, item.applied);
            };
            try {
                reconcile({ strict: true });
                await persistOrRollback(rollback);
            } catch (error) {
                rollback();
                reconcile();
                throw error;
            }
            log(`Imported custom prompts: ${addedEntries.length} added, ${overwrittenEntries.length} overwritten`);
            return { added: addedEntries.length, overwritten: overwrittenEntries.length, conflicts };
        });
    }


    // Reuse the same mutation queue and rollback path as the GUI. Approval is rechecked
    // inside that queue, immediately before any assignment/Provider registration.
    async function mutateApproved({ operation, id, definition, validate, expectedSettings }) {
        if (!['create', 'update', 'delete'].includes(operation)) throw Error('INVALID_PROMPT_DRAFT');
        let started = false;
        const beforeApply = () => {
            if (expectedSettings !== settings) throw Error('STALE_PROMPT_ASSET');
            validate();
            started = true;
        };
        let entry;
        try {
            if (operation === 'create') entry = (await add(definition.name, definition.content, definition.enabled, definition, { beforeApply })).entry;
            else if (operation === 'update') entry = await update(id, definition, { beforeApply });
            else entry = await remove(id, { beforeApply });
            const matches = expectedSettings === settings && (operation === 'delete'
                ? !getList().some(row => row.id === id)
                : getList().filter(row => row.id === entry.id).length === 1 && getList().find(row => row.id === entry.id) === entry
                    && Object.entries(definition).every(([key, value]) => Object.is(entry[key], value)));
            return { status: matches ? 'saved_unconfirmed' : 'outcome_unknown', persistence: matches ? 'unconfirmed' : 'unknown', id: entry?.id || id || '' };
        } catch (error) {
            if (!started) throw error;
            return { status: 'outcome_unknown', persistence: 'unknown', id: entry?.id || id || '' };
        }
    }


    function mutateBatchApproved({ entries, validate, expectedSettings }) {
        return enqueue(async () => {
            if (expectedSettings !== settings) throw Error('STALE_PROMPT_ASSET');
            validate();
            if (!Array.isArray(entries) || !entries.length || entries.length > 6) throw Error('INVALID_PROMPT_BATCH');
            const list = getList(), originalOrder = [...list];
            const planned = entries.map(row => ({ operation: row.operation, id: row.operation === 'create' ? generateCustomPromptId() : row.id,
                next: row.next && normalizeCustomPrompt(row.next) }));
            const undo = [], expected = [];
            try {
                for (const row of planned) {
                    const index = list.findIndex(e => e.id === row.id);
                    if (row.operation === 'create') {
                        const entry = { ...row.next, id: row.id }; list.push(entry);
                        const serialized = JSON.stringify(entry);
                        undo.push(() => { const i = list.indexOf(entry); if (i >= 0 && JSON.stringify(entry) === serialized) list.splice(i, 1); });
                        expected.push({ id: row.id, serialized });
                    } else if (row.operation === 'delete') {
                        if (index < 0) throw Error('STALE_PROMPT_ASSET');
                        const entry = list.splice(index, 1)[0];
                        undo.push(() => {
                            if (list.some(e => e.id === row.id)) return;
                            const successor = originalOrder.slice(originalOrder.indexOf(entry) + 1).find(e => list.includes(e));
                            list.splice(successor ? list.indexOf(successor) : list.length, 0, entry);
                        });
                        expected.push({ id: row.id, serialized: null });
                    } else {
                        if (index < 0) throw Error('STALE_PROMPT_ASSET');
                        const entry = list[index], before = { ...entry }, applied = { ...row.next, id: row.id };
                        Object.assign(entry, applied);
                        undo.push(() => { if (list.includes(entry)) for (const key of Object.keys(applied)) {
                            if (!Object.is(entry[key], applied[key])) continue;
                            if (Object.hasOwn(before, key)) entry[key] = before[key]; else delete entry[key];
                        } });
                        expected.push({ id: row.id, serialized: JSON.stringify(entry) });
                    }
                }
                reconcile({ strict: true });
                await saveSettings();
                const matches = settings.customPrompts === list && expected.every(row => {
                    const found = list.filter(e => e.id === row.id);
                    return row.serialized === null ? found.length === 0 : found.length === 1 && JSON.stringify(found[0]) === row.serialized;
                });
                return { status: matches ? 'saved_unconfirmed' : 'outcome_unknown', persistence: matches ? 'unconfirmed' : 'unknown', ids: planned.map(row => row.id) };
            } catch {
                if (settings.customPrompts === list) for (const restore of undo.reverse()) restore();
                try { reconcile(); } catch { /* Registration/save outcome remains unknown. */ }
                return { status: 'outcome_unknown', persistence: 'unknown', ids: planned.map(row => row.id) };
            }
        });
    }

    return {
        mutateBatchApproved, mutateApproved, getList, add, update, remove, toggle, initAll, validateName, validateDataJson,
        hasSelfReference, exportPrompts, parseImportFile, importPrompts, setMasterEnabled,
    };
}
