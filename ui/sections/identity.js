import { registerSection } from './registry.js';
import { DEFAULT_IDENTITY_PROMPT } from '../../assets/providers/identity.js';

registerSection('identity', function (ctx) {
    const { settings, $c, saveSettings } = ctx;

    $c('identity-prompt').val(settings.identityPrompt || DEFAULT_IDENTITY_PROMPT);
    $c('identity-prompt').on('input', function () {
        settings.identityPrompt = $(this).val();
        saveSettings();
    });
    $c('identity-reset').on('click', function () {
        settings.identityPrompt = '';
        $c('identity-prompt').val(DEFAULT_IDENTITY_PROMPT);
        saveSettings();
    });
});
