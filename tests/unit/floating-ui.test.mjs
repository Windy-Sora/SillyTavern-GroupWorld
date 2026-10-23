import test from 'node:test';
import assert from 'node:assert/strict';
import { createFloatingRegistry } from '../../ui/floating/registry.js';
import { createFloatingShell, fitFloatingRect, fitSidebarRect } from '../../ui/floating/shell.js';
import { visibleViewport, validBallPosition, dockedBallRect, mobilePanelRect } from '../../ui/floating/geometry.js';

const entry = (id, overrides = {}) => ({ id, label: { zh: id, en: id }, icon: '*', order: 10, mount: () => () => {}, ...overrides });
test('Compact mobile title is hidden visually; expanded and desktop titles retain the dialog name', () => {
    let port; const f = surface(options => { port = options; }, { innerWidth: 400 });
    f.shell.open('chat');
    const title = f.find('gd-floating-header').children.find(e => e.tag === 'strong');
    assert.equal(title.hidden, true); assert.equal(f.find('gd-floating-window').attrs['aria-label'], 'chat');
    f.find('gd-floating-expand').onclick(); assert.equal(title.hidden, false);
    f.find('gd-floating-expand').onclick(); assert.equal(title.hidden, true);
    port.setViewExpanded(true); assert.equal(title.hidden, false);
    port.setViewExpanded(false); assert.equal(title.hidden, true);
    f.win.innerWidth = 1000; f.events.get('resize')(); assert.equal(title.hidden, false);
    assert.equal(f.mounts(), 1); f.shell.dispose(); f.registry.dispose();
});
test('Floating ball visibility survives status updates without closing the active view', () => {
    const f = surface();
    const ball = f.find('gd-floating-ball');
    const frame = f.find('gd-floating-window');
    assert.equal(ball.hidden, false);
    f.shell.open('chat');
    f.shell.setBallVisible(false);
    assert.equal(ball.hidden, true);
    assert.equal(frame.hidden, false);
    f.shell.setLanguage('en');
    assert.equal(ball.hidden, true);
    f.shell.close();
    assert.equal(frame.hidden, true);
    assert.equal(ball.hidden, true);
    f.shell.setBallVisible(true);
    assert.equal(ball.hidden, false);
    f.shell.dispose(); f.registry.dispose();
});
test('Floating registry supports independent modules, priority aggregation and isolated metadata', () => {
    const r = createFloatingRegistry(); let status = 'idle', notify, cleaned = 0;
    const remove = r.register(entry('chat', { getStatus: () => status, subscribe: fn => { notify = fn; return () => cleaned++; } }));
    r.register(entry('monitor', { order: 0, getStatus: () => 'error' }));
    r.register(entry('disabled', { isAvailable: () => false, getStatus: () => 'error' }));
    let events = 0; const off = r.subscribe(() => events++);
    status = 'running'; notify(); assert.equal(events, 1); assert.equal(r.status(), 'error');
    assert.equal(r.list()[0].id, 'monitor'); const a = r.list(); a[0].label.zh = 'tampered'; assert.equal(r.list()[0].label.zh, 'monitor');
    assert.throws(() => r.register(entry('chat')), /INVALID/); assert.throws(() => r.mount('disabled'), /UNAVAILABLE/);
    off(); r.dispose(); remove(); assert.equal(cleaned, 1); assert.throws(() => r.register(entry('later')), /DISPOSED/);
});
test('Module status failures are isolated; unknown status cannot leak payloads into launcher', () => {
    const r = createFloatingRegistry(); r.register(entry('odd', { getStatus: () => '<secret>' })); assert.equal(r.status(), 'idle');
    r.register(entry('broken', { getStatus: () => { throw Error('private'); } }));
    assert.doesNotMatch(JSON.stringify(r.list()), /private|secret/); r.dispose();
});
test('Window geometry stays reachable at 320/400/600/800px and after viewport shrink', () => {
    for (const width of [320, 400, 600, 800]) {
        const r = fitFloatingRect({ x: 9999, y: -200, width: 520, height: 660 }, { width, height: 500 });
        assert.ok(r.x >= 8 && r.y >= 8); assert.ok(r.x + r.width <= width - 8); assert.ok(r.y + r.height <= 492);
    }
});

