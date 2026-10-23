import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createConfigProfileSubject } from '../unit/helpers/config-profile-subject.mjs';
import { createProfileExportSystem } from '../../systems/profile-export-system.js';
import { createNpcExportSystem } from '../../systems/npc-export-system.js';

const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const world = 'SillyTavern-GroupWorld';
const director = 'SillyTavern-GroupDirector';

async function templateSubject(available) {
    const source = await read('ui/settings-init.js');
    const start = source.indexOf('const TEMPLATE_FOLDERS =');
    const end = source.indexOf('// Side-effect imports:', start);
    assert.ok(start >= 0 && end > start, 'exercise the actual template resolver');
    const calls = [];
    const context = vm.createContext({
        fetch: async path => {
            calls.push(['fetch', path]);
            return { ok: available.some(folder => path.includes(`/${folder}/`)) };
        },
        renderExtensionTemplateAsync: async (folder, name) => {
            calls.push(['render', folder, name]);
            return `<section>${folder}</section>`;
        },
    });
    vm.runInContext(`${source.slice(start, end)}; globalThis.load = renderSettingsTemplate;`, context);
    return { load: context.load, calls };
}

for (const available of [[world], [world, director]]) {
    test(`GW settings load from GW when available directories are ${available.join(', ')}`, async () => {
        const { load, calls } = await templateSubject(available);
        assert.equal(await load(), `<section>third-party/${world}</section>`);
        assert.deepEqual(calls, [
            ['fetch', `scripts/extensions/third-party/${world}/settings.html`],
            ['render', `third-party/${world}`, 'settings'],
        ]);
    });
}

test('GW settings keep the legacy directory fallback only after GW is unavailable', async () => {
    const { load, calls } = await templateSubject([director]);
    assert.equal(await load(), `<section>third-party/${director}</section>`);
    assert.deepEqual(calls.map(row => row[0]), ['fetch', 'fetch', 'render']);
    assert.equal(calls[0][1], `scripts/extensions/third-party/${world}/settings.html`);
    assert.equal(calls[1][1], `scripts/extensions/third-party/${director}/settings.html`);
});

test('missing templates do not fabricate an initialized settings panel', async () => {
    const { load, calls } = await templateSubject([]);
    assert.equal(await load(), undefined);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(row => row[0] === 'fetch'));
});

for (const available of [[world], [world, director]]) {
    test(`GW configuration preset prefers GW with ${available.length} available directories`, async t => {
        const preset = JSON.parse(await read('assets/profiles/group-world-default.json'));
        const calls = [];
        t.mock.method(globalThis, 'fetch', async path => {
            calls.push(path);
            return { ok: available.some(folder => path.includes(`/${folder}/`)), json: async () => structuredClone(preset) };
        });
        const { subject, settings } = createConfigProfileSubject({ autoMemoryInterval: 37 });
        assert.deepEqual(subject.getPresetNames(), ['group-world-default']);
        const result = await subject.loadPreset('group-world-default');
        assert.equal(result.name, 'Group World 默认配置');
        assert.deepEqual(calls, [`scripts/extensions/third-party/${world}/assets/profiles/group-world-default.json`]);
        assert.equal(settings.autoMemoryInterval, 37, 'loading a preset does not apply it');
    });
}

test('GW configuration preset retains the compatible fallback when the GW URL is absent', async t => {
    const preset = JSON.parse(await read('assets/profiles/group-world-default.json'));
    const calls = [];
    t.mock.method(globalThis, 'fetch', async path => {
        calls.push(path);
        return { ok: path.includes(`/${director}/`), status: 404, json: async () => structuredClone(preset) };
    });
    const { subject } = createConfigProfileSubject();
    await subject.loadPreset('group-world-default');
    assert.deepEqual(calls, [
        `scripts/extensions/third-party/${world}/assets/profiles/group-world-default.json`,
        `scripts/extensions/third-party/${director}/assets/profiles/group-world-default.json`,
    ]);
});

test('profile and NPC presets load their actual GW assets without using an installed GD copy', async t => {
    const calls = [];
    t.mock.method(globalThis, 'fetch', async path => {
        calls.push(path);
        assert.ok(path.startsWith(`scripts/extensions/third-party/${world}/assets/profiles/`));
        return { ok: true, text: () => read(`assets/profiles/${path.split('/').at(-1)}`) };
    });
    const profiles = createProfileExportSystem({ settings: {}, getProfiles: () => ({}) });
    const metadata = { 'group-director': { npcs: [] } };
    const npcs = createNpcExportSystem({ settings: {}, EXT_KEY: 'group-director', getChatMetadata: () => metadata });
    assert.equal((await profiles.loadPreset('fantasy-rpg')).ok, true);
    assert.equal((await npcs.loadPreset('npc-fantasy-tavern')).ok, true);
    assert.equal(calls.length, 2);
});

test('GW keeps product identity, compatibility entry points and newly assembled Muyu runtime', async () => {
    const manifest = JSON.parse(await read('manifest.json'));
    const pkg = JSON.parse(await read('package.json'));
    const lock = JSON.parse(await read('package-lock.json'));
    assert.equal(manifest.display_name, 'Group World');
    assert.equal(manifest.homePage, 'https://github.com/Windy-Sora/SillyTavern-GroupWorld');
    assert.equal(manifest.generate_interceptor, 'groupDirector_Interceptor');
    assert.equal(pkg.name, 'sillytavern-group-world');
    assert.equal(lock.name, pkg.name);
    assert.equal(lock.packages[''].name, pkg.name);
    assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies);
    const index = await read('index.js');
    assert.match(index, /window\.GroupDirector\s*=/);
    assert.match(index, /getMuyuProviders: getProviders/);
    assert.match(index, /muyuOwner: \{\}/);
    const section = await read('ui/sections/muyu.js');
    assert.match(section, /registerSection\('muyu'/);
    assert.match(section, /owner\.floating = createFloatingShell\(/);
    const settings = await read('settings.js');
    assert.match(settings, /EXT_KEY\s*=\s*'group-director'/);
    const init = await read('ui/settings-init.js');
    assert.match(init, /import '\.\/sections\/muyu\.js'/);
    assert.match(init, /PRODUCT_IDENTITY\.displayName/);
    assert.match(init, /— 群聊导演/);
    assert.match(init, /__gdMuyuDispose\?\.\(\)/);
});

test('Muyu skill, assistant and feather resources resolve relative to the installed GW modules', async () => {
    const skills = await read('muyu/skills/builtin-loader.js');
    const assistant = await read('ui/sections/gdAssistant.js');
    const shell = await read('ui/floating/shell.js');
    assert.match(skills, /new URL\('\.\.\/\.\.\/assets\/muyu-skills\/', import\.meta\.url\)/);
    assert.match(assistant, /new URL\('\.\.\/\.\.\/assets\/gd-assistant', import\.meta\.url\)/);
    assert.match(shell, /new URL\('\.\.\/\.\.\/assets\/muyu-floating-feather\.svg', import\.meta\.url\)/);
    assert.match(await read('assets/muyu-floating-feather.svg'), /<svg/);
});
