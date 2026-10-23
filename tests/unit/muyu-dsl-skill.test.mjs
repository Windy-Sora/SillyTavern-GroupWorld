import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as rawReadFile } from 'node:fs/promises';
const readFile = async (...args) => { const data = await rawReadFile(...args); return typeof data === 'string' ? data.replace(/\r\n/g, '\n') : data; };
import { loadBuiltinSkills } from '../../muyu/skills/builtin-loader.js';
import { renderPrompt } from '../../prompt-renderer.js';
import { providers, registerProvider } from '../../provider-registry.js';
import { createSkillPort } from '../../muyu/host/skills.js';
import { createSkillTaskRuntime } from '../../muyu/skills/task-runtime.js';
import { skillDisplay } from '../../muyu/ui/catalog-labels.js';
import { identity } from './helpers/muyu-subject.mjs';

const readText = path => readFile(new URL(`../../assets/muyu-skills/${path}`, import.meta.url), 'utf8');
const examples = JSON.parse(await readText('dsl-template-workbench/references/examples.json'));
const source = (await readText('provider-workbench/references/structured-template.md')).match(/```js\n([\s\S]*?)\n```/)[1];
const sample = await import('data:text/javascript,' + encodeURIComponent(source));

for (const [index, example] of examples.cases.entries()) test('Shipped Provider source and DSL example render as documented / ' + index, async t => {
    const previous = new Map(providers); providers.clear();
    t.after(() => { providers.clear(); for (const [id, provider] of previous) providers.set(id, provider); });
    let renders = 0;
    sample.register({ registerProvider: value => registerProvider({ ...value, render: (...args) => { renders++; return value.render(...args); } }) });
    assert.equal(await renderPrompt(example.template, {}), example.expected);
    assert.equal(renders, 1, 'even raw text protection does not skip registered Provider execution');
});

test('Documented avatar identity recipes preserve punctuation and zero without a data wrapper', async t => {
    const previous = new Map(providers); providers.clear();
    t.after(() => { providers.clear(); for (const [id, provider] of previous) providers.set(id, provider); });
    registerProvider({ id: 'vars', placeholder: '{{vars}}', render: () => ({ content: '', data: { currentCharacter: 'alice.png', character: { hp: { values: { 'alice.png': 0 } } } } }) });
    assert.equal(await renderPrompt('{{?vars:character.hp.values["alice.png"]|未提供}}', {}), '0');
    assert.equal(await renderPrompt('{{?vars:character.hp.values["{{?vars:currentCharacter}}"]|未提供}}', {}), '0');
});

test('Technical Skill resources load progressively without grants, persistence or eager body projection', async () => {
    let writes = 0;
    const settings = {}, port = createSkillPort({ getSettings: () => settings, saveSettings: async () => { writes++; }, loadBuiltins: () => loadBuiltinSkills({ readText }) });
    await port.ready(); const initialWrites = writes;
    let offset = 0, row;
    do { const page = await port.catalog(offset); row ||= page.entries.find(item => item.id === 'builtin:dsl-template-workbench'); offset = page.nextOffset; } while (offset !== -1);
    assert.ok(row); assert.equal(skillDisplay({ ...row, source: 'builtin' }, 'en').displayName, 'DSL and structured templates');
    const runtime = createSkillTaskRuntime({ port, charge: () => true }); runtime.bindRun(identity); await runtime.prepare(identity.id);
    const query = { id: row.id, revision: String(row.revision), path: 'SKILL.md' };
    const main = await runtime.load(identity.id, query);
    assert.equal(main.permissionGranted, false);
    assert.deepEqual(runtime.usage(identity.id)[0].paths, ['SKILL.md']);
    const syntax = await runtime.load(identity.id, { ...query, path: 'references/syntax.md' });
    assert.equal(syntax.complete, true); assert.equal(syntax.permissionGranted, false);
    assert.deepEqual(runtime.usage(identity.id)[0].paths, ['SKILL.md', 'references/syntax.md']);
    assert.equal(writes, initialWrites);
});
