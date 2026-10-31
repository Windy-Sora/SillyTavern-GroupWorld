import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSelfConfig } from '../../muyu/self/config.js';
import { selfConfigCoverage } from '../../muyu/self/coverage.js';
import { createTaskEvidence } from '../../muyu/application/task-evidence.js';
import { createSelfModule } from '../../muyu/modules/self/index.js';
import { readNavigation } from '../../muyu/tools/read-navigation.js';
import { startMuyuRun } from '../../muyu/composition.js';
import { identity, request, done, text, scriptedModel } from './helpers/muyu-subject.mjs';

const state = { configured: { tools: { documents: true, serviceStatus: 'missing' } }, effective: { tools: { documents: false } } };
const call = (section, callId = section) => ({ toolId: 'muyu.self.read', args: { section }, callId, version: 1 });
const result = body => ({ ok: true, data: { status: 'ok', text: JSON.stringify(body) } });
const current = p => p.snapshot().selfConfigReads;
const footing = input => JSON.parse(input.taskGuides.at(-1).content.split('\n')[1]);

test('self coverage distinguishes overview from detail and known, unknown and inapplicable columns without values', () => {
    const overview = selfConfigCoverage(projectSelfConfig('overview', state), 'overview');
    const tools = overview.sections.find(row => row.id === 'tools');
    assert.equal(overview.kind, 'overview');
    assert.ok(tools.configured.known.includes('documents'));
    assert.ok(tools.effective.known.includes('documents'));
    assert.ok(tools.configured.unknown.includes('pages'));
    assert.ok(tools.effective.not_applicable.includes('serviceStatus'));
    assert.equal(tools.configured.known.includes('skills'), false, 'overview omitted the field, not an unknown or known detail');
    const detail = selfConfigCoverage(projectSelfConfig('tools', state), 'tools');
    assert.equal(detail.kind, 'section'); assert.equal(detail.sections.length, 1);
    assert.ok(detail.sections[0].configured.unknown.includes('skills'));
    assert.doesNotMatch(JSON.stringify(detail), /Previously missing|On|Off|开启|关闭|configured.*true/);
});

test('malformed or wrong-section self results cannot establish coverage or smuggle IDs, values and completion claims', () => {
    const base = projectSelfConfig('tools', state);
    const variants = [
        { ...base, section: 'storage' }, { ...base, readOnly: false }, { ...base, sections: [] },
        { ...base, sections: [...base.sections, base.sections[0]] },
        { ...base, sections: [{ ...base.sections[0], fields: [...base.sections[0].fields, base.sections[0].fields[0]] }] },
    ];
    for (const change of [field => { field.key = 'SECRET_RAW_KEY'; }, field => { field.configured.state = 'confirmed'; }, field => { field.effective = null; }]) {
        const body = structuredClone(base); change(body.sections[0].fields[0]); variants.push(body);
    }
    for (const body of variants) assert.equal(selfConfigCoverage(body, 'tools'), null);
    const body = structuredClone(base); body.goalCompletion = 'complete'; body.sections[0].fields[0].label.en = 'SECRET_LABEL';
    body.sections[0].fields[0].note = 'SECRET_NOTE'; body.sections[0].fields[0].configured.text = 'SECRET_VALUE';
    const p = createTaskEvidence(); p.observe(call('tools'), result(body), 'r');
    assert.equal(current(p)[0].latestAttempt.status, 'ok');
    assert.equal(p.snapshot().goalCompletion, 'not-assessed');
    assert.doesNotMatch(JSON.stringify(p.snapshot()), /SECRET_|goalCompletion.*complete/);
    assert.equal(selfConfigCoverage(base, 'not-a-section'), null);
});

