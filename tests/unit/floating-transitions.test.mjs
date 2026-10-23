import test from 'node:test';
import assert from 'node:assert/strict';
import { createSurfaceTransitions, orbTransform } from '../../ui/floating/transitions.js';

function fixture(reduced = false) {
    const records = [], listeners = new Map(), mediaListeners = new Map();
    const make = () => ({ style: {}, attrs: {}, children: [], hidden: false,
        setAttribute(k, v) { this.attrs[k] = v; }, append(child) { child.parent = this; this.children.push(child); },
        remove() { this.parent.children = this.parent.children.filter(child => child !== this); },
        animate(frames, options) {
            let resolve, reject;
            const finished = new Promise((yes, no) => { resolve = yes; reject = no; });
            const record = { frames, options, finished, cancelled: false, resolve, cancel() { this.cancelled = true; reject(Error('cancelled')); } };
            records.push(record); return record;
        },
    });
    const root = make(), frame = make(), content = make(), ball = make();
    frame.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 600 });
    ball.getBoundingClientRect = () => ({ left: 700, top: 600, width: 48, height: 48 });
    const doc = { createElement: make, addEventListener: (k, fn) => listeners.set(k, fn), removeEventListener: k => listeners.delete(k) };
    const media = { matches: reduced, addEventListener: (k, fn) => mediaListeners.set(k, fn), removeEventListener: k => mediaListeners.delete(k) };
    const win = { matchMedia: () => media };
    const motion = createSurfaceTransitions({ root, frame, content, ball, doc, win });
    return { motion, root, frame, ball, records, listeners, mediaListeners, doc };
}
const flush = () => new Promise(resolve => queueMicrotask(resolve));

test('Orb transform anchors both left and right launchers without changing layout dimensions', () => {
    const panel = { left: 100, top: 50, width: 400, height: 600 };
    assert.equal(orbTransform(panel, { left: 700, top: 600, width: 48, height: 48 }), 'translate(424px, 274px) scale(0.12, 0.08)');
    assert.match(orbTransform(panel, { left: 0, top: 0, width: 48, height: 48 }), /^translate\(-276px, -326px\)/);
    assert.equal(orbTransform({ ...panel, width: 0 }, { left: 0, top: 0, width: 48, height: 48 }), null);
    assert.equal(orbTransform(panel, { left: NaN, top: 0, width: 48, height: 48 }), null);
});

test('Opening fades content before its delayed appearance; settlement cancels visual effects only', async () => {
    const f = fixture(); f.motion.open();
    assert.equal(f.records.length, 3); assert.equal(f.records[0].options.duration, 420);
    assert.equal(f.records[1].options.fill, 'backwards'); assert.equal(f.records[1].options.delay, 160);
    f.records.forEach(record => record.resolve()); await flush(); await flush();
    assert.ok(f.records.every(record => record.cancelled)); assert.equal(f.root.children.length, 0);
    assert.equal(f.frame.hidden, false); f.motion.dispose();
});

test('Closing uses an empty inert proxy; reopening cancels it and stale callbacks cannot cancel the new opening', async () => {
    const f = fixture(); f.frame.children.push({ value: 'PRIVATE_KEY_OR_DRAFT' }); f.motion.close();
    const proxy = f.root.children[0]; assert.ok(proxy); assert.equal(proxy.inert, true); assert.equal(proxy.attrs['aria-hidden'], 'true');
    assert.equal(proxy.children.length, 0); assert.doesNotMatch(JSON.stringify(proxy.style), /PRIVATE/);
    const previous = f.records[0]; previous.resolve(); f.motion.open(); await flush();
    assert.equal(f.root.children.length, 1); assert.equal(f.records[2].cancelled, false);
    assert.equal(f.frame.children[0].value, 'PRIVATE_KEY_OR_DRAFT');
    f.motion.dispose(); assert.equal(f.listeners.size, 0); assert.equal(f.mediaListeners.size, 0);
});

test('Reduced motion uses 120ms opacity-only transitions, including close', () => {
    const f = fixture(true); f.motion.open();
    assert.equal(f.records.length, 1); assert.equal(f.records[0].options.duration, 120);
    assert.ok(f.records[0].frames.every(frame => !('transform' in frame)));
    f.motion.close(); assert.equal(f.records.at(-1).options.duration, 120);
    f.motion.dispose(); assert.equal(f.root.children.length, 0);
});

test('Resize settlement, motion preference changes and page hiding remove all visual work', () => {
    const f = fixture(); f.motion.open(); f.motion.settleOpening(); assert.ok(f.records.every(r => r.cancelled));
    f.motion.close(); f.mediaListeners.get('change')(); assert.equal(f.root.children.length, 0);
    f.motion.close(); f.listeners.get('visibilitychange')(); assert.equal(f.root.children.length, 0);
    f.doc.hidden = true; f.listeners.get('visibilitychange')(); assert.equal(f.root.attrs['data-page-hidden'], 'true');
    const count = f.records.length; f.motion.open(); assert.equal(f.records.length, count);
    f.motion.dispose(); f.motion.open(); assert.equal(f.records.length, count);
});

test('Orb glow is decorative, bounded and removed on interruption; reduced motion omits it', async () => {
    const f = fixture(); f.motion.close();
    const ripple = f.root.children[1];
    assert.equal(ripple.className, 'gd-floating-ripple'); assert.equal(ripple.inert, true);
    assert.equal(ripple.attrs['aria-hidden'], 'true'); assert.equal(ripple.style.width, '48px');
    assert.equal(f.records[1].options.delay, 200); assert.equal(f.records[1].options.duration, 320);
    f.records[0].resolve(); await flush(); assert.equal(f.root.children.length, 1);
    f.records[1].resolve(); await flush(); await flush(); assert.equal(f.root.children.length, 0);
    f.motion.open(); f.motion.cancel(); assert.equal(f.root.children.length, 0); f.motion.dispose();
    const reduced = fixture(true); reduced.motion.open(); assert.equal(reduced.root.children.length, 0); reduced.motion.dispose();
});

test('Unsupported or failing animation APIs leave the real view usable and no proxy behind', () => {
    const f = fixture(); f.frame.animate = undefined; f.motion.open(); f.motion.close(); assert.equal(f.root.children.length, 0);
    f.frame.animate = () => { throw Error('unsupported'); }; f.motion.open(); assert.equal(f.frame.hidden, false);
    f.motion.dispose();
});
