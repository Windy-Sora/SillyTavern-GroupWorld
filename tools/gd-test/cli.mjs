#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../../gd-test.config.mjs';
import { runStaticChecks } from './lib/checks.mjs';
import { discoverTests, relativePath } from './lib/files.mjs';
import { runCommand } from './lib/process.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

function printHelp() {
    console.log(`
GD Test Lab

Usage:
  node tools/gd-test/cli.mjs [profile] [options]

Profiles:
  quick        Static checks + unit + regression tests (default)
  full         Static checks + all test suites
  static       Syntax, JSON, manifest, imports and source hygiene
  unit         Unit tests only
  integration  Fake/real SillyTavern integration and contract tests

Options:
  --filter <text>    Filter test files; if none match, filter test names
  --coverage         Enable Node's built-in test coverage
  --seed <integer>   Seed for deterministic property/fuzz tests
  --st-root <path>   SillyTavern root used by optional contract tests
  --report <path>    Write a machine-readable JSON report
  --list             List selected tests without running them
  --verbose          Print complete child-process output
  --help             Show this help
`.trim());
}

function parseArgs(argv) {
    const options = {
        profile: 'quick',
        filter: '',
        coverage: false,
        seed: process.env.GD_TEST_SEED || '4674628',
        stRoot: process.env.GD_TEST_ST_ROOT || '',
        report: '',
        list: false,
        verbose: false,
        help: false,
    };
    let profileSet = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('-') && !profileSet) {
            options.profile = arg;
            profileSet = true;
        } else if (arg === '--filter') {
            options.filter = argv[++i] || '';
        } else if (arg.startsWith('--filter=')) {
            options.filter = arg.slice('--filter='.length);
        } else if (arg === '--st-root') {
            options.stRoot = argv[++i] || '';
        } else if (arg.startsWith('--st-root=')) {
            options.stRoot = arg.slice('--st-root='.length);
        } else if (arg === '--seed') {
            options.seed = argv[++i] || '';
        } else if (arg.startsWith('--seed=')) {
            options.seed = arg.slice('--seed='.length);
        } else if (arg === '--report') {
            options.report = argv[++i] || '';
        } else if (arg.startsWith('--report=')) {
            options.report = arg.slice('--report='.length);
        } else if (arg === '--coverage') {
            options.coverage = true;
        } else if (arg === '--list') {
            options.list = true;
        } else if (arg === '--verbose') {
            options.verbose = true;
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return options;
}

function parseTestSummary(output) {
    const number = label => {
        const match = new RegExp(`(?:^|\\n)[^\\n]*\\b${label}\\s+(\\d+)\\s*(?:\\n|$)`, 'i').exec(output);
        return match ? Number(match[1]) : null;
    };
    return {
        tests: number('tests'),
        pass: number('pass'),
        fail: number('fail'),
        skipped: number('skipped'),
        todo: number('todo'),
    };
}

function parseBugCoverage(output, requiredIds = []) {
    const normalize = value => `BUG-${Number(value.replace(/^BUG-/i, ''))}`;
    const found = new Set(
        [...output.matchAll(/\bBUG-(\d+)\b/gi)].map(match => `BUG-${Number(match[1])}`)
    );
    const required = requiredIds.map(normalize);
    return {
        required,
        found: required.filter(id => found.has(id)),
        missing: required.filter(id => !found.has(id)),
    };
}

function printStatic(stage) {
    const c = stage.counts;
    console.log(`\n[static] ${stage.ok ? 'PASS' : 'FAIL'} — ${c.sourceFiles} source, ${c.jsonFiles} JSON, ${stage.durationMs}ms`);
    console.log(`         imports: ${c.internalImports} internal, ${c.hostImports} host, ${c.packageImports} package`);
    console.log(`         module smoke: ${c.moduleSmokeChecked} checked, ${c.moduleSmokeSkipped} host-dependent skipped`);
    console.log(`         reachability: entry ${c.entryReachableModules}/${c.productionModules}, tests ${c.testReachableModules}/${c.productionModules} modules`);
    for (const item of stage.issues) {
        const where = item.line ? `${item.file}:${item.line}` : item.file;
        console.log(`  ${item.severity === 'error' ? 'ERROR' : 'WARN '} ${item.code} ${where} — ${item.message}`);
    }
}

