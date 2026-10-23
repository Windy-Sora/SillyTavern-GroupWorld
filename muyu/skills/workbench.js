import { parseSkillMarkdown, importSkillPackage, skillCopy } from './contract.js';

/** Controller-owned editor survives DOM replacement; model saves never replace its draft. */
export function createSkillWorkbench({ port, changed = () => {} }) {
    const empty = () => ({ id: '', revision: null, name: '', displayName: '', description: '', body: '', contentVersion: '', modelInvocable: true, userInvocable: true, resourcesJson: '[]', enabled: false, source: 'user', expectedRevision: null });
    let draft = empty(), rows = [], revision = null, enabled = true, busy = false, loaded = false, error = null, result = null, disposed = false, sequence = 0;
    let baseline = JSON.stringify(draft);
    const emit = () => { if (!disposed) changed(); };
    const unsubscribe = port?.subscribe(() => { void load(); });
    async function load() {
        if (!port || disposed) return;
        const ticket = ++sequence;
        try {
            const first = await port.list(), entries = [...first.entries]; let next = first.nextOffset;
            while (next >= 0) {
                const page = await port.list(next);
                if (page.revision !== first.revision) throw Error('SKILL_STALE');
                entries.push(...page.entries); next = page.nextOffset;
            }
            if (!disposed && ticket === sequence) { rows = entries; revision = first.revision; enabled = first.enabled; loaded = true; error = null; emit(); }
        } catch (e) { if (!disposed && ticket === sequence) { error = e.message; loaded = false; emit(); } }
    }
    async function operation(fn) {
        if (!port || disposed || busy) throw Error('SKILL_STORE_UNAVAILABLE');
        busy = true; error = null; result = null; emit();
        try { await fn(); await load(); }
        catch (e) { error = e.message; throw e; }
        finally { busy = false; emit(); }
    }
    function select(pack, identity) {
        const meta = parseSkillMarkdown(pack.files.find(file => file.path === 'SKILL.md').text);
        draft = { ...empty(), ...meta, ...identity, resourcesJson: JSON.stringify(pack.files.filter(file => file.path !== 'SKILL.md'), null, 2) }; baseline = JSON.stringify(draft); emit();
    }
    async function saveRequest(request) {
        const content = port.preview(request);
        try { result = await port.save(content); } finally { port.release(content); }
    }
    return {
        snapshot() { return { available: !!port, draft: skillCopy(draft), dirty: JSON.stringify(draft) !== baseline, rows: skillCopy(rows), revision, enabled, busy, loaded, error, result }; }, load,
        newSkill() { if (busy) return; draft = { ...empty(), expectedRevision: revision }; baseline = JSON.stringify(draft); error = null; result = null; emit(); },
        edit(id, expected) { return operation(async () => { const row = await port.inspect(id, expected); select(row.package, { id: row.id, revision: row.revision, source: row.source, enabled: rows.find(item => item.id === id)?.enabled ?? false, expectedRevision: revision }); }); },
        setDraft(fields) { if (busy) return; const allowed = Object.keys(empty()).filter(key => !['id', 'revision', 'source', 'expectedRevision'].includes(key)); draft = { ...draft, ...Object.fromEntries(Object.entries(fields).filter(([key]) => allowed.includes(key))) }; emit(); },
        importText(text, mode = 'new') {
            if (busy) return;
            if (!['new', 'replace'].includes(mode)) throw Error('SKILL_INVALID');
            const pack = importSkillPackage(text), name = parseSkillMarkdown(pack.files.find(file => file.path === 'SKILL.md').text).name;
            const row = rows.find(row => row.id === `user:${name}`);
            if (mode === 'replace' && !row) throw Error('SKILL_NOT_FOUND');
            select(pack, { expectedRevision: revision, ...(mode === 'replace' ? { id: row.id, revision: row.revision, enabled: row.enabled } : {}) });
            baseline = ''; emit(); // Imported content is unsaved, even before the first keystroke.
        },
        save() { return operation(async () => {
            if (draft.source === 'builtin') throw Error('SKILL_READ_ONLY');
            const fields = Object.fromEntries(['name', 'displayName', 'description', 'body', 'contentVersion', 'modelInvocable', 'userInvocable'].map(key => [key, draft[key]]));
            if (!fields.displayName.trim()) fields.displayName = fields.name;
            fields.resources = JSON.parse(draft.resourcesJson);
            await saveRequest({ operation: draft.id ? 'update' : 'create', id: draft.id, revision: draft.revision, expectedRevision: draft.expectedRevision, fields, ...(!draft.id ? { enabled: draft.enabled } : {}) });
            const list = await port.list();
            const find = async () => { let page = list; for (;;) { const row = page.entries.find(row => row.id === `user:${draft.name}`); if (row || page.nextOffset < 0) return row; page = await port.list(page.nextOffset); } };
            const row = await find();
            if (row) draft = { ...draft, displayName: row.displayName ?? fields.displayName, id: row.id, revision: row.revision, expectedRevision: list.revision };
            baseline = JSON.stringify(draft);
        }); },
        remove(id, packageRevision) { return operation(() => saveRequest({ operation: 'delete', id, revision: packageRevision, expectedRevision: revision })); },
        setEnabled(id, packageRevision, value) { return operation(() => saveRequest({ operation: 'enable', id, revision: packageRevision, expectedRevision: revision, enabled: value })); },
        setFeatureEnabled(value) { return operation(() => saveRequest({ operation: 'feature', expectedRevision: revision, enabled: value })); },
        copy(id, packageRevision, newName) { return operation(() => saveRequest({ operation: 'copy', id, revision: packageRevision, expectedRevision: revision, newName, enabled: false })); },
        export: (id, packageRevision) => port.export(id, packageRevision),
        dispose() { disposed = true; sequence++; unsubscribe?.(); },
    };
}