class Element {
    constructor(tag, doc) {
        this.tag = tag; this.ownerDocument = doc; this.children = []; this.style = {}; this.dataset = {}; this.attrs = {}; this.isConnected = true;
        if (doc.animations) this.animate = (frames, options) => {
            let reject;
            const row = { frames, options, cancelled: false, finished: new Promise((_, no) => { reject = no; }),
                cancel() { this.cancelled = true; reject(Error('cancelled')); } };
            doc.animations.push(row); return row;
        };
    }
    append(...nodes) { for (const n of nodes) { this.children.push(n); n.parent = this; } }
    replaceChildren() { this.children = []; }
    setAttribute(k, v) { this.attrs[k] = v; }
    remove() { this.parent.children = this.parent.children.filter(e => e !== this); this.isConnected = false; }
    focus() {
        if (this.ownerDocument.activeElement === this) return;
        const previous = this.ownerDocument.activeElement; this.ownerDocument.activeElement = this;
        for (let e = previous; e; e = e.parent) e.events?.get('focusout')?.({ target: previous });
        for (let e = this; e; e = e.parent) e.events?.get('focusin')?.({ target: this });
    }
    getBoundingClientRect() { return { left: parseFloat(this.style.left) || 0, top: parseFloat(this.style.top) || 0, width: parseFloat(this.style.width) || 100, height: parseFloat(this.style.height) || 100 }; }
    get firstElementChild() { return this.children[0]; }
    closest(tag) { return this.tag === tag ? this : this.parent?.closest(tag); }
    addEventListener(key, fn) { (this.events ||= new Map()).set(key, fn); }
    removeEventListener(key) { this.events?.delete(key); }
}
function surface(onMount = () => {}, windowOptions = {}, shellOptions = {}) {
    const doc = { animations: windowOptions.testAnimations, createElement: tag => new Element(tag, doc) }; doc.body = new Element('body', doc);
    const events = new Map(), win = { innerWidth: 1000, innerHeight: 800, addEventListener(k, fn) { events.set(k, fn); }, removeEventListener(k) { events.delete(k); } };
    Object.assign(win, windowOptions);
    const registry = createFloatingRegistry(); let mounts = 0, disposals = 0;
    registry.register(entry('chat', { mount: (root, options) => { mounts++; onMount(options); return () => disposals++; } }));
    const shell = createFloatingShell({ registry, doc, win, ...shellOptions });
    const all = (el = doc.body) => [el, ...el.children.flatMap(n => all(n))];
    const find = cls => all().find(e => e.className === cls);
    return { doc, win, events, registry, shell, find, mounts: () => mounts, disposals: () => disposals };
}

for (const width of [1000, 390]) test('BUG-EC60-01: ordinary focus preserves real shell opening transitions / width=' + width, async () => {
    const animations = [], f = surface(() => {}, { innerWidth: width, testAnimations: animations });
    f.shell.open('chat'); assert.equal(animations.length, 3);
    await Promise.resolve(); assert.ok(animations.every(row => !row.cancelled), 'Window focus must not settle or cancel opening');
    const input = f.doc.createElement('textarea'); input.value = 'Keep draft'; f.find('gd-floating-content').append(input); input.focus();
    await Promise.resolve(); assert.ok(animations.every(row => !row.cancelled), 'Text focus without a keyboard must also preserve opening');
    assert.equal(input.value, 'Keep draft'); assert.equal(f.mounts(), 1);
    f.shell.close(); const closing = animations.slice(3); assert.equal(closing.length, 2);
    await Promise.resolve(); assert.ok(closing.every(row => !row.cancelled), 'Focus restoration must not cancel closing motion');
    f.shell.dispose(); assert.ok(animations.every(row => row.cancelled)); f.registry.dispose(); await Promise.resolve();
});

