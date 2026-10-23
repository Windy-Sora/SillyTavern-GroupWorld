import { randomUUID } from '../runtime/crypto.js';
import { copyJson, jsonKey } from '../core/json-contract.js';
import { parseSkillMarkdown, skillCopy, skillKeys, validateSkillData, validateSkillPackage } from '../skills/contract.js';
import { skillEditorPackage } from '../skills/editor.js';
import { createSkillStore } from './skill-store.js';
import { createSkillManagement } from '../skills/management.js';
import { loadBuiltinSkills } from '../skills/builtin-loader.js';

/** Private edit tickets keep complete documents out of artifacts / history. */
export function createSkillPort({ getSettings, saveSettings, loadBuiltins = loadBuiltinSkills }) {
    const owner = getSettings(), store = createSkillStore({ getSettings, saveSettings }), tickets = new Map(), listeners = new Set();
    let service, fixed = [], loading = null, closed = false;
    const live = () => { if (closed || getSettings() !== owner) throw Error('SKILL_STORE_UNAVAILABLE'); };
    const notify = () => { for (const fn of listeners) { try { fn(); } catch { /* Observer only. */ } } };
    async function ready() {
        live();
        if (!loading) loading = loadBuiltins().then(values => {
            live(); fixed = values.map(value => ({ revision: value.revision, package: validateSkillPackage(value.package) }));
            service = createSkillManagement({ store, builtins: fixed });
        }).catch(error => { loading = null; throw error; });
        await loading; live();
    }
    function state() {
        live(); if (!service) throw Error('SKILL_NOT_READY');
        const data = validateSkillData(owner.muyuSkillData);
        const rows = [...fixed.map(row => {
            const meta = parseSkillMarkdown(row.package.files.find(file => file.path === 'SKILL.md').text), id = `builtin:${meta.name}`, policy = data.builtinPolicies.find(item => item.id === id);
            return { id, revision: `${row.revision}:${policy?.revision ?? 0}`, enabled: policy?.enabled ?? true, package: row.package, source: 'builtin' };
        }), ...data.skills.map(row => ({ ...row, source: 'user' }))];
        return { data, rows };
    }
    function existing(s, id, revision) {
        const row = s.rows.find(row => row.id === id);
        if (!row || row.revision !== revision) throw Error('SKILL_STALE');
        return row;
    }
    function preview(request) {
        const keys = Object.keys(request ?? {});
        skillKeys(request, keys);
        if (keys.some(key => !['operation', 'id', 'revision', 'expectedRevision', 'enabled', 'package', 'fields', 'newName'].includes(key))) throw Error('SKILL_INVALID');
        const s = state(), { operation, id = '', revision = null, expectedRevision, enabled = false } = request;
        if (!['create', 'update', 'delete', 'enable', 'copy', 'feature'].includes(operation) || s.data.revision !== expectedRevision || typeof enabled !== 'boolean') throw Error('SKILL_STALE');
        if (tickets.size >= 64) throw Error('SKILL_CAPACITY');
        if (['create', 'feature'].includes(operation) && (id || revision !== null)) throw Error('SKILL_INVALID');
        const previous = ['create', 'feature'].includes(operation) ? null : existing(s, id, revision);
        if (operation === 'update' && request.enabled !== undefined || operation !== 'copy' && request.newName !== undefined || operation === 'copy' && (request.fields !== undefined || request.package !== undefined)) throw Error('SKILL_INVALID');
        if (previous?.source === 'builtin' && ['update', 'delete'].includes(operation)) throw Error('SKILL_READ_ONLY');
        if (['enable', 'delete', 'feature'].includes(operation) && (request.package !== undefined || request.fields !== undefined || request.newName !== undefined)) throw Error('SKILL_INVALID');
        let next = null;
        if (['create', 'update'].includes(operation)) {
            if (request.package !== undefined && request.fields !== undefined) throw Error('SKILL_INVALID');
            next = request.package !== undefined ? validateSkillPackage(request.package) : skillEditorPackage(request.fields, previous?.package);
        } else if (operation === 'copy') {
            next = skillEditorPackage({ name: request.newName }, previous.package);
        }
        const meta = next ? parseSkillMarkdown(next.files.find(file => file.path === 'SKILL.md').text) : null;
        if (operation === 'update' && `user:${meta.name}` !== id) throw Error('SKILL_IDENTITY_CHANGE');
        if (['create', 'copy'].includes(operation) && s.rows.some(row => row.id === `user:${meta.name}`)) throw Error('SKILL_DUPLICATE');
        const ticket = randomUUID(), content = copyJson({ module: 'skill', ticket, operation, id: next ? `user:${meta.name}` : id,
            name: meta?.displayName ?? (previous ? parseSkillMarkdown(previous.package.files.find(file => file.path === 'SKILL.md').text).displayName : 'Skill'),
            enabled: operation === 'update' ? previous.enabled : operation === 'delete' ? false : enabled,
            warnings: ['账户内所有聊天；保存不运行技能或调用模型。启用后相关用途和正文可按需发送给当前模型。关闭／删除不撤回已外发内容；未知保存不要自动重试。'] });
        tickets.set(ticket, { content, owner, storeRevision: s.data.revision, baseline: JSON.stringify(s.data), previous: previous ? skillCopy(previous) : null, next });
        return content;
    }
    function assertFresh(content) {
        const record = tickets.get(content?.ticket), s = state();
        if (!record || jsonKey(record.content) !== jsonKey(content) || record.owner !== owner || record.baseline !== JSON.stringify(s.data)) throw Error('SKILL_STALE');
        if (record.previous) existing(s, record.previous.id, record.previous.revision);
        return record;
    }
    const port = {
        ready,
        async catalog(offset = 0) {
            await ready(); const value = await service.list();
            const rows = value.entries.filter(row => row.modelInvocable);
            if (!Number.isSafeInteger(offset) || offset < 0 || offset > rows.length) throw Error('SKILL_INVALID');
            const entries = rows.slice(offset, offset + 16).map(row => ({ id: row.id, revision: String(row.revision), displayName: row.displayName, description: row.description, source: row.source }));
            while (new TextEncoder().encode(JSON.stringify(entries)).length > 8000 && entries.length > 1) entries.pop();
            return { enabled: value.enabled, total: rows.length, entries, nextOffset: offset + entries.length < rows.length ? offset + entries.length : -1 };
        },
        async snapshot(query) { await ready(); return service.registry.snapshot(query); },
        async list(offset = 0) {
            await ready(); const value = await service.list();
            const current = state();
            if (current.data.revision !== value.revision) throw Error('SKILL_STALE');
            value.entries = value.entries.map(row => ({ ...row, effectiveEnabled: row.enabled, enabled: current.rows.find(item => item.id === row.id).enabled }));
            if (!Number.isSafeInteger(offset) || offset < 0 || offset > value.entries.length) throw Error('SKILL_INVALID');
            const entries = value.entries.slice(offset, offset + 16);
            while (new TextEncoder().encode(JSON.stringify(entries)).length > 20000 && entries.length > 1) entries.pop();
            return { revision: value.revision, enabled: value.enabled, total: value.entries.length, entries, nextOffset: offset + entries.length < value.entries.length ? offset + entries.length : -1 };
        },
        async inspect(id, revision) { await ready(); return service.read({ id, revision }); },
        async read(id, revision, offset = 0) {
            const row = await port.inspect(id, revision), text = JSON.stringify(row.package);
            if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) throw Error('SKILL_INVALID');
            return { id, revision, text: text.slice(offset, offset + 4000), nextOffset: offset + 4000 < text.length ? offset + 4000 : -1, complete: offset === 0 && text.length <= 4000, untrusted: true };
        },
        async export(id, revision) { await ready(); return service.export({ id, revision }); },
        preview, assertFresh,
        display(content) { const row = assertFresh(content); return skillCopy({ previous: row.previous?.package ?? null, next: row.next, previousEnabled: content.operation === 'feature' ? JSON.parse(row.baseline).enabled : row.previous?.enabled ?? false, nextEnabled: content.enabled }); },
        async save(content) {
            const row = assertFresh(content); tickets.delete(content.ticket);
            try {
                const args = { enabled: content.enabled, expectedRevision: row.storeRevision };
                if (content.operation === 'create') await service.create(row.next, args);
                else if (content.operation === 'copy') await service.create(row.next, args);
                else if (content.operation === 'update') await service.update(row.previous.id, row.previous.revision, row.next, row.storeRevision);
                else if (content.operation === 'delete') await service.remove(row.previous.id, row.previous.revision, row.storeRevision);
                else if (content.operation === 'enable') await service.setEnabled(row.previous.id, row.previous.revision, content.enabled, row.storeRevision);
                else await service.setFeatureEnabled(row.storeRevision, content.enabled);
                return { status: 'saved_unconfirmed', persistence: 'unconfirmed' };
            } finally { notify(); }
        },
        release(content) { tickets.delete(content?.ticket); },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        clear() { tickets.clear(); },
        close() { closed = true; store.close(); tickets.clear(); listeners.clear(); },
    };
    return Object.freeze(port);
}