async function runTests(testEntries, options, requiredBugIds = []) {
    const files = testEntries.map(entry => entry.file);
    const args = ['--test', `--test-concurrency=${config.test.concurrency}`, '--test-reporter=spec'];
    if (options.coverage) {
        args.push(
            '--experimental-test-coverage',
            '--test-coverage-include=agents/**/*.js',
            '--test-coverage-include=systems/**/*.js',
            '--test-coverage-include=utils/**/*.js',
        );
    }
    if (options.filter && !files.some(file => relativePath(root, file).toLowerCase().includes(options.filter.toLowerCase()))) {
        args.push(`--test-name-pattern=${options.filter}`);
    }
    args.push(...files);

    const result = await runCommand(process.execPath, args, {
        cwd: root,
        env: {
            ...process.env,
            GD_TEST_ST_ROOT: options.stRoot,
            GD_TEST_SEED: options.seed,
        },
        timeoutMs: config.test.timeoutMs,
        echo: options.verbose,
    });
    const output = `${result.stdout}${result.stderr}`;
    if (!options.verbose && output.trim()) console.log(`\n${output.trim()}`);
    const bugCoverage = parseBugCoverage(output, requiredBugIds);
    if (bugCoverage.missing.length) {
        console.error(`\n[regression-contracts] FAIL — missing scenario IDs: ${bugCoverage.missing.join(', ')}`);
    } else if (bugCoverage.required.length) {
        console.log(`\n[regression-contracts] PASS — ${bugCoverage.found.length}/${bugCoverage.required.length} historical BUG IDs`);
    }
    return {
        name: 'tests',
        ok: result.code === 0 && !result.timedOut && bugCoverage.missing.length === 0,
        durationMs: result.durationMs,
        counts: parseTestSummary(output),
        exitCode: result.code,
        timedOut: result.timedOut,
        files: testEntries.map(entry => ({
            suite: entry.suite,
            file: relativePath(root, entry.file),
        })),
        bugCoverage,
        output,
    };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }
    const profile = config.profiles[options.profile];
    if (!profile) throw new Error(`Unknown profile "${options.profile}". Use --help to list profiles.`);

    const startedAt = Date.now();
    let testEntries = await discoverTests(root, config, profile.suites);
    if (options.filter) {
        const filtered = testEntries.filter(entry =>
            relativePath(root, entry.file).toLowerCase().includes(options.filter.toLowerCase())
        );
        if (filtered.length) testEntries = filtered;
    }

    console.log(`GD Test Lab — ${options.profile}`);
    console.log(`Root: ${root}`);
    console.log(`Node: ${process.version}`);
    console.log(`Seed: ${options.seed}`);
    if (options.stRoot) console.log(`SillyTavern: ${path.resolve(options.stRoot)}`);

    if (options.list) {
        console.log(`\nStatic checks: ${profile.staticChecks ? 'enabled' : 'disabled'}`);
        for (const entry of testEntries) {
            console.log(`[${entry.suite}] ${relativePath(root, entry.file)}`);
        }
        console.log(`\n${testEntries.length} test files selected.`);
        return;
    }

    const stages = [];
    if (profile.staticChecks) {
        const staticStage = await runStaticChecks(root, config);
        stages.push(staticStage);
        printStatic(staticStage);
    }
    if (testEntries.length) {
        const requiredBugIds = profile.suites.includes('regression') && !options.filter
            ? (config.regression?.requiredBugIds || [])
            : [];
        stages.push(await runTests(testEntries, options, requiredBugIds));
    } else if (profile.suites.length) {
        stages.push({
            name: 'tests',
            ok: false,
            durationMs: 0,
            counts: {},
            files: [],
            output: 'No tests matched the selected suites/filter.',
        });
        console.error('\n[tests] FAIL — no tests matched');
    }

    const ok = stages.every(stage => stage.ok);
    const report = {
        schemaVersion: 1,
        tool: 'gd-test-lab',
        profile: options.profile,
        ok,
        startedAt: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        node: process.version,
        root,
        stRoot: options.stRoot ? path.resolve(options.stRoot) : null,
        filter: options.filter || null,
        coverage: options.coverage,
        seed: options.seed,
        stages,
    };

    console.log(`\nResult: ${ok ? 'PASS' : 'FAIL'} (${report.durationMs}ms)`);
    if (options.report) {
        const reportPath = path.resolve(root, options.report);
        await mkdir(path.dirname(reportPath), { recursive: true });
        await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        console.log(`Report: ${reportPath}`);
    }
    if (!ok) process.exitCode = 1;
}

main().catch(error => {
    console.error(`GD Test Lab failed: ${error.stack || error.message}`);
    process.exitCode = 1;
});
