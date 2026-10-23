// Public text pages only. DNS is validated once per hop and pinned into the actual socket.
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns/promises');
const net = require('node:net');
const LIMITS = Object.freeze({ bytes: 1048576, chars: 24000, redirects: 3, timeMs: 8000, requests: 6 });
const CODES = Object.freeze(['PAGE_INVALID', 'PAGE_BLOCKED', 'PAGE_DNS_FAILED', 'PAGE_NETWORK_ERROR', 'PAGE_TIMEOUT', 'PAGE_ABORTED', 'PAGE_TOO_LARGE', 'PAGE_UNSUPPORTED', 'PAGE_REDIRECT_LIMIT', 'PAGE_HTTP_ERROR', 'PAGE_BUSY', 'HISTORY_IDENTITY_UNAVAILABLE']);
const fail = code => { throw Error(code); };
function ipv6Parts(address) {
    const sides = address.toLowerCase().split('::'), left = sides[0] ? sides[0].split(':') : [], right = sides[1] ? sides[1].split(':') : [];
    return [...left, ...Array(8 - left.length - right.length).fill('0'), ...right].map(part => parseInt(part, 16));
}
function publicAddress(address) {
    if (net.isIP(address) === 4) {
        const p = address.split('.').map(Number), a = p[0], b = p[1], c = p[2];
        return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 ||
            a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 88 && c === 99) ||
            a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
    }
    if (net.isIP(address) !== 6 || address.includes('.') || address.includes('%')) return false;
    const p = ipv6Parts(address);
    // Conservative global unicast only; exclude special-use 2001::/23, documentation and 6to4.
    return p[0] >= 0x2000 && p[0] <= 0x3fff && !(p[0] === 0x2001 && (p[1] < 0x0200 || p[1] === 0x0db8)) &&
        p[0] !== 0x2002 && !(p[0] === 0x3fff && p[1] < 0x1000);
}
function addressKey(address) {
    if (net.isIP(address) === 4) return address;
    // A dual-stack socket may report an IPv4 peer as ::ffff:a.b.c.d.
    if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(address)) return address.slice(7);
    if (net.isIP(address) === 6 && !address.includes('.') && !address.includes('%')) return ipv6Parts(address).join(':');
    return '';
}
function pageUrl(value) {
    if (typeof value !== 'string' || !value || value.length > 2000 || /[\x00-\x20\x7f\\]/.test(value)) fail('PAGE_INVALID');
    let url; try { url = new URL(value); } catch { fail('PAGE_INVALID'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) fail('PAGE_BLOCKED');
    let hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    if (!hostname || hostname.length > 253 || !net.isIP(hostname) && (!hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|onion|example)$/.test(hostname))) fail('PAGE_BLOCKED');
    if (net.isIP(hostname) && !publicAddress(hostname)) fail('PAGE_BLOCKED');
    url.hash = '';
    // Canonical trailing-dot DNS name retains the same validated/TLS host.
    if (!net.isIP(hostname)) url.hostname = hostname;
    return url;
}
function bounded(promise, signal) {
    if (signal.aborted) return Promise.reject(Error('PAGE_ABORTED'));
    return new Promise((resolve, reject) => {
        const stop = () => reject(Error('PAGE_ABORTED'));
        signal.addEventListener('abort', stop, { once: true });
        Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
    });
}
async function pin(url, resolver, signal) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const records = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await bounded(resolver(host, { all: true, verbatim: true }), signal).catch(error => {
        if (signal.aborted) throw error; fail('PAGE_DNS_FAILED');
    });
    if (!Array.isArray(records) || !records.length || records.length > 16) fail('PAGE_DNS_FAILED');
    if (records.some(row => !row || ![4, 6].includes(row.family) || net.isIP(row.address) !== row.family || !publicAddress(row.address))) fail('PAGE_BLOCKED');
    return records.find(row => row.family === 4) || records[0];
}
function pinnedRequest(url, record, signal) {
    return new Promise((resolve, reject) => {
        let response, settled = false;
        const done = (error, value) => {
            if (settled) return; settled = true; signal.removeEventListener('abort', stop);
            if (error) { response?.destroy(); request.destroy(); reject(error); } else resolve(value);
        };
        const stop = () => done(Error('PAGE_ABORTED'));
        const transport = url.protocol === 'https:' ? https : http;
        const request = transport.request(url, {
            method: 'GET', agent: false, autoSelectFamily: false, family: record.family, maxHeaderSize: 16384,
            headers: { Accept: 'text/html, text/plain, application/xhtml+xml', 'Accept-Encoding': 'identity', 'User-Agent': 'Muyu-Services/0.5 PublicTextReader' },
            lookup: (_host, options, callback) => options?.all ? callback(null, [record]) : callback(null, record.address, record.family),
        }, res => {
            response = res;
            if (addressKey(res.socket?.remoteAddress || '') !== addressKey(record.address)) return done(Error('PAGE_BLOCKED'));
            const status = res.statusCode;
            if ([301, 302, 303, 307, 308].includes(status)) {
                const location = res.headers.location;
                res.destroy();
                if (typeof location !== 'string' || location.length > 2000) return done(Error('PAGE_BLOCKED'));
                return done(null, { location });
            }
            if (status < 200 || status >= 300) return done(Error('PAGE_HTTP_ERROR'));
            const type = String(res.headers['content-type'] || '').toLowerCase();
            const charset = /\bcharset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s]*))/i.exec(type);
            if (!/^(?:text\/html|text\/plain|application\/xhtml\+xml)(?:;|$)/.test(type) ||
                charset && !['utf-8', 'utf8', 'us-ascii'].includes((charset[1] ?? charset[2] ?? charset[3]).trim()) ||
                res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') return done(Error('PAGE_UNSUPPORTED'));
            const length = res.headers['content-length'];
            if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > LIMITS.bytes)) return done(Error('PAGE_TOO_LARGE'));
            let bytes = 0; const chunks = [];
            res.on('data', chunk => {
                bytes += chunk.length;
                if (bytes > LIMITS.bytes) return done(Error('PAGE_TOO_LARGE'));
                chunks.push(chunk);
            });
            res.on('error', () => done(Error('PAGE_NETWORK_ERROR')));
            res.on('aborted', () => done(Error('PAGE_NETWORK_ERROR')));
            res.on('end', () => {
                if (!res.complete) return done(Error('PAGE_NETWORK_ERROR'));
                let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); } catch { return done(Error('PAGE_UNSUPPORTED')); }
                done(null, { type, text });
            });
        });
        // Verify the peer before sending HTTP bytes, including TLS before the GET is flushed.
        request.on('socket', socket => {
            const connected = () => {
                if (addressKey(socket.remoteAddress || '') !== addressKey(record.address)) return done(Error('PAGE_BLOCKED'));
                if (!signal.aborted && !settled) request.end();
            };
            socket.once(url.protocol === 'https:' ? 'secureConnect' : 'connect', connected);
        });
        request.on('error', () => done(Error(signal.aborted ? 'PAGE_ABORTED' : 'PAGE_NETWORK_ERROR')));
        signal.addEventListener('abort', stop, { once: true });
        if (signal.aborted) stop();
    });
}
function entities(text) {
    return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos|nbsp);/gi, (match, name) => {
        const known = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }, n = name.toLowerCase();
        if (Object.hasOwn(known, n)) return known[n];
        const point = n[1] === 'x' ? parseInt(n.slice(2), 16) : Number(n.slice(1));
        return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '';
    });
}
function extract(text, type, maxChars) {
    let title = '';
    if (type !== 'text/plain' && !type.startsWith('text/plain;')) {
        // Open tags cannot consume another '<'; EOF fallback prevents repeated unterminated
        // title/block starts from rescanning the entire remaining body.
        const heading = /<title\b[^<>]*>([\s\S]*?)(?:<\/title\s*>|$)/i.exec(text);
        title = heading ? entities(heading[1].replace(/<[^<>]*>/g, '')).trim().slice(0, 240) : '';
        text = text.replace(/<!--[\s\S]*?(?:-->|$)/g, '').replace(/<(script|style|head|noscript|template|svg)\b[^<>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
            .replace(/<\/?(?:p|div|br|h[1-6]|li|tr|section|article|blockquote|pre)\b[^<>]*>/gi, '\n').replace(/<[^<>]*>/g, '');
        text = entities(text);
    }
    text = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    let end = Math.min(text.length, maxChars);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text.charAt(end - 1))) end--;
    return { title, text: text.slice(0, end), limited: end < text.length };
}
function createPageService({ resolver = dns.lookup, transport = pinnedRequest, timeoutMs = LIMITS.timeMs } = {}) {
    const accounts = new Map();
    return { async fetch(input, { account, signal } = {}) {
        if (!input || Array.isArray(input) || Object.keys(input).some(key => !['url', 'maxChars'].includes(key)) || !Number.isInteger(input.maxChars) || input.maxChars < 1000 || input.maxChars > LIMITS.chars) fail('PAGE_INVALID');
        let url = pageUrl(input.url);
        if (typeof account !== 'string' || !account.trim() || account.includes('\0')) fail('HISTORY_IDENTITY_UNAVAILABLE');
        if ((accounts.get(account) || 0) >= 2 || accounts.size >= 256 && !accounts.has(account)) fail('PAGE_BUSY');
        accounts.set(account, (accounts.get(account) || 0) + 1);
        const abort = new AbortController(), stop = () => abort.abort();
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
        signal?.addEventListener('abort', stop, { once: true }); if (signal?.aborted) stop();
        try {
            for (let hops = 0; ; hops++) {
                if (abort.signal.aborted) fail('PAGE_ABORTED');
                const record = await pin(url, resolver, abort.signal);
                const result = await bounded(transport(url, record, abort.signal), abort.signal);
                if (result.location !== undefined) {
                    if (hops >= LIMITS.redirects) fail('PAGE_REDIRECT_LIMIT');
                    let next; try { next = new URL(result.location, url).href; } catch { fail('PAGE_BLOCKED'); }
                    const nextUrl = pageUrl(next);
                    if (url.protocol === 'https:' && nextUrl.protocol !== 'https:') fail('PAGE_BLOCKED');
                    url = nextUrl; continue;
                }
                if (typeof result.text !== 'string' || Buffer.byteLength(result.text) > LIMITS.bytes) fail('PAGE_TOO_LARGE');
                return { version: 1, status: 'ok', url: url.href, fetchedAt: new Date().toISOString(), ...extract(result.text, result.type, input.maxChars) };
            }
        } catch (error) {
            fail(timedOut ? 'PAGE_TIMEOUT' : abort.signal.aborted ? 'PAGE_ABORTED' : CODES.includes(error?.message) ? error.message : 'PAGE_NETWORK_ERROR');
        } finally {
            clearTimeout(timer); signal?.removeEventListener('abort', stop);
            const count = accounts.get(account) - 1; if (count) accounts.set(account, count); else accounts.delete(account);
        }
    } };
}
function registerPages(router, service = createPageService()) {
    router.post('/web/page', (req, res) => {
        const abort = new AbortController(), stop = () => { if (!res.writableEnded) abort.abort(); };
        req.on?.('aborted', stop); res.on?.('close', stop);
        void service.fetch(req.body, { account: req.user?.directories?.root, signal: abort.signal }).then(
            value => { if (!abort.signal.aborted) res.json(value); },
            error => { if (!abort.signal.aborted) res.status(error?.message === 'PAGE_BUSY' ? 429 : 400).json({ error: CODES.includes(error?.message) ? error.message : 'PAGE_NETWORK_ERROR' }); }
        ).finally(() => { req.off?.('aborted', stop); res.off?.('close', stop); });
    });
}
module.exports = { createPageService, registerPages, publicAddress, pageUrl, extract, pinnedRequest, LIMITS, CODES };
