#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import config from '../../gd-test.config.mjs';
import { HELP_TEXT, parseOptions } from './core/options.mjs';
import { runProfile } from './core/runner.mjs';
import { printHeader, printList, printReport } from './reporters/console.mjs';
import { writeJsonReport } from './reporters/json.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

async function main() {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) {
        console.log(HELP_TEXT);
        return;
    }
    printHeader(root, options);
    const result = await runProfile({ root, config, options });
    if (options.list) {
        printList(root, result.profile, result.testEntries);
        return;
    }
    printReport(result.report, options);
    if (options.report) {
        const reportPath = await writeJsonReport(root, options.report, result.report);
        console.log(`Report: ${reportPath}`);
    }
    if (!result.report.ok) process.exitCode = 1;
}

main().catch(error => {
    console.error(`GD Test Lab failed: ${error.stack || error.message}`);
    process.exitCode = 1;
});
