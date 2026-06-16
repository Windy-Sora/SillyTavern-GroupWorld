import { renderExtensionTemplateAsync } from '../../../../extensions.js';
import { applyI18n } from './i18n.js';
import { initAllSections } from './sections/registry.js';

// Side-effect imports: each section module self-registers on load
import './sections/modes.js';
import './sections/formula.js';
import './sections/director.js';
import './sections/continuity.js';
import './sections/worldinfo.js';
import './sections/worldBooks.js';
import './sections/ledger.js';
import './sections/forceSpeak.js';
import './sections/templateTester.js';
import './sections/profile.js';

export async function loadSettingsUI(deps) {
    const { settings, EXT_KEY, chat_metadata, saveSettings } = deps;

    const html = await renderExtensionTemplateAsync('third-party/SillyTavern-GroupDirector', 'settings');
    $('#extensions_settings').append(html);

    const $c = (sel) => $(`#gd-${sel}`);

    // Language
    $c('lang').val(settings.lang);
    applyI18n(settings.lang, EXT_KEY, chat_metadata);
    $c('lang').on('change', function () {
        settings.lang = $(this).val();
        applyI18n(settings.lang, EXT_KEY, chat_metadata);
        saveSettings();
    });

    // Delegate to registered sections
    const ctx = { ...deps, $c };
    initAllSections(ctx);
}