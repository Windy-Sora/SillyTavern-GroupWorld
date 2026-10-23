import { AREAS, FEATURES, normalizePreference, readPreference, writePreference, navigatePreference, routeForCard } from './navigation-model.js';
import { PRIMARY_AREAS, partitionFeatures } from './navigation-model.js';
import { mountProfilePage } from './profile-page.js';
import { mountFeatureViews } from './feature-views.js';
import { mountCompactDisclosures } from './compact-disclosures.js';
import { mountCommandBoard } from './command-board.js';
import { PRODUCT_IDENTITY } from '../utils/product-identity.js';

// Keep the preview implementation for future work, but do not expose it to users.
const PREVIEW_NAVIGATION_ENABLED = false;

// One live template, two presentations. Switching NEVER rebuilds editors or
// reinitializes sections, so drafts and existing task callbacks keep their nodes.
export function mountNavigation(root, { settings, storage, initialState, deps } = {}) {
    if (!root) return null;
    root.__gdNavigation?.dispose();
    const doc = root.ownerDocument;
    let state = initialState ? normalizePreference(initialState) : readPreference(storage);
    if (!PREVIEW_NAVIGATION_ENABLED) state.layout = 'classic';
    const t = (zh, en) => settings?.lang === 'en' ? en : zh;
    const label = item => t(item.zh, item.en);
    const owned = [];
    let profilePage;
    let compactDisclosures;
    let commandBoard;
    const debugLabel = root.querySelector('#gd-debug')?.closest('label');
    const debugTarget = root.querySelector('[data-card="debug"] .gd-card-body');
    let debugAnchor;
    function placeDebugControl(preview) {
        if (preview && debugLabel && debugTarget && !debugAnchor) {
            debugAnchor = doc.createComment('debug-control');
            debugLabel.before(debugAnchor);
            debugTarget.prepend(debugLabel);
        } else if (!preview && debugAnchor) {
            debugAnchor.replaceWith(debugLabel);
            debugAnchor = null;
        }
    }
    let boardScroll = 0;
    const featurePages = new Map();
    let returnRoute = null;
    function node(tag, className, parent) {
        const el = doc.createElement(tag);
        el.className = className;
        parent?.append(el);
        return el;
    }
    const bar = node('div', 'gd-ui-switchbar');
    bar.hidden = !PREVIEW_NAVIGATION_ENABLED;
    const brand = node('span', 'gd-ui-brand', bar);
    brand.textContent = PRODUCT_IDENTITY.displayName;
    const switchLabel = node('label', '', bar);
    switchLabel.hidden = !PREVIEW_NAVIGATION_ENABLED;
    const switchText = node('span', '', switchLabel);
    const layout = node('select', 'text_pole', switchLabel);
    const help = node('button', 'menu_button', bar);
    help.type = 'button';
    const nav = node('nav', 'gd-ui-nav');
    const rail = node('div', 'gd-ui-rail', nav);
    const extraAreas = node('details', 'gd-ui-more-areas', nav);
    const extraAreasLabel = node('summary', '', extraAreas);
    const extraAreaButtons = node('div', 'gd-ui-feature-buttons', extraAreas);
    const features = node('div', 'gd-ui-features', nav);
    const caption = node('div', 'gd-ui-caption');
    const breadcrumb = node('span', 'gd-ui-breadcrumb', caption);
    const title = node('h3', '', caption);
    title.tabIndex = -1;
    const note = node('p', '', caption);
    const back = node('button', 'menu_button gd-ui-return', caption);
    back.type = 'button';
    const dashboardToggle = node('button', 'menu_button gd-ui-dashboard-toggle', caption);
    dashboardToggle.type = 'button';
    let dashboardExpanded = false;
    const status = node('p', 'gd-ui-status', bar);
    status.setAttribute('role', 'status');
    root.prepend(bar, nav, caption);
    owned.push(bar, nav, caption);

    function options(select, entries, value) {
        select.replaceChildren();
        for (const [id, text] of entries) {
            const option = node('option', '', select);
            option.value = id; option.textContent = text;
        }
        select.value = value;
    }
    function featureOptions(areaId) {
        features.replaceChildren();
        features.hidden = areaId === 'overview';
        features.setAttribute('aria-label', t('选择功能', 'Choose a feature'));
        const { primary, more } = partitionFeatures(areaId);
        function buttons(items, parent) {
            for (const f of items) {
                const id = f.id;
                const button = node('button', 'gd-ui-feature-button', parent);
                button.type = 'button'; button.dataset.feature = id; button.textContent = label(f);
                if (id === state.last[areaId]) button.setAttribute('aria-current', 'page');
            }
        }
        buttons(primary, node('div', 'gd-ui-feature-buttons', features));
        if (more.length) {
            const disclosure = node('details', 'gd-ui-more-features', features);
            disclosure.open = more.some(f => f.id === state.last[areaId]);
            node('summary', '', disclosure).textContent = t(`更多功能（${more.length}）`, `More features (${more.length})`);
            buttons(more, node('div', 'gd-ui-feature-buttons', disclosure));
        }
    }
    function clearPresentation() {
        root.querySelectorAll('.gd-ui-target, .gd-ui-card, .gd-ui-branch, .gd-ui-visible').forEach(el => {
            el.classList.remove('gd-ui-target', 'gd-ui-card', 'gd-ui-branch', 'gd-ui-visible');
        });
    }
    function reveal(target) {
        const drawer = target.closest('.inline-drawer');
        if (drawer && root.contains(drawer)) {
            drawer.classList.add('gd-ui-target');
            const body = drawer.querySelector(':scope > .inline-drawer-content');
            // Card routes isolate an existing card without moving or cloning it.
            const card = target.closest('[data-card]');
            if (card && body) {
                card.classList.add('gd-ui-card');
                let branch = card;
                while (branch.parentElement && branch.parentElement !== body) branch = branch.parentElement;
                branch.classList.add('gd-ui-branch');
                drawer.classList.add('gd-ui-card');
            }
        } else {
            let top = target;
            while (top.parentElement && top.parentElement !== root) top = top.parentElement;
            top.classList.add('gd-ui-visible');
        }
    }
    function render() {
        clearPresentation();
        root.classList.toggle('gd-ui-preview', state.layout === 'preview');
        const dashboard = root.querySelector('.gd-dashboard');
        if (state.layout === 'classic' && dashboard) {
            if (dashboard.nextElementSibling !== bar) dashboard.after(bar);
        } else if (root.firstElementChild !== bar) root.prepend(bar);
        options(layout, [['classic', t('经典界面', 'Classic')], ['preview', t('新版 · 预览', 'New · Preview')]], state.layout);
        switchText.textContent = t('界面', 'Interface');
        help.textContent = t('帮助', 'Help');
        nav.setAttribute('aria-label', t('插件导航', 'Extension navigation'));
        featureOptions(state.area);
        rail.replaceChildren();
        extraAreaButtons.replaceChildren();
        extraAreasLabel.textContent = t('更多功能 · 自动化 / 高级', 'More · Automation / Advanced');
        extraAreas.open = !PRIMARY_AREAS.includes(state.area);
        const icons = { overview: 'fa-compass', director: 'fa-clapperboard', story: 'fa-book-open', automation: 'fa-bolt', resources: 'fa-sliders', advanced: 'fa-wrench' };
        for (const [id, zh, en] of AREAS) {
            const button = node('button', 'gd-ui-area-button', PRIMARY_AREAS.includes(id) ? rail : extraAreaButtons);
            button.type = 'button'; button.dataset.area = id;
            const icon = node('i', `fa-solid ${icons[id]}`, button);
            icon.setAttribute('aria-hidden', 'true');
            node('span', '', button).textContent = t(zh, en);
            if (id === state.area) button.setAttribute('aria-current', 'page');
        }
        const current = FEATURES.find(f => f.id === state.last[state.area]);
        commandBoard?.update(state.layout === 'preview');
        placeDebugControl(state.layout === 'preview');
        compactDisclosures?.update(state.layout === 'preview', current.selector);
        root.dataset.gdRoute = current.id;
        featurePages.forEach(page => page?.update(state.layout === 'preview'));
        profilePage?.update(state.layout === 'preview', current.id);
        back.hidden = !returnRoute;
        const returnFeature = FEATURES.find(f => f.id === returnRoute);
        back.textContent = returnFeature ? t(`返回${label(returnFeature)}`, `Return to ${label(returnFeature)}`) : '';
        const areaInfo = AREAS.find(([id]) => id === state.area);
        breadcrumb.textContent = t(areaInfo[1], areaInfo[2]);
        title.textContent = label(current);
        const descriptions = {
            overview: ['查看当前模式、最近选人结果和聊天数据。', 'See the current mode, latest speaker decision and chat data.'],
            director: ['调整谁来发言，以及导演如何安排这一轮对话。', 'Control who speaks and how the director guides the conversation.'],
            story: ['查看和维护角色资料与剧情状态。', 'Review and maintain character information and story state.'],
            automation: ['管理消息或轮次后的动作及自定义执行逻辑。', 'Manage after-message and after-round actions and custom execution.'],
            resources: ['管理模型连接、可复用配置和数据交换。', 'Manage model connections, reusable settings and data exchange.'],
            advanced: ['配置扩展数据源、调试模板，或获取使用帮助。', 'Configure data sources, inspect templates or get help.'],
        };
        note.textContent = t(...descriptions[state.area]);
        dashboardToggle.hidden = state.area !== 'overview' || !!commandBoard;
        dashboardToggle.textContent = dashboardExpanded
            ? t('收起批量与配置操作', 'Hide bulk and configuration actions')
            : t('批量与配置操作…', 'Bulk and configuration actions…');
        dashboardToggle.setAttribute('aria-expanded', String(dashboardExpanded));
        root.classList.toggle('gd-ui-dashboard-expanded', dashboardExpanded);
        const target = current.id === 'overview' && commandBoard ? commandBoard.element : root.querySelector(current.selector);
        note.classList.toggle('gd-ui-route-error', state.layout === 'preview' && !target);
        if (state.layout === 'preview' && target) reveal(target);
        if (state.layout === 'preview' && !target) note.textContent = t('此功能入口暂不可用，请切回经典界面。', 'This entry is unavailable. Please use Classic.');
    }
    function persist() {
        status.textContent = writePreference(storage, state) ? '' : t('浏览器未保存界面偏好，本次选择仍然有效。', 'Preference could not be saved; this session still uses your selection.');
    }
    function navigate(id, { focus = true, returnTo = null } = {}) {
        if (!FEATURES.some(f => f.id === id)) return false;
        returnRoute = returnTo;
        state = navigatePreference(state, id);
        render(); persist();
        if (focus && state.layout === 'preview') {
            title.scrollIntoView?.({ block: 'nearest' });
            title.focus({ preventScroll: true });
        }
        return true;
    }
    const onLayout = () => {
        if (!PREVIEW_NAVIGATION_ENABLED) return;
        const previous = state;
        try { state = { ...state, layout: layout.value === 'preview' ? 'preview' : 'classic' }; render(); persist(); }
        catch (error) {
            state = { ...previous, layout: 'classic' };
            profilePage?.update(false, state.last[state.area]);
            compactDisclosures?.update(false);
            commandBoard?.update(false);
            placeDebugControl(false);
            featurePages.forEach(page => page?.update(false));
            clearPresentation(); root.classList.remove('gd-ui-preview'); layout.value = 'classic';
            status.textContent = t('导航切换失败，已恢复经典界面。', 'Navigation failed; Classic restored.');
            console.error('[GroupDirector] Navigation presentation failed:', error);
        }
    };
    const onFeature = event => {
        const button = event.target.closest('button[data-feature]');
        if (button && features.contains(button)) navigate(button.dataset.feature);
    };
    const onRail = event => {
        const button = event.target.closest('button[data-area]');
        if (button && nav.contains(button)) navigate(state.last[button.dataset.area]);
    };
    const onHelp = () => {
        if (state.layout === 'preview') navigate('help');
        else root.querySelector('.gd-dashboard-assistant-row')?.scrollIntoView?.({ block: 'nearest' });
    };
    const onBack = () => {
        if (!returnRoute) return;
        const toBoard = returnRoute === 'overview';
        navigate(returnRoute, { focus: !toBoard });
        if (toBoard) { const scroller = root.closest('.drawer-content') || root.parentElement; scroller.scrollTop = boardScroll; title.focus({ preventScroll: true }); }
    };
    // Redirect data shortcuts only in preview. The classic handlers and live nodes remain intact.
    const shortcuts = {
        'gd-stat-profiles': 'profile', 'gd-stat-memories': 'memory', 'gd-stat-npcs': 'npc',
        'gd-stat-ledger': 'ledger', 'gd-stat-summary': 'summary', 'gd-stat-story-blueprint': 'storyBlueprint',
        'gd-stat-worldbooks': 'worldbooks', 'gd-dash-vars': 'variables',
    };
    const onShortcut = event => {
        if (state.layout !== 'preview') return;
        const el = event.target.closest('[id]');
        const match = el && Object.keys(shortcuts).find(id => el.id === id || el.closest(`#${id}`));
        if (!match) return;
        event.preventDefault(); event.stopImmediatePropagation(); navigate(shortcuts[match]);
    };
    layout.addEventListener('change', onLayout);
    features.addEventListener('click', onFeature);
    rail.addEventListener('click', onRail);
    extraAreaButtons.addEventListener('click', onRail);
    const onDashboardToggle = () => { dashboardExpanded = !dashboardExpanded; render(); };
    dashboardToggle.addEventListener('click', onDashboardToggle);
    help.addEventListener('click', onHelp);
    back.addEventListener('click', onBack);
    root.addEventListener('click', onShortcut, true);
    const language = root.querySelector('#gd-lang');
    const onLanguage = () => render();
    language?.addEventListener('change', onLanguage);
    const controller = {
        getState: () => normalizePreference(state),
        openCard(card) {
            if (state.layout !== 'preview') return false;
            const opened = navigate(routeForCard(card));
            if (opened && card === 'jsonSchema') featurePages.get('rules')?.showView('advanced');
            return opened;
        },
        dispose() {
            profilePage?.dispose();
            compactDisclosures?.dispose();
            commandBoard?.dispose();
            placeDebugControl(false);
            featurePages.forEach(page => page?.dispose());
            delete root.dataset.gdRoute;
            back.removeEventListener('click', onBack);
            layout.removeEventListener('change', onLayout); features.removeEventListener('click', onFeature);
            rail.removeEventListener('click', onRail);
            extraAreaButtons.removeEventListener('click', onRail);
            dashboardToggle.removeEventListener('click', onDashboardToggle);
            root.classList.remove('gd-ui-dashboard-expanded');
            help.removeEventListener('click', onHelp); root.removeEventListener('click', onShortcut, true);
            language?.removeEventListener('change', onLanguage);
            clearPresentation(); root.classList.remove('gd-ui-preview'); owned.forEach(el => el.remove());
            if (root.__gdNavigation === controller) delete root.__gdNavigation;
        },
    };
    root.__gdNavigation = controller;
    const ResizeObserverClass = doc.defaultView?.ResizeObserver;
    const observer = ResizeObserverClass ? new ResizeObserverClass(entries => {
        root.classList.toggle('gd-ui-wide', entries[0].contentRect.width >= 600);
    }) : null;
    observer?.observe(root);
    const dispose = controller.dispose;
    controller.dispose = () => {
        observer?.disconnect();
        root.classList.remove('gd-ui-wide');
        dispose();
    };
    try {
        profilePage = mountProfilePage(root, { settings, onConnection: () => navigate('agents', { returnTo: 'profile' }) });
        for (const [id, selector] of [['rules', '#gd-mode-formula'], ['memory', '#gd-memory-enabled'], ['summary', '#gd-summary-enabled']]) {
            const host = root.querySelector(selector)?.closest(id === 'rules' ? '.inline-drawer-content' : '.gd-card-body');
            featurePages.set(id, mountFeatureViews(host, { id, settings, onConnection: from => navigate('agents', { returnTo: from }) }));
        }
        compactDisclosures = mountCompactDisclosures(root, { settings });
        commandBoard = mountCommandBoard(root, { deps, navigate: id => {
            boardScroll = (root.closest('.drawer-content') || root.parentElement).scrollTop;
            navigate(id, { returnTo: 'overview' });
        } });
        render();
    } catch (error) { controller.dispose(); throw error; }
    return controller;
}
