import { registerSection } from './registry.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../popup.js';

const DEFAULT_SCHEMA = JSON.stringify({
    directorCritique: {
        pacing: '节奏评价',
        spotlight: '焦点分配评价',
        suggestions: ['建议1', '建议2'],
    },
    characterCritiques: {
        '角色名': {
            consistency: '一致性评价',
            interaction: '互动表现评价',
            suggestions: ['建议1'],
        },
    },
}, null, 2);

function getDefaultPrompt(lang) {
    return lang === 'zh'
        ? `你是一个客观中立的群聊导演批判系统。回顾最近的对话内容，从以下角度进行分析。
重要：只批判AI角色的表现，绝对不要批判或评价User/用户的行为和发言。

1. 导演决策批判：
   - 是否合理安排了发言顺序？有没有角色被忽略或过度聚焦？
   - 节奏是否恰当？是否过快或过慢？
   - 有没有错过的关键话题或冲突点？

2. 角色表现批判（仅限AI角色，不含User）：
   - 角色言行是否一致？有没有出现OOC（角色偏差）？
   - 角色之间的互动是否自然、有推进剧情？
   - 有没有角色表现得过于被动或过于强势？

请以JSON格式输出，不要包含其他文字：
{
  "directorCritique": {
    "pacing": "节奏评价",
    "spotlight": "焦点分配评价",
    "suggestions": ["建议1", "建议2"]
  },
  "characterCritiques": {
    "角色名": {
      "consistency": "一致性评价",
      "interaction": "互动表现评价",
      "suggestions": ["建议1"]
    }
  }
}`
        : `You are an objective, neutral group chat critique system. Review the recent conversation and analyze.
IMPORTANT: Only critique AI character performance. Do NOT critique or judge the User's actions or messages.

1. Director Decision Critique:
   - Was the speaking order reasonable? Any characters ignored or over-focused?
   - Was the pacing appropriate? Too fast or too slow?
   - Any missed key topics or conflicts?

2. Character Performance Critique (AI characters only, NOT the User):
   - Are characters consistent in their words and actions? Any OOC (out-of-character) issues?
   - Are character interactions natural and plot-advancing?
   - Any characters too passive or too dominant?

Output ONLY a JSON object, no other text:
{
  "directorCritique": {
    "pacing": "pacing assessment",
    "spotlight": "spotlight distribution assessment",
    "suggestions": ["suggestion 1", "suggestion 2"]
  },
  "characterCritiques": {
    "CharacterName": {
      "consistency": "consistency assessment",
      "interaction": "interaction assessment",
      "suggestions": ["suggestion 1"]
    }
  }
}`;
}

