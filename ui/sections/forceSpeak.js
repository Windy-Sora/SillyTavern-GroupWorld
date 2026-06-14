import { registerSection } from './registry.js';

registerSection('forceSpeak', function (ctx) {
    const { settings, $c, saveSettings } = ctx;

    $(`input[name="gd-force-speak-mode"][value="${settings.forceSpeakMode || 'native'}"]`).prop('checked', true);
    $('#gd-force-speak-llm-section').toggle(settings.forceSpeakMode === 'llm');

    $('input[name="gd-force-speak-mode"]').on('change', function () {
        settings.forceSpeakMode = $(this).val();
        $('#gd-force-speak-llm-section').toggle(settings.forceSpeakMode === 'llm');
        saveSettings();
    });

    $c('force-speak-prompt').val(settings.forceSpeakPrompt || '');
    $c('force-speak-prompt').on('input', () => {
        settings.forceSpeakPrompt = $c('force-speak-prompt').val();
        saveSettings();
    });
});
