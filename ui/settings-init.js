import { renderExtensionTemplateAsync } from '../../../../extensions.js';
import { doNavbarIconClick } from '../../../../../script.js';
import { applyI18n } from './i18n.js';
import { initAllSections } from './sections/registry.js';

// Side-effect imports: each section module self-registers on load
import './sections/dashboard.js';
import './sections/modes.js';
import './sections/formula.js';
import './sections/configProfiles.js';
import './sections/director.js';
import './sections/continuity.js';
import './sections/worldinfo.js';
import './sections/worldBooks.js';
import './sections/ledger.js';
import './sections/forceSpeak.js';
import './sections/chatSummary.js';
import './sections/critique.js';
import './sections/summaryExport.js';
import './sections/critiqueExport.js';
import './sections/providerReference.js';
import './sections/templateTester.js';
import './sections/profile.js';
import './sections/profileExport.js';
import './sections/quickStart.js';
import './sections/exportImport.js';
import './sections/identity.js';
import './sections/npc.js';
import './sections/npcExport.js';
import './sections/memory.js';
import './sections/memoryExport.js';
import './sections/executionTrace.js';
import './sections/postSpeech.js';
import './sections/userProviders.js';
import './sections/customPrompts.js';
import './sections/scriptExecutors.js';
import './sections/customAgents.js';
import './sections/agents.js';
import './sections/gdAssistant.js';

export async function loadSettingsUI(deps) {
    const { settings, EXT_KEY, chat_metadata, saveSettings } = deps;

    // 幂等防护：多插件环境下若 ST 重渲染导致二次调用，避免重复注入破坏 DOM
    if ($('#gd-settings-panel').length) {
        console.warn('[GroupWorld] Settings UI already initialized, skipping');
        return;
    }

    const html = await renderExtensionTemplateAsync('third-party/SillyTavern-GroupWorld', 'settings');

    // Create a top-level settings drawer at the same level as Extensions,
    // then render the Group World settings inside it.
    const drawerId = 'gd-settings-button';
    const panelId = 'gd-settings-panel';
    const lang = settings.lang || 'zh';

    const drawerHtml = `
        <div id="${drawerId}" class="drawer">
            <div class="drawer-toggle">
                <div class="drawer-icon fa-solid fa-globe fa-fw closedIcon"
                     title="${lang === 'zh' ? 'Group World — 群聊导演' : 'Group World'}"></div>
            </div>
            <div id="${panelId}" class="drawer-content closedDrawer"></div>
        </div>`;

    // Insert before Persona Management in the left settings sidebar,
    // keeping the character card panel on the right untouched.
    const $anchor = $('#persona-management-button');
    if ($anchor.length) {
        $anchor.before(drawerHtml);
        // Wire up the toggle — ST uses direct binding, so we must bind the
        // new drawer-toggle to the exported doNavbarIconClick handler.
        $(`#${drawerId} .drawer-toggle`).on('click', doNavbarIconClick);
    } else {
        // Fallback: if the sidebar isn't loaded yet, append to extensions panel
        $('#extensions_settings').append(html);
        console.warn('[GroupWorld] Could not find extensions drawer for top-level tab — falling back to inline');
        const $c = (sel) => $(`#gd-${sel}`);
        $c('lang').val(settings.lang);
        applyI18n(settings.lang, EXT_KEY, chat_metadata);
        $c('lang').on('change', function () {
            settings.lang = $(this).val();
            applyI18n(settings.lang, EXT_KEY, chat_metadata);
            saveSettings();
        });
        const ctx = { ...deps, $c };
        initAllSections(ctx);
        return;
    }

    // Render into the top-level drawer
    $(`#${panelId}`).append(html);

    const $c = (sel) => $(`#gd-${sel}`);

    // Language
    $c('lang').val(settings.lang);
    applyI18n(settings.lang, EXT_KEY, chat_metadata);
    $c('lang').on('change', function () {
        settings.lang = $(this).val();
        applyI18n(settings.lang, EXT_KEY, chat_metadata);
        saveSettings();
        window.__gdRefreshDashboard?.();
    });

    // Delegate to registered sections
    const ctx = { ...deps, $c };
    initAllSections(ctx);
}

/**
 * Re-render the settings panel in-place after a config profile is applied.
 * empty() removes child elements AND their jQuery event handlers, so re-running
 * initAllSections on the fresh DOM is safe (no duplicate bindings).
 * Falls back to loadSettingsUI if the panel doesn't exist yet.
 */
export async function reloadSettingsUI(deps) {
    const { settings, EXT_KEY, chat_metadata, saveSettings } = deps;
    const $panel = $('#gd-settings-panel');
    if (!$panel.length) {
        // 主路径未走（fallback 模式下不存在 panel）。不委托 loadSettingsUI，否则会重复 append。
        return;
    }
    const html = await renderExtensionTemplateAsync('third-party/SillyTavern-GroupWorld', 'settings');
    $panel.empty().append(html);
    const $c = (sel) => $(`#gd-${sel}`);
    $c('lang').val(settings.lang);
    applyI18n(settings.lang, EXT_KEY, chat_metadata);
    $c('lang').on('change', function () {
        settings.lang = $(this).val();
        applyI18n(settings.lang, EXT_KEY, chat_metadata);
        saveSettings();
        window.__gdRefreshDashboard?.();
    });
    const ctx = { ...deps, $c };
    initAllSections(ctx);
}
