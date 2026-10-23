import { applyI18n } from './i18n.js';

// Refresh labels only: never reload the panel or restore saved editor contents.
export function syncGeneralSettingsView(ctx, fields, translate = applyI18n) {
    if (fields.includes('debugLogging')) ctx.$c('debug').prop('checked', ctx.settings.debugLogging);
    if (!fields.includes('lang')) return;
    ctx.$c('lang').val(ctx.settings.lang);
    // Omitting chat metadata avoids overwriting the editable history-script draft.
    translate(ctx.settings.lang);
    ctx.muyuOwner?.refreshView?.({ preserveActive: true });
}
