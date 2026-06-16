import { registerSection } from './registry.js';

registerSection('templateTester', function (ctx) {
    const { settings, $c, renderPrompt } = ctx;

    $c('tester-run').on('click', async () => {
        const input = $c('tester-input').val();
        if (!input.trim()) return;
        $c('tester-output').val(settings.lang === 'zh' ? '渲染中...' : 'Rendering...');
        $c('tester-run').prop('disabled', true);
        try {
            const result = await renderPrompt(input, {});
            $c('tester-output').val(result);
        } catch (e) {
            $c('tester-output').val(`ERROR: ${e.message}`);
        }
        $c('tester-run').prop('disabled', false);
    });
});
