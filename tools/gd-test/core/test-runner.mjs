import { relativePath } from '../lib/files.mjs';
import { runCommand } from '../lib/process.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function parseTestSummary(output) {
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

export function parseBugCoverage(events, requiredIds = []) {
    const normalize = value => `BUG-${Number(value.replace(/^BUG-/i, ''))}`;
    const names = events.filter(event => event.type === 'test:pass' && event.kind === 'test'
        && event.line != null && !event.skip && !event.todo).map(event => event.name).join('\n');
    const found = new Set([...names.matchAll(/\bBUG-(\d+)\b/gi)].map(match => `BUG-${Number(match[1])}`));
    const required = requiredIds.map(normalize);
    return {
        required,
        found: required.filter(id => found.has(id)),
        missing: required.filter(id => !found.has(id)),
    };
}

export function parseCoverageSummary(output) {
    const match = /(?:^|\n)[^\n]*\ball files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/i.exec(output);
    if (!match) return null;
    return {
        lines: Number(match[1]),
        branches: Number(match[2]),
        functions: Number(match[3]),
    };
}

export async function runNodeTests({ root, config, testEntries, options, requiredBugIds = [] }) {
    const files = testEntries.map(entry => entry.file);
    const directory = await mkdtemp(path.join(tmpdir(), 'gd-test-events-'));
    const eventsFile = path.join(directory, 'events.jsonl');
    const reporter = new URL('../reporters/events.mjs', import.meta.url).href;
    const args = ['--test', `--test-concurrency=${config.test.concurrency}`, '--test-reporter=spec',
        '--test-reporter-destination=stdout', `--test-reporter=${reporter}`, `--test-reporter-destination=${eventsFile}`];
    const coverageIncludes = config.test.coverageIncludes || [
        '*.js',
        'agents/**/*.js',
        'assets/**/*.js',
        'systems/**/*.js',
        'ui/**/*.js',
        'utils/**/*.js',
    ];
    if (options.coverage) {
        args.push('--experimental-test-coverage');
        args.push(...coverageIncludes.map(pattern => `--test-coverage-include=${pattern}`));
    }
    if (options.filter && !files.some(file => relativePath(root, file).toLowerCase().includes(options.filter.toLowerCase()))) {
        args.push(`--test-name-pattern=${options.filter}`);
    }
    args.push(...files);
    let result;
    let events = [];
    let eventError = '';
    const env = { ...process.env, GD_TEST_ST_ROOT: options.stRoot, GD_TEST_SEED: options.seed };
    delete env.NODE_TEST_CONTEXT;
    try {
        result = await runCommand(process.execPath, args, {
            cwd: root,
            env,
            timeoutMs: config.test.timeoutMs,
            echo: options.verbose,
        });
        try {
            const content = await readFile(eventsFile, 'utf8');
            events = content.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
        } catch (error) {
            eventError = `Cannot read structured test results: ${error.message}`;
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
    const matchedTests = events.filter(event => event.kind === 'test' && event.line != null).length;
    const output = `${result.stdout}${result.stderr}${eventError ? `\n${eventError}\n` : ''}`
        + (matchedTests ? '' : '\nNo tests matched the selected suites/filter.\n');
    const bugCoverage = parseBugCoverage(events, requiredBugIds);
    return {
        name: 'tests',
        ok: result.code === 0 && !result.timedOut && !eventError && matchedTests > 0 && bugCoverage.missing.length === 0,
        matchedTests,
        durationMs: result.durationMs,
        counts: parseTestSummary(output),
        exitCode: result.code,
        timedOut: result.timedOut,
        files: testEntries.map(entry => ({ suite: entry.suite, file: relativePath(root, entry.file) })),
        bugCoverage,
        coverage: options.coverage ? {
            includes: coverageIncludes,
            summary: parseCoverageSummary(output),
        } : null,
        output,
    };
}
