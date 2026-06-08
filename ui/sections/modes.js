import { registerSection } from './registry.js';
import { applyModeVisibility } from '../i18n.js';

registerSection('modes', function ({ settings, $c, saveSettings }) {
    $(`input[name="gd-mode"][value="${settings.mode}"]`).prop('checked', true);
    applyModeVisibility(settings.mode);

    $c('debug').prop('checked', settings.debugLogging);
    $c('debug').on('input', () => {
        settings.debugLogging = !!$c('debug').prop('checked');
        saveSettings();
    });

    $('input[name="gd-mode"]').on('change', function () {
        settings.mode = $(this).val();
        applyModeVisibility(settings.mode);
        saveSettings();
    });
});