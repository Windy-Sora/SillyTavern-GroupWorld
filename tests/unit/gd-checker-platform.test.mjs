import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateChecker } from '../../tools/gd-test/core/check-contract.mjs';
import { discoverCheckers } from '../../tools/gd-test/core/check-discovery.mjs';
import { runCheckers } from '../../tools/gd-test/core/check-runner.mjs';

async function fixture(t) {
    const directory = await mkdtemp(path.join(tmpdir(), 'gd-checkers-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    return {
        directory,
        write: (name, source) => writeFile(path.join(directory, `${name}.check.mjs`), source),
    };
}

const declaration = (id, order, run = 'return {};', extra = '') => `
export default {
    id: '${id}', title: '${id}', version: 1, order: ${order}, ${extra}
    async run() { ${run} },
};
`;

const context = { project: { root: '', config: {} } };

test('checker contract rejects malformed declarations and worker results', async t => {
    assert.throws(() => validateChecker({}, 'bad.check.mjs'), /invalid id/);
    assert.throws(() => validateChecker({ id: 'Bad ID', title: 'bad', version: 1, run() {} }), /invalid id/);

    const files = await fixture(t);
    await files.write('invalid-result', declaration('invalid-result', 1, "return { issues: [{ severity: 'fatal' }] };"));
    const result = await runCheckers(await discoverCheckers(files.directory), context);
    assert.equal(result.issues[0].code, 'CHECK_CRASH');
    assert.match(result.issues[0].message, /invalid issue severity/);
});

test('checker runner uses deterministic order and isolates crashes', async t => {
    const files = await fixture(t);
    await files.write('second', declaration('second', 20, 'return { counts: { second: 1 } };'));
    await files.write('crashing', declaration('crashing', 10, "throw new Error('boom');"));
    await files.write('first', declaration('first', 10));
    const checkers = await discoverCheckers(files.directory);

    assert.deepEqual(checkers.map(item => item.id), ['crashing', 'first', 'second']);
    const result = await runCheckers(checkers, context);
    assert.equal(result.issues.some(issue => issue.code === 'CHECK_CRASH'), true);
    assert.deepEqual(result.counts, { second: 1 });
    assert.equal(result.checkers.length, 3);
});

test('timed-out checker workers are terminated before the runner advances', async t => {
    const files = await fixture(t);
    const marker = path.join(files.directory, 'late-side-effect.txt').replaceAll('\\', '\\\\');
    await files.write('slow', `
import { writeFile } from 'node:fs/promises';
export default {
    id: 'slow', title: 'slow', version: 1, order: 1, timeoutMs: 10,
    async run() {
        await new Promise(resolve => setTimeout(resolve, 80));
        await writeFile('${marker}', 'late');
        return {};
    },
};
`);
    await files.write('next', declaration('next', 2, 'return { counts: { next: 1 } };'));

    const result = await runCheckers(await discoverCheckers(files.directory), context);
    assert.equal(result.issues[0].code, 'CHECK_TIMEOUT');
    assert.deepEqual(result.counts, { next: 1 });
    await new Promise(resolve => setTimeout(resolve, 120));
    await assert.rejects(access(path.join(files.directory, 'late-side-effect.txt')), { code: 'ENOENT' });
});

test('checker runner rejects duplicate count ownership', async t => {
    const files = await fixture(t);
    await files.write('one', declaration('one', 1, 'return { counts: { shared: 1 } };'));
    await files.write('two', declaration('two', 2, 'return { counts: { shared: 2 } };'));
    await assert.rejects(runCheckers(await discoverCheckers(files.directory), context), /Duplicate checker count key/);
});

test('checker discovery scans check files and rejects duplicate IDs', async t => {
    const files = await fixture(t);
    await files.write('later', declaration('later', 20));
    await files.write('first', declaration('first', 10));
    await writeFile(path.join(files.directory, 'ignored.mjs'), declaration('ignored', 0));
    assert.deepEqual((await discoverCheckers(files.directory)).map(item => item.id), ['first', 'later']);

    await files.write('duplicate', declaration('first', 30));
    await assert.rejects(discoverCheckers(files.directory), /Duplicate checker id "first"/);
});

test('checker loading failures and timeouts remain reportable while healthy checkers run', async t => {
    const files = await fixture(t);
    await files.write('broken', "throw new Error('load failed');");
    await files.write('hanging', 'await new Promise(() => {});');
    await files.write('healthy', declaration('healthy', 2, 'return { counts: { healthy: 1 } };'));
    const result = await runCheckers(await discoverCheckers(files.directory, { timeoutMs: 1000 }), context);
    assert.deepEqual(result.issues.map(issue => issue.code), ['CHECK_CRASH', 'CHECK_TIMEOUT']);
    assert.match(result.issues[0].message, /load failed/);
    assert.equal(result.counts.healthy, 1);
    assert.equal(result.checkers.length, 3);
});

test('checker timeout reaps its service subprocess before the next checker runs', async t => {
    const files = await fixture(t);
    const pidFile = path.join(files.directory, 'child.pid');
    t.after(async () => {
        try {
            const pid = Number(await readFile(pidFile, 'utf8'));
            process.kill(pid, 'SIGKILL');
        } catch (error) {
            if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error;
        }
    });
    const program = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
    await files.write('slow', `export default {
        id: 'slow', title: 'slow', version: 1, order: 1, timeoutMs: 1000,
        async run({ services }) {
            await services.runCommand(process.execPath, ['-e', ${JSON.stringify(program)}], { timeoutMs: 0 });
            return {};
        },
    };`);
    await files.write('next', `import { readFile } from 'node:fs/promises';
        export default { id: 'next', title: 'next', version: 1, order: 2,
            async run() {
                const pid = Number(await readFile(${JSON.stringify(pidFile)}, 'utf8'));
                try { process.kill(pid, 0); } catch (error) {
                    if (error.code === 'ESRCH') return { counts: { childReaped: 1 } };
                    throw error;
                }
                throw new Error('Timed-out child is still alive');
            },
        };`);
    const result = await runCheckers(await discoverCheckers(files.directory), context);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].code, 'CHECK_TIMEOUT');
    assert.equal(result.counts.childReaped, 1);
});