test('Focus-induced keyboard state changes still settle motion and restore geometry without remounting', async () => {
    const animations = [], f = surface(() => {}, { innerWidth: 390, testAnimations: animations });
    f.shell.open('chat'); await Promise.resolve(); assert.ok(animations.every(row => !row.cancelled));
    f.win.innerHeight = 350;
    const input = f.doc.createElement('textarea'); f.find('gd-floating-content').append(input); input.focus();
    await Promise.resolve(); assert.ok(animations.every(row => row.cancelled));
    assert.equal(f.find('gd-floating-root').dataset.keyboard, 'true'); assert.equal(f.find('gd-floating-window').style.height, '260px');
    f.doc.body.focus(); await Promise.resolve(); assert.equal(f.find('gd-floating-root').dataset.keyboard, 'false');
    assert.equal(f.mounts(), 1); f.shell.dispose(); f.registry.dispose(); await Promise.resolve();
});
test('Single entry opens directly, repeated open focuses existing view; close tears down view only', () => {
    const f = surface(), ball = f.find('gd-floating-ball'); ball.focus(); ball.onclick(); f.shell.open('chat');
    assert.equal(f.mounts(), 1); assert.equal(f.find('gd-floating-window').hidden, false);
    f.shell.close(); assert.equal(f.disposals(), 1); assert.equal(f.doc.activeElement, ball);
    f.shell.open('chat'); assert.equal(f.mounts(), 2); f.shell.dispose(); f.shell.dispose();
    assert.equal(f.disposals(), 2); assert.equal(f.events.size, 0); assert.equal(f.doc.body.children.length, 0); f.registry.dispose();
});

test('Optional presentation uses closed states, isolates exceptions and keeps legacy status aggregation', () => {
    const r = createFloatingRegistry();
    r.register(entry('muyu', { getPresentation: () => ({ status: 'running', displayState: 'thinking', secret: 'PRIVATE' }) }));
    r.register(entry('legacy', { getStatus: () => 'idle' }));
    assert.equal(r.list().find(e => e.id === 'muyu').displayState, 'thinking'); assert.equal(r.status(), 'running');
    assert.doesNotMatch(JSON.stringify(r.list()), /PRIVATE/);
    r.register(entry('invalid', { getPresentation: () => ({ status: 'attention', displayState: 'thinking' }) }));
    assert.equal(r.list().find(e => e.id === 'invalid').displayState, 'waiting');
    r.register(entry('broken', { getPresentation: () => { throw Error('PRIVATE'); } }));
    assert.equal(r.status(), 'error'); assert.equal(r.list().find(e => e.id === 'broken').displayState, 'error');
    assert.throws(() => r.register(entry('bad', { getPresentation: 'not a function' })), /INVALID/);
    r.dispose();
});

test('Display-state changes update the launcher without remounting the view or replacing the graphic', () => {
    const f = surface(); let displayState = 'thinking';
    const remove = f.registry.register(entry('activity', { getPresentation: () => ({ status: 'running', displayState }) }));
    f.shell.open('chat'); const ball = f.find('gd-floating-ball'), mark = f.find('gd-floating-feather');
    assert.equal(ball.dataset.displayState, 'thinking'); assert.match(ball.attrs['aria-label'], /等待模型/);
    displayState = 'executing'; f.shell.setLanguage('en', { preserveActive: true });
    assert.equal(ball.dataset.displayState, 'executing'); assert.match(ball.attrs['aria-label'], /Executing/);
    assert.equal(f.mounts(), 1); assert.equal(f.find('gd-floating-feather'), mark);
    remove(); f.shell.dispose(); f.registry.dispose();
});

