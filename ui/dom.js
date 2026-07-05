/**
 * DOM utility helpers for Group World settings panels.
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

    /**
     * bindSetting — one-liner for the common init+bind pattern.
     *
     * Usage:
     *   bindSetting($c('llm-max-speakers'), {
     *       get: () => settings.llmMaxSpeakers,
     *       set: (v) => { settings.llmMaxSpeakers = v; },
     *       parse: (v) => Math.max(1, parseInt(v) || 3),
     *   });
     *
     * For checkboxes, omit `parse` and use `get: () => !!prop('checked')`.
     * The helper auto-detects :checkbox / :radio elements.
     */
    function bindSetting($el, { get, set, parse, afterSet } = {}) {
        if (!$el || !$el.length) return;
        const isCheckbox = $el.is(':checkbox') || $el.is(':radio');

        // Init
        const initial = get();
        if (isCheckbox) {
            $el.prop('checked', !!initial);
        } else {
            $el.val(initial != null ? initial : '');
        }

        // Bind
        $el.on(isCheckbox ? 'input' : 'input', function () {
            let val;
            if (isCheckbox) {
                val = !!$(this).prop('checked');
            } else {
                val = $(this).val();
                if (parse) val = parse(val);
            }
            set(val);
            if (afterSet) afterSet(val);
            saveSettings();
        });

        // Select elements need 'change' too (for option selection)
        if ($el.is('select')) {
            $el.on('change', function () {
                let val = $(this).val();
                if (parse) val = parse(val);
                set(val);
                if (afterSet) afterSet(val);
                saveSettings();
            });
        }
    }

    return { $c, bindNumber, bindCheckbox, bindTextarea, bindRadio, bindSetting };
}