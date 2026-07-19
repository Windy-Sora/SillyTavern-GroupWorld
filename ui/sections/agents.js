import { registerSection } from './registry.js';

const AGENT_DISPLAY = {
    director:    { zh: '导演 (Director)',        en: 'Director' },
    'force-speak': { zh: '强制发言 (Force Speak)', en: 'Force Speak' },
    profile:     { zh: '角色档案 (Profile)',       en: 'Profile' },
    summary:     { zh: '上下文总结 (Summary)',     en: 'Summary' },
    critique:    { zh: '批判 (Critique)',         en: 'Critique' },
    'story-blueprint': { zh: '故事蓝图 (Story Blueprint)', en: 'Story Blueprint' },
};

const CONFIG_ONLY_AGENTS = [
    {
        id: 'story-blueprint',
        displayName: 'Story Blueprint',
        contextAccess: ['chat', 'settings', 'providers'],
        pipelineOrder: ['prompt', 'call', 'parse'],
    },
];

const DEFAULT_AGENT_CONFIG = {
    useCustom: false,
    protocol: 'openai',
    endpoint: '',
    apiKey: '',
    model: '',
    call: { retries: 2, timeout: 30000 },
    strictMode: false,
};

function ensureConfig(settings, agentId) {
    if (!settings.agentConfigs) settings.agentConfigs = {};
    if (!settings.agentConfigs[agentId]) {
        settings.agentConfigs[agentId] = { ...DEFAULT_AGENT_CONFIG };
    }
    return settings.agentConfigs[agentId];
}

async function fetchModels(endpoint, apiKey, protocol) {
    if (protocol === 'anthropic') {
        return { error: 'Anthropic does not provide a public model list endpoint. Check docs for available models.' };
    }
    const base = endpoint.replace(/\/+$/, '');
    try {
        const resp = await fetch(`${base}/v1/models`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
        });
        if (!resp.ok) {
            const err = await resp.text().catch(() => '');
            return { error: `HTTP ${resp.status}: ${err.substring(0, 300)}` };
        }
        const data = await resp.json();
        // OpenAI returns { data: [{ id: 'gpt-4o' }, ...] }
        // Ollama returns { models: [{ name: 'llama3' }, ...] }
        const models = data.data?.map(m => m.id) ??
                       data.models?.map(m => m.name) ??
                       (Array.isArray(data) ? data.map(m => m.id || m.name || m) : []);
        return { models };
    } catch (e) {
        return { error: e.message };
    }
}

