import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsModule } from '../../muyu/modules/settings/index.js';
import { createSkillModule } from '../../muyu/modules/skills/index.js';
import { createSkillPort } from '../../muyu/host/skills.js';
import { skillEditorPackage } from '../../muyu/skills/editor.js';
import { configFields, configDomains, fieldDefinition } from '../../muyu/config/registry.js';
import { DEFAULT_SETTINGS } from '../../settings.js';
import { validateJson } from '../../muyu/core/json-contract.js';

const target = { kind: 'global', userKey: 'navigation-test' };
const ctx = { target, runId: 'navigation-test', signal: new AbortController().signal };
const parsed = value => JSON.parse(value.text);
function assertCall(module, call) {
    const definition = module.registry.get(call.toolId);
    assert.ok(definition, call.toolId);
    validateJson(definition.inputSchema, call.args);
}
test('Domain catalog is static, omits unrelated labels, and gives executable read/contract parameter hints', () => {
    let reads = 0;
    const module = createSettingsModule({ getSettings: () => { reads++; return DEFAULT_SETTINGS; }, getTarget: () => target });
    const full = parsed(module.handlers['muyu.settings.catalog']({}, ctx));
    for (const domain of configDomains) {
        const data = parsed(module.handlers['muyu.settings.catalog']({ domain }, ctx));
        assert.equal(reads, 0);
        const fields = configFields.filter(id => fieldDefinition(id).domain === domain);
        assert.equal(data.coverage, 'requested-domain-only');
        assert.equal(data.fieldCount, fields.length);
        assert.equal(data.totalFieldCount, configFields.length);
        assert.equal(data.totalDomainCount, configDomains.length);
        assert.deepEqual(Object.keys(data.labels), fields);
        assert.deepEqual(data.supported, [{ domain, fields }]);
        assert.ok(Buffer.byteLength(JSON.stringify(data)) < Buffer.byteLength(JSON.stringify(full)));
        assert.match(data.interpretation, /not read values/);
        for (const call of Object.values(data.nextCalls)) assertCall(module, call);
        const output = module.handlers['muyu.settings.catalog']({ domain }, ctx);
        validateJson(module.registry.get('muyu.settings.catalog').outputSchema, output);
        assert.ok(Buffer.byteLength(JSON.stringify(output)) <= 32768);
    }
    const data = parsed(module.handlers['muyu.settings.catalog']({ domain: 'memory' }, ctx));
    const read = data.nextCalls.read, contract = data.nextCalls.contract;
    assert.deepEqual(parsed(module.handlers[read.toolId](read.args, ctx)).fields, data.supported[0].fields);
    assert.deepEqual(parsed(module.handlers[contract.toolId](contract.args, ctx)).map(row => row.id), data.supported[0].fields);
    assert.throws(() => module.handlers['muyu.settings.catalog']({ domain: 'unknown' }, ctx), /INVALID_CATALOG_QUERY/);
    assert.equal(full.fieldCount, configFields.length); // Existing {} catalog contract retained.
    module.dispose();
});

test('Skill management uses exact listed revisions and host-returned offsets; complete pages have no next call', async () => {
    const settings = {}; let saves = 0;
    const port = createSkillPort({ getSettings: () => settings, saveSettings: async () => { saves++; }, loadBuiltins: async () => [] });
    await port.ready();
    for (let i = 0; i < 17; i++) await port.save(port.preview({ operation: 'create', expectedRevision: i, enabled: i % 2 === 0,
        package: skillEditorPackage({ name: `navigation-${i}`, description: 'Navigation test', body: i === 0 ? '资料。'.repeat(4000) : 'No permissions.', modelInvocable: i % 3 !== 0 }) }));
    const module = createSkillModule({ port, charge: () => true });
    const before = JSON.stringify(settings), saveCount = saves;
    const first = parsed(await module.handlers['muyu.skills.list']({}, ctx));
    const firstOutput = await module.handlers['muyu.skills.list']({}, ctx);
    validateJson(module.registry.get('muyu.skills.list').outputSchema, firstOutput);
    assert.ok(Buffer.byteLength(JSON.stringify(firstOutput)) <= 32768);
    assert.equal(first.entries.length, 16); assert.equal(first.nextOffset, 16);
    assertCall(module, first.nextCall);
    const last = parsed(await module.handlers[first.nextCall.toolId](first.nextCall.args, ctx));
    assert.equal(last.entries.length, 1); assert.equal(last.nextOffset, -1); assert.equal(last.nextCall, undefined);
    const rows = [...first.entries, ...last.entries];
    assert.ok(rows.some(row => !row.enabled)); // Management, not enabled-only guidance.
    const row = rows.find(row => row.id === 'user:navigation-0');
    assert.deepEqual(row.readCall.args, { id: row.id, revision: row.revision, offset: 0 });
    let call = row.readCall, result, text = '', pages = 0;
    do {
        assertCall(module, call);
        result = parsed(await module.handlers[call.toolId](call.args, ctx));
        text += result.text; pages++;
        if (result.nextCall) {
            assert.equal(result.nextCall.args.revision, row.revision);
            assert.equal(result.nextCall.args.offset, result.nextOffset);
        }
        call = result.nextCall;
    } while (call);
    assert.ok(pages > 1); assert.equal(result.nextOffset, -1);
    assert.deepEqual(JSON.parse(text), (await port.inspect(row.id, Number(row.revision))).package);
    await assert.rejects(module.handlers['muyu.skills.read']({ ...row.readCall.args, revision: '999' }, ctx), /SKILL_STALE/);
    assert.equal(JSON.stringify(settings), before); assert.equal(saves, saveCount);
    module.dispose();
});
