import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import { createQuickActions, getQuickActions, quickResultText } from '../../ui/quick-actions.js';
import { mountCommandBoard } from '../../ui/command-board.js';

const read = name => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
function find(node, predicate) {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    for (const value of Object.values(node)) {
        for (const child of Array.isArray(value) ? value : [value]) {
            const result = find(child, predicate); if (result) return result;
        }
    }
    return null;
}
function extract(file, predicate) {
    const source = read(file), node = find(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }), predicate);
    assert.ok(node); return source.slice(node.start, node.end);
}
const fn = (file, name) => extract(file, n => n.type === 'FunctionDeclaration' && n.id?.name === name);
const eventHandler = name => {
    const source = extract('index.js', n => n.type === 'CallExpression' && n.arguments?.[0]?.property?.name === name);
    const ast = parse(source, { ecmaVersion: 'latest' });
    const cb = ast.body[0].expression.arguments[1]; return source.slice(cb.start, cb.end);
};
// Tree/event fixture only: no browser layout simulation.
class Element {
    constructor(tag, doc) { this.tagName = tag; this.ownerDocument = doc; this.children = []; this.dataset = {}; this.listeners = new Map(); }
    append(el) { el.remove(); this.children.push(el); el.parentElement = this; }
    prepend(el) { el.remove(); this.children.unshift(el); el.parentElement = this; }
    before(el) { const p = this.parentElement; el.remove(); p.children.splice(p.children.indexOf(this), 0, el); el.parentElement = p; }
    replaceWith(el) { this.before(el); this.remove(); }
    remove() { if (this.parentElement) { const a = this.parentElement.children; a.splice(a.indexOf(this), 1); this.parentElement = null; } }
    setAttribute() {}
    addEventListener(k, fn) { this.listeners.set(k, fn); }
    removeEventListener(k) { this.listeners.delete(k); }
    querySelector() { return null; }
    contains(el) { return el === this || this.children.some(c => c.contains(el)); }
}
const all = el => [el, ...el.children.flatMap(all)];
function depsFixture() {
    const chat = [], metadata = {}, group = { id: 1, members: ['a'] };
    return {
        settings: { lang: 'en', mode: 'llm', topN: 1, llmMaxSpeakers: 3, scoreWeights: {}, profileEnabled: true, memoryEnabled: true, summaryEnabled: true, storyBlueprintEnabled: true },
        getChat: () => chat, getChatMetadata: () => metadata, getCurrentGroup: () => group,
        isRoundActive: () => false, saveSettings() {}, getProfiles: () => ({}), storyBlueprintSystem: { getBlueprint: () => ({}) },
    };
}
function jqueryFixture() {
    const map = new Map();
    const $ = key => {
        if (typeof key !== 'string') return key;
        if (!map.has(key)) {
            const el = { value: '', textValue: '', handlers: {}, length: 1,
                on(k, cb) { this.handlers[k] = cb; return this; },
                val(v) { if (arguments.length) { this.value = String(v); return this; } return this.value; },
                text(v) { if (arguments.length) { this.textValue = v; return this; } return this.textValue; },
                find(s) { return $(key + ' ' + s); }, closest(s) { return $(key + ' ' + s); }, children(s) { return $(key + ' ' + s); },
            };
            for (const m of ['prop', 'toggle', 'toggleClass', 'attr', 'css', 'empty', 'append', 'hide', 'show', 'off']) el[m] = () => el;
            map.set(key, el);
        }
        return map.get(key);
    };
    return $;
}
function section(file, globals) {
    let init;
    vm.runInNewContext(read(file).replace(/^import .*;\r?\n/gm, ''), { ...globals, registerSection(_, cb) { init = cb; } });
    return init;
}