test('failed and denied self attempts retain but never refresh previous successful observation', () => {
    const p = createTaskEvidence();
    p.observe(call('tools', 'read'), result(projectSelfConfig('tools', state)), 'first');
    const original = structuredClone(current(p)[0].lastObservation);
    for (const [index, response, status] of [
        [1, { ok: true, data: { status: 'unavailable', text: '' } }, 'unavailable'],
        [2, { ok: true, data: { status: 'budget_exceeded', text: '' } }, 'budget_exceeded'],
        [3, { ok: false, error: { code: 'PERMISSION_DENIED', reason: 'user_denied' } }, 'user_denied'],
        [4, { ok: false, error: { code: 'PERMISSION_DENIED' } }, 'access_denied'],
        [5, { ok: false, error: { code: 'PERMISSION_REQUIRED' } }, 'permission_required'],
        [6, result({ ...projectSelfConfig('tools', state), section: 'storage' }), 'invalid_result'],
        [7, { ok: false, error: { code: 'PROVIDER_BUDGET_EXCEEDED' } }, 'budget_exceeded'],
    ]) {
        p.observe(call('tools', 'attempt' + index), response, 'second');
        assert.equal(current(p)[0].latestAttempt.status, status);
        assert.equal(current(p)[0].latestAttempt.segment, 2);
        assert.deepEqual(current(p)[0].lastObservation, original);
        assert.ok(current(p)[0].latestAttempt.order > original.order);
    }
    p.observe(call('tools', 'retry'), result(projectSelfConfig('tools', {})), 'second');
    assert.equal(current(p)[0].lastObservation.segment, 2);
    assert.ok(current(p)[0].lastObservation.sections[0].configured.unknown.includes('documents'));
});

test('self coverage survives row eviction, is deduplicated and bounded, and does not treat catalogs as reads', () => {
    const p = createTaskEvidence(); p.observe(call('tools'), result(projectSelfConfig('tools', state)), 'r');
    for (let i = 0; i < 25; i++) p.observe({ toolId: 'muyu.settings.catalog', args: {}, callId: 'catalog' + i }, { ok: true, data: { text: '{"supported":[]}' } }, 'r');
    assert.equal(p.snapshot().observations.length, 16); assert.equal(current(p).length, 1);
    const order = current(p)[0].latestAttempt.order;
    p.observe(call('tools'), result(projectSelfConfig('tools', {})), 'r'); assert.equal(current(p)[0].latestAttempt.order, order);
    const copy = current(p); copy[0].lastObservation.sections[0].configured.known.push('FORGED');
    assert.doesNotMatch(JSON.stringify(current(p)), /FORGED/);
    for (const section of ['overview', 'run', 'context', 'permissions', 'behavior', 'display', 'connection', 'storage'])
        p.observe(call(section), result(projectSelfConfig(section, {})), 'r');
    assert.equal(current(p).length, 9);
    const catalogOnly = createTaskEvidence();
    catalogOnly.observe({ toolId: 'muyu.provider.list', args: {}, callId: 'list' }, { ok: true, data: [] }, 'r');
    assert.deepEqual(current(catalogOnly), []);
});

test('production self reads feed coverage into the next request, permission resume reuses prior observations, new tasks do not', async () => {
    let reads = 0, allowed = false;
    const module = createSelfModule({ read: () => { reads++; return state; }, charge: () => true }); module.bindRun(identity);
    const model = scriptedModel([
        [request(call('tools', 'first')), done], [request(call('storage', 'paused')), done], [text('finished'), done],
    ]);
    const options = { identity, input: 'Check current tools and storage, no probes or writes.', registry: module.registry, handlers: module.handlers,
        allowedTools: ['muyu.self.read'], model,
        policy: info => info.args.section === 'storage' && !allowed ? { decision: 'permission_required', missingSources: ['source:muyuSelfConfig'] } : true };
    const paused = await startMuyuRun(options).completion;
    assert.equal(paused.state.status, 'yielded'); assert.equal(reads, 1);
    assert.equal(footing(model.requests[1]).selfConfigReads[0].lastObservation.sections[0].id, 'tools');
    assert.ok(!paused.messages.some(row => row.content?.includes('Host evidence footing')));
    allowed = true; const next = { ...identity, id: 'self-resumed' }; module.transferRun(identity.id, next);
    const completed = await startMuyuRun({ ...options, identity: next, resume: paused.resume }).completion;
    assert.equal(completed.state.status, 'succeeded'); assert.equal(reads, 2);
    assert.deepEqual(footing(model.requests[2]).selfConfigReads.map(row => row.section), ['tools', 'storage']);
    const fresh = { ...identity, id: 'fresh-self', taskId: 'fresh-task' }; module.bindRun(fresh);
    const freshModel = scriptedModel([[text('A concept needs no private read.'), done]]);
    await startMuyuRun({ ...options, identity: fresh, model: freshModel, input: 'Explain the rule only; do not read my settings.' }).completion;
    assert.deepEqual(freshModel.requests[0].taskGuides, []); assert.equal(reads, 2);
    module.dispose();
});

