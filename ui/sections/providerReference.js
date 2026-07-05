import { registerSection } from './registry.js';

const DEFAULT_ENTRIES = [
    { id: 'd1', placeholder: '{{recentMessages}}', name: 'Recent Messages', descZh: '最近的聊天消息，用于给 LLM 提供对话上下文。消息数由"最近消息条数"设置控制。', descEn: 'Recent chat messages for LLM context. Number controlled by recentMessageCount.' },
    { id: 'd2', placeholder: '{{newRecentMessages}}', name: 'New Recent Messages', descZh: '与 {{recentMessages}} 类似，但只包含上次生成后新增的消息，避免重复上下文。', descEn: 'Like {{recentMessages}} but only contains messages since last generation, avoiding duplicate context.' },
    { id: 'd3', placeholder: '{{characters}}', name: 'Characters', descZh: '当前群组中所有角色的名称列表，用于向 LLM 介绍可用角色。', descEn: 'List of all character names in the current group.' },
    { id: 'd4', placeholder: '{{character_profiles}}', name: 'Character Profiles', descZh: '当前群组中所有角色的详细档案（描述、性格等），受角色档案系统控制。', descEn: 'Detailed profiles of all characters in the group (descriptions, personality, etc.), controlled by the Profile system.' },
    { id: 'd5', placeholder: '{{characterLore}}', name: 'Character Lore', descZh: '当前发言角色的额外 Lore 信息，来自世界书中的角色绑定条目。', descEn: 'Extra lore entries for the currently speaking character from world books.' },
    { id: 'd6', placeholder: '{{worldInfo}}', name: 'World Info', descZh: '当前激活的世界书条目内容，用于向 LLM 注入世界观设定。', descEn: 'Currently active world book entries for world-building context.' },
    { id: 'd7', placeholder: '{{worldBooks}}', name: 'World Books', descZh: '所有可用世界书的列表及其条目信息，供 LLM 了解可用的世界设定。', descEn: 'List of all available world books and their entries.' },
    { id: 'd8', placeholder: '{{worldBookImportance}}', name: 'World Book Importance', descZh: '当前世界书条目的重要性评分/排序信息。', descEn: 'Importance scores/ordering for current world book entries.' },
    { id: 'd9', placeholder: '{{directorLedger}}', name: 'Director Ledger', descZh: '导演账本中记录的所有历史发言轮次，包含发言人、原因等决策记录。', descEn: 'All historical speaking rounds from the director ledger with speakers, reasons, etc.' },
    { id: 'd10', placeholder: '{{directorHistory}}', name: 'Director History', descZh: '导演历史发言顺序的简化摘要，比账本更紧凑。', descEn: 'A compact summary of historical director speaking orders.' },
    { id: 'd11', placeholder: '{{previousPlan}}', name: 'Previous Plan', descZh: '上一轮的导演计划/决策内容，用于保持连贯性。', descEn: 'Previous round\'s director plan for continuity.' },
    { id: 'd12', placeholder: '{{previousPlans}}', name: 'Previous Plans', descZh: '多轮历史导演计划列表，用于连续性模式。', descEn: 'Multiple previous director plans for continuity mode.' },
    { id: 'd13', placeholder: '{{systemTime}}', name: 'System Time', descZh: '当前系统时间（日期+时间），用于需要时间感知的场景。', descEn: 'Current system date and time for time-aware scenarios.' },
    { id: 'd14', placeholder: '{{timeOfDay}}', name: 'Time of Day', descZh: '根据系统时间自动判断的时段描述（如"清晨"、"午后"、"深夜"）。', descEn: 'Time-of-day description derived from system time (e.g., "early morning", "afternoon", "late night").' },
    { id: 'd15', placeholder: '{{moonPhase}}', name: 'Moon Phase', descZh: '当前日期的月相信息（新月、满月等），适用于需要月相的场景。', descEn: 'Current moon phase (new moon, full moon, etc.) for lunar-aware scenarios.' },
    { id: 'd16', placeholder: '{{dice}}', name: 'Dice (Symbolic)', descZh: '符号骰子（如 ⚀⚁⚂），用于在 Prompt 中注入随机元素。', descEn: 'Symbolic dice (e.g. ⚀⚁⚂) for injecting randomness into prompts.' },
    { id: 'd17', placeholder: '{{randomDice}}', name: 'Random Dice (Numeric)', descZh: '数字骰子结果（1-6），每次渲染时随机生成。', descEn: 'Numeric dice result (1-6), randomly generated on each render.' },
    { id: 'd18', placeholder: '{{knowledge}}', name: 'Knowledge', descZh: '用户在设置中输入的知识/背景文本，用于向 LLM 注入自定义世界观。', descEn: 'User-defined knowledge/background text from settings for injecting custom world-building.' },
    { id: 'd19', placeholder: '{{chatSummary}}', name: 'Chat Summary', descZh: 'AI 自动生成的聊天摘要文本，用于在不发送完整历史的情况下保持上下文。受摘要系统控制。', descEn: 'AI-generated chat summary for context without sending full history. Controlled by the Summary system.' },
    { id: 'd20', placeholder: '{{importedSummary}}', name: 'Imported Summary', descZh: '从外部导入的聊天摘要内容，可在摘要导入面板中管理。', descEn: 'Externally imported chat summary content, managed in the Summary Import panel.' },
    { id: 'd21', placeholder: '{{directorCritique}}', name: 'Director Critique', descZh: 'AI 批判系统对导演决策的评估文本（节奏、焦点等），受批判系统控制。', descEn: 'AI critique assessment of director decisions (pacing, spotlight, etc.). Controlled by the Critique system.' },
    { id: 'd22', placeholder: '{{characterCritique}}', name: 'Character Critique (JSON)', descZh: 'AI 批判系统对各角色表现的 JSON 数据，支持 DSL 查询（如 {{?characterCritique:角色名.consistency}}）。', descEn: 'JSON data of character performance critiques. Supports DSL queries (e.g., {{?characterCritique:CharName.consistency}}).' },
    { id: 'd23', placeholder: '{{charCritique}}', name: 'Char Critique (Text)', descZh: '当前发言角色的批判文本（自动识别角色名），以可读格式输出该角色的各项评价。', descEn: 'Readable critique text for the currently speaking character, auto-resolved by character name.' },
    { id: 'd24', placeholder: '{{importedCritique}}', name: 'Imported Critique', descZh: '从外部导入的批判内容，可在批判导入面板中管理。', descEn: 'Externally imported critique content, managed in the Critique Import panel.' },
    { id: 'd25', placeholder: '{{identity}}', name: 'Identity', descZh: '系统身份 Prompt，定义 AI 的角色和基本行为准则。', descEn: 'System identity prompt defining AI role and basic behavior guidelines.' },
    { id: 'd26', placeholder: '{{npcList}}', name: 'NPC List', descZh: 'AI 生成的 NPC 列表，受 NPC 生成系统控制。', descEn: 'AI-generated NPC list, controlled by the NPC Generation system.' },
    { id: 'd27', placeholder: '{{charMemory}}', name: 'Character Memory', descZh: '当前角色被提取的所有长期记忆条目。', descEn: 'All extracted long-term memory entries for the current character.' },
    { id: 'd28', placeholder: '{{charMemoryCurrent}}', name: 'Character Memory (Current)', descZh: '当前角色最近一次提取的记忆条目（仅最新一批）。', descEn: 'Only the most recent batch of extracted memories for the current character.' },
    { id: 'd29', placeholder: '{{script}}', name: 'Director Script', descZh: '当前角色的导演剧本内容，仅在角色 Prompt 注入模版中使用，由 {{scriptField}} 和导演剧本系统控制。', descEn: 'The current character\'s director script, only used in the Character Prompt Injection Template. Controlled by {{scriptField}} and the Director Script system.' },
    { id: 'd30', placeholder: '{{maxSpeakers}}', name: 'Max Speakers', descZh: '每轮最多发言人数（设置中的配置值），可在 Prompt 中引用以告知 LLM 当前限制。', descEn: 'Maximum speakers per round (from settings). Reference in prompts to inform the LLM of the current limit.' },
    { id: 'd31', placeholder: '{{llmJsonSchema}}', name: 'LLM JSON Schema', descZh: '用户可自定义的 JSON 输出格式模板，决定 LLM 返回的 JSON 结构。包含 {{scriptField}} 占位符用于控制 scripts 字段的有无。', descEn: 'User-customizable JSON output format template that defines the JSON structure the LLM returns. Contains {{scriptField}} placeholder to control the scripts field.' },
    { id: 'd32', placeholder: '{{scriptField}}', name: 'Script Field', descZh: '展开为 scripts 字段的 JSON 片段（开启导演剧本时）或空字符串（关闭时），嵌入在 {{llmJsonSchema}} 中使用。', descEn: 'Expands to a scripts JSON fragment when Director Script is enabled, or empty string when disabled. Used within {{llmJsonSchema}}.' },
    { id: 'd33', placeholder: '{{test}}', name: 'Test Provider', descZh: '测试用接口，占位文本，用于验证 Provider 系统是否正常工作。', descEn: 'Test provider returning placeholder text to verify the Provider system works.' },
];

