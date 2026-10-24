import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parse } from 'acorn';
import { parseOptions } from '../../tools/gd-test/core/options.mjs';
import { parseTestSummary } from '../../tools/gd-test/core/test-runner.mjs';
import { printReport } from '../../tools/gd-test/reporters/console.mjs';

function capture(t) {
    const rows = [];
    t.mock.method(console, 'log', (...args) => rows.push(args.join(' ')));
    t.mock.method(console, 'error', (...args) => rows.push(args.join(' ')));
    return rows;
}
function stage(overrides = {}) {
    return { name: 'tests', ok: true, durationMs: 8, exitCode: 0, timedOut: false, matchedTests: 2,
        counts: { tests: 2, pass: 2, fail: 0, cancelled: 0, skipped: 0, todo: 0 },
        files: [{ file: 'example.test.mjs' }],
        bugCoverage: { required: ['BUG-1'], found: ['BUG-1'], missing: [] },
        output: '✔ PASS_MARKER one\n✔ PASS_MARKER two\nℹ tests 2\nℹ pass 2\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0',
        ...overrides };
}
function report(value) { return { ok: value.ok, durationMs: 10, stages: [value] }; }

test('Summary option is explicit and cancellation counts remain observable', () => {
    assert.equal(parseOptions(['full', '--summary'], {}).summary, true);
    assert.equal(parseOptions([], {}).summary, false);
    assert.equal(parseOptions(['--summary', '--verbose'], {}).verbose, true);
    assert.equal(parseTestSummary('ℹ tests 17\nℹ pass 0\nℹ fail 1\nℹ cancelled 16\nℹ skipped 0\nℹ todo 0').cancelled, 16);
});

test('Successful summary output hides passing lines without changing full report output', t => {
    const rows = capture(t), value = stage(), before = JSON.stringify(value);
    printReport(report(value), { summary: true });
    const output = rows.join('\n');
    assert.match(output, /2 tests, 2 passed, 0 failed, 0 cancelled/);
    assert.match(output, /regression-contracts.*PASS/);
    assert.match(output, /Result: PASS/);
    assert.doesNotMatch(output, /PASS_MARKER/);
    assert.equal(JSON.stringify(value), before);
    assert.match(JSON.stringify(report(value)), /PASS_MARKER/);
});

test('Failure summary preserves names, locations and diagnostic stacks but omits passing noise', t => {
    const rows = capture(t);
    const detail = '✖ failing tests:\n\ntest at example.test.mjs:7:1\n✖ broken\n  AssertionError: EXPECTED_FAILURE\n    at example.test.mjs:8:3';
    const value = stage({ ok: false, exitCode: 1, counts: { tests: 2, pass: 1, fail: 1, cancelled: 0, skipped: 0, todo: 0 },
        output: '✔ PASS_MARKER\n✖ broken\nℹ tests 2\n' + detail });
    printReport(report(value), { summary: true });
    const output = rows.join('\n');
    assert.ok(output.includes(detail));
    assert.doesNotMatch(output, /PASS_MARKER/);
    assert.match(output, /1 failed/); assert.match(output, /Result: FAIL/);
});

test('Cancelled tests keep their failure details and count in summary output', t => {
    const rows = capture(t);
    const value = stage({ ok: false, exitCode: 1, counts: { tests: 17, pass: 0, fail: 1, cancelled: 16, skipped: 0, todo: 0 },
        output: '✔ PASS_MARKER\n✖ failing tests:\nparent.test.mjs:2:1\ntest did not finish before its parent and was cancelled' });
    printReport(report(value), { summary: true });
    const output = rows.join('\n');
    assert.match(output, /16 cancelled/); assert.match(output, /did not finish before its parent/);
    assert.doesNotMatch(output, /PASS_MARKER/);
});

test('Aborted processes and missing result files retain raw diagnostics without a normal footer', t => {
    const rows = capture(t);
    printReport(report(stage({ ok: false, timedOut: true, exitCode: null, output: 'process timed out\nRAW_DIAGNOSTIC' })), { summary: true });
    assert.match(rows.join('\n'), /RAW_DIAGNOSTIC/);
});

test('Missing regression IDs are reported without dumping otherwise passing tests', t => {
    const rows = capture(t);
    printReport(report(stage({ ok: false, bugCoverage: { required: ['BUG-1'], found: [], missing: ['BUG-1'] } })), { summary: true });
    const output = rows.join('\n');
    assert.match(output, /missing scenario IDs: BUG-1/); assert.match(output, /Result: FAIL/);
    assert.doesNotMatch(output, /PASS_MARKER/);
});

test('Default output stays detailed, while verbose output is not printed twice', t => {
    const rows = capture(t), value = stage();
    printReport(report(value), { summary: false, verbose: false });
    assert.match(rows.join('\n'), /PASS_MARKER/);
    rows.length = 0;
    printReport(report(value), { summary: true, verbose: true });
    assert.doesNotMatch(rows.join('\n'), /PASS_MARKER/);
    assert.match(rows.join('\n'), /2 passed/);
});

test('CI explicitly selects summary mode while retaining JSON report artifacts', async () => {
    const yaml = await readFile(new URL('../../.github/workflows/gd-test.yml', import.meta.url), 'utf8');
    assert.match(yaml, /node tools\/gd-test\/cli\.mjs full\s+--summary/);
    assert.match(yaml, /--report test-results\//);
    assert.match(yaml, /if: always\(\)/);
    assert.match(yaml, /path: test-results\/\*\.json/);
});

test('Preset test matrix is registered at module scope, never inside the display-preferences test', async () => {
    const source = await readFile(new URL('./muyu-controller.test.mjs', import.meta.url), 'utf8');
    const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    let sites = 0;
    function visit(node, depth = 0) {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'CallExpression' && node.callee?.name === 'test'
            && JSON.stringify(node.arguments[0]).includes('ST preset controller / ')) {
            sites++; assert.equal(depth, 0, 'matrix tests must not be unawaited children');
        }
        const next = depth + (/^(FunctionExpression|FunctionDeclaration|ArrowFunctionExpression)$/.test(node.type) ? 1 : 0);
        for (const child of Object.values(node)) {
            if (Array.isArray(child)) child.forEach(value => visit(value, next));
            else if (child && typeof child === 'object') visit(child, next);
        }
    }
    visit(ast); assert.equal(sites, 1);
});
