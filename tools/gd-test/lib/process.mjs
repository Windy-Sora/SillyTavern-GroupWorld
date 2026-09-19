import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const windowsTreeController = fileURLToPath(new URL('./windows-process-tree.ps1', import.meta.url));

function createWindowsTreeController() {
    if (process.platform !== 'win32') return null;
    const helper = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', windowsTreeController,
    ], {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
    });
    let resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    const done = new Promise(resolve => {
        helper.once('error', () => {
            resolveReady(false);
            resolve(false);
        });
        helper.once('close', code => {
            resolveReady(false);
            resolve(code === 0);
        });
    });
    helper.stdout.once('data', () => resolveReady(true));
    let commanded = false;
    const command = value => {
        if (!commanded) {
            commanded = true;
            helper.stdin.end(`${value}\n`);
        }
        return done;
    };
    return {
        ready,
        attach: processId => helper.stdin.write(`${processId}\n`),
        kill: () => command('kill'),
        close: () => command('close'),
    };
}

function findPosixDescendants(rootProcessId) {
    return new Promise(resolve => {
        const probe = spawn('ps', ['-eo', 'pid=,ppid='], { stdio: ['ignore', 'pipe', 'ignore'] });
        let output = '';
        probe.stdout.on('data', chunk => { output += chunk; });
        probe.once('error', () => resolve([]));
        probe.once('close', code => {
            if (code !== 0) {
                resolve([]);
                return;
            }
            const children = new Map();
            for (const line of output.split(/\r?\n/)) {
                const [processId, parentProcessId] = line.trim().split(/\s+/).map(Number);
                if (!Number.isInteger(processId) || !Number.isInteger(parentProcessId)) continue;
                if (!children.has(parentProcessId)) children.set(parentProcessId, []);
                children.get(parentProcessId).push(processId);
            }
            const descendants = [];
            const pending = [rootProcessId];
            while (pending.length) {
                const processId = pending.shift();
                for (const childProcessId of children.get(processId) || []) {
                    descendants.push(childProcessId);
                    pending.push(childProcessId);
                }
            }
            resolve(descendants);
        });
    });
}

async function terminateProcessTree(child, windowsTreeController) {
    if (!child.pid) return Promise.resolve();
    if (process.platform !== 'win32') {
        const descendants = await findPosixDescendants(child.pid);
        for (const processId of descendants.reverse()) {
            try {
                process.kill(processId, 'SIGKILL');
            } catch (error) {
                if (error.code !== 'ESRCH') throw error;
            }
        }
        try {
            process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
            if (error.code !== 'ESRCH') child.kill('SIGKILL');
        }
        return;
    }
    if (!windowsTreeController) {
        child.kill('SIGKILL');
        return Promise.resolve();
    }
    const success = await windowsTreeController.kill();
    if (!success) child.kill('SIGKILL');
}

async function waitForProcessExit(processId, timeoutMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            process.kill(processId, 0);
        } catch (error) {
            if (error.code === 'ESRCH') return;
            throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

export function runCommand(command, args, {
    cwd,
    env = process.env,
    timeoutMs = 120_000,
    echo = false,
    signal: abortSignal,
} = {}) {
    return new Promise(resolve => {
        const startedAt = Date.now();
        const launch = async () => {
            if (abortSignal?.aborted) {
                resolve({ command, args, code: null, signal: null, stdout: '', stderr: 'Command cancelled', timedOut: false, durationMs: 0 });
                return;
            }
            let windowsTreeController = abortSignal ? createWindowsTreeController() : null;
            if (windowsTreeController && !(await windowsTreeController.ready)) windowsTreeController = null;
            if (abortSignal?.aborted) {
                await windowsTreeController?.close();
                resolve({ command, args, code: null, signal: null, stdout: '', stderr: 'Command cancelled', timedOut: false, durationMs: Date.now() - startedAt });
                return;
            }
            const child = spawn(command, args, {
                cwd,
                env,
                detached: process.platform !== 'win32',
                shell: false,
                windowsHide: true,
            });
            if (child.pid) windowsTreeController?.attach(child.pid);

            let stdout = '';
            let stderr = '';
            let timedOut = false;
            let cancellation = null;
            const cancel = () => {
                cancellation ??= terminateProcessTree(child, windowsTreeController);
                return cancellation;
            };
            abortSignal?.addEventListener('abort', cancel, { once: true });
            const timer = timeoutMs > 0
                ? setTimeout(() => {
                    timedOut = true;
                    cancel();
                }, timeoutMs)
                : null;

            child.stdout?.on('data', chunk => {
                const text = chunk.toString();
                stdout += text;
                if (echo) process.stdout.write(text);
            });
            child.stderr?.on('data', chunk => {
                const text = chunk.toString();
                stderr += text;
                if (echo) process.stderr.write(text);
            });

            child.on('error', async error => {
                abortSignal?.removeEventListener('abort', cancel);
                if (timer) clearTimeout(timer);
                await (cancellation || windowsTreeController?.close());
                resolve({
                    command,
                    args,
                    code: null,
                    signal: null,
                    stdout,
                    stderr: `${stderr}${error.stack || error.message}`,
                    timedOut,
                    durationMs: Date.now() - startedAt,
                });
            });

            child.on('close', async (code, signal) => {
                abortSignal?.removeEventListener('abort', cancel);
                if (timer) clearTimeout(timer);
                await (cancellation || windowsTreeController?.close());
                if (cancellation && process.platform === 'win32' && child.pid) await waitForProcessExit(child.pid);
                resolve({
                    command,
                    args,
                    code,
                    signal,
                    stdout,
                    stderr,
                    timedOut,
                    durationMs: Date.now() - startedAt,
                });
            });
        };
        void launch();
    });
}

export async function mapLimit(items, limit, worker) {
    if (!items.length) return [];
    const results = new Array(items.length);
    let nextIndex = 0;

    async function consume() {
        while (true) {
            const index = nextIndex++;
            if (index >= items.length) return;
            results[index] = await worker(items[index], index);
        }
    }

    const consumers = Array.from(
        { length: Math.max(1, Math.min(limit, items.length)) },
        () => consume(),
    );
    await Promise.all(consumers);
    return results;
}
