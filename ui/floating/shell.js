import { visibleViewport, isMobileViewport, validBallPosition, dockedBallRect, mobilePanelRect } from './geometry.js';
import { floatingPresentation } from './registry.js';
import { createSurfaceTransitions } from './transitions.js';

/** Keep draggable surfaces within the visible viewport, including after orientation changes. */
export function fitFloatingRect(rect, viewport) {
    const width = Math.min(Math.max(rect.width, 48), Math.max(48, viewport.width - 16));
    const height = Math.min(Math.max(rect.height, 48), Math.max(48, viewport.height - 16));
    const x = viewport.x || 0, y = viewport.y || 0;
    return { width, height, x: x + Math.max(8, Math.min(rect.x - x, viewport.width - width - 8)), y: y + Math.max(8, Math.min(rect.y - y, viewport.height - height - 8)) };
}

/** Reserve a left rail without shrinking the conversation; small viewports use a separate page. */
export function fitSidebarRect(rect, viewport, opened) {
    const base = fitFloatingRect(rect, viewport);
    const extra = opened && base.width >= 460 && base.width + 240 <= viewport.width - 16 ? 240 : 0;
    return { rect: fitFloatingRect({ ...base, x: base.x - extra, width: base.width + extra }, viewport), extra };
}

/** Generic single-window shell. Closing a view never stops its module's business work. */
export function createFloatingShell({ registry, doc = document, win = window, lang = 'zh', getBallPosition = () => null, saveBallPosition = () => {} }) {
    let language = lang, activeId = null, teardown = null, disposed = false, returnFocus = null, sidebarOpen = false, mountVersion = 0;
    let ballVisible = true, mobileExpanded = false, viewExpanded = false, keyboardOpen = false;
    let viewportWidth = win.innerWidth, unobscuredHeight = Math.max(win.innerHeight, win.visualViewport?.height || 0);
    let previousDisplay = null, pendingCompletion = false;
    const completionVersions = new Map();
    const t = (zh, en) => language === 'en' ? en : zh;
    const node = (tag, parent, cls) => { const e = doc.createElement(tag); if (cls) e.className = cls; parent.append(e); return e; };
    const root = node('div', doc.body, 'gd-floating-root');
    const button = (parent, cls) => { const e = node('button', parent, cls); e.type = 'button'; return e; };
    const ball = button(root, 'gd-floating-ball');
    const ballMark = node('img', ball, 'gd-floating-feather');
    ballMark.src = new URL('../../assets/muyu-floating-feather.svg', import.meta.url).href;
    ballMark.alt = ''; ballMark.draggable = false;
    ballMark.setAttribute('aria-hidden', 'true');
    for (const cls of ['gd-floating-orbit', 'gd-floating-orbit-secondary', 'gd-floating-sparkles']) node('span', ball, cls).setAttribute('aria-hidden', 'true');
    ball.onanimationend = event => { if (event.animationName === 'gd-orb-complete') ball.dataset.completing = 'false'; };
    const menu = node('div', root, 'gd-floating-menu'); menu.hidden = true;
    const frame = node('section', root, 'gd-floating-window'); frame.hidden = true; frame.tabIndex = -1;
    frame.setAttribute('role', 'dialog'); frame.setAttribute('aria-modal', 'false');
    const header = node('header', frame, 'gd-floating-header');
    const avatar = node('img', header, 'gd-floating-avatar'); avatar.src = ballMark.src; avatar.alt = ''; avatar.draggable = false; avatar.setAttribute('aria-hidden', 'true');
    const title = node('strong', header), actions = node('div', header, 'gd-floating-header-actions'), expandButton = button(header, 'gd-floating-expand'), closeButton = button(header);
    const content = node('div', frame, 'gd-floating-content');
    const transitions = createSurfaceTransitions({ root, frame, content, ball, doc, win });
    const viewport = () => {
        const css = win.getComputedStyle?.(root);
        return visibleViewport(win, { left: parseFloat(css?.paddingLeft), right: parseFloat(css?.paddingRight), top: parseFloat(css?.paddingTop), bottom: parseFloat(css?.paddingBottom) });
    };
    let ballPosition;
    try { ballPosition = validBallPosition(getBallPosition()); } catch { ballPosition = validBallPosition(null); }
    let ballDragging = false;
    let bounds = fitFloatingRect({ x: win.innerWidth - 540, y: 70, width: 520, height: 660 }, viewport());
    let ballBounds = dockedBallRect(ballPosition, viewport());
    function paint(el, rect) { Object.assign(el.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px' }); }
    function keyboardVisible() {
        if (Math.abs(win.innerWidth - viewportWidth) > 80) {
            viewportWidth = win.innerWidth;
            unobscuredHeight = Math.max(win.innerHeight, win.visualViewport?.height || 0);
        }
        const visibleHeight = win.visualViewport?.height || win.innerHeight;
        unobscuredHeight = Math.max(unobscuredHeight, win.innerHeight, visibleHeight);
        const focused = doc.activeElement, tag = (focused?.tagName || focused?.tag || '').toLowerCase();
        let ancestor = focused;
        while (ancestor && ancestor !== frame) ancestor = ancestor.parentElement || ancestor.parent;
        const typing = ancestor === frame && (tag === 'textarea' || tag === 'input' && !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(focused.type) || focused?.isContentEditable);
        return !!(isMobileViewport(win) && activeId && typing && (win.visualViewport?.scale || 1) <= 1.05 && unobscuredHeight - visibleHeight > Math.max(150, unobscuredHeight * .2));
    }
    function layout() {
        transitions.settleOpening();
        const area = viewport(), mobile = isMobileViewport(win);
        keyboardOpen = keyboardVisible();
        root.dataset.mobile = String(mobile);
        root.dataset.keyboard = String(keyboardOpen);
        title.hidden = mobile && !keyboardOpen && !mobileExpanded && !viewExpanded;
        root.dataset.dragging = String(ballDragging);
        if (!ballDragging && mobile) ballBounds = dockedBallRect(ballPosition, area, !activeId && menu.hidden, 56);
        else ballBounds = fitFloatingRect(mobile ? ballBounds : { ...ballBounds, width: 48, height: 48 }, area);
        if (mobile && (mobileExpanded || viewExpanded) && !ballDragging) ballBounds = dockedBallRect({ ...ballPosition, fraction: 1 }, area, false, 56);
        // Mobile geometry is temporary: keyboard/orientation changes cannot shrink desktop bounds.
        const keyboardHeight = Math.min(Math.max(1, area.height - 16), mobileExpanded || viewExpanded ? Math.max(1, area.height - 16) : Math.max(260, (area.height - 16) * .75));
        const expanded = mobile ? { extra: 0, rect: keyboardOpen ? { x: area.x + 8, y: area.y + area.height - 8 - keyboardHeight, width: Math.max(1, area.width - 16), height: keyboardHeight } : mobilePanelRect(ballBounds, area, mobileExpanded || viewExpanded) }
            : fitSidebarRect(bounds, area, sidebarOpen);
        ball.hidden = keyboardOpen || !ballVisible || !registry.list().some(e => e.available);
        expandButton.hidden = !mobile || viewExpanded || keyboardOpen;
        expandButton.textContent = mobileExpanded ? '↙' : '↗';
        expandButton.setAttribute('aria-label', mobileExpanded ? t('恢复小面板', 'Restore compact panel') : t('放大窗口', 'Enlarge window'));
        expandButton.title = mobileExpanded ? t('恢复小面板', 'Restore compact panel') : t('放大窗口', 'Enlarge window');
        frame.style.minWidth = expanded.extra ? 'min(700px, calc(100vw - 16px))' : '';
        paint(frame, expanded.rect); paint(ball, ballBounds);
        menu.style.left = mobile ? area.x + 8 + 'px' : ''; menu.style.top = mobile ? area.y + 8 + 'px' : '';
        menu.style.right = mobile ? '' : win.innerWidth - area.x - area.width + 8 + 'px';
        menu.style.bottom = mobile ? '' : win.innerHeight - area.y - area.height + 72 + 'px';
        menu.style.maxWidth = Math.max(1, area.width - 16) + 'px'; menu.style.maxHeight = Math.max(1, area.height - 16) + 'px';
    }
    function close() {
        if (!activeId) { menu.hidden = true; layout(); render(); return; }
        transitions.close();
        const cleanup = teardown; teardown = null; activeId = null; sidebarOpen = false; mobileExpanded = false; viewExpanded = false; mountVersion++; frame.hidden = true; menu.hidden = true;
        try { cleanup?.(); } finally { content.replaceChildren(); actions.replaceChildren(); layout(); render(); (returnFocus?.isConnected ? returnFocus : ball).focus(); }
    }
    function open(id) {
        if (disposed) return;
        const entry = registry.list().find(e => e.id === id && e.available); if (!entry) return;
        menu.hidden = true;
        if (activeId === id) { frame.focus(); return; }
        if (activeId) close();
        transitions.cancel();
        returnFocus = doc.activeElement; activeId = id; frame.hidden = false;
        const version = ++mountVersion;
        try { teardown = registry.mount(id, content, { lang: language, close, actionsRoot: actions,
            setViewExpanded: value => {
                if (disposed || version !== mountVersion || activeId !== id || viewExpanded === !!value) return;
                viewExpanded = !!value; layout();
            },
            setSidebarOpen: value => {
                if (disposed || version !== mountVersion || activeId !== id || sidebarOpen === !!value) return;
                sidebarOpen = !!value; layout();
            }, resetLayout: () => {
            bounds = fitFloatingRect({ x: win.innerWidth - 540, y: 70, width: 520, height: 660 }, viewport()); layout();
        } }); }
        catch { content.replaceChildren(); node('p', content).textContent = t('面板未能打开，请关闭后重试。', 'Could not open panel. Close and retry.'); }
        layout(); render(); frame.focus(); transitions.open();
    }
    function render() {
        if (disposed) return;
        const entries = registry.list().filter(e => e.available), current = entries.find(e => e.id === activeId);
        if (activeId && !current) { close(); return; }
        const labels = { idle: t('空闲', 'Idle'), running: t('运行中', 'Running'), attention: t('需关注', 'Attention'), error: t('错误', 'Error') };
        const presentation = floatingPresentation(entries);
        let freshCompletion = false;
        for (const entry of entries) {
            const version = entry.completionVersion || 0, previous = completionVersions.get(entry.id);
            if (previous !== undefined && version > previous) freshCompletion = true;
            completionVersions.set(entry.id, Math.max(previous || 0, version));
        }
        if (freshCompletion && ['thinking', 'executing'].includes(previousDisplay)) pendingCompletion = true;
        if (presentation.status !== 'running') {
            if (pendingCompletion && presentation.displayState === 'completed' && ballVisible) ball.dataset.completing = 'true';
            pendingCompletion = false;
        }
        if (presentation.displayState !== 'completed' || !ballVisible) ball.dataset.completing = 'false';
        previousDisplay = presentation.displayState;
        const displayLabels = { idle: t('待机', 'Idle'), thinking: t('等待模型', 'Waiting for model'), executing: t('执行中', 'Executing'), waiting: t('等待处理', 'Attention · Waiting for you'), completed: t('回答完成', 'Response completed'), error: t('任务失败', 'Error · Task failed') };
        ball.dataset.status = presentation.status; ball.dataset.displayState = presentation.displayState; ball.hidden = keyboardOpen || !ballVisible || !entries.length;
        ball.setAttribute('aria-label', t('插件快捷入口', 'Plugin shortcuts') + ' · ' + displayLabels[presentation.displayState]);
        ball.title = t('点击展开或收回，拖动移动；方向键调整位置', 'Click to expand or collapse, drag to move; arrow keys reposition');
        ball.setAttribute('aria-expanded', String(!menu.hidden || !!activeId));
        title.textContent = current ? current.label[language === 'en' ? 'en' : 'zh'] + (isMobileViewport(win) ? '' : ' · ' + labels[current.status]) : '';
        frame.setAttribute('aria-label', title.textContent);
        closeButton.textContent = '−'; closeButton.setAttribute('aria-label', t('收起窗口', 'Collapse window')); closeButton.title = t('收起窗口', 'Collapse window');
        const focusedEntry = menu.children.length && [...menu.children].find(b => b === doc.activeElement)?.dataset.entry;
        menu.replaceChildren();
        for (const entry of entries) {
            const b = button(menu); b.textContent = entry.icon + ' ' + entry.label[language === 'en' ? 'en' : 'zh'] + ' · ' + labels[entry.status];
            b.dataset.entry = entry.id;
            b.onclick = () => open(entry.id);
            if (!menu.hidden && focusedEntry === entry.id) b.focus();
        }
    }
    ball.onclick = () => {
        if (ball.__gdDragged) { ball.__gdDragged = false; return; }
        if (activeId) { close(); return; }
        const entries = registry.list().filter(e => e.available);
        if (entries.length === 1) open(entries[0].id);
        else { menu.hidden = !menu.hidden; layout(); render(); if (!menu.hidden) menu.firstElementChild?.focus(); }
    };
    closeButton.onclick = close;
    expandButton.onclick = () => { mobileExpanded = !mobileExpanded; layout(); };
    frame.onkeydown = menu.onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); ball.focus(); } };
    const dragCleanups = [];
    function rememberBall() {
        const area = viewport();
        ballPosition = validBallPosition({ side: ballBounds.x + ballBounds.width / 2 < area.x + area.width / 2 ? 'left' : 'right',
            fraction: Math.max(0, Math.min(1, (ballBounds.y - area.y - 8) / Math.max(1, area.height - ballBounds.height - 16))) });
        try { Promise.resolve(saveBallPosition({ ...ballPosition })).catch(() => {}); } catch { /* Position saving cannot fail a view. */ }
    }
    function draggable(handle, element, read, write, enabled = () => true) {
        let drag = null;
        const end = () => { if (drag) { try { handle.releasePointerCapture?.(drag.id); } catch { /* Already released. */ }
            if (element === ball) { if (element.__gdDragged) rememberBall(); ballDragging = false; }
            drag = null; layout(); } };
        handle.onpointerdown = e => {
            if (!enabled() || e.button !== 0 || e.target.closest('button') && e.target.closest('button') !== handle) return;
            transitions.cancel();
            element.__gdDragged = false; drag = { id: e.pointerId, x: e.clientX, y: e.clientY, initial: { ...read() } };
            if (element === ball) ballDragging = true;
            if (element === ball && isMobileViewport(win)) mobileExpanded = false;
            handle.setPointerCapture?.(e.pointerId);
        };
        handle.onpointermove = e => {
            if (!drag || e.pointerId !== drag.id) return;
            const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
            const threshold = e.pointerType === 'touch' ? 10 : 5;
            if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold && !element.__gdDragged) return;
            element.__gdDragged = true; write(fitFloatingRect({ ...drag.initial, x: drag.initial.x + dx, y: drag.initial.y + dy }, viewport())); layout();
        };
        handle.onpointerup = handle.onpointercancel = end;
        dragCleanups.push(end);
    }
    draggable(ball, ball, () => ballBounds, r => { ballBounds = r; });
    draggable(header, frame, () => fitSidebarRect(bounds, viewport(), sidebarOpen).rect, r => {
        const extra = fitSidebarRect(bounds, viewport(), sidebarOpen).extra;
        bounds = { ...r, x: r.x + extra, width: r.width - extra };
    }, () => !isMobileViewport(win));
    ball.onkeydown = e => {
        const delta = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[e.key];
        if (!delta) return; e.preventDefault(); ballBounds = fitFloatingRect({ ...ballBounds, x: ballBounds.x + delta[0], y: ballBounds.y + delta[1] }, viewport()); rememberBall(); layout();
    };
    const observer = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(() => {
        if (frame.hidden || isMobileViewport(win)) return;
        const rect = frame.getBoundingClientRect();
        const expected = fitSidebarRect(bounds, viewport(), sidebarOpen);
        // CSS layout dimensions exclude the opening transform; a visual scale is not a user resize.
        const width = frame.offsetWidth || rect.width, height = frame.offsetHeight || rect.height;
        if (Math.abs(width - expected.rect.width) < 1 && Math.abs(height - expected.rect.height) < 1) return;
        bounds = fitFloatingRect({ ...bounds, x: (parseFloat(frame.style.left) || rect.left) + expected.extra, width: Math.max(300, width - expected.extra), height }, viewport());
        layout();
    }) : null;
    const viewportChanged = () => { transitions.cancel(); layout(); };
    const focusChanged = () => { Promise.resolve().then(() => { if (!disposed && keyboardVisible() !== keyboardOpen) viewportChanged(); }); };
    frame.addEventListener('focusin', focusChanged); frame.addEventListener('focusout', focusChanged);
    observer?.observe(frame); win.addEventListener('resize', viewportChanged);
    win.visualViewport?.addEventListener('resize', viewportChanged); win.visualViewport?.addEventListener('scroll', viewportChanged);
    const unsubscribe = registry.subscribe(render); layout(); render();
    return Object.freeze({
        open, close,
        setBallVisible(value) {
            if (disposed) return;
            ballVisible = !!value;
            if (!ballVisible) menu.hidden = true;
            render();
        },
        setLanguage(value, { preserveActive = false } = {}) {
            if (value === language || disposed) return;
            if (preserveActive) { language = value; render(); return; }
            const id = activeId; if (id) close(); language = value; render(); if (id) open(id);
        },
        dispose() { if (disposed) return; close(); transitions.dispose(); disposed = true; unsubscribe(); observer?.disconnect(); win.removeEventListener('resize', viewportChanged);
            frame.removeEventListener('focusin', focusChanged); frame.removeEventListener('focusout', focusChanged);
            win.visualViewport?.removeEventListener('resize', viewportChanged); win.visualViewport?.removeEventListener('scroll', viewportChanged); dragCleanups.forEach(fn => fn()); root.remove(); },
    });
}
