export function createProfileSystem(deps) {
    const { settings, EXT_KEY, getChatMetadata, getChat, getCharacters, saveChatConditional, getContext, setExtensionPrompt, inject_ids, extension_prompt_types, djb2Hash, hashChar, extractJsonObject, sanitizeJson, matchCharacterByName, getCurrentGroup, log, getLlmPickedSet, getLlmPickedAvatars, getRoundSpeakerCount, isRoundActive, saveSettings } = deps;
    const cm = () => getChatMetadata();

    // Escape untrusted strings before embedding in HTML strings.
    // Character names and profile fields can contain user content from
    // shared character cards — must be sanitized before innerHTML.
    function esc(s) {
        if (s === null || s === undefined) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }


// ─── Profile System: Hash & Data Layer ─────────────────────────────────
function computeProfileSchemaHash() {
    const schema = settings.profileJsonSchema || getDefaultProfileSchema();
    return djb2Hash(schema);
}

function getProfileContainer() {
    if (!cm()[EXT_KEY]) cm()[EXT_KEY] = {};
    const meta = cm()[EXT_KEY];
    if (!meta.characterProfiles) meta.characterProfiles = {};
    if (!meta.archivedProfiles) meta.archivedProfiles = {};
    if (meta.profileVersion === undefined) meta.profileVersion = 1;
    if (meta.profileSchemaHash === undefined) meta.profileSchemaHash = '';
    return meta;
}

function migrateProfileData(container) {
    const from = container.profileVersion || 0;
    if (from < 1) {
        container.profileVersion = 1;
    }
    const currentHash = computeProfileSchemaHash();
    if (container.profileSchemaHash && container.profileSchemaHash !== currentHash) {
        console.warn('[GroupDirector] Profile schema changed since last save. Old profiles may use outdated field set.');
    }
    container.profileSchemaHash = currentHash;
}

function getProfiles() {
    return getProfileContainer().characterProfiles;
}

function getArchivedProfiles() {
    return getProfileContainer().archivedProfiles;
}

async function saveProfile(avatar, profileObj) {
    const profiles = getProfiles();
    profiles[avatar] = profileObj;
    await saveChatConditional();
}

function diffProfiles(enabledMembers) {
    if (!settings.profileEnabled) return { newChars: [], removedChars: [], existingChars: [], hashMismatches: [] };
    const profiles = getProfiles();
    const profileAvatars = Object.keys(profiles);
    const newChars = enabledMembers.filter(a => !profileAvatars.includes(a));
    const removedChars = profileAvatars.filter(a => !enabledMembers.includes(a));
    const existingChars = enabledMembers.filter(a => profileAvatars.includes(a));
    const hashMismatches = [];
    for (const avatar of existingChars) {
        const char = getCharacters().find(c => c.avatar === avatar);
        if (!char) continue;
        const currentHash = hashChar(char.description, char.personality, char.scenario);
        if (profiles[avatar].hash && profiles[avatar].hash !== currentHash) {
            hashMismatches.push(avatar);
        }
    }
    return { newChars, removedChars, existingChars, hashMismatches };
}

// ─── Profile System: Generator ─────────────────────────────────────────
function getDefaultProfileGeneratorPrompt() {
    return `You are a Character Profile Analyzer. Analyze the following character and extract key information.

Character Name: {{charName}}
Description: {{charDescription}}
Personality: {{charPersonality}}
Scenario: {{charScenario}}

Extract the following in JSON format ONLY (no prose, no code fences):
{
  "summary": "A concise 2-3 sentence description of who this character is, their role, and their defining traits.",
  "tags": ["tag1", "tag2", "tag3"],
  "motivation": "What drives this character? What do they want? What are their core goals or fears?",
  "relationships": "How does this character relate to others? What is their social role or typical dynamic with people?"
}

Important:
- Output ONLY valid JSON, no extra text.
- summary must be under 200 characters.
- tags must be an array of 3-6 single words or short phrases.
- motivation must be under 300 characters.
- relationships must be under 200 characters.`;
}

function getDefaultProfileSchema() {
    return JSON.stringify({
        type: 'object',
        properties: {
            summary:       { type: 'string' },
            tags:          { type: 'array', items: { type: 'string' } },
            motivation:    { type: 'string' },
            relationships: { type: 'string' },
        },
        required: ['summary', 'tags', 'motivation', 'relationships'],
    }, null, 2);
}

function getDefaultProfileRenderTemplate() {
    return `- {{name}}: {{summary}}
  Tags: {{tags}}
  Motivation: {{motivation}}
  Relationships: {{relationships}}`;
}

function normalizeProfileFields(parsed) {
    if (!parsed || typeof parsed !== 'object') return { summary: '', tags: [], motivation: '', relationships: '' };
    return {
        ...parsed,
        summary: parsed.summary || '',
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        motivation: parsed.motivation || '',
        relationships: parsed.relationships || '',
    };
}

async function generateSingleProfile(avatar) {
    if (!settings.profileEnabled) return null;
    if (isRoundActive()) {
        console.warn('[GroupDirector] Profile generation skipped — director round is active, will retry later');
        return null;
    }
    const char = getCharacters().find(c => c.avatar === avatar);
    if (!char) throw new Error(`Character not found for avatar: ${avatar}`);

    const generatorPrompt = settings.profileGeneratorPrompt || getDefaultProfileGeneratorPrompt();
    const schemaText = settings.profileJsonSchema || getDefaultProfileSchema();

    let filled = generatorPrompt
        .replace('{{charName}}', char.name)
        .replace('{{charDescription}}', char.description || '')
        .replace('{{charPersonality}}', char.personality || '')
        .replace('{{charScenario}}', char.scenario || '');

    let jsonSchema = null;
    try { jsonSchema = JSON.parse(schemaText); } catch (e) { /* use null */ }

    const ctx = getContext();
    const response = await ctx.generateRaw({
        prompt: filled,
        jsonSchema: jsonSchema,
    });
    // Clean up QUIET_PROMPT to prevent profile generator prompt
    // from leaking into subsequent Director generateRaw calls.
    setExtensionPrompt(inject_ids.QUIET_PROMPT, '', extension_prompt_types.IN_PROMPT, 0, true);

    let parsed;
    try {
        parsed = JSON.parse(response);
    } catch (e) {
        const extracted = extractJsonObject(response);
        if (extracted) {
            const sanitized = sanitizeJson(extracted);
            try { parsed = JSON.parse(sanitized); } catch (e2) { /* fall through */ }
        }
    }

    if (!parsed) throw new Error('Failed to parse profile JSON response');
    return normalizeProfileFields(parsed);
}

async function generateProfilesBatch(avatars) {
    if (!settings.profileEnabled) return;
    if (!avatars.length) return;

    const limit = settings.profileConcurrency || 0;
    const buildTask = (avatar) => async () => {
        const char = getCharacters().find(c => c.avatar === avatar);
        if (!char) return;

        const currentHash = hashChar(char.description, char.personality, char.scenario);
        const existing = getProfiles()[avatar];

        // Preserve existing ready data as base; only overwrite on success
        const base = (existing && existing.state === 'ready')
            ? { ...existing, hash: currentHash, name: char.name }
            : {
                avatar, name: char.name, hash: currentHash,
                profile: { summary: '', tags: [], motivation: '', relationships: '' },
                state: 'pending', manualEdited: false,
            };
        base.updatedAt = Date.now();
        await saveProfile(avatar, base);

        try {
            const result = await generateSingleProfile(avatar);
            if (result) {
                base.profile = result;
                base.state = 'ready';
                base.hash = currentHash;
            } else {
                // Null means skipped (e.g. round active) — keep previous state, don't mark failed
                if (base.state === 'pending' && existing && existing.state === 'ready') {
                    base.state = 'ready';
                    base.profile = existing.profile;
                }
            }
        } catch (e) {
            console.error(`[GroupDirector] Profile generation failed for ${char.name}:`, e.message);
            base.state = 'failed';
        }
        base.updatedAt = Date.now();
        await saveProfile(avatar, base);
    };

    const taskFns = avatars.map(buildTask).filter(Boolean);

    if (limit <= 0 || limit >= taskFns.length) {
        // Unlimited concurrent
        await Promise.all(taskFns.map(fn => fn()));
    } else {
        // Batched concurrent: run N at a time
        for (let i = 0; i < taskFns.length; i += limit) {
            const batch = taskFns.slice(i, i + limit);
            await Promise.all(batch.map(fn => fn()));
        }
    }

    refreshProfileManagementUI();
}

// ─── Profile System: Renderer ──────────────────────────────────────────
function renderSingleProfile(prof) {
    if (!prof || !prof.profile) return '';
    const template = settings.profileRenderTemplate || getDefaultProfileRenderTemplate();
    return template
        .replace(/\{\{name\}\}/g,          prof.name || '')
        .replace(/\{\{summary\}\}/g,       prof.profile.summary || '')
        .replace(/\{\{tags\}\}/g,          (prof.profile.tags || []).join(', '))
        .replace(/\{\{motivation\}\}/g,    prof.profile.motivation || '')
        .replace(/\{\{relationships\}\}/g, prof.profile.relationships || '');
}

function getProfilePriority(prof, pickedSet, recentSpeakerSet, currentSpeakingAvatar) {
    if (prof.avatar === currentSpeakingAvatar) return 0;
    if (pickedSet && pickedSet.has(prof.avatar)) return 1;
    if (recentSpeakerSet && recentSpeakerSet.has(prof.avatar)) return 2;
    return 3;
}

function applyTokenBudget(readyProfiles, budget) {
    if (!readyProfiles.length) return [];
    const pickedSet = getLlmPickedSet() || new Set();

    // Build recent speaker set from the last 5 messages
    const recentSpeakerSet = new Set();
    for (let i = getChat().length - 1; i >= Math.max(0, getChat().length - 5); i--) {
        const msg = getChat()[i];
        if (msg && !msg.is_user && !msg.is_system && msg.avatar) {
            recentSpeakerSet.add(msg.avatar);
        }
    }

    const currentSpeakingAvatar = getLlmPickedAvatars()?.[getRoundSpeakerCount()] || null;

    const sorted = [...readyProfiles].sort((a, b) => {
        const aP = getProfilePriority(a, pickedSet, recentSpeakerSet, currentSpeakingAvatar);
        const bP = getProfilePriority(b, pickedSet, recentSpeakerSet, currentSpeakingAvatar);
        if (aP !== bP) return aP - bP;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

    let usedTokens = 0;
    const result = [];
    for (const p of sorted) {
        const rendered = renderSingleProfile(p);
        const estTokens = Math.max(1, Math.ceil(rendered.length / 4));
        if (usedTokens + estTokens <= budget || result.length === 0) {
            result.push({ ...p, rendered });
            usedTokens += estTokens;
        } else {
            const short = `${p.name}: ${(p.profile.summary || '').slice(0, 100)}`;
            result.push({ ...p, rendered: short, compressed: true });
            usedTokens += Math.max(1, Math.ceil(short.length / 4));
        }
    }
    return result;
}

function buildCharacterProfilesText() {
    if (!settings.profileEnabled) return '';

    getProfileContainer(); // ensure migration ran
    const profiles = getProfiles();
    const all = Object.values(profiles);
    const readyProfiles = all.filter(p => p.state === 'ready');
    const pendingProfiles = all.filter(p => p.state === 'pending');
    const failedProfiles = all.filter(p => p.state === 'failed');

    // Always log profile state summary so the user knows what's happening
    console.log(`[GroupDirector] Profiles: ${all.length} total, ${readyProfiles.length} ready, ${pendingProfiles.length} pending, ${failedProfiles.length} failed`);

    if (readyProfiles.length === 0) {
        if (all.length === 0) {
            console.warn('[GroupDirector] No profiles exist. Click "Regenerate All" in the Profile Management panel to generate them.');
        } else if (failedProfiles.length === all.length) {
            console.warn(`[GroupDirector] All ${all.length} profile(s) failed. Check the browser console for errors, then click "Regenerate All" to retry.`);
        } else if (pendingProfiles.length > 0) {
            console.warn(`[GroupDirector] ${pendingProfiles.length} profile(s) still pending. Profiles will appear once generation completes.`);
        }
        return '';
    }

    const budgeted = applyTokenBudget(readyProfiles, settings.profileTokenBudget);
    return budgeted.map(p => p.rendered).join('\n');
}

function validateTemplatePlaceholders(template, knownKeys) {
    const found = template.match(/\{\{[a-zA-Z_]+\}\}/g) || [];
    const unknowns = [...new Set(found)].filter(p => !knownKeys.has(p));
    return unknowns;
}

function validateAndWarnProfilePlaceholders(type) {
    const template = type === 'generator'
        ? ($('#gd-profile-generator-prompt').val() || getDefaultProfileGeneratorPrompt())
        : ($('#gd-profile-render-template').val() || getDefaultProfileRenderTemplate());

    const knownKeys = type === 'generator'
        ? new Set(['{{charName}}', '{{charDescription}}', '{{charPersonality}}', '{{charScenario}}'])
        : new Set(['{{name}}', '{{summary}}', '{{tags}}', '{{motivation}}', '{{relationships}}']);

    const unknowns = validateTemplatePlaceholders(template, knownKeys);
    const $warn = $('#gd-profile-template-warning');
    if (unknowns.length > 0) {
        const lang = settings.lang || 'zh';
        $warn.text(lang === 'zh'
            ? `警告：未知占位符 ${unknowns.join(', ')}，将渲染为空。`
            : `Warning: unknown placeholders ${unknowns.join(', ')}. They will render as empty.`).show();
    } else {
        $warn.hide();
    }
}

async function syncProfiles(enabledMembers) {
    if (!settings.profileEnabled) return;

    getProfileContainer(); // ensure migration
    const { newChars, removedChars, hashMismatches } = diffProfiles(enabledMembers);

    // Archive removed characters
    for (const avatar of removedChars) {
        const profile = getProfiles()[avatar];
        if (profile) {
            getArchivedProfiles()[avatar] = profile;
            delete getProfiles()[avatar];
        }
    }

    if (hashMismatches.length > 0) {
        const names = hashMismatches.map(a => getCharacters().find(c => c.avatar === a)?.name || a).join(', ');
        log(`Profile hash mismatch for: ${names} — use Regenerate button to update`);
    }

    if (removedChars.length || hashMismatches.length) {
        await saveChatConditional();
    }

    // Auto-generate profiles for new characters (non-blocking fire-and-forget)
    if (newChars.length > 0) {
        log(`Auto-generating profiles for ${newChars.length} new character(s): ${newChars.map(a => getCharacters().find(c => c.avatar === a)?.name || a).join(', ')}`);
        generateProfilesBatch(newChars).catch(e => {
            console.error('[GroupDirector] Background profile generation failed:', e);
        });
    }
}

// ─── Profile System: Management UI ─────────────────────────────────────
function buildProfileLoaderPanel() {
    if (!settings.profileEnabled) return;
    const group = getCurrentGroup();
    if (!group) return;
    const members = group.members.filter(a => !group.disabled_members?.includes(a));
    if (!members.length) return;

    const profiles = getProfiles();
    const { newChars, hashMismatches } = diffProfiles(members);
    const lang = settings.lang || 'zh';
    const isZh = lang === 'zh';

    const existingList = Object.entries(profiles).map(([avatar, prof]) => {
        const char = getCharacters().find(c => c.avatar === avatar);
        const name = char ? char.name : (prof.name || avatar);
        const isMismatch = hashMismatches.includes(avatar);
        const stateLabel = { ready: isZh ? '就绪' : 'Ready', pending: isZh ? '生成中' : 'Pending', failed: isZh ? '失败' : 'Failed' }[prof.state] || prof.state;
        const stateColor = { ready: '#4caf50', pending: '#ff9800', failed: '#f44336' }[prof.state] || '#999';
        return { avatar, name, prof, isMismatch, stateLabel, stateColor };
    });

    const newList = newChars.map(avatar => {
        const char = getCharacters().find(c => c.avatar === avatar);
        return { avatar, name: char?.name || avatar };
    });

    if (existingList.length === 0 && newList.length === 0) return;

    let html = `<div id="gd-profile-loader" style="border:1px solid var(--SmartThemeBorderColor);border-radius:6px;padding:10px;margin-bottom:10px;">`;
    html += `<strong>${isZh ? '加载存档档案' : 'Load Profiles from Save'}</strong>`;
    html += `<small style="display:block;margin:4px 0;color:var(--grey70a);">${isZh ? '勾选要处理的角色，选择保留或重新生成。新角色默认勾选。' : 'Check characters to process, choose keep or regenerate. New characters checked by default.'}</small>`;

    if (existingList.length > 0) {
        html += `<div style="margin-top:6px;font-weight:bold;font-size:0.9em;">${isZh ? '存档中的档案' : 'Profiles in Save'} (${existingList.length}):</div>`;
        for (const item of existingList) {
            html += `<div class="gd-loader-row" data-avatar="${esc(item.avatar)}" style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--SmartThemeBorderColor);font-size:0.85em;">
                <input type="checkbox" class="gd-loader-check" checked style="flex-shrink:0;">
                <span style="flex:1;min-width:0;"><b>${esc(item.name)}</b></span>
                <span style="color:${item.stateColor};flex-shrink:0;">${esc(item.stateLabel)}</span>
                ${item.isMismatch ? `<span style="color:#ff9800;flex-shrink:0;" title="${isZh ? '角色卡已修改' : 'Character card changed'}">&#9888;</span>` : ''}
                <select class="gd-loader-action text_pole" style="width:auto;flex-shrink:0;font-size:0.85em;">
                    <option value="keep" selected>${isZh ? '保留' : 'Keep'}</option>
                    <option value="regen">${isZh ? '重新生成' : 'Regenerate'}</option>
                </select>
            </div>`;
        }
    }

    if (newList.length > 0) {
        html += `<div style="margin-top:6px;font-weight:bold;font-size:0.9em;">${isZh ? '新角色' : 'New Characters'} (${newList.length}):</div>`;
        for (const item of newList) {
            html += `<div class="gd-loader-row gd-loader-new" data-avatar="${esc(item.avatar)}" style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--SmartThemeBorderColor);font-size:0.85em;">
                <input type="checkbox" class="gd-loader-check" checked style="flex-shrink:0;">
                <span style="flex:1;min-width:0;">${esc(item.name)}</span>
                <span style="color:#999;flex-shrink:0;">${isZh ? '无档案' : 'No profile'}</span>
            </div>`;
        }
    }

    html += `<div style="margin-top:8px;display:flex;gap:6px;">
        <button class="gd-loader-btn-apply" style="flex:1;">${isZh ? '应用选择（保留勾选的，重新生成标记的）' : 'Apply (keep checked, regenerate marked)'}</button>
        <button class="gd-loader-btn-all" style="flex:1;">${isZh ? '全部重新生成' : 'Regenerate All'}</button>
    </div></div>`;

    const $existing = $('#gd-profile-loader');
    if ($existing.length) $existing.replaceWith(html);
    else $('#gd-profile-management-list').before(html);

    // Bind buttons
    $('#gd-profile-section').off('click', '.gd-loader-btn-apply').on('click', '.gd-loader-btn-apply', function () {
        const btn = $(this);
        btn.prop('disabled', true);
        const toRegen = [];
        $('.gd-loader-row').each(function () {
            const $row = $(this);
            if (!$row.find('.gd-loader-check').prop('checked')) return;
            const avatar = $row.data('avatar');
            if ($row.hasClass('gd-loader-new') || $row.find('.gd-loader-action').val() === 'regen') {
                toRegen.push(avatar);
            }
        });
        if (toRegen.length > 0) {
            toastr.info(isZh ? `后台生成 ${toRegen.length} 个档案...` : `Generating ${toRegen.length} profile(s) in background...`);
            generateProfilesBatch(toRegen).then(() => {
                $('#gd-profile-loader').remove();
                refreshProfileManagementUI();
                toastr.success(isZh ? '档案已更新' : 'Profiles updated');
            }).finally(() => btn.prop('disabled', false));
        } else {
            $('#gd-profile-loader').remove();
            refreshProfileManagementUI();
            btn.prop('disabled', false);
        }
    });

    $('#gd-profile-section').off('click', '.gd-loader-btn-all').on('click', '.gd-loader-btn-all', function () {
        const btn = $(this);
        btn.prop('disabled', true);
        toastr.info(isZh ? `后台生成 ${members.length} 个角色档案...` : `Generating ${members.length} profiles in background...`);
        generateProfilesBatch(members).then(() => {
            $('#gd-profile-loader').remove();
            refreshProfileManagementUI();
            toastr.success(isZh ? '全部档案已更新' : 'All profiles updated');
        }).finally(() => btn.prop('disabled', false));
    });
}

function checkProfileStartupStatus() {
    buildProfileLoaderPanel();
}

function detectCharacterChanges() {
    const group = getCurrentGroup();
    if (!group) return;
    const members = group.members.filter(a => !group.disabled_members?.includes(a));
    const profiles = getProfiles();
    const { newChars, removedChars } = diffProfiles(members);
    const lang = settings.lang || 'zh';
    const isZh = lang === 'zh';

    if (newChars.length === 0 && removedChars.length === 0) {
        toastr.info(isZh ? '未检测到角色变动' : 'No character changes detected');
        return;
    }

    let html = `<div id="gd-profile-changes" style="border:1px solid var(--SmartThemeBorderColor);border-radius:6px;padding:10px;margin-bottom:10px;">`;
    html += `<strong>${isZh ? '角色变动检测' : 'Character Change Detection'}</strong>`;
    html += `<small style="display:block;margin:4px 0;color:var(--grey70a);">${isZh ? '选择如何处理以下变动。' : 'Choose how to handle the following changes.'}</small>`;

    if (newChars.length > 0) {
        html += `<div style="margin-top:6px;font-weight:bold;color:#4caf50;">${isZh ? '新增角色' : 'Added'} (${newChars.length}):</div>`;
        for (const avatar of newChars) {
            const char = getCharacters().find(c => c.avatar === avatar);
            const name = char?.name || avatar;
            html += `<div class="gd-change-row" data-avatar="${esc(avatar)}" data-action="add" style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:0.85em;">
                <input type="checkbox" class="gd-change-check" checked>
                <span style="flex:1;">${esc(name)}</span>
                <span style="color:#999;font-size:0.8em;">${isZh ? '无档案' : 'No profile'}</span>
            </div>`;
        }
    }

    if (removedChars.length > 0) {
        html += `<div style="margin-top:6px;font-weight:bold;color:#f44336;">${isZh ? '已移除角色' : 'Removed'} (${removedChars.length}):</div>`;
        for (const avatar of removedChars) {
            const prof = profiles[avatar];
            const name = prof?.name || avatar;
            html += `<div class="gd-change-row" data-avatar="${esc(avatar)}" data-action="remove" style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:0.85em;">
                <input type="checkbox" class="gd-change-check" checked>
                <span style="flex:1;">${esc(name)}</span>
                <span style="color:#999;font-size:0.8em;">${isZh ? '档案仍在' : 'Profile exists'}</span>
            </div>`;
        }
    }

    html += `<div style="margin-top:8px;display:flex;gap:6px;">
        <button class="gd-changes-btn-apply" style="flex:1;">${isZh ? '应用选择' : 'Apply Selected'}</button>
        <button class="gd-changes-btn-cancel" style="flex:1;">${isZh ? '取消' : 'Cancel'}</button>
    </div></div>`;

    const $existing = $('#gd-profile-changes');
    if ($existing.length) $existing.replaceWith(html);
    else $('#gd-profile-management-list').before(html);

    $('.gd-changes-btn-cancel').off('click').on('click', () => $('#gd-profile-changes').remove());

    $('.gd-changes-btn-apply').off('click').on('click', async function () {
        const btn = $(this);
        btn.prop('disabled', true);
        const toGenerate = [];
        const toArchive = [];

        $('.gd-change-row').each(function () {
            const $row = $(this);
            if (!$row.find('.gd-change-check').prop('checked')) return;
            const action = $row.data('action');
            const avatar = $row.data('avatar');
            if (action === 'add') toGenerate.push(avatar);
            else if (action === 'remove') toArchive.push(avatar);
        });

        // Archive removed characters
        for (const avatar of toArchive) {
            const prof = profiles[avatar];
            if (prof) {
                getArchivedProfiles()[avatar] = prof;
                delete profiles[avatar];
            }
        }
        if (toArchive.length > 0) {
            await saveChatConditional();
            toastr.info(isZh ? `已归档 ${toArchive.length} 个档案` : `Archived ${toArchive.length} profile(s)`);
        }

        // Generate new profiles
        if (toGenerate.length > 0) {
            toastr.info(isZh ? `正在生成 ${toGenerate.length} 个新角色档案...` : `Generating ${toGenerate.length} new profile(s)...`);
            await generateProfilesBatch(toGenerate);
        }

        $('#gd-profile-changes').remove();
        refreshProfileManagementUI();
        toastr.success(isZh ? '变动已处理' : 'Changes processed');
        btn.prop('disabled', false);
    });
}

function refreshProfileManagementUI() {
    const $container = $('#gd-profile-management-list');
    if (!$container.length) return;
    $container.empty();

    const profiles = getProfiles();
    const lang = settings.lang || 'zh';
    const isZh = lang === 'zh';

    if (Object.keys(profiles).length === 0) {
        $container.html(`<small><i>${isZh ? '暂无角色档案。点击上方「全部重新生成」按钮为当前群聊角色生成档案。' : 'No character profiles yet. Click "Regenerate All" above to generate profiles for current group members.'}</i></small>`);
        return;
    }

    for (const avatar of Object.keys(profiles)) {
        const prof = profiles[avatar];
        if (!prof) continue;
        const char = getCharacters().find(c => c.avatar === avatar);
        const name = char ? char.name : (prof.name || 'Unknown');
        const hashMatch = char ? (hashChar(char.description, char.personality, char.scenario) === prof.hash) : true;
        const stateLabels = isZh ? { ready: '就绪', pending: '生成中', failed: '失败' } : { ready: 'Ready', pending: 'Generating', failed: 'Failed' };
        const stateLabel = stateLabels[prof.state] || prof.state;
        const stateClass = { ready: 'gd-profile-state-ready', pending: 'gd-profile-state-pending', failed: 'gd-profile-state-failed' }[prof.state] || '';
        const safeId = CSS.escape(avatar);

        const card = $(`
            <div class="gd-profile-card" data-avatar="${esc(avatar)}">
                <div class="gd-profile-card-header">
                    <div class="gd-profile-card-info">
                        <strong>${esc(name)}</strong>
                        <div class="gd-profile-card-meta">
                            <span class="gd-profile-state ${stateClass}">${esc(stateLabel)}</span>
                            ${!hashMatch ? `<span class="gd-profile-hash-warn" title="${isZh ? '角色定义已变更，档案可能过时' : 'Character definition changed, profile may be outdated'}">&#9888;</span>` : ''}
                            ${prof.manualEdited ? `<span class="gd-profile-edited-tag">${isZh ? '(已编辑)' : '(Edited)'}</span>` : ''}
                        </div>
                    </div>
                    <div class="gd-profile-card-actions">
                        <button class="gd-profile-btn-edit" data-avatar="${esc(avatar)}">${isZh ? '编辑' : 'Edit'}</button>
                        <button class="gd-profile-btn-regen" data-avatar="${esc(avatar)}">${isZh ? '重生成' : 'Regen'}</button>
                        <button class="gd-profile-btn-delete" data-avatar="${esc(avatar)}">${isZh ? '删除' : 'Delete'}</button>
                    </div>
                </div>
                <div class="gd-profile-card-edit" id="gd-profile-edit-${safeId}" style="display:none;">
                    <label>Summary <textarea class="gd-profile-edit-field" data-field="summary" rows="2">${esc(prof.profile.summary || '')}</textarea></label>
                    <label>Tags <input class="gd-profile-edit-field" data-field="tags" value="${esc((prof.profile.tags || []).join(', '))}"></label>
                    <label>Motivation <textarea class="gd-profile-edit-field" data-field="motivation" rows="2">${esc(prof.profile.motivation || '')}</textarea></label>
                    <label>Relationships <textarea class="gd-profile-edit-field" data-field="relationships" rows="2">${esc(prof.profile.relationships || '')}</textarea></label>
                    <button class="gd-profile-btn-save" data-avatar="${esc(avatar)}">${isZh ? '保存' : 'Save'}</button>
                    <button class="gd-profile-btn-cancel" data-avatar="${esc(avatar)}">${isZh ? '取消' : 'Cancel'}</button>
                </div>
            </div>
        `);
        $container.append(card);
    }

    bindProfileCardActions();
}

function bindProfileCardActions() {
    const $container = $('#gd-profile-management-list');
    if (!$container.length) return;

    $container.off('click', '.gd-profile-btn-edit').on('click', '.gd-profile-btn-edit', function (e) {
        e.stopPropagation();
        const avatar = $(this).closest('.gd-profile-card').attr('data-avatar') || $(this).attr('data-avatar');
        const el = document.getElementById('gd-profile-edit-' + CSS.escape(avatar || ''));
        if (el) { el.style.display = el.style.display === 'none' ? '' : 'none'; }
    });

    $container.off('click', '.gd-profile-btn-cancel').on('click', '.gd-profile-btn-cancel', function (e) {
        e.stopPropagation();
        const avatar = $(this).closest('.gd-profile-card').attr('data-avatar') || $(this).attr('data-avatar');
        const el = document.getElementById('gd-profile-edit-' + CSS.escape(avatar || ''));
        if (el) el.style.display = 'none';
    });

    $container.off('click', '.gd-profile-btn-save').on('click', '.gd-profile-btn-save', async function (e) {
        e.stopPropagation();
        const avatar = $(this).closest('.gd-profile-card').attr('data-avatar') || $(this).attr('data-avatar');
        const $edit = $(document.getElementById('gd-profile-edit-' + CSS.escape(avatar || '')));
        const profiles = getProfiles();
        const prof = profiles[avatar];
        if (!prof) return;

        prof.profile.summary = $edit.find('[data-field="summary"]').val();
        prof.profile.tags = ($edit.find('[data-field="tags"]').val() || '').split(',').map(s => s.trim()).filter(Boolean);
        prof.profile.motivation = $edit.find('[data-field="motivation"]').val();
        prof.profile.relationships = $edit.find('[data-field="relationships"]').val();
        prof.manualEdited = true;
        prof.updatedAt = Date.now();
        prof.state = 'ready';

        await saveProfile(avatar, prof);
        $edit.hide();
        toastr.info(settings.lang === 'zh' ? '档案已保存' : 'Profile saved');
    });

    $container.off('click', '.gd-profile-btn-regen').on('click', '.gd-profile-btn-regen', async function () {
        const avatar = $(this).data('avatar');
        const btn = $(this);
        btn.prop('disabled', true);
        try {
            await generateProfilesBatch([avatar]);
        } finally {
            btn.prop('disabled', false);
        }
    });

    $container.off('click', '.gd-profile-btn-delete').on('click', '.gd-profile-btn-delete', async function () {
        const avatar = $(this).data('avatar');
        const profiles = getProfiles();
        const prof = profiles[avatar];
        if (prof) {
            getArchivedProfiles()[avatar] = prof;
            delete profiles[avatar];
        }
        await saveChatConditional();
        refreshProfileManagementUI();
    });
}

    return {
        computeProfileSchemaHash, getProfileContainer, migrateProfileData, getProfiles, getArchivedProfiles, saveProfile, diffProfiles,
        getDefaultProfileGeneratorPrompt, getDefaultProfileSchema, getDefaultProfileRenderTemplate,
        normalizeProfileFields, generateSingleProfile, generateProfilesBatch,
        buildCharacterProfilesText,
        validateAndWarnProfilePlaceholders,
        syncProfiles,
        buildProfileLoaderPanel, checkProfileStartupStatus, detectCharacterChanges, refreshProfileManagementUI, bindProfileCardActions,
    };
}
