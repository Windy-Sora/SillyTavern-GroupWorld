import { spawn } from 'node:child_process';

export function runCommand(command, args, {
    cwd,
    env = process.env,
    timeoutMs = 120_000,
    echo = false,
} = {}) {
    return new Promise(resolve => {
        const startedAt = Date.now();
        const child = spawn(command, args, {
            cwd,
            env,
            shell: false,
            windowsHide: true,
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const timer = timeoutMs > 0
            ? setTimeout(() => {
                timedOut = true;
                child.kill();
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

        child.on('error', error => {
            if (timer) clearTimeout(timer);
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

        child.on('close', (code, signal) => {
            if (timer) clearTimeout(timer);
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
