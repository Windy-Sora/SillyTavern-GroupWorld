/**
 * DOM utility helpers for Group Director settings panels.
 *
 * createDomUtils(saveSettings) returns:
 *   $c          — shorthand jQuery selector for #gd-{id} elements
 *   bindNumber  — number input with clamp
 *   bindCheckbox — checkbox input
 *   bindTextarea — textarea/input
 *   bindRadio   — radio group
 */

export function createDomUtils(saveSettings) {

    const $c = (sel) => $(`#gd-${sel}`);

    function bindNumber($el, setter, { min = 0, def = 0 } = {}) {
        $el.on('input', function () {
            const raw = parseInt($(this).val(), 10);
            const val = isNaN(raw) ? def : Math.max(min, raw);
            setter(val);
            saveSettings();
        });
    }

    function bindCheckbox($el, setter) {
        $el.on('input', function () { setter(!!$(this).prop('checked')); saveSettings(); });
    }

    function bindTextarea($el, setter) {
        $el.on('input', function () { setter($(this).val()); saveSettings(); });
    }

    function bindRadio(name, setter, afterChange) {
        $(`input[name="${name}"]`).on('change', function () {
            setter($(this).val());
            if (afterChange) afterChange($(this).val());
            saveSettings();
        });
    }

    return { $c, bindNumber, bindCheckbox, bindTextarea, bindRadio };
}