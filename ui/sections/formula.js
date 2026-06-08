import { registerSection } from './registry.js';

registerSection('formula', function (ctx) {
    const { settings, saveSettings } = ctx;
    const $c = ctx.$c;
    const n = (sel, setter, min, def) => $(sel).on('input', function () {
        const raw = parseInt($(this).val(), 10);
        setter(isNaN(raw) ? def : Math.max(min, raw));
        saveSettings();
    });
    const c = (sel, setter) => $(sel).on('input', function () { setter(!!$(this).prop('checked')); saveSettings(); });

    $c('topn').val(settings.topN);
    $c('recent-count').val(settings.recentMessageCount);
    $c('consecutive-penalty').val(settings.consecutivePenalty);
    $c('trigger-enabled').prop('checked', settings.triggerEnabled);
    $c('trigger-score').val(settings.triggerScore);
    $c('initiative-enabled').prop('checked', settings.initiativeEnabled);
    $c('initiative-base').val(settings.initiativeBaseScore);
    $c('mention-weight').val(settings.scoreWeights.mention);
    $c('keyword-weight').val(settings.scoreWeights.keyword);
    $c('recency-weight').val(settings.scoreWeights.recency);
    $c('talkativeness-weight').val(settings.scoreWeights.talkativeness);

    n('#gd-topn', v => settings.topN = v, 1, 1);
    n('#gd-recent-count', v => settings.recentMessageCount = v, 1, 10);
    n('#gd-consecutive-penalty', v => settings.consecutivePenalty = v, 0, 15);
    c('#gd-trigger-enabled', v => settings.triggerEnabled = v);
    n('#gd-trigger-score', v => settings.triggerScore = v, 0, 40);
    c('#gd-initiative-enabled', v => settings.initiativeEnabled = v);
    n('#gd-initiative-base', v => settings.initiativeBaseScore = v, 0, 5);
    n('#gd-mention-weight', v => settings.scoreWeights.mention = v, 0, 30);
    n('#gd-keyword-weight', v => settings.scoreWeights.keyword = v, 0, 15);
    n('#gd-recency-weight', v => settings.scoreWeights.recency = v, 0, 20);
    n('#gd-talkativeness-weight', v => settings.scoreWeights.talkativeness = v, 1, 10);
});