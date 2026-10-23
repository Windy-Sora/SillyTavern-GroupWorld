import test from 'node:test';
import assert from 'node:assert/strict';
import { createScrollFollow } from '../../muyu/ui/scroll-follow.js';

class Surface {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.events = new Map(); }
    addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(fn); }
    removeEventListener(type, fn) { this.events.get(type)?.delete(fn); }
    emit(type, event = {}) { for (const fn of this.events.get(type) || []) fn({ target: this, ...event }); }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
}
function fixture() {
    const viewport = new Surface(), win = new Surface(), states = [], saved = [], frames = new Map(); let tick = 10, frame = 0, callback, disconnected = false;
    viewport.scrollHeight = 1000; viewport.clientHeight = 200;
    let top = 0;
    Object.defineProperty(viewport, 'scrollTop', { get: () => top, set: value => { top = Math.max(0, Math.min(value, viewport.scrollHeight - viewport.clientHeight)); } });
    viewport.getBoundingClientRect = () => ({ top: 0, bottom: viewport.clientHeight, height: viewport.clientHeight });
    win.visualViewport = new Surface();
    win.requestAnimationFrame = fn => { frames.set(++frame, fn); return frame; }; win.cancelAnimationFrame = id => frames.delete(id);
    const observed = [];
    win.ResizeObserver = class { constructor(fn) { callback = fn; } observe(node) { observed.push(node); } disconnect() { disconnected = true; } };
    const history = new Surface(); viewport.children.push(history);
    const control = createScrollFollow({ viewport, win, now: () => tick, onState: state => states.push(state), onPosition: (key, value) => saved.push([key, value]) });
    const state = { viewKey: 'a', scrollTop: null };
    const render = (changed = false, input = state) => { const pending = control.begin(input); control.end(changed); return pending; };
    const readAt = value => { viewport.emit('wheel'); viewport.scrollTop = value; viewport.emit('scroll'); };
    const paragraph = (position, height = 100) => {
        const node = new Surface('p'); node.position = position; node.height = height;
        node.getBoundingClientRect = () => ({ top: node.position - top, bottom: node.position - top + node.height, height: node.height }); history.children.push(node); return node;
    };
    const flush = () => { const batch = [...frames.values()]; frames.clear(); for (const fn of batch) fn(); };
    return { viewport, win, history, control, state, states, saved, observed, render, readAt, paragraph, flush, resize: () => callback(), disconnected: () => disconnected, frames, expire: () => { tick += 5000; } };
}

test('User reading intent survives new content and returning to latest explicitly restores following', () => {
    const f = fixture(); f.render(); assert.equal(f.viewport.scrollTop, 800);
    f.readAt(120); assert.equal(f.states.at(-1).following, false);
    f.control.begin(f.state); f.viewport.scrollHeight += 200; f.control.end(true);
    assert.equal(f.viewport.scrollTop, 120); assert.deepEqual(f.states.at(-1), { following: false, unread: true });
    f.control.latest(); assert.equal(f.viewport.scrollTop, 1000); assert.deepEqual(f.states.at(-1), { following: true, unread: false });
    f.control.begin(f.state); f.viewport.scrollHeight += 100; f.control.end(true); assert.equal(f.viewport.scrollTop, 1100); f.control.dispose();
});

test('Keyboard resize cannot turn proximity to the bottom into resumed follow intent', () => {
    const f = fixture(); f.render(); f.readAt(700);
    f.viewport.clientHeight = 300; f.resize(); f.flush(); assert.equal(f.states.at(-1).following, false);
    f.viewport.emit('scroll'); f.control.begin(f.state); f.viewport.scrollHeight += 200; f.control.end(true);
    assert.equal(f.viewport.scrollTop, 700); assert.equal(f.states.at(-1).following, false); f.control.dispose();
});

test('Layout compensation preserves visible content rather than only the old scrollTop', () => {
    const f = fixture(), first = f.paragraph(100), next = f.paragraph(300); f.render(); f.readAt(120);
    const oldOffset = first.getBoundingClientRect().top;
    first.position += 50; next.position += 50; f.viewport.scrollHeight += 50; f.resize(); f.flush();
    assert.equal(f.viewport.scrollTop, 170); assert.equal(first.getBoundingClientRect().top, oldOffset);
    assert.equal(f.states.at(-1).following, false); assert.equal(f.states.at(-1).unread, false);
    f.history.children = [next]; next.position += 40; f.viewport.scrollHeight += 40; f.resize(); f.flush();
    assert.equal(f.viewport.scrollTop, 210, 'deleted primary anchor falls back to its surviving neighbor'); f.control.dispose();
});

test('Queued size-neutral reflow retains the old anchor before an ordinary notification', () => {
    const f = fixture(), first = f.paragraph(100); f.render(); f.readAt(120);
    first.position += 50; f.resize(); f.render(); f.flush();
    assert.equal(f.viewport.scrollTop, 170); assert.equal(first.getBoundingClientRect().top, -20);
    assert.equal(f.states.at(-1).following, false); f.control.dispose();
});