registerSection('agents', function (ctx) {
    const { settings, $c, saveSettings, AgentRegistry, createCaller, getContext } = ctx;
    const lang = settings.lang || 'zh';
    const registeredAgents = AgentRegistry.list();
    const registeredIds = new Set(registeredAgents.map(a => a.id));
    const agents = registeredAgents.concat(CONFIG_ONLY_AGENTS.filter(a => !registeredIds.has(a.id)));

    const container = $('#gd-agents-list');
    if (!container.length) return;

    container.empty();

    for (const agent of agents) {
        const cfg = ensureConfig(settings, agent.id);
        const displayName = (AGENT_DISPLAY[agent.id] || {})[lang] || agent.displayName || agent.id;
        const modelListId = `gd-model-list-${agent.id}`;

        const block = $(`
            <div class="gd-agent-block" style="border:1px solid var(--SmartThemeBorderColor);border-radius:6px;padding:8px;margin-bottom:8px;">
                <label class="checkbox_label" style="font-weight:bold;">
                    <input type="checkbox" class="gd-agent-use-custom" data-agent="${agent.id}">
                    <span>${displayName}</span>
                </label>
                <div class="gd-agent-config" data-agent="${agent.id}" style="display:none;margin-top:6px;">
                    <label>${lang === 'zh' ? '协议' : 'Protocol'}</label>
                    <select class="gd-agent-protocol text_pole" data-agent="${agent.id}" style="width:100%;">
                        <option value="openai">OpenAI Compatible</option>
                        <option value="anthropic">Anthropic Compatible</option>
                    </select>
                    <label style="margin-top:4px;">Endpoint</label>
                    <input type="text" class="gd-agent-endpoint text_pole" data-agent="${agent.id}" style="width:100%;" placeholder="https://api.openai.com">
                    <label style="margin-top:4px;">API Key</label>
                    <input type="password" class="gd-agent-apikey text_pole" data-agent="${agent.id}" style="width:100%;" placeholder="sk-...">
                    <label style="margin-top:4px;">Model</label>
                    <div style="display:flex;gap:4px;align-items:center;">
                        <input type="text" class="gd-agent-model text_pole" data-agent="${agent.id}" style="flex:1;" placeholder="gpt-4o" list="${modelListId}">
                        <span class="menu_button menu_button_icon gd-agent-fetch-models" data-agent="${agent.id}" style="font-size:0.8em;white-space:nowrap;" title="${lang === 'zh' ? '获取可用模型列表' : 'Fetch available models'}">
                            <i class="fa-solid fa-list"></i>
                        </span>
                    </div>
                    <select class="gd-agent-model-select text_pole" data-agent="${agent.id}" style="width:100%;margin-top:4px;display:none;">
                        <option value="">${lang === 'zh' ? '— 选择一个模型，或直接输入 —' : '— Select a model, or type manually —'}</option>
                    </select>
                    <datalist id="${modelListId}"></datalist>
                    <span class="gd-agent-model-msg" data-agent="${agent.id}" style="font-size:0.8em;"></span>
                    <div style="margin-top:6px;display:flex;gap:6px;align-items:center;">
                        <span class="menu_button menu_button_icon gd-agent-test" data-agent="${agent.id}" style="font-size:0.85em;">
                            <i class="fa-solid fa-plug"></i> ${lang === 'zh' ? '测试连通性' : 'Test Connection'}
                        </span>
                        <span class="gd-agent-test-result" data-agent="${agent.id}" style="font-size:0.85em;"></span>
                    </div>
                </div>
            </div>
        `);

        // Bind values
        block.find('.gd-agent-use-custom').prop('checked', cfg.useCustom);
        block.find('.gd-agent-config').toggle(cfg.useCustom);
        block.find('.gd-agent-protocol').val(cfg.protocol || 'openai');
        block.find('.gd-agent-endpoint').val(cfg.endpoint || '');
        block.find('.gd-agent-apikey').val(cfg.apiKey || '');
        block.find('.gd-agent-model').val(cfg.model || '');

        // Use custom toggle
        block.find('.gd-agent-use-custom').on('change', function () {
            const aid = $(this).data('agent');
            const c = ensureConfig(settings, aid);
            c.useCustom = !!$(this).prop('checked');
            block.find(`.gd-agent-config[data-agent="${aid}"]`).toggle(c.useCustom);
            saveSettings();
        });

        // Protocol
        block.find('.gd-agent-protocol').on('change', function () {
            const aid = $(this).data('agent');
            ensureConfig(settings, aid).protocol = $(this).val();
            saveSettings();
        });

        // Endpoint
        block.find('.gd-agent-endpoint').on('input', function () {
            const aid = $(this).data('agent');
            ensureConfig(settings, aid).endpoint = $(this).val();
            saveSettings();
        });

        // API Key
        block.find('.gd-agent-apikey').on('input', function () {
            const aid = $(this).data('agent');
            ensureConfig(settings, aid).apiKey = $(this).val();
            saveSettings();
        });

        // Model input (manual typing)
        block.find('.gd-agent-model').on('input', function () {
            const aid = $(this).data('agent');
            ensureConfig(settings, aid).model = $(this).val();
            saveSettings();
        });

        // Model select (dropdown pick)
        block.find('.gd-agent-model-select').on('change', function () {
            const aid = $(this).data('agent');
            const val = $(this).val();
            if (!val) return;
            const input = block.find(`.gd-agent-model[data-agent="${aid}"]`);
            input.val(val);
            ensureConfig(settings, aid).model = val;
            saveSettings();
        });

        // Fetch models
        block.find('.gd-agent-fetch-models').on('click', async function () {
            const aid = $(this).data('agent');
            const c = ensureConfig(settings, aid);
            const msgEl = block.find(`.gd-agent-model-msg[data-agent="${aid}"]`);
            const datalist = document.getElementById(`gd-model-list-${aid}`);
            const btn = $(this);

            if (!c.endpoint || !c.apiKey) {
                msgEl.css('color', 'orange').text(lang === 'zh' ? '请先填写 Endpoint 和 API Key' : 'Fill endpoint and API key first');
                return;
            }

            btn.prop('disabled', true);
            msgEl.css('color', '').text(lang === 'zh' ? '获取中...' : 'Fetching...');

            const result = await fetchModels(c.endpoint, c.apiKey, c.protocol || 'openai');

            if (result.error) {
                msgEl.css('color', 'red').text(result.error);
                btn.prop('disabled', false);
                return;
            }

            if (!result.models?.length) {
                msgEl.css('color', 'orange').text(lang === 'zh' ? '未找到模型' : 'No models found');
                btn.prop('disabled', false);
                return;
            }

            // Populate datalist and select dropdown
            datalist.innerHTML = '';
            const select = block.find(`.gd-agent-model-select[data-agent="${aid}"]`);
            // Keep the placeholder option
            select.empty().append(
                $('<option>').val('').text(lang === 'zh' ? '— 选择一个模型，或直接输入 —' : '— Select a model, or type manually —')
            );
            for (const m of result.models) {
                const opt = document.createElement('option');
                opt.value = m;
                datalist.appendChild(opt);
                // Also add to select (skip duplicates)
                select.append($('<option>').val(m).text(m));
            }
            select.show();

            msgEl.css('color', 'green').text(
                (lang === 'zh' ? `✓ ${result.models.length} 个模型已加载` : `✓ ${result.models.length} models loaded`)
            );
            btn.prop('disabled', false);
        });

        // Test connection
        block.find('.gd-agent-test').on('click', async function () {
            const aid = $(this).data('agent');
            const c = ensureConfig(settings, aid);
            const resultEl = block.find(`.gd-agent-test-result[data-agent="${aid}"]`);
            const btn = $(this);

            if (!c.useCustom || !c.endpoint || !c.apiKey) {
                resultEl.css('color', 'orange').text(lang === 'zh' ? '请先填写端点、Key 和 Model' : 'Fill endpoint, key and model first');
                return;
            }

            btn.prop('disabled', true);
            resultEl.css('color', '').text(lang === 'zh' ? '测试中...' : 'Testing...');

            try {
                const stGenerateRaw = (opts) => getContext().generateRaw(opts);
                const caller = createCaller(c, stGenerateRaw);
                const result = await caller.test();
                if (result.ok) {
                    resultEl.css('color', 'green').text(lang === 'zh' ? '✓ 连通成功' : '✓ Connected');
                } else {
                    resultEl.css('color', 'red').text((lang === 'zh' ? '✗ 失败: ' : '✗ Failed: ') + (result.error || ''));
                }
            } catch (e) {
                resultEl.css('color', 'red').text((lang === 'zh' ? '✗ 错误: ' : '✗ Error: ') + e.message);
            } finally {
                btn.prop('disabled', false);
            }
        });

        container.append(block);
    }
});