test('checker timeout reaps descendants of its service subprocess', async t => {
    const files = await fixture(t);
    const childPidFile = path.join(files.directory, 'grandchild.pid');
    const marker = path.join(files.directory, 'grandchild-marker.txt');
    t.after(async () => {
        try {
            const pid = Number(await readFile(childPidFile, 'utf8'));
            process.kill(pid, 'SIGKILL');
        } catch (error) {
            if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error;
        }
    });
    const childProgram = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'survived'), 1500);`;
    const parentProgram = `const { spawn } = require('node:child_process');
        const child = spawn(process.execPath, ['-e', ${JSON.stringify(childProgram)}], { detached: true, windowsHide: true, stdio: 'ignore' });
        child.unref();
        require('node:fs').writeFileSync(${JSON.stringify(childPidFile)}, String(child.pid));
        setInterval(() => {}, 1000);`;
    await files.write('tree', `export default {
        id: 'tree', title: 'tree', version: 1, order: 1, timeoutMs: 1000,
        async run({ services }) {
            await services.runCommand(process.execPath, ['-e', ${JSON.stringify(parentProgram)}], { timeoutMs: 0 });
            return {};
        },
    };`);
    const result = await runCheckers(await discoverCheckers(files.directory), context);
    assert.equal(result.issues[0].code, 'CHECK_TIMEOUT');
    await new Promise(resolve => setTimeout(resolve, 1700));
    await assert.rejects(access(marker), { code: 'ENOENT' });
    const childPid = Number(await readFile(childPidFile, 'utf8'));
    assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' });
});
