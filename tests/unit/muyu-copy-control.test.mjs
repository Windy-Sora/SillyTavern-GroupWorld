import test from 'node:test';
import assert from 'node:assert/strict';
import { createCopyControl } from '../../muyu/ui/copy-control.js';
import { renderMarkdown } from '../../muyu/ui/markdown.js';

function fixture(clipboard) {
    const doc = { defaultView: { navigator: { clipboard } }, createElement(tag) { return { tag, ownerDocument: doc, attrs: {}, children: [], append(el) { this.children.push(el); }, replaceChildren() { this.children = []; }, setAttribute(k, v) { this.attrs[k] = v; } }; } };
    const root = doc.createElement('div'), all = (el = root) => [el, ...el.children.flatMap(all)];
    return { doc, root, all };
}

for (const lang of ['zh', 'en']) test(`Copy writes exact original only on click and gives localized feedback / ${lang}`, async () => {
    const copied = [], f = fixture({ writeText: async text => copied.push(text) });
    const control = createCopyControl({ doc: f.doc, parent: f.root, lang, text: '**原文**\n<script>reference</script>' });
    const button = f.all().find(el => el.tag === 'button'), status = f.all().find(el => el.attrs.role === 'status');
    assert.equal(copied.length, 0); assert.equal(button.type, 'button'); assert.equal(status.attrs['aria-live'], 'polite');
    assert.equal(button.textContent, lang === 'en' ? 'Copy original' : '复制原文');
    await button.onclick(); assert.deepEqual(copied, ['**原文**\n<script>reference</script>']);
    assert.equal(status.textContent, lang === 'en' ? 'Copied' : '已复制'); assert.equal(button.disabled, false); control.dispose();
});

for (const lang of ['zh', 'en']) for (const missing of [false, true]) test(`Clipboard unavailable or rejected is not called success / ${lang}/${missing}`, async () => {
    const f = fixture(missing ? undefined : { writeText: async () => { throw Error('private service detail'); } });
    const control = createCopyControl({ doc: f.doc, parent: f.root, lang, text: 'text' });
    await f.all().find(el => el.tag === 'button').onclick();
    const status = f.all().find(el => el.attrs.role === 'status');
    assert.match(status.textContent, lang === 'en' ? /manually/ : /手动/); assert.doesNotMatch(status.textContent, /private/); control.dispose();
});

for (const reject of [false, true]) test(`Double clicks and late clipboard completion after disposal cannot update old UI / ${reject}`, async () => {
    let settle, calls = 0; const f = fixture({ writeText: () => { calls++; return new Promise((resolve, failure) => { settle = reject ? failure : resolve; }); } });
    const control = createCopyControl({ doc: f.doc, parent: f.root, lang: 'en', text: 'text' });
    const button = f.all().find(el => el.tag === 'button'), status = f.all().find(el => el.attrs.role === 'status'), old = button.onclick;
    const first = old(); await old(); assert.equal(calls, 1); assert.equal(button.disabled, true);
    control.dispose(); control.dispose(); settle(); await first; await old();
    assert.equal(calls, 1); assert.equal(status.textContent, 'Copying…'); assert.equal(button.disabled, true);
});

for (const lang of ['zh', 'en']) test(`Code/table scroll regions are keyboard reachable and code copy never parses or runs it / ${lang}`, async () => {
    const copied = [], f = fixture({ writeText: async text => copied.push(text) });
    const dispose = renderMarkdown(f.root, '| A | B |\n| --- | --- |\n| wide | cell |\n\n```js\n<script>data</script>\n  keep whitespace\n```', { lang });
    const regions = f.all().filter(el => el.attrs.role === 'region');
    assert.equal(regions.length, 2); for (const region of regions) { assert.equal(region.attrs.tabindex, '0'); assert.match(region.attrs['aria-label'], lang === 'en' ? /scrollable/ : /滚动/); }
    const copy = f.all().find(el => el.tag === 'button'); assert.equal(copy.textContent, lang === 'en' ? 'Copy displayed code' : '复制所示代码');
    await copy.onclick(); assert.deepEqual(copied, ['<script>data</script>\n  keep whitespace']);
    assert.equal(f.all().some(el => el.tag === 'script'), false);
    const old = copy.onclick; renderMarkdown(f.root, 'replacement', { lang }); await old(); assert.equal(copied.length, 1); dispose();
});
