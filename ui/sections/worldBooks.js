import { registerSection } from './registry.js';

registerSection('worldBooks', async function (ctx) {
    const { settings, $c, saveSettings, world_names, loadWorldInfo, toastr } = ctx;

    // Ensure selection object exists
    if (!settings.worldBookSelection) settings.worldBookSelection = {};

    $c('world-book-max-entries').val(settings.worldBookMaxEntries ?? 20);
    $c('world-book-max-entries').on('input', () => {
        settings.worldBookMaxEntries = Math.max(1, parseInt($c('world-book-max-entries').val()) || 20);
        saveSettings();
    });

    // Build world book checkbox list
    async function refreshBookList() {
        const list = $('#gd-world-book-list');
        list.empty();
        const names = world_names || [];

        if (names.length === 0) {
            list.append(`<small>${settings.lang === 'zh' ? '未找到任何世界书' : 'No world books found'}</small>`);
            return;
        }

        // Select all / deselect all buttons
        const toolbar = $('<div style="margin-bottom:6px;"></div>');
        const selectAll = $(`<span class="menu_button menu_button_icon" style="margin-right:4px;cursor:pointer;"><i class="fa-solid fa-check-double"></i> ${settings.lang === 'zh' ? '全选' : 'Select All'}</span>`);
        const deselectAll = $(`<span class="menu_button menu_button_icon" style="cursor:pointer;"><i class="fa-solid fa-xmark"></i> ${settings.lang === 'zh' ? '取消全选' : 'Deselect All'}</span>`);

        selectAll.on('click', () => {
            for (const name of names) settings.worldBookSelection[name] = true;
            refreshBookList();
            saveSettings();
        });
        deselectAll.on('click', () => {
            settings.worldBookSelection = {};
            refreshBookList();
            saveSettings();
        });

        toolbar.append(selectAll, deselectAll);
        list.append(toolbar);

        for (const name of names) {
            const checked = settings.worldBookSelection[name] === true;
            const label = $(`<label class="checkbox_label" style="display:flex;align-items:center;gap:6px;"></label>`);
            const input = $(`<input type="checkbox" data-book="${name}">`);
            input.prop('checked', checked);
            input.on('change', function () {
                settings.worldBookSelection[name] = !!$(this).prop('checked');
                saveSettings();
            });
            label.append(input, name);
            list.append(label);
        }
    }

    await refreshBookList();

    $c('world-book-refresh').on('click', async () => {
        await refreshBookList();
        toastr.info(settings.lang === 'zh' ? '世界书列表已刷新' : 'World book list refreshed');
    });
});
