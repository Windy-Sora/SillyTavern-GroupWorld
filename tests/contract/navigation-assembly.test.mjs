import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { FEATURES, routeForCard } from '../../ui/navigation-model.js';
const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('preview entry is disabled even for stored preferences, with utility entries below the dashboard', async () => {
    const shell = await read('ui/navigation-shell.js');
    assert.match(shell, /const PREVIEW_NAVIGATION_ENABLED = false;/);
    assert.match(shell, /if \(!PREVIEW_NAVIGATION_ENABLED\) state\.layout = 'classic';/);
    assert.match(shell, /switchLabel\.hidden = !PREVIEW_NAVIGATION_ENABLED;/);
    assert.match(shell, /const onLayout = \(\) => \{\s*if \(!PREVIEW_NAVIGATION_ENABLED\) return;/);
    assert.match(shell, /dashboard\.after\(bar\)/);
    const html = await read('settings.html');
    assert.ok(html.indexOf('id="gd-muyu-root"') > html.indexOf('id="gd-dash-import-group-file"'));
    const css = await read('style.css');
    assert.match(css, /\.gd-ui-switchbar label\[hidden\]\s*\{ display: none; \}/);
});

test('command board routes exist and uses shared actions with explicit lifecycle cleanup', async () => {
    const board = await read('ui/command-board.js');
    for (const id of ['rules', 'agents', 'ledger', 'profile', 'memory', 'summary', 'storyBlueprint', 'npc', 'variables', 'worldbooks', 'config-profile']) {
        assert.ok(FEATURES.some(f => f.id === id), id);
    }
    assert.match(board, /await deps\.runQuickAction\(button\.dataset\.boardAction\)/);
    assert.match(board, /actions\.subscribe\(render\)/);
    assert.match(board, /unsubscribe\(\)/);
    assert.match(board, /languageAnchor\.replaceWith\(language\)/);
    assert.match(board, /removeEventListener\('click', onClick\)/);
    assert.doesNotMatch(board, /setTimeout|setInterval|\.trigger\(|innerHTML\s*=/);
    const shell = await read('ui/navigation-shell.js');
    assert.match(shell, /navigate\(id, \{ returnTo: 'overview' \}\)/);
    assert.match(shell, /scroller\.scrollTop = boardScroll/);
});

test('overview disclosure overrides the host min-content button width and remains bounded', async () => {
    const css = await read('style.css');
    const rule = css.match(/\.gd-ui-preview \.gd-ui-dashboard-toggle\s*\{([^}]+)\}/)?.[1];
    assert.ok(rule);
    assert.match(rule, /width:\s*fit-content\s*;/);
    assert.match(rule, /max-width:\s*100%\s*;/);
    assert.match(rule, /box-sizing:\s*border-box\s*;/);
    assert.match(rule, /display:\s*flex\s*;/);
    assert.match(css, /\.gd-ui-dashboard-toggle\[hidden\]\s*\{\s*display:\s*none;/);
});

test('every preview route resolves to an existing template control and all legacy cards have a route', async () => {
    const html = await read('settings.html');
    for (const f of FEATURES) {
        if (f.selector.startsWith('#')) assert.ok(html.includes(`id="${f.selector.slice(1)}"`), f.id);
        else if (f.selector.startsWith('[data-card=')) assert.ok(html.includes(f.selector.slice(1, -1)), f.id);
        else assert.ok(html.includes(f.selector.slice(1)), f.id);
    }
    const cards = [...html.matchAll(/data-card="([^"]+)"/g)].map(m => m[1]);
    assert.equal(cards.length, 29);
    for (const card of cards) assert.ok(routeForCard(card), card);
});

test('preview only changes presentation and never remounts or clones business controls', async () => {
    const shell = await read('ui/navigation-shell.js');
    assert.doesNotMatch(shell, /initAllSections|reloadSettingsUI|cloneNode|saveSettings|\.trigger\(/);
    assert.doesNotMatch(shell, /innerHTML\s*=/);
    assert.match(shell, /root\.classList\.toggle\('gd-ui-preview'/);
    assert.match(shell, /removeEventListener\('click', onShortcut, true\)/);
    assert.match(shell, /observer\?\.disconnect\(\)/);
});

test('settings reload preserves the active navigation session and disposes its listeners first', async () => {
    const init = await read('ui/settings-init.js');
    const reload = init.slice(init.indexOf('export async function reloadSettingsUI'));
    assert.ok(reload.indexOf('navigation?.getState()') < reload.indexOf('$panel.empty()'));
    assert.ok(reload.indexOf('navigation?.dispose()') < reload.indexOf('$panel.empty()'));
    assert.match(reload, /attachNavigation\(.*deps, navigationState\)/);
    const dashboard = await read('ui/sections/dashboard.js');
    assert.match(dashboard, /if \(navigation\?\.openCard\(cardName\)\) return/);
});
