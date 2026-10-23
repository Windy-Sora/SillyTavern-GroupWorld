import { projectServiceDiagnostics } from '../services/diagnostics.js';
/** Local viewing/export is explicit and never grants model access. */
export function createServiceDiagnosticsView({ doc, parent, controller, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const root = doc.createElement('details'); parent.append(root);
    const node = (tag, text, owner = root) => { const el = doc.createElement(tag); el.textContent = text; owner.append(el); return el; };
    node('summary', t('服务错误记录（最近30分钟）', 'Service errors (last 30 minutes)'));
    node('small', t('仅当前账户的暮羽服务失败分类，最多200条；重启或清空后不可恢复。无正文、密钥、原始异常或CMD日志。本地查看不外发；暮羽读取仍遵守资料权限。空记录不证明从未失败。', 'Only this account’s Muyu service error classifications, up to 200. Restarting or clearing removes them. No bodies, keys, raw exceptions or CMD logs. Local viewing does not send them to a model; model reads follow data permissions. Empty records do not prove no failures occurred.'));
    const actions = node('div', ''); actions.className = 'gd-muyu-actions';
    const button = (zh, en) => { const el = node('button', t(zh, en), actions); el.type = 'button'; el.className = 'menu_button'; return el; };
    const view = button('查看／刷新错误记录', 'View / refresh service errors'), clear = button('清空服务错误记录', 'Clear service errors'), download = button('导出服务日志 JSON', 'Export service log JSON');
    const output = node('pre', ''); output.hidden = true; output.className = 'gd-muyu-diagnostics-records';
    const manual = node('details', ''); manual.hidden = true;
    node('summary', t('JSON文本／手动复制', 'JSON text / copy manually'), manual);
    const text = node('textarea', '', manual); text.className = 'text_pole'; text.readOnly = true; text.rows = 6; text.setAttribute('aria-label', t('脱敏服务日志 JSON', 'Sanitized service log JSON'));
    const notice = node('p', ''); notice.setAttribute('role', 'status');
    let available = false, blocked = false, busy = false, disposed = false, value = null, url = null, timer = null;
    const revoke = () => { if (timer !== null) clearTimeout(timer); timer = null; if (url) doc.defaultView?.URL?.revokeObjectURL(url); url = null; };
    function render(enabled = available, disabled = blocked) {
        available = enabled; blocked = disabled;
        for (const el of [view, clear, download]) el.disabled = disposed || !available || blocked || busy || el === download && !value;
        if (!available) { value = null; output.textContent = ''; output.hidden = true; text.value = ''; manual.hidden = true; revoke(); }
    }
    async function run(action) {
        if (disposed || !available || blocked || busy) return;
        busy = true; render();
        try { await action(); }
        catch { if (!disposed) notice.textContent = t('服务记录操作失败，未确认读取或清空。检查版本与酒馆连接后重试。', 'Service record operation failed; reading or clearing was not confirmed. Check service version and ST connection, then retry.'); }
        finally { busy = false; if (!disposed) render(); }
    }
    view.onclick = () => run(async () => {
        const raw = await controller.serviceDiagnostics(); if (disposed || !available) return;
        value = projectServiceDiagnostics(raw); output.hidden = false;
        const operations = { 'history.list': t('历史列表', 'History list'), 'history.read': t('读取对话', 'Read conversation'), 'history.write': t('保存对话', 'Save conversation'), 'history.delete': t('删除对话', 'Delete conversation'), 'search.request': t('联网搜索', 'Web search'), 'storage.check': t('存储自检', 'Storage test') };
        const stages = { request: t('请求', 'request'), prepare: t('准备', 'prepare'), write: t('写入', 'write'), read: t('读回', 'read'), cleanup: t('清理', 'cleanup') };
        output.textContent = value.records.length ? value.records.map(row => `${new Date(row.time).toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN')} · ${operations[row.operation]} · ${stages[row.stage]} · ${row.code} · ${row.durationMs} ms`).join('\n') : t('暂无保留的错误记录。', 'No retained error records.');
        notice.textContent = t('已读取当前账户保留记录；这是快照，不是实时监控。', 'Read retained records for this account; this is a snapshot, not live monitoring.');
    });
    clear.onclick = () => run(async () => {
        await controller.clearServiceDiagnostics(); if (disposed) return;
        value = null; output.textContent = ''; output.hidden = true; text.value = ''; manual.hidden = true; revoke();
        notice.textContent = t('已清空当前账户的服务错误记录；不删除对话。后续新错误仍会记录。', 'Cleared this account’s service errors, not conversations. New errors will still be recorded.');
    });
    download.onclick = () => {
        if (disposed || download.disabled || !value) return;
        revoke(); text.value = JSON.stringify({ format: 'muyu-service-diagnostics', version: 1, exportedAt: Date.now(), data: projectServiceDiagnostics(value) }, null, 2); manual.hidden = false;
        try {
            const api = doc.defaultView?.URL, BlobType = doc.defaultView?.Blob; if (!api?.createObjectURL || !BlobType) throw Error('UNAVAILABLE');
            url = api.createObjectURL(new BlobType([text.value], { type: 'application/json;charset=utf-8' }));
            const link = node('a', ''); link.href = url; link.download = 'muyu-service-diagnostics.json'; try { link.click(); } finally { link.remove(); }
            timer = setTimeout(revoke, 1000); manual.open = false;
            notice.textContent = t('已发起下载；若未保存可手动复制JSON。', 'Download requested; copy the JSON manually if it was not saved.');
        } catch { revoke(); manual.open = true; notice.textContent = t('请手动复制下方JSON。', 'Please copy the JSON below manually.'); }
    };
    render(); return { render, dispose() { disposed = true; revoke(); value = null; text.value = ''; render(); } };
}