registerSection('critique', function (ctx) {
    const { settings, $c, saveSettings, critiqueSystem, toastr, isRoundActive } = ctx;
    const cs = critiqueSystem;
    if (!cs) return;
    const defaultPrompt = getDefaultPrompt(settings.lang);

    // Init
    $c('critique-enabled').prop('checked', !!settings.critiqueEnabled);
    $c('critique-reuse').prop('checked', settings.critiqueReusePrevious !== false);
    $c('critique-prompt').val(settings.critiquePrompt || defaultPrompt);
    $c('critique-schema').val(settings.critiqueSchema || DEFAULT_SCHEMA);

    const checkEnabled = () => {
        const locked = isRoundActive ? isRoundActive() : false;
        const on = !!settings.critiqueEnabled && !locked;
        $c('critique-lock-warn').toggle(locked);
        $c('critique-reuse').prop('disabled', !settings.critiqueEnabled);
        $c('critique-prompt').prop('disabled', !settings.critiqueEnabled);
        $c('critique-schema').prop('disabled', !settings.critiqueEnabled);
        $c('critique-execute').prop('disabled', !on);
        $c('critique-regenerate').prop('disabled', !on);
        $c('critique-revert').prop('disabled', !on);
        $c('critique-reset').prop('disabled', !on);
        $c('critique-prompt-reset').prop('disabled', !settings.critiqueEnabled);
        $c('critique-schema-reset').prop('disabled', !settings.critiqueEnabled);
        $c('critique-refresh').prop('disabled', !on);
        $c('critique-result-save').prop('disabled', !on);
    };
    checkEnabled();

    // Toggle
    $c('critique-enabled').on('change', () => {
        settings.critiqueEnabled = !!$c('critique-enabled').prop('checked');
        checkEnabled();
        saveSettings();
    });

    // Auto critique
    $c('auto-critique-enabled').prop('checked', !!settings.autoCritiqueEnabled);
    $c('auto-critique-interval').val(settings.autoCritiqueInterval ?? 10);
    $c('auto-critique-enabled').on('change', () => {
        settings.autoCritiqueEnabled = !!$c('auto-critique-enabled').prop('checked');
        $('#gd-auto-critique-row').toggle(settings.autoCritiqueEnabled);
        saveSettings();
    });
    $c('auto-critique-interval').on('input', () => {
        settings.autoCritiqueInterval = Math.max(1, parseInt($c('auto-critique-interval').val()) || 10);
        saveSettings();
    });
    $('#gd-auto-critique-row').toggle(!!settings.autoCritiqueEnabled);

    // Reuse toggle
    $c('critique-reuse').on('change', () => {
        settings.critiqueReusePrevious = !!$c('critique-reuse').prop('checked');
        saveSettings();
    });

    // Prompt
    $c('critique-prompt').on('input', () => {
        settings.critiquePrompt = $c('critique-prompt').val();
        saveSettings();
    });
    $c('critique-prompt-reset').on('click', () => {
        $c('critique-prompt').val(defaultPrompt);
        settings.critiquePrompt = '';
        saveSettings();
        toastr.info(settings.lang === 'zh' ? '已恢复默认批判 Prompt' : 'Critique prompt reset to default');
    });

    // Schema
    $c('critique-schema').on('input', () => {
        settings.critiqueSchema = $c('critique-schema').val();
        saveSettings();
    });
    $c('critique-schema-reset').on('click', () => {
        $c('critique-schema').val(DEFAULT_SCHEMA);
        settings.critiqueSchema = '';
        saveSettings();
        toastr.info(settings.lang === 'zh' ? '已恢复默认 JSON Schema' : 'Critique schema reset to default');
    });

    // Save edited result
    $c('critique-result-save').on('click', async () => {
        if (isRoundActive && isRoundActive()) return;
        const text = $c('critique-result').val();
        const active = cs.getLatestActive();
        if (active) {
            active.content = text;
            // Try to re-parse JSON
            try {
                const firstBrace = text.indexOf('{');
                if (firstBrace >= 0) {
                    const raw = text.slice(firstBrace);
                    let s = raw;
                    s = s.replace(/,(\s*[}\]])/g, '$1');
                    s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ');
                    const parsed = JSON.parse(s);
                    active.data = parsed;
                }
            } catch (_) { /* keep old data */ }
            const { saveChatConditional } = ctx;
            if (saveChatConditional) await saveChatConditional();
            toastr.info(settings.lang === 'zh' ? '批判已更新' : 'Critique updated');
        }
        refreshStatus();
    });

    // Execute
    $c('critique-execute').on('click', async () => {
        if (isRoundActive && isRoundActive()) return;
        const $btn = $c('critique-execute');
        const origText = $btn.text();
        $btn.prop('disabled', true);
        $btn.text(settings.lang === 'zh' ? '执行中...' : 'Running...');
        try {
            const entry = await cs.generateCritique();
            refreshStatus();
            toastr.success(settings.lang === 'zh'
                ? `批判完成，覆盖 ${entry.rangeEnd} 条消息`
                : `Critique complete, covers ${entry.rangeEnd} messages`);
        } catch (e) {
            toastr.error(e.message || (settings.lang === 'zh' ? '批判失败' : 'Critique failed'));
        }
        $btn.prop('disabled', false);
        $btn.text(origText);
    });

    // Regenerate
    $c('critique-regenerate').on('click', async () => {
        if (isRoundActive && isRoundActive()) return;
        const $btn = $c('critique-regenerate');
        const origText = $btn.text();
        $btn.prop('disabled', true);
        $btn.text(settings.lang === 'zh' ? '重新生成中...' : 'Regenerating...');
        try {
            await cs.regenerateLastCritique();
            refreshStatus();
            toastr.success(settings.lang === 'zh' ? '已重新批判' : 'Regenerated critique');
        } catch (e) {
            toastr.error(e.message || (settings.lang === 'zh' ? '重新批判失败' : 'Regenerate failed'));
        }
        $btn.prop('disabled', false);
        $btn.text(origText);
    });

    // Revert
    $c('critique-revert').on('click', async () => {
        if (isRoundActive && isRoundActive()) return;
        if (!await callGenericPopup(settings.lang === 'zh' ? '回退本次批判？' : 'Revert this critique?', POPUP_TYPE.CONFIRM)) return;
        await cs.revertLastCritique();
        refreshStatus();
        toastr.info(settings.lang === 'zh' ? '已回退批判' : 'Critique reverted');
    });

    // Refresh
    $c('critique-refresh').on('click', () => {
        refreshStatus();
        toastr.info(settings.lang === 'zh' ? '批判状态已刷新' : 'Critique status refreshed');
    });

    // Reset
    $c('critique-reset').on('click', async () => {
        if (isRoundActive && isRoundActive()) return;
        if (!await callGenericPopup(settings.lang === 'zh' ? '关闭全部批判？' : 'Deactivate all critiques?', POPUP_TYPE.CONFIRM)) return;
        await cs.resetAll();
        refreshStatus();
        toastr.info(settings.lang === 'zh' ? '已重置全部批判' : 'All critiques reset');
    });

    function refreshStatus() {
        const active = cs.getLatestActive();
        const { getChat } = ctx;
        const chatLen = getChat ? getChat().length : 0;
        if (active) {
            const remaining = Math.max(0, chatLen - active.rangeEnd);
            $c('critique-status').text(settings.lang === 'zh'
                ? `上次批判位置：第 ${active.rangeEnd} 条 | 未批判：${remaining} 条 | 总计：${chatLen} 条`
                : `Last critique at: #${active.rangeEnd} | Uncensored: ${remaining} | Total: ${chatLen}`);
            $c('critique-result').val(active.content || '');
            $c('critique-result-section').show();
        } else {
            $c('critique-status').text(settings.lang === 'zh'
                ? `未批判 | 总计：${chatLen} 条消息`
                : `No critique | Total: ${chatLen} messages`);
            $c('critique-result').val('');
            $c('critique-result-section').hide();
        }
    }
    refreshStatus();

    if (cs.getLatestActive()) {
        $c('critique-result-section').show();
    } else {
        $c('critique-result-section').hide();
    }
});