test('round lifecycle refreshes mounted board controls without navigation or polling', async () => {
    const doc = { createElement: tag => new Element(tag, doc) }, root = new Element('div', doc);
    const d = depsFixture();
    const runtime = vm.createContext({ isGroupChat: false, directorRoundEpoch: 0, log() {}, console: { log() {} },
        roundOrchestrator: { getSnapshot: () => ({ takeoverPending: false }), setPending() {}, canFinalize: () => false },
        settings: { customAgents: [] }, scriptExecutorRoundRan: false, postSpeechRoundQueue: [], manualGenInProgress: false, generationStopped: false,
        window: { __gdRefreshDashboard() { d.quickActions.refresh(); } },
    });
    d.isRoundActive = () => runtime.isGroupChat; d.quickActions = createQuickActions(d);
    const board = mountCommandBoard(root, { deps: d, navigate() {} }); board.update(true);
    const controls = all(root).filter(el => el.dataset.boardAction || ['gd-board-mode', 'gd-board-count'].includes(el.id));
    assert.equal(controls.length, 6); assert.ok(controls.every(el => !el.disabled));
    // Execute the actual start transition, stopping before unrelated round initialization.
    const start = eventHandler('GROUP_WRAPPER_STARTED');
    const begin = start.indexOf('isGroupChat = true;'), end = start.indexOf('// Regenerate / swipe', begin);
    assert.ok(begin >= 0 && end > begin);
    vm.runInContext(start.slice(begin, end), runtime);
    assert.ok(controls.every(el => el.disabled));
    await vm.runInContext(`(${eventHandler('GROUP_WRAPPER_FINISHED')})()`, runtime);
    assert.equal(d.quickActions.unavailable('summary'), null);
    assert.ok(controls.every(el => !el.disabled));
    board.dispose(); runtime.isGroupChat = true; d.quickActions.refresh();
    assert.ok(controls.every(el => !el.disabled), 'disposed board unsubscribed');
});

for (const [file, id, key] of [['formula', 'topn', 'topN'], ['director', 'llm-max-speakers', 'llmMaxSpeakers']]) {
    test(`${file} speaker input restores persisted value when rejected and saves accepted edits`, async () => {
        const $ = jqueryFixture(), d = depsFixture(); let active = true, saves = 0;
        d.isRoundActive = () => active; d.saveSettings = () => saves++;
        d.quickActions = createQuickActions(d);
        const init = section(`ui/sections/${file}.js`, { $, toggleCharDescLength() {}, DEFAULT_SETTINGS: {} });
        init({ ...d, $c: id => $('#gd-' + id), getDefaultLlmPrompt: () => '' });
        const input = $('#gd-' + id), original = d.settings[key];
        input.val('5'); input.handlers.input();
        assert.equal(input.val(), String(original)); assert.equal(d.settings[key], original); assert.equal(saves, 0);
        active = false;
        for (const value of ['0', '21', '2.5', '']) { input.val(value); input.handlers.input(); assert.equal(input.val(), String(original)); }
        let finish; d.summarySystem = { generateSummary: () => new Promise(r => { finish = r; }) };
        const task = d.quickActions.run('summary'); input.val('4'); input.handlers.input();
        assert.equal(input.val(), String(original)); finish(); await task;
        input.val('5'); input.handlers.input(); assert.equal(d.settings[key], 5); assert.equal(input.val(), '5'); assert.equal(saves, 1);
    });
}

test('preview reuses the debug label on the trace page and restores its exact classic position', () => {
    const doc = { createComment: () => new Element('#comment', doc) };
    const origin = new Element('div', doc), target = new Element('div', doc), label = new Element('label', doc);
    const before = new Element('select', doc), after = new Element('span', doc), checkbox = new Element('input', doc);
    label.append(checkbox); origin.append(before); origin.append(label); origin.append(after);
    let changes = 0; checkbox.addEventListener('input', () => changes++);
    const context = vm.createContext({ doc, debugLabel: label, debugTarget: target, debugAnchor: null });
    vm.runInContext(fn('ui/navigation-shell.js', 'placeDebugControl'), context);
    for (let i = 0; i < 3; i++) {
        context.placeDebugControl(true); context.placeDebugControl(true);
        assert.equal(target.children[0], label); checkbox.listeners.get('input')();
        context.placeDebugControl(false); assert.deepEqual(origin.children, [before, label, after]);
    }
    assert.equal(changes, 3); assert.equal(label.children[0], checkbox);
    const shell = read('ui/navigation-shell.js');
    assert.match(shell, /querySelector\('\[data-card="debug"\] \.gd-card-body'\)/);
    assert.match(shell, /placeDebugControl\(state.layout === 'preview'\)/);
    assert.match(shell.slice(shell.indexOf('dispose()')), /placeDebugControl\(false\)/);
});

