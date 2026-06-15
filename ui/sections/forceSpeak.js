import { registerSection } from './registry.js';

function getDefaultFsPrompt(lang) {
    return lang === 'zh'
        ? '【系统指令】用户已强制触发 {charName} 发言。请只选择 {charName} 一人作为本轮发言者。忽略其他角色。为 {charName} 生成一段简短的舞台指导。'
        : '[SYSTEM] Force-speak: {charName} has been manually triggered. You MUST select ONLY {charName}. Do NOT select any other characters. Write a short stage direction for {charName}.';
}

registerSection('forceSpeak', function (ctx) {
    const { settings, $c, saveSettings, toastr } = ctx;

    $(`input[name="gd-force-speak-mode"][value="${settings.forceSpeakMode || 'native'}"]`).prop('checked', true);
    $('#gd-force-speak-llm-section').toggle(settings.forceSpeakMode === 'llm');

    $('input[name="gd-force-speak-mode"]').on('change', function () {
        settings.forceSpeakMode = $(this).val();
        $('#gd-force-speak-llm-section').toggle(settings.forceSpeakMode === 'llm');
        saveSettings();
    });

    // Show custom value if set, otherwise display the built-in default
    const defaultPrompt = getDefaultFsPrompt(settings.lang);
    $c('force-speak-prompt').val(settings.forceSpeakPrompt || defaultPrompt);
    $c('force-speak-prompt').on('input', () => {
        settings.forceSpeakPrompt = $c('force-speak-prompt').val();
        saveSettings();
    });
    $c('force-speak-prompt-reset').on('click', () => {
        $c('force-speak-prompt').val(defaultPrompt);
        settings.forceSpeakPrompt = '';
        saveSettings();
        toastr.info(settings.lang === 'zh' ? '已恢复默认强制发言 Prompt' : 'Force-speak prompt reset to default');
    });
});
