import { registerSection } from './registry.js';

registerSection('exportImport', function (ctx) {
    const { $c, settings, getCurrentGroup } = ctx;

    // ── Export button ──
    $c('export-group').on('click', async function () {
        const group = getCurrentGroup();
        if (!group) {
            toastr.warning(settings.lang === 'zh'
                ? '请先在群聊中打开此设置面板'
                : 'Please open this settings panel from within a group chat');
            return;
        }
        const btn = $(this);
        btn.prop('disabled', true);
        try {
            await ctx.exportGroup();
        } finally {
            btn.prop('disabled', false);
        }
    });

    // ── Import button & hidden file input ──
    $c('import-group').on('click', function () {
        $c('import-file-input').trigger('click');
    });

    $c('import-file-input').on('change', async function () {
        const file = this.files?.[0];
        if (!file) return;
        const btn = $c('import-group');
        btn.prop('disabled', true);
        try {
            await ctx.importGroup(file);
        } finally {
            btn.prop('disabled', false);
            // Reset so the same file can be re-selected
            $(this).val('');
        }
    });
});
