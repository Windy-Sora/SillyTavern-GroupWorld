import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../../ui/sections/exportImport.js', import.meta.url), 'utf8');

function fixture(actions) {
    const notices = [];
    const elements = new Map();
    for (const id of ['export-group', 'import-group', 'import-file-input']) {
        const handlers = new Map();
        elements.set(id, {
            disabled: false,
            value: 'selected.zip',
            files: [{ name: 'selected.zip' }],
            on(event, handler) { handlers.set(event, handler); },
            prop(name, value) { this[name] = value; },
            val(value) { this.value = value; },
            trigger(event) { return handlers.get(event)?.call(this); },
        });
    }
    const context = {
        $c: id => elements.get(id),
        settings: { lang: 'en' },
        getCurrentGroup: () => ({ members: ['alice.png'] }),
        ...actions,
    };
    vm.runInNewContext(source.slice(source.indexOf('registerSection(')), {
        registerSection(_name, init) { init(context); },
        $: element => element,
        toastr: { error: message => notices.push(message) },
        console: { error() {} },
    });
    return { elements, notices };
}

test('group export UI reports unexpected rejection and re-enables its button', async () => {
    const subject = fixture({ exportGroup: async () => { throw new Error('export failed'); } });
    const button = subject.elements.get('export-group');
    await button.trigger('click');
    assert.equal(button.disabled, false);
    assert.deepEqual(subject.notices, ['Group export failed']);
});

test('group import UI reports unexpected rejection, resets input, and re-enables its button', async () => {
    const subject = fixture({ importGroup: async () => { throw new Error('import failed'); } });
    const button = subject.elements.get('import-group');
    const input = subject.elements.get('import-file-input');
    await input.trigger('change');
    assert.equal(button.disabled, false);
    assert.equal(input.value, '');
    assert.deepEqual(subject.notices, ['Group import failed']);
});
