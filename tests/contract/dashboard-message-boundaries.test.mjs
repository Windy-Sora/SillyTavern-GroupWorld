import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const read = async file => (await readFile(new URL('../../' + file, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const dashboard = await read('ui/sections/dashboard.js');
const index = await read('index.js');
function section(source, start, end) {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
    assert.ok(a >= 0 && b > a, start);
    return source.slice(a, b);
}

function dashboardFixture() {
    const created = [], selectors = new Map();
    function node(markup = '') {
        return { markup, children: [], events: new Map(), length: 1,
            append(...children) { this.children.push(...children); return this; },
            empty() { this.children = []; return this; },
            on(type, handler) { this.events.set(type, handler); return this; },
            prop() { return this; }, css() { return this; }, val() { return this; }, text() { return this; } };
    }
    const $ = value => {
        if (typeof value === 'string' && value.startsWith('<')) { const result = node(value); created.push(result); return result; }
        if (!selectors.has(value)) selectors.set(value, node());
        return selectors.get(value);
    };
    const context = {
        $, lang: 'en', settings: {}, document: { createTextNode: value => ({ nodeType: 3, textContent: String(value) }) },
        ctx: {}, visibleWorldBookNames: names => names, $wbList: node(), $wbCount: node(),
        openSettingsLabel: () => 'Settings', saveSettings() {}, openSettingsCard() {}, refreshWorldBookStat() {},
        appendProfileLibraryToolbar() {}, appendOpenSettingsButton() {}, makeEditable() {}, makeToggleRow() {},
        formatProfileSummary: () => '', getProfileSummaryEditValue: () => '', saveChatConditional() {},
    };
    vm.createContext(context);
    vm.runInContext(section(dashboard, '    function esc(s)', '    function openSettingsLabel'), context);
    return { context, created, selectors, node };
}

test('Dashboard world book labels append untrusted names as text nodes', () => {
    const f = dashboardFixture(), names = ['<img src=x onerror=alert(1)>', 'Book "quote" & brackets [a]'];
    f.context.ctx.world_names = names;
    vm.runInContext(section(dashboard, '    function renderDashWorldBookList()', '    // Toggle world book panel'), f.context);
    f.context.renderDashWorldBookList();
    const labels = f.created.filter(row => row.markup.startsWith('<label'));
    assert.equal(labels.length, names.length);
    for (let i = 0; i < names.length; i++) {
        assert.equal(labels[i].children[1].nodeType, 3);
        assert.equal(labels[i].children[1].textContent, names[i]);
        assert.ok(!f.created.some(row => row.markup.includes(names[i])));
    }
});

test('Dashboard profile state is escaped instead of becoming markup', () => {
    const f = dashboardFixture(), state = '<img src=x onerror=alert(1)>';
    f.context.getProfiles = () => ({ 'a.png': { name: 'A', state, profile: {} } });
    vm.runInContext(section(dashboard, '    function renderPanelProfiles()', '    function renderPanelMemories()'), f.context);
    f.context.renderPanelProfiles();
    const row = f.created.find(value => value.markup.includes('gd-list-meta'));
    assert.ok(row.markup.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(!row.markup.includes(state));
});

test('Dashboard memory attributes escape quotes, brackets and HTML in avatar keys', () => {
    const f = dashboardFixture(), avatar = 'a"><img src=x onerror=alert(1)>[q]\\.png';
    f.context.memorySystem = { getStats: () => ({ [avatar]: { name: 'A', count: 1 } }), listMemories: () => [{ event: 'safe', mood: 'calm' }] };
    vm.runInContext(section(dashboard, '    function renderPanelMemories()', '    function renderPanelNpcs()'), f.context);
    f.context.renderPanelMemories();
    const detail = f.created.find(row => row.markup.includes('data-field="mem-'));
    assert.ok(detail.markup.includes('a&quot;&gt;&lt;img'));
    assert.ok(!detail.markup.includes('<img'));
    assert.ok(!detail.markup.includes('data-field="mem-' + avatar));
});

test('Inline memory editor matches raw data attributes without dynamic CSS selectors', () => {
    const field = 'mem-a"]\\[data-x="b]-0', other = { getAttribute: () => 'other' }, target = { getAttribute: () => field };
    const chosen = [], selectors = [];
    const display = { length: 1, append(value) { chosen.push(value); } };
    const detail = { find(selector) {
        selectors.push(selector); assert.equal(selector, '.gd-edit-field');
        return { filter(fn) { assert.equal(fn.call(other), false); assert.equal(fn.call(target), true); return display; } };
    } };
    const context = { lang: 'en', $: () => ({ on() {} }) };
    vm.createContext(context);
    vm.runInContext(section(dashboard, '    function makeEditable(', '    function renderPanelSummary()'), context);
    context.makeEditable(detail, field, () => 'old', () => {}, () => {});
    assert.equal(chosen.length, 1);
    assert.deepEqual(selectors, ['.gd-edit-field']);
});

const marker = 'eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED';
const first = index.indexOf(marker), second = index.indexOf(marker, first + marker.length);
const end = index.indexOf('eventSource.on(event_types.', second + marker.length);
assert.ok(first >= 0 && second > first && end > second);
function messagesFixture() {
    const handlers = [], scripts = [], pools = [], queued = [], calls = [];
    const context = {
        eventSource: { on(type, callback) { handlers.push(callback); } },
        event_types: { CHARACTER_MESSAGE_RENDERED: 'render' },
        chat: [{ name: 'A', mes: 'selected message' }, { name: 'B', mes: 'tail message' }],
        characters: [{ name: 'A' }, { name: 'B' }], chat_metadata: {},
        settings: { postSpeechMessageEnabled: true, postSpeechTiming: 'round', agentConfigs: {} },
        roundGenerateType: 'normal', postSpeechLastMsgIndex: -1, postSpeechRoundQueueEpoch: 0,
        postSpeechMessageAbortController: null, postSpeechMessageControllers: new Set(), AbortController,
        scriptExecutorSystem: { async executeAll(mode, event) { scripts.push({ mode, message: event.message }); } },
        getCurrentGroup: () => ({ id: 'group' }), getContext: () => ({ generateRaw() {}, stopGeneration() {} }),
        AgentRegistry: { get: () => ({ parseResponse: () => ({ intents: [{ type: 'image', params: {} }] }) }) },
        CapabilityRegistry: { listForMode: () => [{ id: 'image' }] },
        postSpeechSystem: { wasExecuted: () => false, isPending: () => false },
        isPostSpeechIntentQueued: () => false,
        enqueuePostSpeechRoundJob: contexts => queued.push(...contexts), countQueuedPostSpeechIntents: () => queued.length,
        buildContextPool: value => { pools.push(value); return value; }, createCaller: () => ({}),
        async execute(...args) { calls.push(args); return await context.response(); },
        response: async () => 'policy', log() {}, toastr: { info() {}, success() {} },
    };
    vm.runInNewContext(index.slice(first, end), context);
    assert.equal(handlers.length, 2);
    return { context, script: handlers[0], post: handlers[1], scripts, pools, queued, calls };
}

test('Message-rendered scripts receive the event message, not the last chat message', async () => {
    const f = messagesFixture();
    await f.script(0, 'normal');
    assert.equal(f.scripts[0].message, f.context.chat[0]);
    await f.script(1, 'normal');
    assert.equal(f.scripts[1].message, f.context.chat[1]);
});

test('PostSpeech reads and queues the event message with its correct message index', async () => {
    const f = messagesFixture();
    await f.post(0, 'normal');
    assert.equal(f.pools[0].speakerName, 'A');
    assert.equal(f.pools[0].speakerMessage, 'selected message');
    assert.equal(f.queued[0].messageIndex, 0);
    assert.equal(f.queued[0].messageName, 'A');
    assert.equal(f.context.postSpeechLastMsgIndex, 0);
    await f.post(0, 'normal');
    assert.equal(f.calls.length, 1);
    await f.post(1, 'normal');
    assert.equal(f.queued[1].messageIndex, 1);
    assert.equal(f.queued[1].messageName, 'B');
});

for (const type of ['swipe', 'regenerate']) test('PostSpeech uses event reroll type even when global generation type is normal: ' + type, async () => {
    const f = messagesFixture();
    await f.post(0, 'normal');
    await f.post(0, type);
    assert.equal(f.calls.length, 2);
    assert.equal(f.queued.length, 2);
    assert.ok(f.queued.every(row => row.messageIndex === 0 && row.messageName === 'A'));
});

for (const id of [undefined, null, '0', '', false, -1, 0.5, 2, NaN, Infinity]) test('Invalid rendered-message ID never falls back to tail: ' + String(id), async () => {
    const f = messagesFixture();
    await f.script(id, 'normal'); await f.post(id, 'normal');
    assert.equal(f.scripts.length, 0); assert.equal(f.calls.length, 0);
    assert.equal(f.queued.length, 0); assert.equal(f.context.postSpeechLastMsgIndex, -1);
});

for (const flags of [{ is_user: true }, { is_system: true }, { name: '_system' }, { mes: '' }]) test('Message filters apply to the selected message: ' + JSON.stringify(flags), async () => {
    const f = messagesFixture();
    Object.assign(f.context.chat[0], flags);
    await f.script(0, 'normal'); await f.post(0, 'normal');
    assert.equal(f.scripts.length, 0); assert.equal(f.calls.length, 0);
});

for (const change of ['edit', 'replace', 'chat', 'delete']) test('Late PostSpeech for an earlier message is ignored after ' + change, async () => {
    const f = messagesFixture(); let resolve;
    f.context.response = () => new Promise(done => { resolve = done; });
    const running = f.post(0, 'normal');
    if (change === 'edit') f.context.chat[0].mes = 'new text';
    if (change === 'replace') f.context.chat[0] = { name: 'A', mes: 'replacement' };
    if (change === 'chat') f.context.chat_metadata = {};
    if (change === 'delete') f.context.chat.splice(0, 1);
    resolve('late policy'); await running;
    assert.equal(f.queued.length, 0); assert.equal(f.context.postSpeechMessageControllers.size, 0);
});

test('An unrelated tail edit does not invalidate analysis for the selected earlier message', async () => {
    const f = messagesFixture(); let resolve;
    f.context.response = () => new Promise(done => { resolve = done; });
    const running = f.post(0, 'normal');
    f.context.chat[1].mes = 'unrelated edit';
    resolve('policy'); await running;
    assert.equal(f.queued.length, 1); assert.equal(f.queued[0].messageIndex, 0);
});

test('Non-message render event types cannot trigger scripts or PostSpeech', async () => {
    const f = messagesFixture();
    await f.script(0, 'quiet'); await f.post(0, 'quiet');
    assert.equal(f.scripts.length, 0); assert.equal(f.calls.length, 0);
});
