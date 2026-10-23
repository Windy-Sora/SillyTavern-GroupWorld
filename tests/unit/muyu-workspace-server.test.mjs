import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { createWorkspaceService, validateJson, registerWorkspace } = require('../../muyu/server-plugin/workspace.cjs');
async function fixture(t, options) {
    const account = await fs.mkdtemp(path.join(os.tmpdir(), 'muyu-workspace-'));
    t.after(() => fs.rm(account, { recursive: true, force: true }));
    const req = { user: { directories: { root: account } } }, service = createWorkspaceService(options);
    const dir = path.join(account, '.group-director', 'muyu', 'workspace');
    const preview = (text, expectedRevision = null, name = 'notes.md') => service.run('preview', req, { path: name, expectedRevision, text });
    const apply = row => service.run('apply', req, { previewId: row.previewId });
    return { account, req, service, dir, preview, apply };
}
test('Workspace previews are side-effect free; exact content is written once with revisions and raw backups', async t => {
    const f = await fixture(t), p = await f.preview('hello');
    assert.equal(p.operation, 'create'); await assert.rejects(fs.stat(f.dir), { code: 'ENOENT' });
    const result = await f.apply(p); assert.equal(result.status, 'written'); assert.equal(result.revision, p.revision);
    assert.equal(await fs.readFile(path.join(f.dir, 'notes.md'), 'utf8'), 'hello');
    await assert.rejects(f.apply(p), /PREVIEW_EXPIRED/);
    const second = await f.preview('updated', result.revision), update = await f.apply(second);
    assert.equal(update.status, 'written'); assert.ok(update.backupId);
    assert.equal(await fs.readFile(path.join(path.dirname(f.dir), 'workspace-backups', update.backupId), 'utf8'), 'hello');
    const bytes = Buffer.from('\ufeffBOM content');
    await fs.writeFile(path.join(f.dir, 'notes.md'), bytes);
    const crypto = require('node:crypto'), revision = crypto.createHash('sha256').update(bytes).digest('hex');
    const third = await f.apply(await f.preview('after BOM', revision));
    assert.deepEqual(await fs.readFile(path.join(path.dirname(f.dir), 'workspace-backups', third.backupId)), bytes);
});
test('Conflicts preserve new data, missing is not update, and previews cannot be forged or used by another account', async t => {
    const f = await fixture(t), p = await f.preview('mine');
    await fs.mkdir(f.dir, { recursive: true }); await fs.writeFile(path.join(f.dir, 'notes.md'), 'external');
    await assert.rejects(f.apply(p), /WORKSPACE_CONFLICT/);
    assert.equal(await fs.readFile(path.join(f.dir, 'notes.md'), 'utf8'), 'external');
    await assert.rejects(f.preview('overwrite'), /WORKSPACE_CONFLICT/);
    const other = await fixture(t);
    const own = await other.preview('private');
    await assert.rejects(other.service.run('apply', f.req, { previewId: own.previewId }), /PREVIEW_EXPIRED/);
    assert.equal((await other.apply(own)).status, 'written');
    await assert.rejects(f.service.run('apply', f.req, { previewId: p.previewId, text: 'substitution' }), /INVALID/);
});
test('Paths, scripts, settings, junctions and pre-aborted writes fail closed', async t => {
    const f = await fixture(t);
    for (const name of ['../x.md', 'folder/x.md', 'C:/x.md', 'x\\y.md', '.env', 'CON.txt', 'x.js', 'config.json', 'credentials.json', 'x.md:stream']) {
        await assert.rejects(f.preview('x', null, name), /INVALID/);
    }
    await assert.rejects(f.service.run('preview', {}, { path: 'a.md', expectedRevision: null, text: 'x' }), /IDENTITY/);
    const p = await f.preview('x'), abort = new AbortController(); abort.abort();
    await assert.rejects(f.service.run('apply', f.req, { previewId: p.previewId }, abort.signal), /ABORTED/);
    await assert.rejects(fs.stat(f.dir), { code: 'ENOENT' });
    const privateDir = path.join(f.account, '.group-director'); await fs.mkdir(privateDir);
    const outside = path.join(f.account, 'outside'); await fs.mkdir(outside);
    await fs.symlink(outside, path.join(privateDir, 'muyu'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(f.apply(p), /UNAVAILABLE/);
    assert.deepEqual(await fs.readdir(outside), []);
});
test('JSON validation is bounded syntax/data checking, not schema validation or execution', async t => {
    const f = await fixture(t);
    assert.equal(validateJson('{"x": [1, true]}').valid, true);
    assert.equal(validateJson('{oops}').reason, 'JSON_SYNTAX');
    assert.equal(validateJson('{"__proto__":{"x":1}}').reason, 'JSON_UNSAFE_KEY');
    assert.equal(validateJson('1e999').reason, 'JSON_NUMBER');
    assert.equal(validateJson('['.repeat(66) + '0' + ']'.repeat(66)).reason, 'JSON_COMPLEXITY');
    assert.throws(() => validateJson('x'.repeat(65537)), /INVALID/);
    assert.throws(() => validateJson('\ud800'), /INVALID/);
    await assert.rejects(f.preview('{broken}', null, 'test.json'), /INVALID/);
    const json = await f.preview('{"valid":true}', null, 'test.json');
    assert.equal((await f.apply(json)).status, 'written');
});
test('Previews expire, per-account quota is bounded and concurrent applies do not clobber', async t => {
    let time = 1000; const f = await fixture(t, { now: () => time });
    const expired = await f.preview('x'); time += 300001; await assert.rejects(f.apply(expired), /EXPIRED/);
    const proposals = await Promise.allSettled([f.preview('a'), f.preview('b')]);
    assert.equal(proposals.filter(x => x.status === 'fulfilled').length, 1);
    const p = proposals.find(x => x.status === 'fulfilled').value;
    const attempts = await Promise.allSettled([f.apply(p), f.apply(p)]);
    assert.equal(attempts.filter(x => x.status === 'fulfilled').length, 1);
    assert.ok(attempts.some(x => x.reason?.message === 'WORKSPACE_BUSY'));
    for (let i = 0; i < 8; i++) await f.preview('x', null, 'n' + i + '.txt');
    await assert.rejects(f.preview('overflow', null, 'last.txt'), /CAPACITY/);
});
test('Backups retain twenty versions; workspace count quota never removes unrelated files', async t => {
    const f = await fixture(t); let result = await f.apply(await f.preview('0'));
    for (let i = 1; i <= 22; i++) result = await f.apply(await f.preview(String(i), result.revision));
    const store = path.join(path.dirname(f.dir), 'workspace-backups');
    assert.equal((await fs.readdir(store)).length, 20);
    await fs.writeFile(path.join(store, 'personal.txt'), 'KEEP');
    for (let i = 0; i < 63; i++) await fs.writeFile(path.join(f.dir, 'user' + i + '.txt'), 'x');
    const overflow = await f.preview('x', null, 'one-more.txt');
    await assert.rejects(f.apply(overflow), /CAPACITY/);
    result = await f.apply(await f.preview('23', result.revision));
    assert.equal(result.status, 'written'); assert.equal(await fs.readFile(path.join(store, 'personal.txt'), 'utf8'), 'KEEP');
});
test('HTTP routes never echo private paths or underlying errors', async () => {
    const routes = new Map(); registerWorkspace({ post: (name, fn) => routes.set(name, fn) });
    assert.equal(routes.size, 3);
    const res = { status(code) { this.code = code; return this; }, json(value) { this.value = value; } };
    routes.get('/workspace/apply')({ body: { previewId: 'bad' } }, res);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(res.value, { error: 'HISTORY_IDENTITY_UNAVAILABLE' });
});

test('Client and real workspace service agree on exact create/update, conflict and fixed authenticated routes',async t=>{
    const f=await fixture(t),{createServicesPort}=await import('../../muyu/host/services.js');
    const routes=[];
    const port=createServicesPort({getEnabled:()=>({workspaceWrite:true,jsonValidate:true}),fetcher:async(url,options)=>{
        routes.push(url);assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');
        if(url.endsWith('/service/status'))return new Response(JSON.stringify({version:1,serviceVersion:'0.6.0',capabilities:{},toolProtocols:{workspaceWrite:1,jsonValidate:1},limits:{records:64,recordBytes:1000,totalBytes:10000,messages:4096}}),{headers:{'content-type':'application/json'}});
        const op=url.split('/').at(-1);
        try{return new Response(JSON.stringify(await f.service.run(op,f.req,JSON.parse(options.body),options.signal)),{headers:{'content-type':'application/json'}});}
        catch(error){return new Response(JSON.stringify({error:error.message}),{status:409,headers:{'content-type':'application/json'}});}
    }});
    await port.check();const capture=port.captureTools(),target={kind:'global',userKey:'page'};
    const draft=await port.workspaceWriter.preview({path:'notes.md',expectedRevision:'',text:'client data'},target,capture,new AbortController().signal);
    await assert.rejects(fs.stat(f.dir),{code:'ENOENT'});
    assert.equal((await port.workspaceWriter.apply(draft)).status,'saved_confirmed');
    const update=await port.workspaceWriter.preview({path:'notes.md',expectedRevision:draft.proposedRevision,text:'new data'},target,capture,new AbortController().signal);
    assert.equal(update.before,'client data');
    await fs.writeFile(path.join(f.dir,'notes.md'),'external edit');
    await assert.rejects(port.workspaceWriter.apply(update),/WORKSPACE_CONFLICT/);
    assert.equal(await fs.readFile(path.join(f.dir,'notes.md'),'utf8'),'external edit');
    assert.equal((await port.workspaceWriter.validate({text:'{}'},capture,new AbortController().signal)).valid,true);
    assert.ok(routes.every(url=>url.startsWith('/api/plugins/gd-muyu-history/')));
    port.cancel();
});
test('BUG-2: full workspace quota excludes the actual updated entry, not request spelling', async t => {
    const f = await fixture(t);
    const initial = await f.apply(await f.preview('before'));
    let aliases = true;
    try { await fs.readFile(path.join(f.dir, 'NOTES.md')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; aliases = false; }
    let revision = initial.revision;
    if (!aliases) revision = (await f.apply(await f.preview('distinct', null, 'NOTES.md'))).revision;
    for (let i = 0; i < (aliases ? 63 : 62); i++) await fs.writeFile(path.join(f.dir, 'user' + i + '.txt'), 'x');
    const result = await f.apply(await f.preview('after', revision, 'NOTES.md'));
    assert.equal(result.status, 'written');
    assert.equal(await fs.readFile(path.join(f.dir, 'NOTES.md'), 'utf8'), 'after');
    assert.equal(await fs.readFile(path.join(f.dir, 'notes.md'), 'utf8'), aliases ? 'after' : 'before');
    assert.equal((await fs.readdir(f.dir)).length, 64);
    await assert.rejects(f.apply(await f.preview('overflow', null, 'new.txt')), /WORKSPACE_CAPACITY/);
});