for (const outcome of ['success', 'failure', 'blocked']) {
    test(`blueprint detail clears continuing status after ${outcome} through the shared adapter`, async () => {
        const $ = jqueryFixture(), d = depsFixture(), blueprint = { title: 'Test', nodes: [] };
        let finish;
        d.storyBlueprintSystem = {
            getState: () => ({ continuePending: false }), getBlueprint: () => blueprint,
            getProgress: () => ({ steps: [], doneCount: 0, total: 0, complete: true }), getProviderData: () => ({ blueprint, current: null }),
            getCompletionVariable: () => 'story_done', getDefaultPrompt: () => '', getDefaultContinuePrompt: () => '', getDefaultSchema: () => '', getDefaultTemplate: () => '', renderCurrent: () => '',
            generateBlueprint: () => new Promise((resolve, reject) => { finish = () => outcome === 'failure' ? reject(Error('rejected')) : resolve(blueprint); }),
        };
        if (outcome === 'blocked') d.settings.storyBlueprintEnabled = false;
        const window = {}, globals = { $, window, console, getQuickActions, quickResultText, activeContexts: new WeakMap() };
        const context = vm.createContext(globals);
        vm.runInContext(fn('ui/settings-init.js', 'prepareContext'), context);
        const ctx = context.prepareContext(d, id => $('#gd-' + id));
        section('ui/sections/storyBlueprint.js', globals)(ctx);
        const task = $('#gd-story-blueprint-continue').handlers.click();
        finish?.(); await task;
        assert.equal($('#gd-story-blueprint-card-status').text(), '0/0');
        assert.doesNotMatch($('#gd-story-blueprint-status').text(), /continuing/i);
        if (outcome !== 'blocked') assert.equal(ctx.quickActions.state('blueprint').status, outcome === 'success' ? 'success' : 'failed');
    });
}

for (const boundary of ['chat-switch', 'panel-rebuild', 'chat-switch-and-rebuild']) {
    for (const outcome of ['success', 'failure']) {
        test(`old blueprint continuation preserves drafts after ${boundary} and ${outcome}`, async () => {
            const $ = jqueryFixture(), d = depsFixture();
            let chat = [], metadata = {}, group = { id: 'A', members: ['a'] };
            let blueprint = { title: 'A saved', nodes: [] }, finish, continuePending = false;
            d.getChat = () => chat; d.getChatMetadata = () => metadata; d.getCurrentGroup = () => group;
            d.storyBlueprintSystem = {
                getState: () => ({ continuePending }), getBlueprint: () => blueprint,
                getProgress: () => ({ steps: [], doneCount: 0, total: 0, complete: true }), getProviderData: () => ({ blueprint, current: null }),
                getCompletionVariable: () => 'story_done', getDefaultPrompt: () => '', getDefaultContinuePrompt: () => '', getDefaultSchema: () => '', getDefaultTemplate: () => '', renderCurrent: () => '',
                generateBlueprint: () => new Promise((resolve, reject) => {
                    continuePending = true;
                    finish = () => {
                        continuePending = false;
                        if (outcome === 'failure') reject(Error('chat changed')); else resolve(blueprint);
                    };
                }),
            };
            const window = {}, globals = { $, window, console, getQuickActions, quickResultText, activeContexts: new WeakMap() };
            const context = vm.createContext(globals);
            vm.runInContext(fn('ui/settings-init.js', 'prepareContext'), context);
            const init = section('ui/sections/storyBlueprint.js', globals);
            const oldCtx = context.prepareContext(d, id => $('#gd-' + id)); init(oldCtx);
            const task = $('#gd-story-blueprint-continue').handlers.click();
            if (boundary.includes('chat-switch')) {
                chat = []; metadata = {}; group = { id: 'B', members: ['b'] }; blueprint = { title: 'B saved', nodes: [] };
            }
            if (boundary.includes('rebuild')) {
                const newCtx = context.prepareContext(d, id => $('#gd-' + id)); init(newCtx);
                assert.equal(oldCtx.isCurrentPanel(), false);
            } else window.__gdRefreshStoryBlueprint();
            assert.match($('#gd-story-blueprint-status').text(), /continuing/i);
            const draft = '{"title":"unsaved draft","nodes":[]}';
            $('#gd-story-blueprint-json').val(draft);
            $('#gd-story-blueprint-continue-prompt').val('unsaved prompt');
            let fullRefreshes = 0;
            const refresh = window.__gdRefreshStoryBlueprint;
            window.__gdRefreshStoryBlueprint = () => { fullRefreshes++; refresh(); };
            finish(); await task;
            assert.equal(fullRefreshes, 0);
            assert.equal($('#gd-story-blueprint-json').val(), draft);
            assert.equal($('#gd-story-blueprint-continue-prompt').val(), 'unsaved prompt');
            assert.equal($('#gd-story-blueprint-card-status').text(), '0/0');
            assert.doesNotMatch($('#gd-story-blueprint-status').text(), /continuing/i);
        });
    }
}