let nextUserIdx = 0;
function genId() { return `u_${Date.now()}_${++nextUserIdx}`; }

registerSection('providerReference', function (ctx) {
    const { settings, $c, saveSettings } = ctx;
    const isZh = () => (settings.lang || 'zh') === 'zh';

    // Init list
    if (!settings.providerReferenceList || !settings.providerReferenceList.length) {
        settings.providerReferenceList = DEFAULT_ENTRIES.map(e => ({ ...e }));
        saveSettings();
    }
    const list = settings.providerReferenceList;

    function save() {
        settings.providerReferenceList = list;
        saveSettings();
    }

    // ── Render ──

    function render() {
        const query = ($c('provider-ref-search').val() || '').toLowerCase().trim();
        const filtered = query
            ? list.filter(e => e.placeholder.toLowerCase().includes(query) || e.name.toLowerCase().includes(query) || ((isZh() ? e.descZh : e.descEn) || '').toLowerCase().includes(query))
            : list;

        const $container = $('#gd-provider-ref-list');
        if (!filtered.length) {
            $container.html(`<small style="color:var(--grey70a);">${isZh() ? '无匹配结果' : 'No matches'}</small>`);
            return;
        }

        const html = filtered.map(e => {
            const desc = isZh() ? (e.descZh || e.descEn) : (e.descEn || e.descZh);
            const isUser = e.id && e.id.startsWith('u_');
            return `
            <div class="gd-provider-ref-entry" style="border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:6px;margin-top:4px;">
                <div style="display:flex;align-items:flex-start;gap:6px;">
                    <code style="background:var(--grey20a);padding:2px 6px;border-radius:3px;font-size:0.85em;white-space:nowrap;flex-shrink:0;">${escHtml(e.placeholder)}</code>
                    <span style="font-weight:bold;font-size:0.9em;flex:1;min-width:0;">${escHtml(e.name)}</span>
                    <span class="menu_button menu_button_icon gd-provider-ref-edit" data-id="${escAttr(e.id)}" style="font-size:0.7em;flex-shrink:0;" title="${isZh() ? '编辑' : 'Edit'}"><i class="fa-solid fa-pen-to-square"></i></span>
                    ${isUser ? `<span class="menu_button menu_button_icon gd-provider-ref-delete" data-id="${escAttr(e.id)}" style="font-size:0.7em;flex-shrink:0;color:#ff5555;" title="${isZh() ? '删除' : 'Delete'}"><i class="fa-solid fa-trash"></i></span>` : ''}
                </div>
                <div style="font-size:0.8em;color:var(--grey70a);margin-top:2px;margin-left:2px;">${escHtml(desc)}</div>
            </div>`;
        }).join('');

        $container.html(html);

        // Edit
        $container.find('.gd-provider-ref-edit').off('click').on('click', function () {
            const id = $(this).data('id');
            editEntry(id);
        });

        // Delete
        $container.find('.gd-provider-ref-delete').off('click').on('click', function () {
            const id = $(this).data('id');
            const idx = list.findIndex(e => e.id === id);
            if (idx >= 0) {
                list.splice(idx, 1);
                save();
                render();
            }
        });
    }

    function editEntry(id) {
        const entry = list.find(e => e.id === id);
        if (!entry) return;

        const name = prompt(isZh() ? '接口名称：' : 'Provider name:', entry.name || '');
        if (name === null) return;
        const placeholder = prompt(isZh() ? '占位符（如 {{myProvider}}）：' : 'Placeholder (e.g. {{myProvider}}):', entry.placeholder || '');
        if (placeholder === null) return;
        if (!placeholder.trim()) {
            toastr.warning(isZh() ? '占位符不能为空' : 'Placeholder cannot be empty');
            return;
        }
        const desc = prompt(isZh() ? '描述：' : 'Description:', isZh() ? (entry.descZh || '') : (entry.descEn || ''));
        if (desc === null) return;

        if (isZh()) {
            entry.descZh = desc;
        } else {
            entry.descEn = desc;
        }
        entry.name = name;
        entry.placeholder = placeholder;
        save();
        render();
    }

    // ── Add ──

    $c('provider-ref-add').off('click').on('click', () => {
        const name = prompt(isZh() ? '接口名称：' : 'Provider name:');
        if (!name || !name.trim()) return;
        const placeholder = prompt(isZh() ? '占位符（如 {{myProvider}}）：' : 'Placeholder (e.g. {{myProvider}}):');
        if (!placeholder || !placeholder.trim()) return;
        const desc = prompt(isZh() ? '描述：' : 'Description:');
        if (desc === null) return;

        list.push({
            id: genId(),
            name: name.trim(),
            placeholder: placeholder.trim(),
            descZh: isZh() ? desc : '',
            descEn: isZh() ? '' : desc,
        });
        save();
        render();
    });

    // ── Reset ──

    $c('provider-ref-reset').off('click').on('click', () => {
        settings.providerReferenceList = DEFAULT_ENTRIES.map(e => ({ ...e }));
        save();
        render();
    });

    // ── Export ──

    $c('provider-ref-export').off('click').on('click', () => {
        const json = JSON.stringify(list, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `provider-reference-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // ── Import ──

    $c('provider-ref-import').off('click').on('click', () => {
        $('#gd-provider-ref-import-file').click();
    });

    $c('provider-ref-import-file').off('change').on('change', function () {
        const file = this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function () {
            try {
                const data = JSON.parse(reader.result);
                if (!Array.isArray(data)) throw new Error('Not an array');
                for (const e of data) {
                    if (!e.id || !e.placeholder || !e.name) throw new Error('Missing required field (id/placeholder/name)');
                }
                // Merge by placeholder (same placeholder = update, new placeholder = add)
                let updated = 0, added = 0;
                for (const e of data) {
                    const idx = list.findIndex(x => x.placeholder === e.placeholder);
                    if (idx >= 0) {
                        list[idx] = e;
                        updated++;
                    } else {
                        e.id = genId(); // fresh id to avoid collision
                        list.push(e);
                        added++;
                    }
                }
                save();
                render();
                const msg = isZh()
                    ? `导入完成：更新 ${updated} 条，新增 ${added} 条`
                    : `Import done: ${updated} updated, ${added} added`;
                toastr.success(msg);
            } catch (e) {
                toastr.error((isZh() ? '导入失败：' : 'Import failed: ') + e.message);
            }
        };
        reader.readAsText(file);
        this.value = '';
    });

    // ── Search ──

    $c('provider-ref-search').off('input').on('input', () => render());

    // ── Initial ──

    render();
});

function escHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
}
