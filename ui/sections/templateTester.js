import { registerSection } from './registry.js';

registerSection('templateTester', function (ctx) {
    const { settings, $c, renderPrompt } = ctx;

    $c('tester-run').on('click', async () => {
        const input = $c('tester-input').val();
        if (!input.trim()) return;
        $c('tester-output').val(settings.lang === 'zh' ? '渲染中...' : 'Rendering...');
        $c('tester-run').prop('disabled', true);

        // Parse locals if provided
        let locals = {};
        const localsRaw = $c('tester-locals').val().trim();
        if (localsRaw) {
            try { locals = JSON.parse(localsRaw); } catch (e) {
                $c('tester-output').val(`Locals JSON parse error: ${e.message}`);
                $c('tester-run').prop('disabled', false);
                return;
            }
        }

        try {
            const result = await renderPrompt(input, {}, {
                maxPasses: settings.templateMaxPasses ?? 5,
                recursive: settings.templateRecursive ?? true,
                debugPlaceholders: true,   // show unresolved {{...}} as-is in tester
                locals,
            });
            $c('tester-output').val(result);
        } catch (e) {
            $c('tester-output').val(`ERROR: ${e.message}`);
        }
        $c('tester-run').prop('disabled', false);
    });
});
