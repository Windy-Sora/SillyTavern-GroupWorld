import { Worker } from 'node:worker_threads';
import { runCommand } from '../lib/process.mjs';

const workerUrl = new URL('./check-worker.mjs', import.meta.url);

export function runCheckerWorker(workerData, timeoutMs) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(workerUrl, { workerData });
        let settled = false;
        const controller = new AbortController();
        const commands = new Set();

        const finish = async (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            controller.abort();
            try {
                await worker.terminate();
                await Promise.allSettled([...commands]);
                callback(value);
            } catch (error) {
                reject(error);
            } finally {
                worker.removeAllListeners();
            }
        };
        const timer = setTimeout(() => {
            const error = Object.assign(new Error(`Checker exceeded ${timeoutMs}ms`), { code: 'CHECK_TIMEOUT' });
            void finish(reject, error);
        }, timeoutMs);

        worker.on('message', message => {
            if (settled) return;
            if (message.kind === 'run-command') {
                const task = runCommand(message.command, message.args, { ...message.options, signal: controller.signal });
                commands.add(task);
                task.then(value => {
                    if (!settled) worker.postMessage({ kind: 'command-result', id: message.id, value });
                }, error => {
                    if (!settled) worker.postMessage({ kind: 'command-result', id: message.id, error: error.message });
                }).finally(() => commands.delete(task));
                return;
            }
            if (message.ok) {
                void finish(resolve, message.value);
                return;
            }
            const error = Object.assign(new Error(message.error?.message || 'Checker worker failed'), {
                code: message.error?.code,
                stack: message.error?.stack,
            });
            void finish(reject, error);
        });
        worker.once('error', error => void finish(reject, error));
        worker.once('exit', code => {
            if (!settled) void finish(reject, new Error(`Checker worker exited before returning a result (code ${code})`));
        });
    });
}
