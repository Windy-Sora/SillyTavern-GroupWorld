import test from 'node:test';
import assert from 'node:assert/strict';

import { createProfileSystem } from '../../systems/profile-system.js';

class FakeNode {
    constructor(length = 1) {
        this.length = length;
        this.fragments = [];
        this.history = [];
        this.handlers = [];
        this.props = {};
        this.dataValues = {};
        this.attributes = {};
        this.findValues = new Map();
        this.closestValue = null;
        this.value = '';
    }

    empty() { this.fragments = []; return this; }
    html(value) { if (value !== undefined) { this.fragments = [value]; this.history.push(value); } return this; }
    append(value) { const fragment = value?.markup ?? value; this.fragments.push(fragment); this.history.push(fragment); return this; }
    before(value) { this.fragments.push(value); this.history.push(value); return this; }
    replaceWith(value) { this.fragments = [value]; this.history.push(value); return this; }
    remove() { this.length = 0; return this; }
    off() { return this; }
    on(...args) { this.handlers.push(args); return this; }
    prop(name, value) { if (value === undefined) return this.props[name]; this.props[name] = value; return this; }
    data(name) { return this.dataValues[name]; }
    attr(name) { return this.attributes[name]; }
    closest() { return this.closestValue || this; }
    find(selector) { return this.findValues.get(selector) || new FakeNode(0); }
    each(callback) { (this.items || []).forEach(item => callback.call(item)); return this; }
    val(value) { if (value === undefined) return this.value; this.value = value; return this; }
    hide() { this.props.hidden = true; return this; }
}

function fixture(overrides = {}) {
    const metadata = {};
    const chat = [];
    const characters = [
        { avatar: 'alice.png', name: 'Alice', description: 'new', personality: 'p', scenario: 's' },
        { avatar: 'bob.png', name: 'Bob', description: 'b', personality: 'p', scenario: 's' },
    ];
    const settings = { profileEnabled: true, profileJsonSchema: '{}', lang: 'en' };
    const dependencies = {
        settings,
        EXT_KEY: 'gd',
        getChatMetadata: () => metadata,
        getChat: () => chat,
        getCharacters: () => characters,
        saveChatConditional: async () => {},
        getContext: () => ({ generateRaw: async () => '{}' }),
        setExtensionPrompt: () => {},
        inject_ids: { QUIET_PROMPT: 'quiet' },
        extension_prompt_types: { IN_PROMPT: 0 },
        djb2Hash: value => value,
        hashChar: (description, personality, scenario) => `${description}|${personality}|${scenario}`,
        extractJsonObject: () => null,
        sanitizeJson: value => value,
        matchCharacterByName: () => null,
        getCurrentGroup: () => ({ members: ['alice.png', 'bob.png'], disabled_members: [] }),
        log: () => {},
        getLlmPickedSet: () => new Set(),
        getLlmPickedAvatars: () => [],
        getRoundSpeakerCount: () => 0,
        isRoundActive: () => false,
        saveSettings: () => {},
        renderPrompt: async prompt => prompt,
        createCaller: () => ({ generate: async () => '{}' }),
        ...overrides,
    };
    return { system: createProfileSystem(dependencies), metadata, characters, settings };
}

