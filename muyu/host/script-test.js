import { createBrowserSyntheticTester } from './provider-test.js';
import { scriptWorkerMain } from '../scripts/synthetic-worker.js';
import { checkedScriptReport } from '../scripts/test-contract.js';
import { normalizeScriptExecutor } from '../../systems/script-executor-validation.js';
export function createBrowserScriptTester(options = {}) {
    return createBrowserSyntheticTester({ ...options, workerMain: scriptWorkerMain,
        prepare: content => normalizeScriptExecutor(content),
        check: checkedScriptReport });
}
