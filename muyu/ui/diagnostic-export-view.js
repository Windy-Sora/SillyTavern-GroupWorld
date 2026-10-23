import { diagnosticExport } from '../application/diagnostic-export.js';

/** User-triggered local download; no tools, permissions, network or transcript export. */
export function createDiagnosticExportView({ doc, parent, controller, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text, parent = root) => { const el = doc.createElement(tag); el.textContent = text; parent.append(el); return el; };
    const root = doc.createElement('details'); parent.append(root);
    node('summary', t('排错日志', 'Troubleshooting log'));
    node('small', t('导出当前对话尚保留的执行段、错误码、阶段和开销。仅本地下载，不包含正文、思考、密钥或真实会话标识；刷新前导出，旧记录可能已被裁剪。不包含CMD／服务器日志。', 'Download retained execution segments, error codes, phases and usage for this conversation. Local only: no bodies, thinking, keys or real session IDs. Export before reload; older records may be trimmed. No CMD/server logs.'));
    const button = node('button', t('导出排错日志 JSON', 'Export diagnostic log JSON')); button.type = 'button'; button.className = 'menu_button';
    const manual = node('details', ''); manual.hidden = true;
    node('summary', t('查看日志文本／手动复制', 'View log text / copy manually'), manual);
    const output = node('textarea', '', manual); output.readOnly = true; output.rows = 6; output.className = 'text_pole';
    output.setAttribute('aria-label', t('排错日志原文（可手动复制）', 'Diagnostic log text (copy manually)'));
    const status = node('small', ''); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    let disposed = false, url = null, timer = null;
    const api = doc.defaultView?.URL;
    const clear = () => { if (timer !== null) clearTimeout(timer); timer = null; if (url) api?.revokeObjectURL(url); url = null; };
    button.onclick = () => {
        if (disposed) return;
        let text;
        try { text = diagnosticExport(controller.snapshot()); }
        catch { status.textContent = t('日志生成失败，未导出任何内容。', 'Log generation failed; nothing exported.'); return; }
        clear(); output.value = text; manual.hidden = true;
        try {
            const BlobType = doc.defaultView?.Blob;
            if (!api?.createObjectURL || !BlobType) throw Error('UNAVAILABLE');
            url = api.createObjectURL(new BlobType([text], { type: 'application/json;charset=utf-8' }));
            const link = doc.createElement('a'); link.href = url; link.download = 'muyu-diagnostics.json'; root.append(link);
            try { link.click(); } finally { link.remove(); }
            timer = setTimeout(clear, 1000);
            status.textContent = t('已发起日志下载；若浏览器未保存，请复制下方日志。', 'Download requested; if the browser did not save it, copy the log below.');
            manual.hidden = false; manual.open = false;
        } catch {
            clear(); manual.hidden = false; manual.open = true;
            status.textContent = t('无法自动下载，请手动复制下方日志。', 'Automatic download unavailable; copy the log below.');
        }
    };
    return { dispose() { if (disposed) return; disposed = true; clear(); button.disabled = true; output.value = ''; root.remove(); } };
}
