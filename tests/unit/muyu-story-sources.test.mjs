import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderPort } from '../../muyu/host/providers.js';
import { createProviderModule } from '../../muyu/modules/providers/index.js';
import { createPermissions } from '../../muyu/application/permissions.js';
import { validateJson } from '../../muyu/core/json-contract.js';

function fixture() {
    let target = { kind: 'chat', userKey: 'u', chatKey: 'a' };
    const original = target, settings = { storyBlueprintEnabled: true };
    const ctx = { characters: [{ name: 'Alice', avatar: 'private.png' }], chatMetadata: { gd: {
        variables: { defs: [{ id: 'goal', label: 'Goal', scope: 'global', type: 'array' }, { id: 'mood', scope: 'character', type: 'string' }, { id: 'missing', scope: 'global', type: 'number', defaultValue: 50 }], values: { global: { goal: ['find clue'] }, character: { mood: { 'private.png': 'happy' } } }, log: [{ secret: 'not exported' }] },
        storyBlueprint: { blueprint: { title: 'Story', meta: { secret: 'not exported' }, nodes: [{ id: 'a', title: 'Act', type: 'act', content: { objective: 'clue' }, children: [{ id: 'b', title: 'Scene', content: { text: 'scene content' }, children: [] }] }] }, doneSignals: [{ nodeId: 'b', stepIndex: 0, chatLength: 999, reason: 'not exported' }], continuePending: true },
    } } };
    const port = createProviderPort({ getContext: () => ctx, getSettings: () => settings, extensionKey: 'gd' });
    const module = createProviderModule({ providerPort: port, currentTarget: () => target });
    function read(id, args = {}, runId = 'r') {
        const result = module.handlers['muyu.provider.read']({ id, selector: '', revision: '', offset: 0, ...args }, { runId, target: original });
        validateJson(module.registry.get('muyu.provider.read').outputSchema, result); return result;
    }
    return { ctx, settings, port, module, read, original, switch() { target = { ...target, chatKey: 'b' }; } };
}
test('Variables expose stored values without defaults, avatar IDs, mutation or old broad authorization', () => {
    const f = fixture(), before = structuredClone(f.ctx), d = f.read('variables');
    assert.equal(d.status, 'ok'); assert.match(d.text, /chat-global/); assert.doesNotMatch(d.text, /private.png|find clue|not exported/);
    const v = f.read('variables', { selector: 'item:0', revision: d.revision });
    assert.deepEqual(JSON.parse(v.text).value, ['find clue']);
    const c = f.read('variables', { selector: 'item:1', revision: d.revision }); assert.equal(JSON.parse(c.text).character, 'Alice'); assert.doesNotMatch(c.text, /private.png/);
    const missing = JSON.parse(f.read('variables', { selector: 'item:2', revision: d.revision }).text); assert.equal(missing.state, 'missing'); assert.ok(!Object.hasOwn(missing, 'value'));
    assert.deepEqual(f.ctx, before);
    const p = createPermissions(); for (const kind of ['chat', 'extended', 'diagnostics']) p.grant(kind, f.original);
    assert.equal(p.allows('source:variables', f.original), false); assert.equal(p.allows('source:storyBlueprint', f.original), false);
});
test('Variable diagnostics separate current definition, stored value, and bounded historical evidence without mutation', () => {
    const f = fixture(), vars = f.ctx.chatMetadata.gd.variables;
    vars.defs[1].locked = true; vars.defs[1].autoUpdate = false; vars.defs[1].updateMode = 'replace';
    vars.log = [
        { id: 'mood', target: 'private.png', ignored: true, outcomeCode: 'locked', reason: 'model claim', source: 'director', messageId: 3, time: '2026-01-01' },
        { id: 'mood', target: 'unknown.png', ignored: true, outcomeCode: 'unknown_character_target', reason: 'secret', source: 'director' },
        { id: 'mood', target: 'private.png', ignored: true, reason: 'old model claim', source: 'director' },
    ];
    const before = structuredClone(f.ctx), d = f.read('variableDiagnostics');
    assert.equal(d.status, 'ok'); assert.doesNotMatch(d.text, /private.png|model claim|happy/);
    assert.equal(JSON.parse(d.text).definitions.find(row => row.id === 'mood').unknownCharacterTargetAttempts, 1);
    const detail = f.read('variableDiagnostics', { selector: 'item:1', revision: d.revision });
    assert.equal(detail.status, 'ok'); const data = JSON.parse(detail.text);
    assert.equal(data.definition.locked, true); assert.equal(data.definition.autoUpdate, false);
    assert.equal(data.stored.value, 'happy'); assert.equal(data.unresolvedTarget.attemptsForDefinition, 1);
    assert.equal(data.unresolvedTarget.outcomeCode, 'unknown_character_target');
    assert.equal(data.unresolvedTarget.scope, 'definition-wide');
    assert.match(data.unresolvedTarget.resolutionRule, /case-insensitively/);
    assert.equal(data.recentAttempts[0].outcomeCode, 'locked'); assert.equal(data.recentAttempts[1].outcomeCode, 'unrecorded');
    assert.doesNotMatch(detail.text, /private.png|unknown.png|secret/);
    assert.deepEqual(f.ctx, before);
    const permissions = createPermissions(); permissions.grantSource('source:variables', f.original);
    assert.equal(permissions.allows('source:variableDiagnostics', f.original), false);
    permissions.grantSource('source:variableDiagnostics', f.original);
    assert.equal(permissions.allows('source:variableDiagnostics', f.original), true);
    f.ctx.chatMetadata.gd.variables.defs[1].locked = false;
    assert.equal(f.read('variableDiagnostics', { selector: 'item:1', revision: detail.revision }).status, 'STALE_SOURCE');
});
test('Blueprint lists hierarchy and reads one node, preserving saved signals without pruning or claiming progress', () => {
    const f = fixture(), before = structuredClone(f.ctx), d = f.read('storyBlueprint');
    assert.equal(d.status, 'ok'); const dir = JSON.parse(d.text); assert.equal(dir.savedSignalCount, 1); assert.equal(dir.nodes[1].parent, 0);
    const v = JSON.parse(f.read('storyBlueprint', { selector: 'node:1', revision: d.revision }).text);
    assert.equal(v.content.text, 'scene content'); assert.equal(v.savedSignals[0].chatLength, 999); assert.doesNotMatch(JSON.stringify(v), /not exported/);
    assert.deepEqual(f.ctx, before); assert.ok(!Object.hasOwn(v, 'complete'));
});
test('Story sources distinguish empty, disabled, unsupported, bad selectors and oversized directories', () => {
    const f = fixture(); f.ctx.chatMetadata = {};
    assert.equal(f.read('variables').status, 'empty'); assert.equal(f.read('storyBlueprint').status, 'empty'); assert.deepEqual(f.ctx.chatMetadata, {});
    f.settings.storyBlueprintEnabled = false; assert.equal(f.read('storyBlueprint').status, 'SOURCE_DISABLED');
    const g = fixture(); g.ctx.chatMetadata.gd.variables.values = null; assert.equal(g.read('variables').status, 'SOURCE_UNSUPPORTED');
    const h = fixture(); h.ctx.chatMetadata.gd.variables.defs = Array(257).fill({}); assert.equal(h.read('variables').status, 'SOURCE_TOO_LARGE');
    assert.equal(h.read('storyBlueprint', { selector: '../x' }).status, 'INVALID_SELECTOR');
    h.ctx.chatMetadata.gd.storyBlueprint.blueprint.nodes[0].children.push(h.ctx.chatMetadata.gd.storyBlueprint.blueprint.nodes[0]);
    assert.equal(h.read('storyBlueprint').status, 'SOURCE_UNSUPPORTED');
});
test('Opaque selectors reject stale identities, pagination rejects changed values and targets, budget remains bounded', () => {
    const f = fixture(), d = f.read('variables'); f.ctx.chatMetadata.gd.variables.defs.reverse();
    assert.equal(f.read('variables', { selector: 'item:0', revision: d.revision }).status, 'STALE_SOURCE');
    const g = fixture(); g.ctx.chatMetadata.gd.variables.values.global.goal = ['x'.repeat(16000)];
    g.module.bindRun('r', 6000); const dir = g.read('variables'), first = g.read('variables', { selector: 'item:0', revision: dir.revision }); assert.equal(first.nextOffset, 2000);
    let page = first; while (page.status === 'ok' && page.nextOffset >= 0) page = g.read('variables', { selector: 'item:0', revision: page.revision, offset: page.nextOffset });
    assert.equal(page.status, 'BUDGET_EXCEEDED');
    const h = fixture(), hd = h.read('variables'), hv = h.read('variables', { selector: 'item:0', revision: hd.revision });
    h.ctx.chatMetadata.gd.variables.values.global.goal.push('changed'); assert.equal(h.read('variables', { selector: 'item:0', revision: hv.revision }).status, 'STALE_SOURCE');
    h.switch(); assert.equal(h.read('variables').status, 'TARGET_UNAVAILABLE');
});

