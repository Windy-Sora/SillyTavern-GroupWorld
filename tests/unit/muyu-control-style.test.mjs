import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
const settingsHtml = readFileSync(new URL('../../settings.html', import.meta.url), 'utf8');
const rule = selector => {
    const start = css.indexOf(selector + ' {');
    assert.ok(start >= 0, selector);
    return css.slice(start, css.indexOf('}', start));
};

test('Muyu text controls inherit the conversation font and keep code-specific fonts separate', () => {
    const button = rule('.gd-muyu-panel .menu_button');
    assert.match(button, /font-family: inherit/);
    assert.match(button, /font-weight: 500/);
    assert.match(button, /line-height: 1\.4/);
    assert.match(rule('.gd-muyu-panel :is(input, select)'), /font-family: inherit/);
    assert.match(rule('.gd-muyu-web-install-command'), /font-family: monospace/);
});

test('Floating-ball visibility has one mount beside Summon Muyu, with compact wrapping controls', () => {
    assert.equal((settingsHtml.match(/id="gd-muyu-root"/g) || []).length, 1);
    const rowStart = settingsHtml.indexOf('class="gd-dashboard-assistant-row"');
    const rowEnd = settingsHtml.indexOf('class="gd-dashboard-rule"', rowStart);
    const row = settingsHtml.slice(rowStart, rowEnd);
    assert.ok(row.indexOf('id="gd-muyu-root"') > row.indexOf('id="gd-dash-get-assistant"'));
    assert.ok(row.indexOf('id="gd-muyu-root"') < row.indexOf('class="gd-assistant-hint"'));
    assert.match(rule('.gd-dashboard-assistant-row'), /flex-wrap: wrap/);
    assert.match(rule('.gd-dashboard-assistant-row > #gd-muyu-root'), /margin: 0/);
    assert.match(rule('.gd-dashboard-assistant-row > #gd-muyu-root > label'), /min-height: 36px/);
    assert.match(rule('.gd-dashboard-assistant-row > #gd-muyu-root > small[hidden]'), /display: none/);
});

test('New conversation, refresh and return-to-latest have distinct compact visual roles', () => {
    const create = rule('.gd-muyu-panel .gd-muyu-history-sidebar > .gd-muyu-new-session');
    assert.match(create, /width: 100%/); assert.match(create, /font-size: \.9em/);
    assert.match(create, /justify-content: flex-start/); assert.match(create, /background: transparent/);
    const refresh = rule('.gd-muyu-panel .gd-muyu-history-sidebar > .gd-muyu-history-refresh');
    assert.match(refresh, /width: auto/); assert.match(refresh, /font-weight: 400/);
    assert.match(refresh, /border-color: transparent/);
    const latest = rule('.gd-muyu-panel .gd-muyu-return-latest');
    assert.match(latest, /border-radius: 999px/); assert.match(latest, /max-width: calc\(100% - 24px\)/);
    assert.match(latest, /font-weight: 400/);
    assert.ok(css.includes('@media (pointer: coarse)'));
    assert.ok(css.includes('.gd-muyu-history-refresh { min-height: 40px; }'));
});
