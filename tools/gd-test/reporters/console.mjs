import path from 'node:path';
import { relativePath } from '../lib/files.mjs';

export function printHeader(root, options) {
    console.log(`GD Test Lab — ${options.profile}`);
    console.log(`Root: ${root}`);
    console.log(`Node: ${process.version}`);
    console.log(`Seed: ${options.seed}`);
    if (options.stRoot) console.log(`SillyTavern: ${path.resolve(options.stRoot)}`);
}

export function printList(root, profile, testEntries) {
    console.log(`\nStatic checks: ${profile.staticChecks ? 'enabled' : 'disabled'}`);
    for (const entry of testEntries) console.log(`[${entry.suite}] ${relativePath(root, entry.file)}`);
    console.log(`\n${testEntries.length} test files selected.`);
}

function printStatic(stage) {
    const c = stage.counts;
    console.log(`\n[static] ${stage.ok ? 'PASS' : 'FAIL'} — ${c.sourceFiles} source, ${c.jsonFiles} JSON, ${stage.durationMs}ms`);
    console.log(`         imports: ${c.internalImports} internal, ${c.hostImports} host, ${c.packageImports} package`);
    console.log(`         module smoke: ${c.moduleSmokeChecked} checked, ${c.moduleSmokeSkipped} host-dependent skipped`);
    console.log(`         reachability: entry ${c.entryReachableModules}/${c.productionModules}, tests ${c.testReachableModules}/${c.productionModules} modules`);
    const unreachable = stage.moduleReachability?.testUnreachableModules || [];
    if (unreachable.length) {
        const areas = new Map();
        for (const file of unreachable) {
            const area = file.includes('/') ? file.split('/')[0] : '(root)';
            areas.set(area, (areas.get(area) || 0) + 1);
        }
        const summary = [...areas].map(([area, count]) => `${area} ${count}`).join(', ');
        console.log(`         not test-reachable: ${unreachable.length} modules (${summary})`);
    }
    for (const item of stage.issues) {
        const where = item.line ? `${item.file}:${item.line}` : item.file;
        console.log(`  ${item.severity === 'error' ? 'ERROR' : 'WARN '} ${item.code} ${where} — ${item.message}`);
    }
}

function printTests(stage, options) {
    if (stage.coverage?.summary) {
        const { lines, branches, functions } = stage.coverage.summary;
        console.log(`\n[coverage] loaded modules only: lines ${lines}%, branches ${branches}%, functions ${functions}%`);
    }
    if (!options.verbose && stage.output?.trim()) console.log(`\n${stage.output.trim()}`);
    const coverage = stage.bugCoverage;
    if (coverage?.missing.length) console.error(`\n[regression-contracts] FAIL — missing scenario IDs: ${coverage.missing.join(', ')}`);
    else if (coverage?.required.length) console.log(`\n[regression-contracts] PASS — ${coverage.found.length}/${coverage.required.length} historical BUG IDs`);
    if (!stage.files?.length && stage.output) console.error('\n[tests] FAIL — no tests matched');
}

export function printReport(report, options) {
    for (const stage of report.stages) {
        if (stage.name === 'static') printStatic(stage);
        if (stage.name === 'tests') printTests(stage, options);
    }
    console.log(`\nResult: ${report.ok ? 'PASS' : 'FAIL'} (${report.durationMs}ms)`);
}