test('Feather launcher keeps its decorative asset across language and status updates without changing the button contract', () => {
    const f = surface(), ball = f.find('gd-floating-ball'), mark = f.find('gd-floating-feather');
    assert.equal(mark.tag, 'img'); assert.equal(mark.parent, ball);
    assert.match(mark.src, /\/assets\/muyu-floating-feather\.svg$/);
    assert.equal(mark.alt, ''); assert.equal(mark.draggable, false); assert.equal(mark.attrs['aria-hidden'], 'true');
    assert.match(ball.attrs['aria-label'], /插件快捷入口/);
    f.shell.setLanguage('en');
    const remove = f.registry.register(entry('monitor', { getStatus: () => 'attention' }));
    assert.equal(ball.dataset.status, 'attention'); assert.equal(f.find('gd-floating-feather'), mark);
    assert.match(ball.attrs['aria-label'], /Plugin shortcuts.*Attention/);
    assert.equal(ball.style.width, '48px');
    remove(); ball.onclick(); assert.equal(f.mounts(), 1);
    assert.equal(f.find('gd-floating-feather'), mark);
    f.shell.dispose(); f.registry.dispose();
});

test('Completion effect fires only for a new live completion, not history, repeated renders, reopening or hidden launchers', () => {
    const f = surface(); let notify, displayState = 'completed', completionVersion = 7;
    f.registry.register(entry('muyu', { getPresentation: () => ({ status: ['thinking', 'executing'].includes(displayState) ? 'running' : 'idle', displayState, completionVersion }), subscribe: fn => { notify = fn; return () => {}; } }));
    const ball = f.find('gd-floating-ball');
    assert.notEqual(ball.dataset.completing, 'true', 'initial historical result is not a completion event');
    displayState = 'thinking'; notify();
    completionVersion = 8; displayState = 'executing'; notify();
    displayState = 'completed'; notify(); assert.equal(ball.dataset.completing, 'true');
    ball.onanimationend({ animationName: 'gd-orb-complete' }); assert.equal(ball.dataset.completing, 'false');
    notify(); f.shell.open('chat'); f.shell.close(); f.shell.setLanguage('en');
    assert.equal(ball.dataset.completing, 'false');
    displayState = 'thinking'; notify(); f.shell.setBallVisible(false);
    completionVersion = 9; displayState = 'completed'; notify(); f.shell.setBallVisible(true);
    assert.equal(ball.dataset.completing, 'false');
    f.shell.dispose(); f.registry.dispose();
});

test('Mobile viewport respects visible offsets, safe insets and keyboard recovery without remounting', () => {
    const listeners = new Map(), visual = { width: 390, height: 760, offsetLeft: 0, offsetTop: 0,
        addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) };
    const f = surface(() => {}, { innerWidth: 390, innerHeight: 844, visualViewport: visual,
        getComputedStyle: () => ({ paddingTop: '20px', paddingBottom: '10px', paddingLeft: '0px', paddingRight: '0px' }) });
    f.shell.open('chat');
    const frame = f.find('gd-floating-window'), ball = f.find('gd-floating-ball');
    assert.equal(frame.style.width, '335.4px'); assert.equal(frame.style.height, '438px');
    assert.equal(ball.hidden, false);
    visual.height = 360; visual.offsetTop = 35; listeners.get('resize')(); listeners.get('scroll')();
    assert.ok(parseFloat(frame.style.top) >= 67); assert.ok(parseFloat(frame.style.height) <= 234); assert.equal(f.mounts(), 1);
    visual.height = 760; visual.offsetTop = 0; listeners.get('resize')();
    assert.equal(frame.style.height, '438px'); assert.equal(f.mounts(), 1);
    f.shell.close(); assert.equal(ball.hidden, false);
    f.shell.dispose(); assert.equal(listeners.size, 0); f.registry.dispose();
});

