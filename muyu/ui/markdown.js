import { createCopyControl } from './copy-control.js';

const lifetimes = new WeakMap();
/** Bounded Markdown subset rendered exclusively with DOM/textContent. Never parses HTML. */
export function renderMarkdown(root, source, { lang } = {}) {
    const doc = root.ownerDocument;
    lifetimes.get(root)?.();
    const controls = []; let disposed = false;
    const dispose = () => { if (disposed) return; disposed = true; controls.forEach(control => control.dispose()); if (lifetimes.get(root) === dispose) lifetimes.delete(root); };
    lifetimes.set(root, dispose);
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text, parent) => { const el = doc.createElement(tag); if (text) el.textContent = text; parent.append(el); return el; };
    function inline(parent, text, depth = 0) {
        if (depth > 3) { node('span', text, parent); return; }
        const tokens = /!\[[^\]\n]*\]\([^\)\n]*\)|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|\[[^\]\n]+\]\([^\s\)]+\)/g;
        let start = 0;
        for (const m of text.matchAll(tokens)) {
            if (m.index > start) node('span', text.slice(start, m.index), parent);
            const token = m[0];
            if (token.startsWith('!')) node('span', token, parent);
            else if (token.startsWith('`')) node('code', token.slice(1, -1), parent);
            else if (token.startsWith('**') || token.startsWith('__')) inline(node('strong', '', parent), token.slice(2, -2), depth + 1);
            else if (token.startsWith('*')) inline(node('em', '', parent), token.slice(1, -1), depth + 1);
            else {
                const parts = /^\[([^\]]+)\]\((.+)\)$/.exec(token); let url;
                try { url = new URL(parts[2]); } catch { /* Relative and malformed URLs remain text. */ }
                if (url && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) {
                    const a = node('a', parts[1], parent); a.setAttribute('href', url.href); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); a.setAttribute('referrerpolicy', 'no-referrer');
                } else node('span', token, parent);
            }
            start = m.index + token.length;
        }
        if (start < text.length) node('span', text.slice(start), parent);
    }
    root.replaceChildren();
    const raw = String(source ?? ''), lines = raw.slice(0, 32768).replace(/\r\n?/g, '\n').split('\n');
    const limit = Math.min(lines.length, 2000); let paragraph = [], list = null, listType = '';
    const flush = () => { if (paragraph.length) { inline(node('p', '', root), paragraph.join('\n')); paragraph = []; } list = null; };
    const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim());
    const tableRule = line => line.includes('|') && cells(line).every(s => /^:?-{3,}:?$/.test(s));
    for (let i = 0; i < limit; i++) {
        const line = lines[i];
        const fence = /^\s*(`{3,}|~{3,})([^`]*)$/.exec(line);
        if (fence) {
            flush(); const code = [], marker = fence[1][0], length = fence[1].length;
            while (++i < limit) { if (new RegExp('^\\s*' + marker + '{' + length + ',}\\s*$').test(lines[i])) break; code.push(lines[i]); }
            const block = node('div', '', root); block.className = 'gd-muyu-code-block';
            controls.push(createCopyControl({ doc, parent: block, text: code.join('\n'), lang, label: t('复制所示代码', 'Copy displayed code') }));
            const pre = node('pre', '', block); pre.setAttribute('tabindex', '0'); pre.setAttribute('role', 'region'); pre.setAttribute('aria-label', t('代码，可横向滚动', 'Code; horizontally scrollable'));
            node('code', code.join('\n'), pre); continue;
        }
        if (!line.trim()) { flush(); continue; }
        if (i + 1 < limit && line.includes('|') && tableRule(lines[i + 1])) {
            flush(); const wrapper = node('div', '', root); wrapper.className = 'gd-muyu-table-scroll'; wrapper.setAttribute('tabindex', '0'); wrapper.setAttribute('role', 'region'); wrapper.setAttribute('aria-label', t('表格，可横向滚动', 'Table; horizontally scrollable'));
            const table = node('table', '', wrapper), head = node('tr', '', node('thead', '', table));
            cells(line).forEach(c => inline(node('th', '', head), c)); i++;
            const body = node('tbody', '', table);
            while (i + 1 < limit && lines[i + 1].includes('|') && lines[i + 1].trim()) { const row = node('tr', '', body); cells(lines[++i]).forEach(c => inline(node('td', '', row), c)); }
            continue;
        }
        const heading = /^(#{1,6})\s+(.+)$/.exec(line), item = /^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/.exec(line);
        if (heading) { flush(); inline(node('h' + heading[1].length, '', root), heading[2]); }
        else if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) { flush(); node('hr', '', root); }
        else if (/^\s*>\s?/.test(line)) { flush(); inline(node('blockquote', '', root), line.replace(/^\s*>\s?/, '')); }
        else if (item) {
            const type = item[1] ? 'ul' : 'ol';
            if (!list || listType !== type) {
                flush(); list = node(type, '', root); listType = type;
                // Loose numbered sections may be separated by ordinary paragraphs.
                // Preserve the source number instead of restarting every section at 1.
                if (type === 'ol') list.setAttribute('start', item[2]);
            }
            inline(node('li', '', list), item[3]);
        } else { list = null; paragraph.push(line); }
    }
    flush();
    if (raw.length > 32768 || lines.length > 2000) node('small', lang === 'en' ? 'Display truncated' : lang === 'zh' ? '显示已截断' : '显示已截断 / Display truncated', root);
    return dispose;
}
