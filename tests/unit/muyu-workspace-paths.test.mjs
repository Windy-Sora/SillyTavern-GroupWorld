import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const filename = new URL('../../muyu/server-plugin/workspace.cjs', import.meta.url);
const require = createRequire(filename), { fileSafety } = require('./documents.cjs');

test('Workspace uses the checked canonical account root for create, verification, updates and backups', async t => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'muyu-path-regression-'));
    t.after(() => fs.rm(temporary, { recursive: true, force: true }));
    const account = await fs.realpath(temporary), alias = account + '-alias';
    const checked = [], exported = { exports: {} };
    // Deterministic alias resolution on any OS; only canonical(account) is
    // substituted. Actual file I/O and the real containment reader stay intact.
    vm.runInNewContext(await fs.readFile(filename, 'utf8'), {
        module: exported, Buffer,
        require: name => name === './documents.cjs' ? { fileSafety: { ...fileSafety,
            canonical: async directory => { checked.push(directory); return fileSafety.canonical(directory === alias ? account : directory); },
        } } : require(name),
    }, { filename: filename.pathname });
    const service = exported.exports.createWorkspaceService(), req = { user: { directories: { root: alias } } };
    const preview = (text, expectedRevision = null) => service.run('preview', req, { path: 'notes.md', expectedRevision, text });
    const first = await preview('before');
    await assert.rejects(fs.stat(path.join(account, '.group-director')), { code: 'ENOENT' });
    const saved = await service.run('apply', req, { previewId: first.previewId });
    assert.equal(saved.status, 'written'); assert.equal(saved.persistence, 'file_synced');
    const next = await preview('after', saved.revision);
    assert.equal(next.beforeText, 'before');
    const updated = await service.run('apply', req, { previewId: next.previewId });
    assert.equal(updated.status, 'written'); assert.ok(updated.backupId);
    const base = path.join(account, '.group-director', 'muyu');
    assert.equal(await fs.readFile(path.join(base, 'workspace', 'notes.md'), 'utf8'), 'after');
    assert.equal(await fs.readFile(path.join(base, 'workspace-backups', updated.backupId), 'utf8'), 'before');
    assert.ok(checked.includes(alias));
    assert.equal(checked.some(directory => directory.startsWith(alias + path.sep)), false);
    await assert.rejects(fs.stat(alias), { code: 'ENOENT' });
});