test('Reflow during ordinary state rendering compensates using the pre-render anchor', () => {
    const f = fixture(), first = f.paragraph(100); f.render(); f.readAt(120);
    f.control.begin(f.state); first.position += 75; f.viewport.scrollHeight += 75; f.control.end(false);
    assert.equal(f.viewport.scrollTop, 195); assert.equal(first.getBoundingClientRect().top, -20); assert.equal(f.states.at(-1).unread, false); f.control.dispose();
});

for (const kind of ['permission', 'clarification']) test(`A pending ${kind} is located once without changing reader intent`, () => {
    const f = fixture(); f.render(); f.readAt(120); f.state.interaction = { id: 'one', kind, status: 'pending' };
    assert.equal(f.render(), true); assert.equal(f.viewport.scrollTop, 800); assert.equal(f.states.at(-1).following, false);
    f.readAt(150); f.state.interaction.question = 'Updated'; assert.equal(f.render(), false); assert.equal(f.viewport.scrollTop, 150);
    f.state.interaction.status = 'answered'; f.render(); f.state.interaction.status = 'pending'; assert.equal(f.render(), false);
    const b = { ...f.state, viewKey: 'b', scrollTop: 40 }; assert.equal(f.render(false, b), true);
    assert.equal(f.render(false, f.state), false); assert.equal(f.viewport.scrollTop, 150);
    f.state.interaction.id = 'two'; assert.equal(f.render(), true); assert.equal(f.viewport.scrollTop, 800); f.control.dispose();
});

test('Session switches restore each reading position and follow intent independently', () => {
    const f = fixture(); f.render(); f.readAt(120);
    const b = { viewKey: 'b', scrollTop: null }; f.render(false, b); assert.equal(f.viewport.scrollTop, 800);
    f.render(false, f.state); assert.equal(f.viewport.scrollTop, 120); assert.equal(f.states.at(-1).following, false);
    f.viewport.scrollHeight += 100; f.render(false, b); assert.equal(f.viewport.scrollTop, 900); assert.equal(f.states.at(-1).following, true); f.control.dispose();
});

test('Hidden settings layouts preserve positions until the transcript is visible again', () => {
    const f = fixture(); f.render(); f.readAt(120); f.viewport.clientHeight = 0; f.viewport.scrollTop = 0;
    f.render(); f.resize(); f.flush(); f.viewport.clientHeight = 200; f.resize(); f.flush();
    assert.equal(f.viewport.scrollTop, 120);
    f.viewport.clientHeight = 0; const b = { viewKey: 'b', scrollTop: 75 }; f.render(false, b);
    f.viewport.clientHeight = 200; f.render(false, b); assert.equal(f.viewport.scrollTop, 75); f.control.dispose();
});

test('Programmatic scroll and nested text inputs do not count as reader navigation', () => {
    const f = fixture(); f.render(); f.readAt(120); f.control.latest(); f.viewport.emit('scroll');
    assert.equal(f.states.at(-1).following, true);
    f.expire(); f.viewport.emit('keydown', { key: 'ArrowUp', target: { tagName: 'TEXTAREA' } }); f.viewport.scrollTop = 120; f.viewport.emit('scroll');
    assert.equal(f.states.at(-1).following, true);
    f.viewport.emit('keydown', { key: 'PageUp' }); f.viewport.emit('scroll'); assert.equal(f.states.at(-1).following, false); f.control.dispose();
});

test('Disposal clears listeners, observers, queued frames and late notifications', () => {
    const f = fixture(); f.render(); f.resize(); assert.equal(f.frames.size, 1);
    const publications = f.states.length; f.control.dispose(); f.control.dispose(); f.flush(); f.resize(); f.flush(); f.control.latest();
    assert.equal(f.states.length, publications); assert.equal(f.frames.size, 0); assert.equal(f.disconnected(), true);
    assert.ok([...f.viewport.events.values()].every(rows => rows.size === 0));
    assert.ok([...f.win.events.values()].every(rows => rows.size === 0)); assert.equal(f.control.begin(f.state), false); f.control.end(true);
});

test('Explicit result navigation opens disclosures and scrolls only the message viewport', () => {
    const f = fixture(), target = f.paragraph(400), disclosure = new Surface('details');
    f.history.children = [disclosure]; disclosure.children = [target]; target.parentElement = disclosure; disclosure.parentElement = f.history; f.history.parentElement = f.viewport;
    f.render(); f.readAt(120); assert.equal(f.control.locate(target), true);
    assert.equal(disclosure.open, true); assert.equal(f.viewport.scrollTop, 392); assert.equal(f.states.at(-1).following, false);
    f.control.begin(f.state); f.viewport.scrollHeight += 100; f.control.end(true); assert.equal(f.viewport.scrollTop, 392);
    assert.equal(f.control.locate(new Surface()), false); f.viewport.clientHeight = 0; assert.equal(f.control.locate(target), false);
    f.control.dispose(); assert.equal(f.control.locate(target), false);
});
