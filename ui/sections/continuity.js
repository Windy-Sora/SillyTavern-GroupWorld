import { registerSection } from './registry.js';
import { toggleContinuityMode } from '../i18n.js';

registerSection('continuity', function ({ settings, $c, saveSettings }) {
    $c('llm-script-continuity').prop('checked', settings.llmScriptContinuity);
    $c('llm-script-continuity-wrapper').val(settings.llmScriptContinuityWrapper);
    $(`input[name="gd-llm-script-continuity-mode"][value="${settings.llmScriptContinuityMode}"]`).prop('checked', true);
    $c('llm-script-continuity-count').val(settings.llmScriptContinuityCount);
    $c('llm-script-continuity-history-wrapper').val(settings.llmScriptContinuityHistoryWrapper);
    toggleContinuityMode(settings.llmScriptContinuityMode);

    $c('llm-script-continuity').on('input', () => { settings.llmScriptContinuity = !!$c('llm-script-continuity').prop('checked'); saveSettings(); });
    $c('llm-script-continuity-wrapper').on('input', () => { settings.llmScriptContinuityWrapper = $c('llm-script-continuity-wrapper').val(); saveSettings(); });
    $('input[name="gd-llm-script-continuity-mode"]').on('change', function () {
        settings.llmScriptContinuityMode = $(this).val();
        toggleContinuityMode(settings.llmScriptContinuityMode);
        saveSettings();
    });
    $c('llm-script-continuity-count').on('input', () => { settings.llmScriptContinuityCount = Math.max(0, parseInt($c('llm-script-continuity-count').val()) || 0); saveSettings(); });
    $c('llm-script-continuity-history-wrapper').on('input', () => { settings.llmScriptContinuityHistoryWrapper = $c('llm-script-continuity-history-wrapper').val(); saveSettings(); });
});