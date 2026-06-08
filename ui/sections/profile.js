import { registerSection } from './registry.js';

registerSection('profile', function (ctx) {
    const { settings, $c, saveSettings, getCurrentGroup, generateProfilesBatch, getProfiles,
        getDefaultProfileGeneratorPrompt, getDefaultProfileSchema, getDefaultProfileRenderTemplate,
        refreshProfileManagementUI, checkProfileStartupStatus, buildProfileLoaderPanel,
        detectCharacterChanges, validateAndWarnProfilePlaceholders } = ctx;

    $c('profile-enabled').prop('checked', settings.profileEnabled);
    $c('profile-token-budget').val(settings.profileTokenBudget);
    $c('profile-concurrency').val(settings.profileConcurrency);
    $c('profile-generator-prompt').val(settings.profileGeneratorPrompt || getDefaultProfileGeneratorPrompt());
    $c('profile-json-schema').val(settings.profileJsonSchema || getDefaultProfileSchema());
    $c('profile-render-template').val(settings.profileRenderTemplate || getDefaultProfileRenderTemplate());
    $('#gd-profile-section').toggle(settings.profileEnabled);

    $c('profile-enabled').on('input', () => {
        settings.profileEnabled = !!$c('profile-enabled').prop('checked');
        $('#gd-profile-section').toggle(settings.profileEnabled);
        if (settings.profileEnabled) { refreshProfileManagementUI(); checkProfileStartupStatus(); }
        saveSettings();
    });

    $c('profile-token-budget').on('input', () => { settings.profileTokenBudget = Math.max(1, parseInt($c('profile-token-budget').val()) || 2000); saveSettings(); });
    $c('profile-concurrency').on('input', () => { settings.profileConcurrency = Math.max(0, parseInt($c('profile-concurrency').val()) || 0); saveSettings(); });
    $c('profile-generator-prompt').on('input', () => { settings.profileGeneratorPrompt = $c('profile-generator-prompt').val(); saveSettings(); });
    $c('profile-json-schema').on('input', () => { settings.profileJsonSchema = $c('profile-json-schema').val(); saveSettings(); });
    $c('profile-render-template').on('input', () => { settings.profileRenderTemplate = $c('profile-render-template').val(); validateAndWarnProfilePlaceholders('render'); saveSettings(); });

    $c('profile-generator-reset').on('click', () => {
        const def = getDefaultProfileGeneratorPrompt();
        $c('profile-generator-prompt').val(def); settings.profileGeneratorPrompt = ''; saveSettings();
    });
    $c('profile-schema-reset').on('click', () => {
        const def = getDefaultProfileSchema();
        $c('profile-json-schema').val(def); settings.profileJsonSchema = ''; saveSettings();
    });
    $c('profile-render-reset').on('click', () => {
        const def = getDefaultProfileRenderTemplate();
        $c('profile-render-template').val(def); settings.profileRenderTemplate = ''; saveSettings();
    });

    const checkGroup = () => { const g = getCurrentGroup(); if (!g) { toastr.warning(settings.lang === 'zh' ? '请先在群聊中打开此设置面板' : 'Please open this settings panel from within a group chat'); return null; } return g; };

    $c('profile-scan-save').on('click', () => { const g = checkGroup(); if (g) { buildProfileLoaderPanel(); toastr.info(settings.lang === 'zh' ? '已扫描存档' : 'Save scanned'); } });
    $c('profile-detect-changes').on('click', () => { const g = checkGroup(); if (g) detectCharacterChanges(); });

    $c('profile-regenerate-all').on('click', async () => {
        const g = checkGroup(); if (!g) return;
        const members = g.members.filter(a => !g.disabled_members?.includes(a));
        if (!members.length) { toastr.warning(settings.lang === 'zh' ? '当前群聊没有可用角色' : 'No enabled members in current group'); return; }
        const btn = $('#gd-profile-regenerate-all'); btn.prop('disabled', true);
        const lang = settings.lang || 'zh';
        toastr.info(lang === 'zh' ? `正在后台为 ${members.length} 个角色生成档案...` : `Generating profiles for ${members.length} characters in background...`);
        generateProfilesBatch(members).then(() => {
            const profiles = getProfiles();
            const ready = Object.values(profiles).filter(p => p.state === 'ready').length;
            const failed = Object.values(profiles).filter(p => p.state === 'failed').length;
            btn.prop('disabled', false); refreshProfileManagementUI();
            if (failed > 0) toastr.warning(lang === 'zh' ? `${ready} 个就绪, ${failed} 个失败 — 查看控制台了解详情` : `${ready} ready, ${failed} failed — check console for details`);
            else toastr.success(lang === 'zh' ? `${ready} 个角色档案已更新` : `${ready} character profiles updated`);
        }).catch(e => { btn.prop('disabled', false); toastr.error(lang === 'zh' ? '生成失败，请查看控制台' : 'Generation failed, check console'); console.error('[GroupDirector] Batch profile generation failed:', e); });
    });

    refreshProfileManagementUI();
    checkProfileStartupStatus();
});