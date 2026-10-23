/** Explicit local clipboard write only. No fallback execution or model request. */
export function createCopyControl({ doc, parent, text, lang, label, ariaLabel, compact = false }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const root = doc.createElement('div'); root.className = 'gd-muyu-copy-control' + (compact ? ' gd-muyu-copy-compact' : ''); parent.append(root);
    const button = doc.createElement('button'); button.type = 'button'; button.className = 'menu_button';
    const caption = label || t('复制原文', 'Copy original');
    button.setAttribute('aria-label', ariaLabel || caption); button.title = caption;
    if (compact) { const icon = doc.createElement('span'); icon.className = 'gd-muyu-copy-icon'; icon.setAttribute('aria-hidden', 'true'); button.append(icon); }
    else button.textContent = caption;
    root.append(button);
    const status = doc.createElement('span'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true'); root.append(status);
    let disposed = false, busy = false;
    button.onclick = async () => {
        if (disposed || busy || button.isConnected === false) return;
        busy = true; button.disabled = true; status.textContent = t('正在复制…', 'Copying…');
        try {
            const clipboard = doc.defaultView?.navigator?.clipboard;
            if (!clipboard?.writeText) throw Error('CLIPBOARD_UNAVAILABLE');
            await clipboard.writeText(String(text ?? ''));
            if (!disposed && button.isConnected !== false) status.textContent = t('已复制', 'Copied');
        } catch {
            if (!disposed && button.isConnected !== false) status.textContent = t('无法自动复制，请手动选择文本复制。', 'Could not copy automatically. Select and copy the text manually.');
        } finally {
            busy = false; if (!disposed && button.isConnected !== false) button.disabled = false;
        }
    };
    return { element: root, dispose() { if (disposed) return; disposed = true; button.disabled = true; } };
}
