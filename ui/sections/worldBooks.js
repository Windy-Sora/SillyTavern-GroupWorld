import { registerSection } from './registry.js';

registerSection('worldBooks', async function (ctx) {
    const { settings, $c, saveSettings, world_names, worldBookScanner, toastr } = ctx;
    const L = (zh, en) => (settings.lang === 'zh' ? zh : en);

    // Ensure selection object exists
    if (!settings.worldBookSelection) settings.worldBookSelection = {};
    if (!settings.worldBookSourceMode) settings.worldBookSourceMode = 'st';

    $c('world-book-source-mode').val(settings.worldBookSourceMode || 'st');
    $c('world-book-max-entries').val(settings.worldBookMaxEntries ?? 20);
    $c('world-book-source-mode').on('change', async () => {
        settings.worldBookSourceMode = $c('world-book-source-mode').val() || 'st';
        worldBookScanner?.clearCache?.();
        saveSettings();
        await refreshBookList();
        await refreshProviderPreview();
        window.__gdRefreshDashboard?.();
    });
    $c('world-book-max-entries').on('input', () => {
        settings.worldBookMaxEntries = Math.max(1, parseInt($c('world-book-max-entries').val()) || 20);
        worldBookScanner?.clearCache?.();
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

        const sourceMode = settings.worldBookSourceMode || 'st';
        const selectedNames = new Set(worldBookScanner?.getSelectedNames?.() || []);

        // Select all / deselect all buttons
        const toolbar = $('<div style="margin-bottom:6px;"></div>');
        const selectAll = $(`<span class="menu_button menu_button_icon" style="margin-right:4px;cursor:pointer;"><i class="fa-solid fa-check-double"></i> ${L('全选', 'Select All')}</span>`);
        const deselectAll = $(`<span class="menu_button menu_button_icon" style="cursor:pointer;"><i class="fa-solid fa-xmark"></i> ${L('取消全选', 'Deselect All')}</span>`);
        const modeHint = $(`<small style="display:block;color:var(--grey70a);margin-top:4px;"></small>`);
        modeHint.text(sourceMode === 'st'
            ? L('当前跟随 ST 激活世界书；如需手动维护，请切换来源模式。', 'Currently following ST active world books. Switch source mode to edit manually.')
            : L('当前使用下方手动勾选列表。', 'Currently using the manual selection below.'));

        selectAll.on('click', () => {
            if ((settings.worldBookSourceMode || 'st') === 'st') return;
            for (const name of names) settings.worldBookSelection[name] = true;
            worldBookScanner?.clearCache?.();
            refreshBookList();
            saveSettings();
            window.__gdRefreshDashboard?.();
        });
        deselectAll.on('click', () => {
            if ((settings.worldBookSourceMode || 'st') === 'st') return;
            settings.worldBookSelection = {};
            worldBookScanner?.clearCache?.();
            refreshBookList();
            saveSettings();
            window.__gdRefreshDashboard?.();
        });
        if (sourceMode === 'st') {
            selectAll.css({ opacity: 0.55, pointerEvents: 'none' });
            deselectAll.css({ opacity: 0.55, pointerEvents: 'none' });
        }

        toolbar.append(selectAll, deselectAll, modeHint);
        list.append(toolbar);

        for (const name of names) {
            const checked = sourceMode === 'st' ? selectedNames.has(name) : settings.worldBookSelection[name] === true;
            const label = $(`<label class="checkbox_label" style="display:flex;align-items:center;gap:6px;"></label>`);
            const input = $('<input type="checkbox">').attr('data-book', name);
            input.prop('checked', checked);
            input.prop('disabled', sourceMode === 'st');
            input.on('change', function () {
                settings.worldBookSelection[name] = !!$(this).prop('checked');
                worldBookScanner?.clearCache?.();
                saveSettings();
                refreshProviderPreview();
                window.__gdRefreshDashboard?.();
            });
            label.append(input, document.createTextNode(name));
            list.append(label);
        }
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            toastr.success(L('已复制', 'Copied'));
        } catch (_) {
            toastr.warning(text);
        }
    }

    async function refreshProviderPreview() {
        const $stats = $c('world-book-provider-stats');
        const $preview = $c('world-book-provider-preview');
        if (!worldBookScanner?.buildSnapshot) {
            $stats.text(L('世界书扫描器不可用', 'World book scanner unavailable'));
            return;
        }
        $stats.text(L('正在扫描世界书...', 'Scanning world books...'));
        try {
            const snap = await worldBookScanner.buildSnapshot();
            const mode = $c('world-book-provider-preview-mode').val() || 'constant';
            const text = mode === 'full'
                ? snap.fullText
                : mode === 'names'
                    ? snap.names.join('\n')
                    : snap.constantText;
            $preview.val(text || L('(空)', '(empty)'));
            $stats.text(L(
                `世界书 ${snap.stats.bookCount} 本；条目 ${snap.stats.entryCount} 条；无条件 ${snap.stats.constantCount} 条；全量 ${snap.stats.fullChars} 字；无条件 ${snap.stats.constantChars} 字`,
                `${snap.stats.bookCount} book(s); ${snap.stats.entryCount} entries; ${snap.stats.constantCount} always-on; full ${snap.stats.fullChars} chars; always-on ${snap.stats.constantChars} chars`,
            ));
        } catch (e) {
            $preview.val('');
            $stats.text((L('扫描失败：', 'Scan failed: ')) + e.message);
        }
    }

    await refreshBookList();
    await refreshProviderPreview();

    $c('world-book-refresh').on('click', async () => {
        worldBookScanner?.clearCache?.();
        await refreshBookList();
        await refreshProviderPreview();
        toastr.info(L('世界书列表已刷新', 'World book list refreshed'));
    });
    $c('world-book-provider-refresh').on('click', async () => {
        worldBookScanner?.clearCache?.();
        await refreshProviderPreview();
        toastr.info(L('世界书 Provider 已刷新', 'World book Provider refreshed'));
    });
    $c('world-book-provider-preview-mode').on('change', refreshProviderPreview);
    $c('world-book-copy-constant').on('click', () => copyText('{{gdWorldBooksConstant}}'));
    $c('world-book-copy-full').on('click', () => copyText('{{gdWorldBooksFull}}'));
    $c('world-book-copy-names').on('click', () => copyText('{{gdWorldBooksNames}}'));

    // Expose for quick-start mirror in drawer 1
    ctx.renderWorldBookList = async () => {
        await refreshBookList();
        await refreshProviderPreview();
    };
    window.__gdRefreshWorldBookList = ctx.renderWorldBookList;
});
