import { parentPort, workerData } from 'node:worker_threads';
import { normalizeCheckResult, validateChecker } from './check-contract.mjs';
import { projectServices } from './project-index.mjs';

let commandId = 0;
const commands = new Map();
parentPort.on('message', message => {
    if (message.kind !== 'command-result') return;
    const pending = commands.get(message.id);
    if (!pending) return;
    commands.delete(message.id);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.value);
});
const services = Object.freeze({
    ...projectServices,
    runCommand(command, args, options) {
        return new Promise((resolve, reject) => {
            const id = ++commandId;
            commands.set(id, { resolve, reject });
            parentPort.postMessage({ kind: 'run-command', id, command, args, options });
        });
    },
});

function serializeError(error) {
    return {
        code: error?.code,
        message: error?.message || String(error),
        stack: error?.stack,
    };
}

try {
    const loaded = await import(workerData.moduleUrl);
    const checker = validateChecker(loaded.default, workerData.file);
    if (workerData.action === 'describe') {
        parentPort.postMessage({
            ok: true,
            value: {
                id: checker.id,
                title: checker.title,
                version: checker.version,
                order: checker.order,
                timeoutMs: checker.timeoutMs,
                file: checker.file,
                moduleUrl: workerData.moduleUrl,
            },
        });
    } else if (workerData.action === 'run') {
        if (checker.id !== workerData.checkerId) {
            throw new Error(`Checker id changed from "${workerData.checkerId}" to "${checker.id}"`);
        }
        const project = workerData.project;
        const context = Object.freeze({
            root: project.root,
            config: project.config,
            project,
            services,
        });
        parentPort.postMessage({
            ok: true,
            value: normalizeCheckResult(await checker.run(context), checker.id),
        });
    } else {
        throw new Error(`Unknown checker worker action: ${workerData.action}`);
    }
} catch (error) {
    parentPort.postMessage({ ok: false, error: serializeError(error) });
}
