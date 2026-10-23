import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createPageService, publicAddress, pageUrl, extract, pinnedRequest, registerPages } = require('../../muyu/server-plugin/web-page.cjs');
const publicRecord = { address: '93.184.216.34', family: 4 };
const html = '<html><head><title>A &amp; B</title><style>secret-style</style></head><body><h1>Hello</h1><script>secret-code</script><p>World &lt;safe&gt;</p></body></html>';
const input = { url: 'https://example.com/docs', maxChars: 1000 };
test('Public addresses reject private, special, encoded and transition destinations', () => {
    for (const ip of ['0.0.0.0', '10.1.2.3', '127.0.0.1', '169.254.169.254', '100.64.0.1', '172.16.0.1', '192.168.1.1', '192.0.2.1', '198.18.0.1', '198.51.100.2', '203.0.113.1', '224.0.0.1', '255.255.255.255',
        '::', '::1', 'fc00::1', 'fe80::1', '::ffff:8.8.8.8', '64:ff9b::808:808', '2001:db8::1', '2001::1', '2002:808:808::1', '3fff::1']) assert.equal(publicAddress(ip), false, ip);
    for (const ip of ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888']) assert.equal(publicAddress(ip), true, ip);
    for (const url of ['file:///etc/passwd', 'http://localhost/', 'http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'https://x.internal/', 'https://user:pass@example.com/', 'https://example.com:8443/', 'https://example.com\\@127.0.0.1/']) assert.throws(() => pageUrl(url), /PAGE_/);
    assert.equal(pageUrl('https://example.com./docs#section').href, input.url);
});
test('DNS mixed answers fail closed and public resolution is pinned for each redirect', async () => {
    let sent = 0, dnsCalls = 0;
    const bad = createPageService({ resolver: async () => [publicRecord, { address: '127.0.0.1', family: 4 }], transport: async () => { sent++; } });
    await assert.rejects(bad.fetch(input, { account: 'u' }), /PAGE_BLOCKED/); assert.equal(sent, 0);
    const service = createPageService({ resolver: async () => { dnsCalls++; return [publicRecord]; }, transport: async (url, record) => {
        sent++; assert.deepEqual(record, publicRecord); return url.pathname === '/docs' ? { location: '/article' } : { text: html, type: 'text/html' };
    } });
    const result = await service.fetch(input, { account: 'u' });
    assert.equal(dnsCalls, 2); assert.equal(sent, 2); assert.equal(result.url, 'https://example.com/article'); assert.equal(result.title, 'A & B');
    assert.match(result.text, /Hello\n\nWorld <safe>/); assert.ok(!result.text.includes('secret')); assert.equal(result.limited, false);
});
test('Redirects cannot reach local/credentialed ports, downgrade TLS or exceed the hop bound', async () => {
    for (const location of ['http://127.0.0.1/', 'https://user:key@example.com/', 'https://example.com:9000/', 'http://example.com/']) {
        let sent = 0;
        const service = createPageService({ resolver: async () => [publicRecord], transport: async () => { sent++; return { location }; } });
        await assert.rejects(service.fetch(input, { account: 'u' }), /PAGE_BLOCKED/); assert.equal(sent, 1);
    }
    let sent = 0;
    const endless = createPageService({ resolver: async () => [publicRecord], transport: async () => { sent++; return { location: '/again' }; } });
    await assert.rejects(endless.fetch(input, { account: 'u' }), /PAGE_REDIRECT_LIMIT/); assert.equal(sent, 4);
    const rebinding = createPageService({ resolver: async host => host === 'example.com' ? [publicRecord] : [{ address: '10.0.0.1', family: 4 }], transport: async () => ({ location: 'https://private.example.net/' }) });
    await assert.rejects(rebinding.fetch(input, { account: 'u' }), /PAGE_BLOCKED/);
});
test('Cancellation and total deadline include stuck DNS; concurrent quota is released afterwards', async () => {
    const abort = new AbortController(), pre = new AbortController(); pre.abort(); let sent = 0;
    const service = createPageService({ resolver: async () => new Promise(() => {}), transport: () => { sent++; }, timeoutMs: 25 });
    await assert.rejects(service.fetch(input, { account: 'u', signal: pre.signal }), /PAGE_ABORTED/);
    const first = service.fetch(input, { account: 'u', signal: abort.signal }); abort.abort(); await assert.rejects(first, /PAGE_ABORTED/);
    const a = service.fetch(input, { account: 'u' }), b = service.fetch(input, { account: 'u' });
    await assert.rejects(service.fetch(input, { account: 'u' }), /PAGE_BUSY/);
    await Promise.all([assert.rejects(a, /PAGE_TIMEOUT/), assert.rejects(b, /PAGE_TIMEOUT/)]);
    await assert.rejects(service.fetch(input, { account: 'u' }), /PAGE_TIMEOUT/); assert.equal(sent, 0);
    await assert.rejects(service.fetch(input, {}), /IDENTITY/);
    await assert.rejects(service.fetch({ ...input, headers: { Cookie: 'x' } }, { account: 'u' }), /PAGE_INVALID/);
});
test('Text extraction is bounded and never includes executable/non-content blocks', () => {
    assert.deepEqual(extract(html, 'text/html', 1000), { title: 'A & B', text: 'Hello\n\nWorld <safe>', limited: false });
    assert.equal(extract('<h1>literal</h1>', 'text/plain', 1000).text, '<h1>literal</h1>');
    const result = extract('x'.repeat(999) + '🦉tail', 'text/plain', 1000);
    assert.equal(result.text.length, 999); assert.equal(result.limited, true);
    assert.ok(!extract('<script>unclosed</script><p>A</p><!-- hidden', 'text/html', 1000).text.includes('hidden'));
});
test('Actual socket uses pinned lookup, no cookies/auth and bounded plain/HTML responses', async t => {
    let requests = 0, headers;
    const server = http.createServer((req, res) => {
        requests++; headers = req.headers;
        if (req.url === '/redirect') { res.writeHead(302, { Location: '/ok', 'Set-Cookie': 'private' }); return res.end(); }
        if (req.url === '/pdf') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); return res.end('binary'); }
        if (req.url === '/gzip') { res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' }); return res.end('bad'); }
        if (req.url === '/charset') { res.writeHead(200, { 'Content-Type': 'text/html; charset=gbk' }); return res.end('bad'); }
        if (req.url === '/quoted') { res.writeHead(200, { 'Content-Type': 'text/html; charset="utf-8"' }); return res.end(html); }
        if (req.url === '/huge') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('x'.repeat(1048577)); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const port = server.address().port, record = { address: '127.0.0.1', family: 4 };
    // Internal transport test only; the public service rejects local URLs before this layer.
    const call = path => pinnedRequest(new URL('http://public.example.net:' + port + path), record, new AbortController().signal);
    assert.equal((await call('/ok')).text, html); assert.equal(headers.host, 'public.example.net:' + port);
    assert.equal(headers.cookie, undefined); assert.equal(headers.authorization, undefined); assert.equal(headers.referer, undefined); assert.equal(headers['accept-encoding'], 'identity');
    assert.deepEqual(await call('/redirect'), { location: '/ok' });
    assert.equal((await call('/quoted')).text, html);
    for (const route of ['/pdf', '/gzip', '/charset']) await assert.rejects(call(route), /PAGE_UNSUPPORTED/);
    await assert.rejects(call('/huge'), /PAGE_TOO_LARGE/);
    const before = requests;
    // A literal IP skips lookup: check the actual peer BEFORE sending the HTTP request.
    await assert.rejects(pinnedRequest(new URL('http://127.0.0.1:' + port), publicRecord, new AbortController().signal), /PAGE_BLOCKED/);
    assert.equal(requests, before);
});
test('Malformed repeated markup stays bounded without quadratic full-tail rescans', () => {
    for (const markup of ['<title>'.repeat(50000), '<script'.repeat(50000), '<'.repeat(500000)]) {
        const value = extract(markup, 'text/html', 1000);
        assert.ok(value.text.length <= 1000); assert.ok(value.title.length <= 240);
    }
});
test('HTTP errors are closed and contain no raw exception details', async () => {
    let handler;
    registerPages({ post(route, fn) { assert.equal(route, '/web/page'); handler = fn; } }, { fetch: async () => { throw Error('SECRET_PATH_KEY'); } });
    const result = await new Promise(resolve => handler({ body: input, user: { directories: { root: 'u' } } }, { status(code) { assert.equal(code, 400); return this; }, json: resolve }));
    assert.deepEqual(result, { error: 'PAGE_NETWORK_ERROR' });
});