test('Mobile keyboard temporarily fills visible space without remounting, losing drafts or scroll, and restores expanded preference', async () => {
    const listeners = new Map(), visual = { width: 390, height: 760, offsetLeft: 0, offsetTop: 0, scale: 1,
        addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) };
    const f = surface(() => {}, { innerWidth: 390, innerHeight: 844, visualViewport: visual }); f.shell.open('chat');
    const root = f.find('gd-floating-root'), frame = f.find('gd-floating-window'), ball = f.find('gd-floating-ball');
    const content = f.find('gd-floating-content'), input = f.doc.createElement('textarea'); content.append(input);
    input.value = 'Unsent draft'; content.scrollTop = 120; input.focus();
    frame.events.get('focusin')(); await Promise.resolve();
    assert.equal(root.dataset.keyboard, 'false', 'Focus alone does not imply a soft keyboard');
    visual.height = 360; visual.offsetTop = 35; listeners.get('resize')();
    assert.equal(root.dataset.keyboard, 'true'); assert.equal(frame.style.top, '127px');
    assert.equal(frame.style.height, '260px'); assert.equal(frame.style.width, '374px'); assert.equal(ball.hidden, true);
    assert.equal(f.find('gd-floating-header').children.find(e => e.tag === 'strong').hidden, false);
    assert.equal(f.find('gd-floating-expand').hidden, true);
    f.shell.setLanguage('en', { preserveActive: true }); assert.equal(ball.hidden, true, 'Status renders cannot reveal the ball over the composer');
    assert.equal(input.value, 'Unsent draft'); assert.equal(content.scrollTop, 120); assert.equal(f.mounts(), 1);
    visual.height = 760; visual.offsetTop = 0; listeners.get('resize')();
    assert.equal(root.dataset.keyboard, 'false'); assert.equal(frame.style.height, '440px'); assert.equal(ball.hidden, false);
    f.find('gd-floating-expand').onclick(); const expandedHeight = frame.style.height;
    visual.height = 360; listeners.get('resize')(); assert.equal(root.dataset.keyboard, 'true');
    assert.equal(frame.style.height, '344px'); assert.equal(frame.style.top, '8px', 'User-enlarged panels keep all usable height');
    visual.height = 760; listeners.get('resize')(); assert.equal(frame.style.height, expandedHeight);
    f.shell.dispose(); await Promise.resolve(); assert.equal(frame.events.size, 0); assert.equal(listeners.size, 0); f.registry.dispose();
});

test('Keyboard detection handles layout viewport resizing without visualViewport and focus leaving the window', async () => {
    const f = surface(() => {}, { innerWidth: 400, innerHeight: 800 }); f.shell.open('chat');
    const frame = f.find('gd-floating-window'), root = f.find('gd-floating-root'), input = f.doc.createElement('input');
    input.type = 'text'; f.find('gd-floating-content').append(input); input.focus();
    f.win.innerHeight = 370; f.events.get('resize')();
    assert.equal(root.dataset.keyboard, 'true'); assert.equal(frame.style.height, '265.5px');
    f.doc.body.focus(); frame.events.get('focusout')(); await Promise.resolve();
    assert.equal(root.dataset.keyboard, 'false'); assert.equal(f.find('gd-floating-ball').hidden, false);
    f.win.innerHeight = 800; f.events.get('resize')(); assert.equal(frame.style.height, '440px');
    f.shell.dispose(); f.registry.dispose();
});

test('Address bars, pinch zoom, checkboxes and desktop keyboard focus do not activate mobile input layout', () => {
    const visual = { width: 390, height: 760, scale: 1, addEventListener() {}, removeEventListener() {} };
    const f = surface(() => {}, { innerWidth: 390, innerHeight: 800, visualViewport: visual }); f.shell.open('chat');
    const root = f.find('gd-floating-root'), input = f.doc.createElement('input'); f.find('gd-floating-content').append(input);
    input.type = 'text'; input.focus(); visual.height = 680; f.events.get('resize')(); assert.equal(root.dataset.keyboard, 'false');
    visual.height = 350; visual.scale = 2; f.events.get('resize')(); assert.equal(root.dataset.keyboard, 'false');
    visual.scale = 1; input.type = 'checkbox'; f.events.get('resize')(); assert.equal(root.dataset.keyboard, 'false');
    input.type = 'text'; f.win.innerWidth = 1000; f.events.get('resize')(); assert.equal(root.dataset.keyboard, 'false');
    f.shell.dispose(); f.registry.dispose();
});

