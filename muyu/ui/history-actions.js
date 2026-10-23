import { HISTORY_LIMITS } from '../sessions/contract.js';
import { UI_LABELS } from './navigation-metadata.js';

/** Explicit inline confirmations; no business operation is inferred from model text. */
export function createHistoryActions({ doc, importRoot, exportRoot, parent, controller, act, t }) {
    const node = (tag, text, owner) => { const el = doc.createElement(tag); el.textContent = text; owner.append(el); return el; };
    const button = (label, owner) => { const el = node('button', label, owner); el.type = 'button'; el.className = 'menu_button'; return el; };
    const form = node('section', '', parent); form.className = 'gd-muyu-history-confirm'; form.hidden = true;
    const prompt = node('p', '', form), label = node('label', t('对话标题', 'Conversation title'), form), title = node('input', '', label);
    title.type = 'text'; title.className = 'text_pole'; title.maxLength = 100;
    const confirm = button(t('确认', 'Confirm'), form), cancel = button(t('取消', 'Cancel'), form);
    let command = null, pending = false, disposed = false, importText = null, fileEpoch = 0;
    const close = () => { command = null; form.hidden = true; if (!disposed) parent.querySelector?.('button')?.focus(); };
    form.onkeydown = event => { if (event.key === 'Escape' && !pending) { event.preventDefault(); event.stopPropagation(); close(); } };
    cancel.onclick = close;
    confirm.onclick = () => act(async () => {
        if (!command || pending) return;
        const selected = command; pending = true; confirm.disabled = cancel.disabled = true;
        try {
            if (selected.action === 'rename') await controller.renameSession(selected.id, title.value);
            else if (selected.action === 'remove') await controller.deleteSession(selected.id);
            else await controller.archiveSession(selected.id, selected.value);
            close();
        } finally { pending = false; confirm.disabled = cancel.disabled = false; }
    });
    function download(format) {
        const text = controller.exportHistory(format), url = URL.createObjectURL(new Blob([text], { type: format === 'markdown' ? 'text/markdown;charset=utf-8' : 'application/json' }));
        try { const a = doc.createElement('a'); a.href = url; a.download = format === 'markdown' ? 'muyu-conversation.md' : 'muyu-conversation.json'; a.click(); }
        finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    }
    const exportJSON = button(t(...UI_LABELS.exportJSON), exportRoot);
    const exportMD = button(t(...UI_LABELS.exportMarkdown), exportRoot);
    exportJSON.onclick = () => act(() => download('json')); exportMD.onclick = () => act(() => download('markdown'));
    const importer = node('details', '', importRoot); node('summary', t('导入只读备份', 'Import read-only backup'), importer);
    node('p', t(`最多 ${HISTORY_LIMITS.recordBytes / 1024 / 1024} MiB 的单会话 JSON。在当前读取来源核对：相同只读备份跳过，有变化则新增只读版本；不会覆盖原对话、恢复授权或调用模型。`, `One conversation JSON, up to ${HISTORY_LIMITS.recordBytes / 1024 / 1024} MiB. Checks the current read source: identical read-only backups are skipped; changed content becomes a separate read-only version. Never overwrites originals, restores grants or calls a model.`), importer);
    const fileLabel = node('label', t('选择 JSON 文件', 'Choose JSON file'), importer), file = node('input', '', fileLabel); file.type = 'file'; file.accept = '.json,application/json';
    const preview = node('p', '', importer), accept = button(t('确认导入只读备份', 'Confirm read-only import'), importer), discard = button(t('取消导入', 'Cancel import'), importer);
    const result = node('p', '', importer); result.setAttribute('role', 'status');
    accept.disabled = true; const clearImport = () => { fileEpoch++; importText = null; preview.textContent = ''; file.value = ''; accept.disabled = true; };
    discard.onclick = clearImport;
    file.onchange = () => act(async () => {
        const selected = file.files?.[0]; clearImport(); result.textContent = ''; const epoch = fileEpoch;
        if (!selected) return;
        if (selected.size > HISTORY_LIMITS.recordBytes) throw Error('HISTORY_CAPACITY');
        const text = await selected.text(); if (disposed || epoch !== fileEpoch) return;
        const info = controller.previewHistoryImport(text);
        preview.textContent = `${info.title || t('未命名', 'Untitled')} · ${info.messages} ${t('条消息', 'messages')} · ${info.bytes} bytes\n${t('原始范围：', 'Original scope: ')}${info.scope}`;
        importText = text; accept.disabled = false;
    });
    accept.onclick = () => act(async () => {
        if (importText === null || pending) return;
        pending = true; accept.disabled = true;
        try {
            result.textContent = t('正在核对当前来源中的只读备份…', 'Checking read-only backups in the current source…');
            await controller.importHistory(importText);
            if (disposed) return;
            clearImport();
            result.textContent = controller.snapshot().history?.importReport?.status === 'identical'
                ? t('相同只读备份已存在，未新增；已打开已有记录。', 'An identical read-only backup exists. No duplicate created; opened the existing record.')
                : t('已新增独立只读备份；未覆盖原记录。是否保存请查看存储状态。', 'Added a separate read-only backup without overwriting originals. Check storage status for persistence.');
        } catch (error) { result.textContent = t('导入未完成；原记录保留，请检查存储状态后重试。', 'Import did not complete. Original records are retained; check storage status before retrying.'); throw error; }
        finally { pending = false; if (importText !== null) accept.disabled = false; }
    });
    return {
        export(format) { download(format); },
        show(action) {
            const s = controller.snapshot(), h = s.history; if (!h?.sessionId || s.resetting || pending) return;
            command = { id: h.sessionId, action, value: !h.selected?.archived }; form.hidden = false;
            label.hidden = action !== 'rename'; title.value = h.selected?.title || '';
            if (action === 'rename') prompt.textContent = t('修改当前对话标题（1–100 字符）', 'Rename this conversation (1–100 characters)');
            else {
                const stopping = s.busy && !s.occupiedElsewhere;
                prompt.textContent = (stopping ? t('先停止此会话任务并等待清理，然后', 'Stop this conversation and wait for cleanup, then ') : '') + (action === 'remove'
                    ? h.persisted ? t('删除当前存储位置中已保存的这条记录及本页副本？无法撤销，建议先导出。不会删除酒馆聊天或其他存储位置的副本。', 'delete this record from the active storage backend and this page? This cannot be undone; export first. ST chat and copies in other backends are unaffected.') : t('删除这条临时记录？无法撤销，不影响酒馆聊天。', 'delete this temporary record? This cannot be undone; ST chat is unaffected.')
                    : command.value ? t('归档此对话？仍占存储容量，可恢复。', 'archive this conversation? Storage is retained; it can be restored.') : t('恢复此归档对话？导入备份仍为只读。', 'restore this archived conversation? Imported backups remain read-only.'));
            }
            (action === 'rename' ? title : confirm).focus?.();
        },
        render(s) {
            if (command && command.id !== s.history?.sessionId && !pending) close();
            confirm.disabled = cancel.disabled = pending || s.resetting;
            exportJSON.disabled = exportMD.disabled = !s.history?.sessionId;
            file.disabled = discard.disabled = s.resetting || s.busy || s.history?.loading || pending;
            accept.disabled = importText === null || s.resetting || s.busy || s.history?.loading || pending;
        },
        dispose() { disposed = true; clearImport(); close(); },
    };
}
