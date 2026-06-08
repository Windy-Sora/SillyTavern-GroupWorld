import { registerSection } from './registry.js';

registerSection('worldInfo', function ({ settings, $c, saveSettings }) {
    $c('llm-world-info-enabled').prop('checked', settings.llmWorldInfoEnabled);
    $c('llm-world-info-wrapper').val(settings.llmWorldInfoWrapper);
    $c('llm-world-info-enabled').on('input', () => { settings.llmWorldInfoEnabled = !!$c('llm-world-info-enabled').prop('checked'); saveSettings(); });
    $c('llm-world-info-wrapper').on('input', () => { settings.llmWorldInfoWrapper = $c('llm-world-info-wrapper').val(); saveSettings(); });
});