test('profile management renders loader, change detector, and safe editable cards', () => {
    const originalDollar = globalThis.$;
    const originalToastr = globalThis.toastr;
    const nodes = new Map();
    const node = (selector, length = 1) => {
        if (!nodes.has(selector)) nodes.set(selector, new FakeNode(length));
        return nodes.get(selector);
    };
    globalThis.$ = value => {
        if (value instanceof FakeNode) return value;
        if (typeof value === 'string' && value.trimStart().startsWith('<')) return { markup: value };
        if (value === '#gd-profile-loader' || value === '#gd-profile-changes') return node(value, 0);
        return node(value);
    };
    globalThis.toastr = { info() {}, success() {}, warning() {}, error() {} };

    try {
        const { system } = fixture();
        Object.assign(system.getProfiles(), {
            'alice.png': {
                avatar: 'alice.png', name: 'Alice', hash: 'stale', state: 'ready', manualEdited: true,
                profile: { summary: 'Summary', tags: ['one'], motivation: 'Goal', relationships: 'Team' },
            },
            'removed.png': {
                avatar: 'removed.png', name: 'Removed', hash: 'old', state: 'failed',
                profile: { summary: '', tags: [], motivation: '', relationships: '' },
            },
            '\" onmouseover=\"attack': {
                avatar: '\" onmouseover=\"attack', name: '<img src=x>', hash: '', state: 'pending',
                profile: { summary: '<script>', tags: ['\"'], motivation: '&', relationships: "'" },
            },
        });

        system.buildProfileLoaderPanel();
        system.detectCharacterChanges();
        system.refreshProfileManagementUI();

        const loaderMarkup = node('#gd-profile-management-list').history.join('');
        assert.match(loaderMarkup, /Load Profiles from Save/);
        assert.match(loaderMarkup, /Character Change Detection/);
        assert.doesNotMatch(loaderMarkup, /<img src=x>/);
        assert.doesNotMatch(loaderMarkup, /id="gd-profile-edit-/);
        assert.match(loaderMarkup, /&quot; onmouseover=&quot;attack/);
        assert.ok(node('#gd-profile-section').handlers.length >= 2);
        assert.ok(node('.gd-changes-btn-apply').handlers.length >= 1);
        assert.ok(node('#gd-profile-management-list').handlers.length >= 5);
    } finally {
        globalThis.$ = originalDollar;
        globalThis.toastr = originalToastr;
    }
});

test('profile management handlers complete successful no-op, edit, save, regeneration, and delete flows', async () => {
    const originalDollar = globalThis.$;
    const originalToastr = globalThis.toastr;
    const nodes = new Map();
    const node = selector => {
        if (!nodes.has(selector)) nodes.set(selector, new FakeNode(selector === '#gd-profile-loader' || selector === '#gd-profile-changes' ? 0 : 1));
        return nodes.get(selector);
    };
    globalThis.$ = value => {
        if (value instanceof FakeNode) return value;
        if (typeof value === 'string' && value.trimStart().startsWith('<')) return { markup: value };
        return node(value);
    };
    const notices = [];
    globalThis.toastr = {
        info: message => notices.push(message), success: message => notices.push(message),
        warning: message => notices.push(message), error: message => notices.push(message),
    };

    try {
        const { system } = fixture();
        system.getProfiles()['alice.png'] = {
            avatar: 'alice.png', name: 'Alice', hash: 'old', state: 'ready', manualEdited: false,
            profile: { summary: 'Old', tags: [], motivation: '', relationships: '' },
        };
        system.buildProfileLoaderPanel();
        system.detectCharacterChanges();

        const loaderApply = node('#gd-profile-section').handlers.find(args => args[1] === '.gd-loader-btn-apply')[2];
        const loaderButton = new FakeNode();
        loaderApply.call(loaderButton);
        assert.equal(loaderButton.props.disabled, false);

        const changesApply = node('.gd-changes-btn-apply').handlers.at(-1)[1];
        const changesButton = new FakeNode();
        await changesApply.call(changesButton);
        assert.equal(changesButton.props.disabled, false);

        system.refreshProfileManagementUI();
        const handlers = node('#gd-profile-management-list').handlers;
        const getHandler = selector => handlers.find(args => args[1] === selector)[2];
        const editPanel = new FakeNode();
        editPanel[0] = { style: { display: 'none' } };
        for (const [selector, value] of [
            ['[data-field="summary"]', 'Edited'],
            ['[data-field="tags"]', 'one, two'],
            ['[data-field="motivation"]', 'Goal'],
            ['[data-field="relationships"]', 'Team'],
        ]) {
            const field = new FakeNode();
            field.value = value;
            editPanel.findValues.set(selector, field);
        }
        const card = new FakeNode();
        card.attributes['data-avatar'] = 'alice.png';
        card.findValues.set('.gd-profile-card-edit', editPanel);
        const button = new FakeNode();
        button.closestValue = card;
        button.dataValues.avatar = 'alice.png';
        const event = { stopPropagation() {} };

        getHandler('.gd-profile-btn-edit').call(button, event);
        getHandler('.gd-profile-btn-cancel').call(button, event);
        await getHandler('.gd-profile-btn-save').call(button, event);
        assert.equal(system.getProfiles()['alice.png'].profile.summary, 'Edited');
        await getHandler('.gd-profile-btn-regen').call(button);
        assert.equal(button.props.disabled, false);
        await getHandler('.gd-profile-btn-delete').call(button);
        assert.equal(system.getProfiles()['alice.png'], undefined);
        assert.equal(system.getArchivedProfiles()['alice.png'].avatar, 'alice.png');
        assert.ok(notices.length >= 2);
    } finally {
        globalThis.$ = originalDollar;
        globalThis.toastr = originalToastr;
    }
});

test('profile management entry points stop cleanly when disabled or outside a group', () => {
    const originalDollar = globalThis.$;
    globalThis.$ = () => new FakeNode(0);
    try {
        fixture({ settings: { profileEnabled: false } }).system.checkProfileStartupStatus();
        fixture({ getCurrentGroup: () => null }).system.buildProfileLoaderPanel();
        fixture({ getCurrentGroup: () => null }).system.detectCharacterChanges();
        fixture().system.refreshProfileManagementUI();
    } finally {
        globalThis.$ = originalDollar;
    }
});
