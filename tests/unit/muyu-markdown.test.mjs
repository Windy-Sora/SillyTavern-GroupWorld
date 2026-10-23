import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderMarkdown } from '../../muyu/ui/markdown.js';
function dom() {
    const doc = { createElement(tag) { return { tag, ownerDocument: doc, children: [], attrs: {}, append(e) { this.children.push(e); }, replaceChildren() { this.children = []; }, setAttribute(k, v) { this.attrs[k] = v; } }; } };
    const root = doc.createElement('div'), all = (el = root) => [el, ...el.children.flatMap(all)];
    return { root, all };
}

test('Muyu code uses its own theme palette instead of the host pale code color', () => {
    const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
    const rule = selector => {
        const start = css.indexOf(selector + ' {');
        assert.ok(start >= 0, selector);
        return css.slice(start, css.indexOf('}', start));
    };
    const inline = rule('.gd-floating-root .gd-muyu-panel .gd-muyu-markdown :not(pre) > code');
    assert.match(inline, /color: var\(--gd-muyu-text\)/);
    assert.match(inline, /background: var\(--gd-muyu-inset\)/);
    const block = rule('.gd-floating-root .gd-muyu-panel .gd-muyu-markdown pre > code');
    assert.match(block, /color: var\(--gd-muyu-text\)/);
    assert.match(block, /background: transparent/);
    const user = rule('.gd-floating-root .gd-muyu-panel .gd-muyu-user .gd-muyu-markdown :not(pre) > code');
    assert.match(user, /color: inherit/);
    const f = dom(); renderMarkdown(f.root, '`{{getvar}}`');
    assert.equal(f.all().find(e => e.tag === 'code').textContent, '{{getvar}}');
});
test('Markdown supports headings, bold, emphasis, lists, quotes, tables, code and explicit safe links', () => {
    const f = dom(); renderMarkdown(f.root, '# 标题\n\n**重点**和*强调*，`inline`\n\n- 一\n- 二\n\n1. first\n\n> 引用\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst x = "<tag>";\n```\n\n[文档](https://example.com/doc)');
    for (const tag of ['h1', 'strong', 'em', 'ul', 'ol', 'blockquote', 'table', 'pre', 'code', 'a']) assert.ok(f.all().some(e => e.tag === tag), tag);
    const a = f.all().find(e => e.tag === 'a'); assert.equal(a.attrs.rel, 'noopener noreferrer'); assert.equal(a.attrs.href, 'https://example.com/doc');
});
test('Markdown never parses HTML, loads images or makes executable/relative links', () => {
    const f = dom(); renderMarkdown(f.root, '<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n![track](https://secret.test/x)\n[x](javascript:alert) [y](data:text/html,x) [z](/api/private)');
    assert.ok(f.all().every(e => !['script', 'img', 'iframe', 'a'].includes(e.tag)));
    assert.ok(f.all().some(e => e.textContent?.includes('<script>')));
    assert.ok(f.all().every(e => !Object.hasOwn(e, 'innerHTML')));
});
test('Markdown malformed fences and oversized input remain bounded and explicitly marked', () => {
    const f = dom(); renderMarkdown(f.root, '```\n<img>'); assert.equal(f.all().find(e => e.tag === 'code').textContent, '<img>');
    renderMarkdown(f.root, 'a'.repeat(40000)); assert.ok(f.all().some(e => e.tag === 'small' && e.textContent.includes('truncated')));
});

for (const lang of ['zh', 'en']) test('Markdown truncation follows GUI language without rewriting original text / ' + lang, () => {
    const f = dom(); renderMarkdown(f.root, '原文'.repeat(20000), { lang });
    assert.equal(f.all().find(e => e.tag === 'small').textContent, lang === 'en' ? 'Display truncated' : '显示已截断');
    assert.ok(f.all().some(e => e.textContent?.includes('原文')));
});

test('Numbered findings keep their source numbers across explanatory paragraphs', () => {
    const f = dom(); renderMarkdown(f.root, '1. First finding\nDetails for the first finding.\n\n2. Second finding\nMore details.\n\n5. Fifth finding\n\n- Summary');
    const lists = f.all().filter(e => e.tag === 'ol');
    assert.deepEqual(lists.map(e => e.attrs.start), ['1', '2', '5']);
    assert.equal(lists[1].children[0].children[0].textContent, 'Second finding');
    assert.equal(f.all().find(e => e.tag === 'ul').children[0].children[0].textContent, 'Summary');
});
