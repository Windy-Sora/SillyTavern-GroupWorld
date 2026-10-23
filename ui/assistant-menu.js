/** A local, opaque action menu; never expands the settings layout. */
export function mountAssistantMenu({ button, lang, onOpen, onImport }) {
    const doc = button.ownerDocument;
    const menu = doc.createElement('div');
    menu.className = 'gd-assistant-menu'; menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.id = `${button.id}-menu`;
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-controls', menu.id);
    const en = lang === 'en';
    const items = [
        [en ? 'Open Muyu Agent (recommended)' : '打开暮羽 Agent（推荐）', en ? 'Independent chat with tools and configuration management' : '独立聊天窗口，支持资料读取与配置管理', onOpen],
        [en ? 'Import Muyu character card and world book' : '导入暮羽角色卡与世界书', en ? 'Use Muyu in a SillyTavern character chat' : '在酒馆角色聊天中使用暮羽', onImport],
    ].map(([label, hint, action]) => {
        const item = doc.createElement('button'); item.type = 'button'; item.className = 'gd-assistant-menu-item'; item.setAttribute('role', 'menuitem');
        const title = doc.createElement('span'); title.textContent = label;
        const detail = doc.createElement('small'); detail.textContent = hint;
        item.append(title, detail);
        item.onclick = () => { close(); button.focus(); void action(); };
        menu.append(item); return item;
    });
    doc.body.append(menu);
    const outside = event => { if (!menu.contains(event.target) && !button.contains(event.target)) close(); };
    const keydown = event => {
        if (event.key === 'Escape') { event.preventDefault(); close(); button.focus(); }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); const index = items.indexOf(doc.activeElement);
            items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
        } else if (event.key === 'Tab') close();
    };
    function close() {
        menu.hidden = true; button.setAttribute('aria-expanded', 'false');
        doc.removeEventListener('pointerdown', outside); doc.removeEventListener('keydown', keydown);
        doc.removeEventListener('scroll', close, true); doc.defaultView.removeEventListener('resize', close);
    }
    const toggle = () => {
        if (!menu.hidden) { close(); return; }
        menu.hidden = false; button.setAttribute('aria-expanded', 'true');
        const anchor = button.getBoundingClientRect(), rect = menu.getBoundingClientRect();
        const width = doc.defaultView.innerWidth, height = doc.defaultView.innerHeight;
        menu.style.left = `${Math.max(8, Math.min(anchor.left, width - rect.width - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(anchor.bottom + 6, height - rect.height - 8))}px`;
        doc.addEventListener('pointerdown', outside); doc.addEventListener('keydown', keydown);
        doc.addEventListener('scroll', close, true); doc.defaultView.addEventListener('resize', close);
        items[0].focus();
    };
    button.addEventListener('click', toggle); close();
    return () => { close(); button.removeEventListener('click', toggle); menu.remove(); };
}
