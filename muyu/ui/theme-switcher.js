import { DISPLAY_DEFAULTS } from '../preferences/contract.js';

/** Header shortcut for the existing display preference; no model or task state. */
export function createThemeSwitcher({ doc, parent, controller, act, lang }) {
    if (!parent) return { render() {}, dispose() {} };
    const en = lang === 'en', root = doc.createElement('div');
    root.className = 'gd-muyu-theme-switcher'; root.setAttribute('role', 'group');
    root.setAttribute('aria-label', en ? 'Muyu appearance' : '暮羽界面主题'); parent.append(root);
    let disposed = false, saving = false;
    const choices = [['host', '◐', '跟随酒馆', 'Follow Tavern'], ['dusk', '☾', '暮夜 · 深色', 'Dusk · Dark'], ['light', '☀', '晨光 · 浅色', 'Morning · Light']];
    const buttons = choices.map(([theme, icon, zh, english]) => {
        const button = doc.createElement('button'); button.type = 'button'; button.className = 'menu_button';
        button.textContent = icon; button.title = en ? english : zh;
        button.setAttribute('aria-label', button.title); button.setAttribute('data-theme', theme);
        root.append(button);
        button.onclick = () => {
            const state = controller.snapshot();
            if (disposed || saving || state.savingDisplayConfig || state.resetting || (state.displayConfig?.theme || 'host') === theme) return;
            return act(async () => {
                saving = true; render(controller.snapshot());
                try { await controller.saveDisplayConfig({ ...(state.displayConfig || DISPLAY_DEFAULTS), theme }); }
                catch { throw Error('DISPLAY_CONFIG_SAVE_FAILED'); }
                finally { saving = false; if (!disposed) render(controller.snapshot()); }
            });
        };
        return button;
    });
    function render(state) {
        if (disposed) return;
        root.setAttribute('aria-busy', String(saving || !!state.savingDisplayConfig));
        for (const button of buttons) {
            button.setAttribute('aria-pressed', String(button.getAttribute('data-theme') === (state.displayConfig?.theme || 'host')));
            button.disabled = saving || !!state.savingDisplayConfig || !!state.resetting;
        }
    }
    return { render, dispose() { disposed = true; root.remove(); } };
}