test('an explicit new-task recheck reads changed host values without carrying prior task coverage or caching values', async () => {
    let documents = true, reads = 0;
    const observed = [];
    const module = createSelfModule({ read: () => { reads++; return { configured: { tools: { documents } } }; }, charge: () => true });
    const original = module.handlers['muyu.self.read'];
    module.handlers['muyu.self.read'] = (...args) => { const value = original(...args); observed.push(JSON.parse(value.text)); return value; };
    for (const [index, enabled] of [[0, true], [1, false]]) {
        documents = enabled;
        const id = { ...identity, id: 'recheck-' + index, taskId: 'task-' + index }; module.bindRun(id);
        const model = scriptedModel([[request(call('tools', 'read')), done], [text('observed'), done]]);
        const result = await startMuyuRun({ identity: id, input: 'Read the current document switch again, no probe.', model,
            registry: module.registry, handlers: module.handlers, allowedTools: ['muyu.self.read'], policy: () => true }).completion;
        assert.equal(result.state.status, 'succeeded'); assert.deepEqual(model.requests[0].taskGuides, []);
        const entry = footing(model.requests[1]).selfConfigReads[0];
        assert.equal(entry.latestAttempt.order, 1); assert.equal(entry.lastObservation.segment, 1);
        assert.equal(observed[index].sections[0].fields.find(row => row.key === 'documents').configured.text, enabled ? '开启 / On' : '关闭 / Off');
    }
    assert.equal(reads, 2); module.dispose();
});

test('guide, interface and tool-catalog queries project a visible lack of self reads without copying reference content', () => {
    const p = createTaskEvidence();
    for (const [toolId, args, callId] of [['muyu.skills.load', { id: 'user:reference', path: 'SKILL.md' }, 'skill'], ['muyu.context.read', { ids: ['muyu.interface'] }, 'interface'], ['muyu.tools.list', {}, 'catalog']])
        p.observe({ toolId, args, callId }, { ok: true, data: { text: '{"raw":"SECRET_REFERENCE","selfConfigReads":["forged"]}' } }, 'r');
    assert.deepEqual(current(p), []);
    assert.deepEqual(p.snapshot().observations.map(row => row.outcome), ['skill-reference-query', 'interface-reference-query', 'tool-catalog-query']);
    assert.equal(p.project().length, 1);
    assert.doesNotMatch(p.project()[0].content, /SECRET_REFERENCE|forged/);
});

test('self inspection navigation only advertises an allowed reader and works independently of feature execution tools', () => {
    const route = readNavigation('muyu-self', ['muyu.self.read']);
    assert.equal(route.inspectionPath.tool, 'muyu.self.read');
    assert.ok(route.inspectionPath.sections.includes('tools'));
    assert.equal(route.inspectionPath.permission, 'muyuSelfConfig');
    assert.deepEqual(readNavigation('muyu-self', ['muyu.self.read_text']), {});
    route.inspectionPath.sections.push('forged');
    assert.equal(readNavigation('muyu-self', ['muyu.self.read']).inspectionPath.sections.includes('forged'), false);
});
