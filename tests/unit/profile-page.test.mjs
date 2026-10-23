import test from 'node:test';
import assert from 'node:assert/strict';
import { mountProfilePage } from '../../ui/profile-page.js';

// Minimal tree/event fixture; not a browser layout or CSS simulation.
class Element {
    constructor(tag, doc) {
        this.tagName = tag; this.ownerDocument = doc; this.children = [];
        this.hidden = false;
        this.dataset = {}; this.attributes = {}; this.listeners = new Map();
        const classes = new Set();
        this.classList = { add: x => classes.add(x), remove: x => classes.delete(x) };
    }
    append(el) { el.remove(); this.children.push(el); el.parentElement = this; }
    before(el) {
        const parent = this.parentElement;
        el.remove(); parent.children.splice(parent.children.indexOf(this), 0, el); el.parentElement = parent;
    }
    remove() {
        if (this.parentElement) {
            const siblings = this.parentElement.children;
            siblings.splice(siblings.indexOf(this), 1); this.parentElement = null;
        }
    }
    replaceWith(el) { this.before(el); this.remove(); }
    contains(el) { return this === el || this.children.some(c => c.contains(el)); }
    matches(selector) {
        if (selector.startsWith('#')) return this.id === selector.slice(1);
        const group = selector.match(/^\[data-profile-group="(.+)"\]$/);
        if (group) return this.dataset.profileGroup === group[1];
        if (selector === 'button[data-profile-view]') return this.tagName === 'button' && !!this.dataset.profileView;
        return false;
    }
    querySelector(selector) {
        for (const child of this.children) {
            if (child.matches(selector)) return child;
            const found = child.querySelector(selector); if (found) return found;
        }
        return null;
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    click() {
        const event = { target: this };
        for (let el = this; el; el = el.parentElement) for (const fn of el.listeners.get('click') || []) fn(event);
    }
}
function fixture() {
    const doc = { createElement: tag => new Element(tag, doc), createComment: () => new Element('#comment', doc) };
    const root = doc.createElement('div');
    const add = (parent, id, group) => {
        const el = doc.createElement('div'); el.id = id;
        if (group) el.dataset.profileGroup = group;
        parent.append(el); return el;
    };
    const section = add(root, 'gd-profile-section');
    const scan = add(section, 'gd-profile-scan-save');
    const detect = add(section, 'gd-profile-detect-changes');
    add(section, '', 'settings');
    const advanced = add(section, '', 'advanced');
    const prompt = add(advanced, 'gd-profile-generator-prompt'); prompt.value = 'draft';
    const warning = add(advanced, 'gd-profile-template-warning');
    add(section, '', 'batch');
    const library = add(section, 'gd-profile-library-section');
    const data = add(section, '', 'data');
    const list = add(data, 'gd-profile-management-list');
    const original = [...section.children];
    const settings = { lang: 'zh' };
    let connections = 0;
    const page = mountProfilePage(root, { settings, onConnection: () => connections++ });
    const all = el => [el, ...el.children.flatMap(all)];
    const switchTo = id => { root.querySelector('#gd-profile-view-advanced').open = id === 'advanced'; };
    return { root, section, data, list, library, prompt, warning, scan, detect, original, page, settings, all, switchTo, connections: () => connections };
}

test('profile views preserve live controls, values and business listeners across classic switches', () => {
    const f = fixture(); let clicks = 0;
    f.detect.addEventListener('click', () => clicks++);
    for (let i = 0; i < 3; i++) {
        f.page.update(true, 'profile');
        assert.equal(f.root.querySelector('#gd-profile-view-use').hidden, false);
        f.switchTo('advanced');
        assert.equal(f.root.querySelector('#gd-profile-view-use').hidden, false);
        assert.equal(f.root.querySelector('#gd-profile-view-advanced').tagName, 'details');
        assert.equal(f.all(f.root).some(el => el.dataset.profileView), false);
        assert.equal(f.root.querySelector('#gd-profile-view-advanced').hidden, false);
        assert.equal(f.root.querySelector('#gd-profile-generator-prompt'), f.prompt);
        f.prompt.value += '!'; f.detect.click();
        // Validation output is outside the hidden advanced panel.
        assert.equal(f.root.querySelector('#gd-profile-view-advanced').contains(f.warning), false);
        f.page.update(false, 'profile');
        assert.deepEqual(f.section.children.filter(el => !el.className?.includes('gd-profile-page')), f.original);
        f.switchTo('use');
    }
    assert.equal(f.prompt.value, 'draft!!!'); assert.equal(clicks, 3);
    f.page.dispose(); assert.deepEqual(f.section.children, f.original);
});

test('dynamic scan results survive relocation and remain under the business event delegation root', () => {
    const f = fixture(); f.page.update(true, 'profile');
    const results = f.root.ownerDocument.createElement('div'); results.id = 'gd-profile-loader';
    f.list.before(results);
    f.page.update(false, 'profile');
    assert.equal(results.parentElement, f.data);
    assert.equal(f.section.contains(results), true);
    f.page.update(true, 'profile'); f.page.dispose();
    assert.equal(results.parentElement, f.data);
    assert.equal(f.list.parentElement, f.data);
});

test('library routes reveal Use and the library, language refresh retains the selected view', () => {
    const f = fixture(); f.page.update(true, 'profile'); f.switchTo('advanced');
    f.page.update(true, 'profile-library');
    assert.equal(f.library.parentElement.open, true);
    assert.equal(f.root.querySelector('#gd-profile-view-use').hidden, false);
    f.switchTo('settings'); f.settings.lang = 'en'; f.page.update(true, 'profile-library');
    assert.equal(f.root.querySelector('#gd-profile-view-settings').hidden, false);
    const connection = f.all(f.root).find(el => el.textContent === 'Model connections…');
    connection.click(); assert.equal(f.connections(), 1);
    f.page.dispose(); connection.click(); assert.equal(f.connections(), 1);
});

test('missing profile sections are harmless and incomplete templates leave no presentation controls', () => {
    const f = fixture(); f.page.dispose();
    const empty = f.root.ownerDocument.createElement('div');
    assert.equal(mountProfilePage(empty), null);
    f.detect.remove(); const before = [...f.section.children];
    assert.throws(() => mountProfilePage(f.root), /missing/);
    assert.deepEqual(f.section.children, before);
    assert.deepEqual(f.root.children, [f.section]);
});