test('Mobile drag docks, stores a proportional position and restores it across surfaces', () => {
    let saved;
    const f = surface(() => {}, { innerWidth: 400, innerHeight: 800 }, { saveBallPosition: p => { saved = p; } });
    const ball = f.find('gd-floating-ball');
    ball.onpointerdown({ button: 0, pointerId: 1, target: ball, clientX: 370, clientY: 700 });
    ball.onpointermove({ pointerId: 1, clientX: 30, clientY: 390 }); ball.onpointerup();
    assert.equal(saved.side, 'left'); assert.ok(saved.fraction >= 0 && saved.fraction <= 1);
    assert.equal(ball.style.left, '-20px'); ball.onclick(); assert.equal(f.mounts(), 0);
    ball.onclick(); assert.equal(f.mounts(), 1); assert.equal(ball.hidden, false);
    f.shell.close(); assert.equal(ball.hidden, false); f.shell.dispose(); f.registry.dispose();
    const restored = surface(() => {}, { innerWidth: 320, innerHeight: 500 }, { getBallPosition: () => saved });
    assert.equal(restored.find('gd-floating-ball').style.top, 8 + 428 * saved.fraction + 'px');
    assert.equal(restored.find('gd-floating-ball').style.left, '-20px');
    restored.shell.dispose(); restored.registry.dispose();
});

test('Mobile layout preserves desktop geometry and rejects corrupt saved positions', () => {
    let port;
    const f = surface(p => { port = p; }); f.shell.open('chat');
    const frame = f.find('gd-floating-window');
    f.win.innerWidth = 400; f.events.get('resize')(); port.setSidebarOpen(true);
    assert.equal(frame.style.width, '340px'); assert.equal(frame.style.height, '440px');
    const header = f.find('gd-floating-header');
    header.onpointerdown({ button: 0, pointerId: 2, target: header, clientX: 100, clientY: 20 });
    header.onpointermove({ pointerId: 2, clientX: 300, clientY: 300 }); header.onpointerup();
    assert.ok(parseFloat(frame.style.top) >= 12);
    port.setSidebarOpen(false); f.win.innerWidth = 1000; f.events.get('resize')();
    assert.equal(frame.style.width, '520px'); assert.equal(frame.style.height, '660px'); assert.equal(frame.style.top, '70px');
    f.shell.dispose(); f.registry.dispose();
    for (const bad of [null, {}, { side: 'left', fraction: NaN }, { side: 'right', fraction: 2 }, { side: 'no', fraction: 0.5 }])
        assert.deepEqual(validBallPosition(bad), { side: 'right', fraction: 0.9 });
    const area = visibleViewport({ innerWidth: 400, innerHeight: 800 });
    assert.equal(dockedBallRect({ side: 'left', fraction: 0 }, area).y, 8);
});

test('Compact geometry stays inside the visible area and never overlaps the exposed ball', () => {
    for (const width of [320, 390, 600, 850]) for (const height of [220, 360, 800]) for (const fraction of [0, 0.3, 0.5, 0.9, 1]) {
        const area = { x: 20, y: 30, width, height };
        const ball = dockedBallRect({ side: 'right', fraction }, area, false, 56), panel = mobilePanelRect(ball, area);
        assert.ok(panel.x >= area.x + 12); assert.ok(panel.x + panel.width <= area.x + width - 12);
        assert.ok(panel.y >= area.y + 12); assert.ok(panel.y + panel.height <= area.y + height - 12);
        assert.ok(panel.y + panel.height <= ball.y - 12 || panel.y >= ball.y + ball.height + 12);
    }
});

