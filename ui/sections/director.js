import { registerSection } from './registry.js';
import { toggleCharDescLength } from '../i18n.js';
import { DEFAULT_SETTINGS } from '../../settings.js';

registerSection('director', function (ctx) {
    const { settings, $c, saveSettings, EXT_KEY, chat_metadata, saveChatConditional, getDefaultLlmPrompt } = ctx;

    $c('llm-prompt').val(settings.llmPrompt || getDefaultLlmPrompt());
    $c('llm-max-speakers').val(settings.llmMaxSpeakers);
    $c('llm-context-depth').val(settings.llmContextDepth);

    $(`input[name="gd-llm-char-desc-mode"][value="${settings.llmCharDescMode}"]`).prop('checked', true);
    $c('llm-char-desc-length').val(settings.llmCharDescLength);
    $c('llm-script-enabled').prop('checked', settings.llmScriptEnabled);
    $c('llm-script-position').val(String(settings.llmScriptPosition ?? DEFAULT_SETTINGS.llmScriptPosition));
    $c('llm-script-prompt').val(settings.llmScriptPrompt);
    $c('llm-script-wrapper').val(settings.llmScriptWrapper);

    toggleCharDescLength(settings.llmCharDescMode);

    $c('llm-prompt').on('input', () => { settings.llmPrompt = $c('llm-prompt').val(); saveSettings(); });
    $c('llm-max-speakers').on('input', () => { settings.llmMaxSpeakers = Math.max(1, parseInt($c('llm-max-speakers').val()) || 3); saveSettings(); });
    $c('llm-context-depth').on('input', () => { settings.llmContextDepth = Math.max(1, parseInt($c('llm-context-depth').val()) || 10); saveSettings(); });

    $('input[name="gd-llm-char-desc-mode"]').on('change', function () {
        settings.llmCharDescMode = $(this).val();
        toggleCharDescLength(settings.llmCharDescMode);
        saveSettings();
    });
    $c('llm-char-desc-length').on('input', () => { settings.llmCharDescLength = Math.max(1, parseInt($c('llm-char-desc-length').val()) || 200); saveSettings(); });
    $c('llm-script-enabled').on('input', () => { settings.llmScriptEnabled = !!$c('llm-script-enabled').prop('checked'); saveSettings(); });
    $c('llm-script-position').on('change', () => {
        settings.llmScriptPosition = Number($c('llm-script-position').val()) === 1 ? 1 : 0;
        saveSettings();
    });
    $c('llm-script-prompt').on('input', () => {
        settings.llmScriptPrompt = $c('llm-script-prompt').val();
        const val = $c('llm-script-prompt').val();
        if (val) { $('#gd-history-meta-script').text(val); $('#gd-history-meta-display').show(); }
        saveSettings();
    });
    $c('llm-script-wrapper').on('input', () => { settings.llmScriptWrapper = $c('llm-script-wrapper').val(); saveSettings(); });
    $c('llm-script-wrapper-reset').on('click', () => {
        settings.llmScriptWrapper = DEFAULT_SETTINGS.llmScriptWrapper;
        $c('llm-script-wrapper').val(DEFAULT_SETTINGS.llmScriptWrapper);
        saveSettings();
    });

    // JSON Schema
    $c('llm-json-schema').val(settings.llmJsonSchema || DEFAULT_SETTINGS.llmJsonSchema);
    $c('llm-json-schema').on('input', () => { settings.llmJsonSchema = $c('llm-json-schema').val(); saveSettings(); });
    $c('llm-json-schema-reset').on('click', () => {
        settings.llmJsonSchema = DEFAULT_SETTINGS.llmJsonSchema;
        $c('llm-json-schema').val(DEFAULT_SETTINGS.llmJsonSchema);
        saveSettings();
    });

    $c('llm-history-enabled').prop('checked', settings.llmHistoryEnabled);
    $c('llm-history-enabled').on('input', () => { settings.llmHistoryEnabled = !!$c('llm-history-enabled').prop('checked'); saveSettings(); });

    const persistedScript = chat_metadata?.[EXT_KEY]?.historyMeta?.scriptPrompt;
    if (persistedScript) { $('#gd-history-meta-script').text(persistedScript); $('#gd-history-meta-display').show(); }

    $c('llm-history-clear').on('click', () => {
        if (chat_metadata[EXT_KEY]) {
            chat_metadata[EXT_KEY].directorHistory = [];
            if (chat_metadata[EXT_KEY].historyMeta) chat_metadata[EXT_KEY].historyMeta.scriptPrompt = '';
        }
        $('#gd-history-meta-display').hide();
        saveChatConditional();
        toastr.info('导演账本已清空');
    });

    $c('llm-prompt-reset').on('click', () => {
        const def = getDefaultLlmPrompt();
        $c('llm-prompt').val(def);
        settings.llmPrompt = def;
        saveSettings();
    });

    // Template recursive rendering
    $c('template-recursive').prop('checked', settings.templateRecursive !== false);
    $c('template-max-passes').val(settings.templateMaxPasses ?? 5);
    $c('template-recursive').on('input', () => {
        settings.templateRecursive = !!$c('template-recursive').prop('checked');
        saveSettings();
    });
    $c('template-max-passes').on('input', () => {
        settings.templateMaxPasses = Math.max(1, parseInt($c('template-max-passes').val()) || 5);
        saveSettings();
    });
    $c('template-debug-placeholders').prop('checked', !!settings.templateDebugPlaceholders);
    $c('template-debug-placeholders').on('input', () => {
        settings.templateDebugPlaceholders = !!$c('template-debug-placeholders').prop('checked');
        saveSettings();
    });

    // Provider render timeout (wires to settings.providerTimeoutMs → setProviderTimeoutDefault)
    $c('provider-timeout').val(settings.providerTimeoutMs ?? 10000);
    $c('provider-timeout').on('input', () => {
        settings.providerTimeoutMs = Math.max(0, parseInt($c('provider-timeout').val()) || 0);
        saveSettings();
    });

    // Knowledge textarea
    $c('knowledge-text').val(settings.knowledgeText || '');
    $c('knowledge-text').on('input', () => {
        settings.knowledgeText = $c('knowledge-text').val();
        saveSettings();
    });
});