test('Node content pagination preserves complete JSON and Unicode; changed node identity invalidates selectors', () => {
    const f = fixture(), body = '内容😀'.repeat(900);
    f.ctx.chatMetadata.gd.storyBlueprint.blueprint.nodes[0].content = { text: body };
    const d = f.read('storyBlueprint'); let page = f.read('storyBlueprint', { selector: 'node:0', revision: d.revision }), output = page.text;
    while (page.nextOffset >= 0) {
        page = f.read('storyBlueprint', { selector: 'node:0', revision: page.revision, offset: page.nextOffset });
        assert.equal(page.status, 'ok'); output += page.text;
    }
    assert.equal(JSON.parse(output).content.text, body);
    const g = fixture(), gd = g.read('storyBlueprint'); g.ctx.chatMetadata.gd.storyBlueprint.blueprint.nodes[0].id = 'replacement';
    assert.equal(g.read('storyBlueprint', { selector: 'node:0', revision: gd.revision }).status, 'STALE_SOURCE');
});

test('Story values reject non-JSON and excessive detail without forwarding unsupported data', () => {
    const f = fixture(), d = f.read('variables'); f.ctx.chatMetadata.gd.variables.values.global.goal = { get secret() { throw Error('accessor must not run'); } };
    assert.equal(f.read('variables', { selector: 'item:0', revision: d.revision }).status, 'SOURCE_UNSUPPORTED');
    const g = fixture(), gd = g.read('storyBlueprint'); g.ctx.chatMetadata.gd.storyBlueprint.blueprint.nodes[0].content = { text: 'x'.repeat(32769) };
    assert.equal(g.read('storyBlueprint', { selector: 'node:0', revision: gd.revision }).status, 'SOURCE_UNSUPPORTED');
});
