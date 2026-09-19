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
    getWorldNames = () => world_names,
    selected_world_info,
    world_info,
    getChatMetadata,
    log,
}) {
    // toastr is a global jQuery plugin that may load after module init —
    // resolve lazily so it's always available when our functions run.
    const toastr = () => window.toastr;
    const JSZIP_PATH = '../../../../../lib/jszip.min.js';
    let JSZip;
    let csrfToken = null;
    const reservedWorldNames = new Set();

    async function ensureJSZip() {
        if (JSZip) return;
        if (window.JSZip) { JSZip = window.JSZip; return; }
        try { await import(JSZIP_PATH); } catch (_) { /* non-module, fall through */ }
        if (window.JSZip) { JSZip = window.JSZip; return; }
        const script = document.createElement('script');
        script.src = JSZIP_PATH;
        document.head.appendChild(script);
        await new Promise((resolve, reject) => {
            const tid = setTimeout(() => reject(new Error('JSZip script load timeout')), 10000);
            script.onload = () => { clearTimeout(tid); resolve(); };
            script.onerror = () => { clearTimeout(tid); reject(new Error('JSZip script load failed')); };
        });
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

    function isSafeArchiveName(name, extension) {
        if (typeof name !== 'string' || !name.toLowerCase().endsWith(extension) || name.length > 255) return false;
        const stem = name.slice(0, -extension.length);
        return !!stem.trim() && !/^\.+$/.test(stem) && !/[<>:"/\\|?*\x00-\x1f]/.test(name);
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
            return { ok: false, partial: false, error: 'No active group' };
        }

        const enabledMembers = group.members.filter(a => !group.disabled_members?.includes(a));
        if (!enabledMembers.length) {
            toastr().warning(L('当前群聊没有可用角色', 'No enabled members in current group'));
            return { ok: false, partial: false, error: 'No enabled members' };
        }
        const activatedBooks = getActivatedWorldBooks();
        const groupMeta = {
            name: group.name,
            members: [],
            allow_self_responses: group.allow_self_responses,
            activation_strategy: group.activation_strategy,
            generation_mode: group.generation_mode,
            disabled_members: [],
            auto_mode_delay: group.auto_mode_delay,
        };

        try {
            await ensureJSZip();
        } catch (e) {
            toastr().error(L('JSZip 加载失败', 'JSZip failed to load'));
            console.error('[GroupDirector] JSZip load failed:', e);
            return { ok: false, partial: false, error: e.message };
        }

        const zip = new JSZip();

        // Ensure CSRF token before any POST requests
        try { await getCsrfToken(); } catch (e) {
            toastr().error(L('获取 CSRF token 失败', 'Failed to get CSRF token'));
            return { ok: false, partial: false, error: e.message };
        }

        // ── 1. Character cards ──
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
                    if (!(blob instanceof Blob) || !blob.size) throw new Error('Empty character card');
                    charsFolder.file(avatar, blob);
                    groupMeta.members.push(avatar);
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

        if (!charOk) {
            toastr().error(L('角色卡导出全部失败，未生成压缩包', 'All character exports failed; no archive was created'));
            return { ok: false, partial: false, error: 'No character cards exported' };
        }
        zip.file('group.json', JSON.stringify(groupMeta, null, 2));

        // ── 2. World books ──
        const worldsFolder = zip.folder('worlds');
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
                    if (!json || typeof json !== 'object' || Array.isArray(json) || !Object.hasOwn(json, 'entries')) {
                        throw new Error('Invalid world book');
                    }
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

        // ── 3. Trigger download ──
        try {
            const safeName = (groupMeta.name || 'group').replace(/[<>:"/\\|?*]/g, '_').substring(0, 80);
            const content = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(content);
            let a;
            let appended = false;
            try {
                a = document.createElement('a');
                a.href = url;
                a.download = `group_export_${safeName}.zip`;
                document.body.appendChild(a);
                appended = true;
                a.click();
            } finally {
                try { if (appended) document.body.removeChild(a); }
                finally { URL.revokeObjectURL(url); }
            }
        } catch (e) {
            log('Group archive download failed:', e.message);
            toastr().error(L('群组压缩包下载失败', 'Group archive download failed'));
            return { ok: false, partial: false, error: e.message };
        }

        const summary = L(
            `导出完成：${charOk} 个角色卡, ${worldOk} 个世界书` + (charFail + worldFail > 0 ? ` (${charFail + worldFail} 跳过)` : ''),
            `Export complete: ${charOk} characters, ${worldOk} world books` + (charFail + worldFail > 0 ? ` (${charFail + worldFail} skipped)` : '')
        );
        const partial = charFail + worldFail > 0;
        if (partial) toastr().warning(summary);
        else toastr().success(summary);

        log(`Export done: ${charOk} chars, ${worldOk} worlds` + (charFail + worldFail > 0 ? `, ${charFail + worldFail} skipped` : ''));
        return { ok: !partial, partial, characters: { exported: charOk, failed: charFail }, worldBooks: { exported: worldOk, failed: worldFail } };
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
            return { ok: false, partial: false, error: e.message };
        }

        let zip;
        try {
            // Support both File objects and ArrayBuffer
            const data = zipFile instanceof ArrayBuffer ? zipFile : await zipFile.arrayBuffer();
            zip = await JSZip.loadAsync(data);
        } catch (e) {
            toastr().error(L('无法解析压缩包', 'Failed to parse zip file'));
            console.error('[GroupDirector] Zip parse failed:', e);
            return { ok: false, partial: false, error: e.message };
        }

        let groupData;
        let charFiles;
        let worldFiles;
        let characterBlobs;
        let worldBlobs;
        try {
            const groupFile = zip.file('group.json');
            if (!groupFile) throw new Error('Missing group.json');
            groupData = JSON.parse(await groupFile.async('text'));
            if (!groupData || typeof groupData !== 'object' || Array.isArray(groupData) ||
                !Array.isArray(groupData.members) || !groupData.members.length ||
                (groupData.name !== undefined && typeof groupData.name !== 'string') ||
                (groupData.disabled_members !== undefined && !Array.isArray(groupData.disabled_members)) ||
                (groupData.allow_self_responses !== undefined && typeof groupData.allow_self_responses !== 'boolean') ||
                (groupData.activation_strategy !== undefined && (!Number.isInteger(groupData.activation_strategy) || groupData.activation_strategy < 0)) ||
                (groupData.generation_mode !== undefined && (!Number.isInteger(groupData.generation_mode) || groupData.generation_mode < 0)) ||
                (groupData.auto_mode_delay !== undefined && (typeof groupData.auto_mode_delay !== 'number' || !Number.isFinite(groupData.auto_mode_delay) || groupData.auto_mode_delay < 0))) {
                throw new Error('Invalid group metadata');
            }

            const members = new Set();
            for (const member of groupData.members) {
                if (!isSafeArchiveName(member, '.png') || members.has(member.toLowerCase())) {
                    throw new Error('Invalid or duplicate group member');
                }
                members.add(member.toLowerCase());
            }
            for (const disabled of groupData.disabled_members || []) {
                if (!isSafeArchiveName(disabled, '.png')) throw new Error('Invalid disabled member');
            }

            charFiles = zip.folder('characters')?.file(/\.(png|webp)$/i) || [];
            worldFiles = zip.folder('worlds')?.file(/\.json$/i) || [];
            const cardNames = new Set();
            const exactCardNames = new Set();
            for (const file of charFiles) {
                const name = file.name.slice('characters/'.length);
                if (!file.name.startsWith('characters/') || !isSafeArchiveName(name, '.png') ||
                    cardNames.has(name.toLowerCase())) {
                    throw new Error('Invalid or duplicate character card path');
                }
                cardNames.add(name.toLowerCase());
                exactCardNames.add(name);
            }
            if (groupData.members.some(member => !exactCardNames.has(member))) {
                throw new Error('Group member has no character card');
            }
            if (exactCardNames.size !== groupData.members.length) {
                throw new Error('Unreferenced character card');
            }
            const worldNames = new Set();
            for (const file of worldFiles) {
                const name = file.name.slice('worlds/'.length);
                if (!file.name.startsWith('worlds/') || !isSafeArchiveName(name, '.json') ||
                    worldNames.has(name.toLowerCase())) {
                    throw new Error('Invalid or duplicate world book path');
                }
                worldNames.add(name.toLowerCase());
            }

            characterBlobs = new Map();
            for (const file of charFiles) {
                const blob = await file.async('blob');
                if (!(blob instanceof Blob) || !blob.size) throw new Error('Invalid character card');
                characterBlobs.set(file.name, blob);
            }
            worldBlobs = new Map();
            for (const file of worldFiles) {
                const content = await file.async('text');
                const parsed = JSON.parse(content);
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Object.hasOwn(parsed, 'entries')) {
                    throw new Error('Invalid world book');
                }
                worldBlobs.set(file.name, new Blob([content], { type: 'application/json' }));
            }
        } catch (e) {
            log('Group archive validation failed:', e.message);
            toastr().error(L('群组压缩包无效，未导入任何内容', 'Invalid group archive; nothing was imported'));
            return { ok: false, partial: false, error: e.message };
        }

        // No remote writes happen until the complete archive structure is valid.
        try { await getCsrfToken(); } catch (e) {
            toastr().error(L('获取 CSRF token 失败', 'Failed to get CSRF token'));
            return { ok: false, partial: false, error: e.message };
        }

        let charOk = 0, charFail = 0;
        let worldOk = 0, worldFail = 0;
        let remoteWriteAttempted = false;

        // ── 1. Import character cards ──
        const avatarNameMap = new Map(); // original avatar name → actual imported filename
        const importedAvatars = new Set();

        {
            for (const file of charFiles) {
                try {
                    const blob = characterBlobs.get(file.name);
                    const archivePath = file.name;
                    const originalName = archivePath.split('/').pop() || archivePath;

                    const formData = new FormData();
                    formData.append('avatar', blob, originalName);
                    formData.append('file_type', 'png');

                    remoteWriteAttempted = true;
                    const resp = await fetch('/api/characters/import', {
                        method: 'POST',
                        headers: csrfHeaders(),
                        body: formData,
                    });
                    if (resp.ok) {
                        const result = await resp.json();
                        const actualAvatar = `${result?.file_name}.png`;
                        if (typeof result?.file_name === 'string' && result.file_name && !result.error &&
                            isSafeArchiveName(actualAvatar, '.png') &&
                            !importedAvatars.has(actualAvatar.toLowerCase())) {
                            importedAvatars.add(actualAvatar.toLowerCase());
                            avatarNameMap.set(originalName, actualAvatar);
                            log(`Imported character: ${originalName} → ${actualAvatar}`);
                            charOk++;
                        } else {
                            log(`Import character failed: ${originalName} (missing file name)`);
                            charFail++;
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
        const currentWorldNames = getWorldNames();
        const usedWorldNames = new Set((Array.isArray(currentWorldNames) ? currentWorldNames : [])
            .filter(name => typeof name === 'string').map(name => name.toLowerCase()));
        for (const name of reservedWorldNames) usedWorldNames.add(name);

        {
            for (const file of worldFiles) {
                try {
                    const blob = worldBlobs.get(file.name);
                    const originalName = file.name.split('/').pop() || file.name;
                    const baseName = originalName.slice(0, -'.json'.length);
                    let importedName = baseName;
                    for (let suffix = 1; usedWorldNames.has(importedName.toLowerCase()); suffix++) {
                        importedName = `${baseName}_${suffix}`;
                    }
                    usedWorldNames.add(importedName.toLowerCase());
                    reservedWorldNames.add(importedName.toLowerCase());

                    const formData = new FormData();
                    formData.append('avatar', blob, `${importedName}.json`);

                    remoteWriteAttempted = true;
                    const resp = await fetch('/api/worldinfo/import', {
                        method: 'POST',
                        headers: csrfHeaders(),
                        body: formData,
                    });
                    if (resp.ok) {
                        worldOk++;
                        log(`Imported world book: ${originalName} → ${importedName}.json`);
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
        if (groupData.members.every(member => avatarNameMap.has(member))) {
            try {
                // Remap member avatar names using the import mapping
                const remappedMembers = groupData.members.map(member => avatarNameMap.get(member));
                const remappedDisabled = (groupData.disabled_members || [])
                    .filter(member => groupData.members.includes(member))
                    .map(member => avatarNameMap.get(member));

                const createBody = {
                    name: groupData.name || L('导入的群聊', 'Imported Group'),
                    members: remappedMembers,
                    allow_self_responses: !!groupData.allow_self_responses,
                    activation_strategy: groupData.activation_strategy ?? 1,
                    generation_mode: groupData.generation_mode ?? 0,
                    disabled_members: remappedDisabled,
                    auto_mode_delay: groupData.auto_mode_delay ?? 5,
                };

                remoteWriteAttempted = true;
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

        const ok = groupCreated && charFail === 0 && worldFail === 0;
        const partial = !ok && remoteWriteAttempted;
        if (ok) {
            toastr().success(L('导入完成', 'Import complete') + ' — ' + parts.join(', '));
        } else if (partial) {
            toastr().warning(L('导入未完全成功；请检查宿主中的资源', 'Import incomplete; review resources in SillyTavern') + ' — ' + parts.join(', '));
        } else {
            toastr().error(L('导入失败，未创建资源', 'Import failed; no resources created'));
        }
        if (ok || partial) {
            toastr().info(L('请刷新页面以查看导入的角色和群组', 'Please refresh the page to see imported characters and group'));
        }

        log(`Import done: ${charOk} chars, ${worldOk} worlds, group=${groupCreated}` + (charFail + worldFail > 0 ? `, ${charFail + worldFail} skipped` : ''));
        return { ok, partial, groupCreated, characters: { imported: charOk, failed: charFail }, worldBooks: { imported: worldOk, failed: worldFail } };
    }

    return { exportGroup, importGroup, getActivatedWorldBooks };
}
