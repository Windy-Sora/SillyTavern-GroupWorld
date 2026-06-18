/**
 * Group export/import system — packages group characters + world books
 * into a zip, and restores them via ST's HTTP APIs.
 *
 * Factory function with explicit dependency injection.
 */
export function createExportImportSystem({
    settings,
    getCurrentGroup,
    getChat,
    characters,
    world_names,
    selected_world_info,
    world_info,
    getChatMetadata,
    log,
}) {
    // toastr is a global jQuery plugin that may load after module init —
    // resolve lazily so it's always available when our functions run.
    const toastr = () => window.toastr;
    let JSZip;
    let csrfToken = null;

    async function ensureJSZip() {
        if (JSZip) return;
        if (window.JSZip) { JSZip = window.JSZip; return; }
        await import('../../../../../lib/jszip.min.js');
        if (window.JSZip) { JSZip = window.JSZip; return; }
        throw new Error('JSZip not available');
    }

    async function getCsrfToken() {
        if (csrfToken) return csrfToken;
        const resp = await fetch('/csrf-token');
        const data = await resp.json();
        csrfToken = data.token;
        if (!csrfToken) throw new Error('Failed to get CSRF token');
        return csrfToken;
    }

    function csrfHeaders() {
        return csrfToken ? { 'X-CSRF-Token': csrfToken } : {};
    }

    function jsonHeaders() {
        return Object.assign({ 'Content-Type': 'application/json' }, csrfHeaders());
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    const L = (zh, en) => (settings.lang === 'zh' ? zh : en);

    /** Collect all currently activated world book names. */
    function getActivatedWorldBooks() {
        const books = new Set();
        const chatMeta = getChatMetadata();
        // Primary chat world book
        if (chatMeta && chatMeta['world_info'] && world_names.includes(chatMeta['world_info'])) {
            books.add(chatMeta['world_info']);
        }
        // Currently selected in world info panel
        if (Array.isArray(selected_world_info)) {
            for (const name of selected_world_info) {
                if (world_names.includes(name)) books.add(name);
            }
        }
        // Character lore assignments
        if (world_info && Array.isArray(world_info.charLore)) {
            for (const entry of world_info.charLore) {
                if (entry.name && world_names.includes(entry.name)) books.add(entry.name);
            }
        }
        return [...books];
    }

    // ─── Export ──────────────────────────────────────────────────────

    async function exportGroup() {
        const group = getCurrentGroup();
        if (!group) {
            toastr().warning(L('请先在群聊中打开此设置面板', 'Please open this settings panel from within a group chat'));
            return;
        }

        const enabledMembers = group.members.filter(a => !group.disabled_members?.includes(a));
        if (!enabledMembers.length) {
            toastr().warning(L('当前群聊没有可用角色', 'No enabled members in current group'));
            return;
        }

        try {
            await ensureJSZip();
        } catch (e) {
            toastr().error(L('JSZip 加载失败', 'JSZip failed to load'));
            console.error('[GroupDirector] JSZip load failed:', e);
            return;
        }

        const zip = new JSZip();

        // Ensure CSRF token before any POST requests
        try { await getCsrfToken(); } catch (e) {
            toastr().error(L('获取 CSRF token 失败', 'Failed to get CSRF token'));
            return;
        }

        // ── 1. Group metadata ──
        {
            const groupMeta = {
                name: group.name,
                members: enabledMembers,
                allow_self_responses: group.allow_self_responses,
                activation_strategy: group.activation_strategy,
                generation_mode: group.generation_mode,
                disabled_members: group.disabled_members || [],
                auto_mode_delay: group.auto_mode_delay,
            };
            zip.file('group.json', JSON.stringify(groupMeta, null, 2));
        }

        // ── 2. Character cards ──
        const charsFolder = zip.folder('characters');
        let charOk = 0, charFail = 0;

        for (const avatar of enabledMembers) {
            try {
                const resp = await fetch('/api/characters/export', {
                    method: 'POST',
                    headers: jsonHeaders(),
                    body: JSON.stringify({ format: 'png', avatar_url: avatar }),
                });
                if (resp.ok) {
                    const blob = await resp.blob();
                    charsFolder.file(avatar, blob);
                    charOk++;
                } else {
                    log(`Export character failed: ${avatar} (status ${resp.status})`);
                    charFail++;
                }
            } catch (e) {
                log(`Export character error: ${avatar}`, e.message);
                charFail++;
            }
        }

        // ── 3. World books ──
        const worldsFolder = zip.folder('worlds');
        const activatedBooks = getActivatedWorldBooks();
        let worldOk = 0, worldFail = 0;

        for (const name of activatedBooks) {
            try {
                const resp = await fetch('/api/worldinfo/get', {
                    method: 'POST',
                    headers: jsonHeaders(),
                    body: JSON.stringify({ name }),
                });
                if (resp.ok) {
                    const json = await resp.json();
                    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
                    worldsFolder.file(`${name}.json`, blob);
                    worldOk++;
                } else {
                    log(`Export world book failed: ${name} (status ${resp.status})`);
                    worldFail++;
                }
            } catch (e) {
                log(`Export world book error: ${name}`, e.message);
                worldFail++;
            }
        }

        // ── 4. Trigger download ──
        const safeName = (group.name || 'group').replace(/[<>:"/\\|?*]/g, '_').substring(0, 80);
        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `group_export_${safeName}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        const summary = L(
            `导出完成：${charOk} 个角色卡, ${worldOk} 个世界书` + (charFail + worldFail > 0 ? ` (${charFail + worldFail} 跳过)` : ''),
            `Export complete: ${charOk} characters, ${worldOk} world books` + (charFail + worldFail > 0 ? ` (${charFail + worldFail} skipped)` : '')
        );
        toastr().success(summary);

        log(`Export done: ${charOk} chars, ${worldOk} worlds` + (charFail + worldFail > 0 ? `, ${charFail + worldFail} skipped` : ''));
    }

    // ─── Import ──────────────────────────────────────────────────────

    /**
     * Import a zip file containing group data.
     * Uploads characters, world books, then creates the group.
     */
    async function importGroup(zipFile) {
        try {
            await ensureJSZip();
        } catch (e) {
            toastr().error(L('JSZip 加载失败', 'JSZip failed to load'));
            console.error('[GroupDirector] JSZip load failed:', e);
            return;
        }

        // Ensure CSRF token before any POST requests
        try { await getCsrfToken(); } catch (e) {
            toastr().error(L('获取 CSRF token 失败', 'Failed to get CSRF token'));
            return;
        }

        let zip;
        try {
            // Support both File objects and ArrayBuffer
            const data = zipFile instanceof ArrayBuffer ? zipFile : await zipFile.arrayBuffer();
            zip = await JSZip.loadAsync(data);
        } catch (e) {
            toastr().error(L('无法解析压缩包', 'Failed to parse zip file'));
            console.error('[GroupDirector] Zip parse failed:', e);
            return;
        }

        let charOk = 0, charFail = 0;
        let worldOk = 0, worldFail = 0;

        // ── 1. Import character cards ──
        const charsFolder = zip.folder('characters');
        const avatarNameMap = new Map(); // original avatar name → actual imported filename

        if (charsFolder) {
            const charFiles = charsFolder.file(/\.(png|webp)$/i);
            for (const file of charFiles) {
                try {
                    const blob = await file.async('blob');
                    const originalName = file.name;
                    const baseName = originalName.replace(/\.(png|webp)$/i, '');

                    const formData = new FormData();
                    formData.append('avatar', blob, originalName);
                    formData.append('file_type', 'png');
                    formData.append('preserved_name', originalName);

                    const resp = await fetch('/api/characters/import', {
                        method: 'POST',
                        headers: csrfHeaders(),
                        body: formData,
                    });
                    if (resp.ok) {
                        const result = await resp.json();
                        if (result.file_name) {
                            const actualAvatar = result.file_name + '.png';
                            avatarNameMap.set(originalName, actualAvatar);
                            avatarNameMap.set(baseName, actualAvatar); // also map without extension
                            log(`Imported character: ${originalName} → ${actualAvatar}`);
                            charOk++;
                        } else {
                            avatarNameMap.set(originalName, originalName); // assume preserved
                            avatarNameMap.set(baseName, originalName);
                            charOk++;
                        }
                    } else {
                        log(`Import character failed: ${originalName} (status ${resp.status})`);
                        charFail++;
                    }
                } catch (e) {
                    log(`Import character error: ${file.name}`, e.message);
                    charFail++;
                }
            }
        }

        // ── 2. Import world books ──
        const worldsFolder = zip.folder('worlds');

        if (worldsFolder) {
            const worldFiles = worldsFolder.file(/\.json$/i);
            for (const file of worldFiles) {
                try {
                    const blob = await file.async('blob');
                    const originalName = file.name;

                    const formData = new FormData();
                    formData.append('avatar', blob, originalName);

                    const resp = await fetch('/api/worldinfo/import', {
                        method: 'POST',
                        headers: csrfHeaders(),
                        body: formData,
                    });
                    if (resp.ok) {
                        worldOk++;
                        log(`Imported world book: ${originalName}`);
                    } else {
                        log(`Import world book failed: ${originalName} (status ${resp.status})`);
                        worldFail++;
                    }
                } catch (e) {
                    log(`Import world book error: ${file.name}`, e.message);
                    worldFail++;
                }
            }
        }

        // ── 3. Create group from group.json ──
        let groupCreated = false;
        const groupFile = zip.file('group.json');
        if (groupFile && avatarNameMap.size > 0) {
            try {
                const groupJsonStr = await groupFile.async('text');
                const groupData = JSON.parse(groupJsonStr);

                // Remap member avatar names using the import mapping
                const remappedMembers = [];
                const remappedDisabled = [];

                if (Array.isArray(groupData.members)) {
                    for (const m of groupData.members) {
                        const mapped = avatarNameMap.get(m) || avatarNameMap.get(m.replace(/\.(png|webp)$/i, '')) || m;
                        remappedMembers.push(mapped);
                    }
                }
                if (Array.isArray(groupData.disabled_members)) {
                    for (const m of groupData.disabled_members) {
                        const mapped = avatarNameMap.get(m) || avatarNameMap.get(m.replace(/\.(png|webp)$/i, '')) || m;
                        remappedDisabled.push(mapped);
                    }
                }

                const createBody = {
                    name: groupData.name || L('导入的群聊', 'Imported Group'),
                    members: remappedMembers,
                    allow_self_responses: !!groupData.allow_self_responses,
                    activation_strategy: groupData.activation_strategy ?? 1,
                    generation_mode: groupData.generation_mode ?? 0,
                    disabled_members: remappedDisabled,
                    auto_mode_delay: groupData.auto_mode_delay ?? 5,
                };

                const resp = await fetch('/api/groups/create', {
                    method: 'POST',
                    headers: jsonHeaders(),
                    body: JSON.stringify(createBody),
                });
                if (resp.ok) {
                    groupCreated = true;
                    log('Group created:', await resp.json());
                } else {
                    log(`Group create failed (status ${resp.status})`);
                }
            } catch (e) {
                log('Group create error:', e.message);
            }
        }

        // ── Done ──

        const parts = [
            L(`${charOk} 个角色`, `${charOk} characters`),
            L(`${worldOk} 个世界书`, `${worldOk} world books`),
        ];
        if (groupCreated) parts.push(L('群组已创建', 'group created'));
        if (charFail + worldFail > 0) parts.push(L(`${charFail + worldFail} 跳过`, `${charFail + worldFail} skipped`));

        toastr().success(L('导入完成', 'Import complete') + ' — ' + parts.join(', '));
        toastr().info(L('请刷新页面以查看导入的角色和群组', 'Please refresh the page to see imported characters and group'));

        log(`Import done: ${charOk} chars, ${worldOk} worlds, group=${groupCreated}` + (charFail + worldFail > 0 ? `, ${charFail + worldFail} skipped` : ''));
    }

    return { exportGroup, importGroup, getActivatedWorldBooks };
}