test('Mobile enlargement preserves drafts and touch jitter still opens/closes the panel', () => {
    const f = surface(() => {}, { innerWidth: 400, innerHeight: 800 });
    const ball = f.find('gd-floating-ball');
    ball.onpointerdown({ button: 0, pointerId: 3, pointerType: 'touch', target: ball, clientX: 390, clientY: 700 });
    ball.onpointermove({ pointerId: 3, pointerType: 'touch', clientX: 396, clientY: 706 }); ball.onpointerup(); ball.onclick();
    assert.equal(f.mounts(), 1);
    const frame = f.find('gd-floating-window'), content = f.find('gd-floating-content');
    const draft = f.doc.createElement('textarea'); draft.value = 'keep this draft'; content.append(draft);
    f.find('gd-floating-expand').onclick(); assert.equal(frame.style.height, '704px');
    assert.equal(f.mounts(), 1); assert.equal(content.children[0].value, 'keep this draft');
    f.find('gd-floating-expand').onclick(); assert.equal(frame.style.height, '440px');
    ball.onclick(); assert.equal(frame.hidden, true);
    f.shell.dispose(); f.registry.dispose();
});

test('Temporary workbench expansion restores compact or user-enlarged geometry without remounting', () => {
    let port;
    const f = surface(p => { port = p; }, { innerWidth: 400, innerHeight: 800 }); f.shell.open('chat');
    const frame = f.find('gd-floating-window'), expand = f.find('gd-floating-expand');
    assert.equal(frame.style.width, '340px'); assert.equal(frame.style.height, '440px');
    port.setViewExpanded(true); assert.equal(frame.style.height, '704px'); assert.equal(expand.hidden, true);
    port.setViewExpanded(false); assert.equal(frame.style.height, '440px'); assert.equal(expand.hidden, false);
    expand.onclick(); port.setViewExpanded(true); port.setViewExpanded(false);
    assert.equal(frame.style.height, '704px'); assert.equal(f.mounts(), 1);
    const previous = port; f.shell.close(); f.shell.open('chat'); previous.setViewExpanded(true);
    assert.equal(frame.style.height, '440px'); f.shell.dispose(); f.registry.dispose();
});

test('Bubble toggles an active window closed and reopens without double-mounting', () => {
    const f = surface(), ball = f.find('gd-floating-ball');
    ball.onclick(); assert.equal(f.mounts(), 1); assert.equal(ball.attrs['aria-expanded'], 'true');
    ball.onclick(); assert.equal(f.disposals(), 1); assert.equal(ball.attrs['aria-expanded'], 'false');
    ball.onclick(); assert.equal(f.mounts(), 2); f.shell.dispose(); f.registry.dispose();
});
test('Additional module creates selector and unavailable/removed active module closes safely', () => {
    const f = surface(); let available = true, notify;
    const remove = f.registry.register(entry('monitor', { isAvailable: () => available, subscribe: fn => { notify = fn; return () => {}; } }));
    f.find('gd-floating-ball').onclick(); assert.equal(f.mounts(), 0); assert.equal(f.find('gd-floating-menu').hidden, false);
    f.shell.open('monitor'); available = false; notify(); assert.equal(f.find('gd-floating-window').hidden, true);
    available = true; notify(); f.shell.open('monitor'); remove(); assert.equal(f.find('gd-floating-window').hidden, true);
    f.shell.dispose(); f.registry.dispose();
});
test('Language remounts once; resize and dragging never create additional business views', () => {
    const f = surface(); f.shell.open('chat'); f.shell.setLanguage('zh'); assert.equal(f.mounts(), 1);
    f.shell.setLanguage('en'); assert.equal(f.mounts(), 2); assert.equal(f.disposals(), 1);
    f.win.innerWidth = 320; f.events.get('resize')(); assert.equal(f.find('gd-floating-window').style.width, '275.2px');
    const ball = f.find('gd-floating-ball');
    ball.onpointerdown({ button: 0, pointerId: 1, target: ball, clientX: 200, clientY: 200 });
    ball.onpointermove({ pointerId: 1, clientX: -1000, clientY: -1000 }); ball.onpointerup(); ball.onclick();
    assert.equal(ball.style.left, '8px'); assert.equal(f.mounts(), 2);
    f.shell.dispose(); f.registry.dispose();
});

