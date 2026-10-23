import { SETTINGS_PAGES } from './navigation-metadata.js';
/** Stable settings pages: navigation never remounts editors or starts work. */
export function createSettingsLayout({ doc, root, lang }) {
    const en = lang === 'en';
    const nav = doc.createElement('nav'); nav.className = 'gd-muyu-settings-nav';
    nav.setAttribute('aria-label', en ? 'Settings categories' : '配置分类'); root.append(nav);
    const content = doc.createElement('div'); content.className = 'gd-muyu-settings-content'; root.append(content);
    const pages = {}, buttons = {}, positions = new Map();
    let selected = 'connection', visible = false;
    for (const [id, zh, english, descriptionZh, descriptionEn] of SETTINGS_PAGES) {
        const button = doc.createElement('button'); button.type = 'button'; button.className = 'menu_button'; button.textContent = en ? english : zh;
        nav.append(button); buttons[id] = button;
        const page = doc.createElement('section'); page.className = 'gd-muyu-settings-page'; page.setAttribute('aria-label', button.textContent);
        const heading = doc.createElement('h3'); heading.className = 'gd-muyu-settings-page-title'; heading.textContent = button.textContent; page.append(heading);
        const hint = doc.createElement('p'); hint.className = 'gd-muyu-settings-hint'; hint.textContent = en ? descriptionEn : descriptionZh; page.append(hint);
        content.append(page); pages[id] = page; button.onclick = () => select(id);
        page.onscroll = () => { if (visible && selected === id) positions.set(id, page.scrollTop || 0); };
    }
    function capture() { if (visible && pages[selected]) positions.set(selected, pages[selected].scrollTop || 0); }
    function restore() { if (visible) pages[selected].scrollTop = positions.get(selected) || 0; }
    function select(id, { target } = {}) {
        if (!pages[id]) return;
        capture(); selected = id;
        for (const key of Object.keys(pages)) {
            pages[key].hidden = key !== id;
            buttons[key].setAttribute('aria-current', key === id ? 'page' : 'false');
        }
        restore();
        if (visible && target) {
            let owner = target, belongs = false;
            while (owner) { if (owner === pages[id]) { belongs = true; break; } owner = owner.parentElement || owner.parent; }
            if (!belongs) return;
            for (owner = target; owner && owner !== pages[id]; owner = owner.parentElement || owner.parent) {
                if ((owner.tagName || owner.tag || '').toLowerCase() === 'details') owner.open = true;
            }
            target.focus?.({ preventScroll: true });
            target.scrollIntoView?.({ block: 'nearest' });
            positions.set(id, pages[id].scrollTop || 0);
        }
    }
    select('connection');
    return { pages, select, setVisible(value) { if (!value) capture(); visible = !!value; if (visible) restore(); } };
}