test('Agent language changes preserve active drafts and use the new language on next mount', () => {
    const languages = [], f = surface(options => languages.push(options.lang));
    f.shell.open('chat');
    const content = f.find('gd-floating-content'), draft = f.doc.createElement('textarea'); draft.value = 'unsaved configuration'; content.append(draft);
    f.shell.setLanguage('en', { preserveActive: true }); f.shell.setLanguage('en', { preserveActive: true });
    assert.equal(f.mounts(), 1); assert.equal(f.disposals(), 0); assert.equal(content.children[0], draft); assert.equal(draft.value, 'unsaved configuration');
    f.shell.close(); f.shell.open('chat'); assert.equal(f.mounts(), 2); assert.deepEqual(languages, ['zh', 'en']);
    f.shell.dispose(); f.registry.dispose();
});

test('History rail grows left without shrinking chat, stays in viewport and restores the base geometry', () => {
    const base = { x: 460, y: 70, width: 520, height: 660 };
    const expanded = fitSidebarRect(base, { width: 1000, height: 800 }, true);
    assert.equal(expanded.extra, 240); assert.equal(expanded.rect.x, 220); assert.equal(expanded.rect.width, 760);
    assert.equal(expanded.rect.x + expanded.rect.width, base.x + base.width);
    for (const width of [320, 400, 600, 800, 1000]) {
        const result = fitSidebarRect(base, { width, height: 800 }, true);
        assert.ok(result.rect.x >= 8); assert.ok(result.rect.x + result.rect.width <= width - 8);
        assert.equal(result.extra, width >= 800 ? 240 : 0);
    }
    assert.equal(fitSidebarRect({ ...base, width: 400 }, { width: 1000, height: 800 }, true).extra, 0);
    let port;
    const f = surface(options => { port = options; }); f.shell.open('chat');
    const frame = f.find('gd-floating-window');
    port.setSidebarOpen(true); port.setSidebarOpen(true); assert.equal(frame.style.width, '760px'); assert.equal(frame.style.left, '220px');
    port.setSidebarOpen(false); assert.equal(frame.style.width, '520px'); assert.equal(frame.style.left, '460px');
    port.setSidebarOpen(true);
    const header = f.find('gd-floating-header');
    header.onpointerdown({ button: 0, pointerId: 2, target: header, clientX: 230, clientY: 80 });
    header.onpointermove({ pointerId: 2, clientX: -1000, clientY: 80 }); header.onpointerup();
    assert.equal(frame.style.left, '8px'); assert.equal(frame.style.width, '760px');
    port.setSidebarOpen(false); assert.equal(frame.style.left, '248px'); assert.equal(frame.style.width, '520px');
    const oldPort = port; f.shell.close(); f.shell.open('chat'); oldPort.setSidebarOpen(true);
    assert.equal(frame.style.width, '520px'); assert.equal(f.mounts(), 2);
    port.setSidebarOpen(true); f.win.innerWidth = 400; f.events.get('resize')();
    assert.equal(frame.style.width, '340px'); assert.equal(frame.style.left, '48px');
    f.shell.dispose(); f.registry.dispose();
});

test('Resize notifications do not repeatedly add rail width; user resize retains the new chat width', () => {
    let port, resize, disconnected = false;
    const f = surface(options => { port = options; }, { ResizeObserver: class {
        constructor(callback) { resize = callback; }
        observe() {}
        disconnect() { disconnected = true; }
    } });
    f.shell.open('chat');
    const frame = f.find('gd-floating-window');
    frame.getBoundingClientRect = () => ({ left: parseFloat(frame.style.left), width: parseFloat(frame.style.width), height: parseFloat(frame.style.height) });
    port.setSidebarOpen(true); resize(); resize();
    assert.equal(frame.style.width, '760px');
    frame.style.width = '800px'; frame.style.height = '620px'; resize(); resize();
    assert.equal(frame.style.width, '800px'); assert.equal(frame.style.height, '620px');
    port.setSidebarOpen(false); resize(); assert.equal(frame.style.width, '560px');
    port.setSidebarOpen(true); resize(); assert.equal(frame.style.width, '800px');
    f.shell.dispose(); assert.equal(disconnected, true); f.registry.dispose();
});
