import { registerSection } from './registry.js';
import { eventSource, event_types } from '../../../../../events.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../popup.js';

registerSection('ledger', function (ctx) {
    const { settings, getDirectorHistory, updateEntry, clearEntry, isRoundActive, saveChatConditional, toastr, onLatestEntryEdited } = ctx;

    let expandedIndex = -1;
    let rawMode = false;
    let snapshotLength = 0;
    let snapshotHistory = [];

    // ── Helpers ─────────────────────────────────────────────────

    function getEntries() { return (getDirectorHistory() || []).slice().reverse(); }
    function isLocked() { return !!isRoundActive(); }

    function updateLockState() {
        const locked = isLocked();
        $('#gd-ledger-lock-warn').toggle(locked);
        $('#gd-ledger-toolbar button, #gd-ledger-toolbar .menu_button').prop('disabled', locked);
        $('#gd-ledger-list button, #gd-ledger-list textarea').prop('disabled', locked);
        if (locked) { expandedIndex = -1; snapshotLength = 0; }
    }

    // ── Build card list ────────────────────────────────────────

    function buildCards() {
        const entries = getEntries();
        const list = $('#gd-ledger-list');
        list.empty();

        if (entries.length === 0) {
            list.append(`<small style="color:var(--grey70a)">${settings.lang === 'zh' ? '暂无导演账本记录' : 'No director ledger entries yet'}</small>`);
            return;
        }

        const clearedCount = entries.filter(e => !e.speakers && !e.reason).length;
        $('#gd-ledger-count').text(`${entries.length} ${settings.lang === 'zh' ? '轮' : 'rounds'}${clearedCount > 0 ? ` · ${clearedCount} ${settings.lang === 'zh' ? '已清空' : 'cleared'}` : ''}`);

        for (let i = 0; i < entries.length; i++) {
            const realIndex = entries.length - 1 - i;
            const entry = entries[i];
            const isEmpty = !entry.speakers && !entry.reason;
            const speakers = Array.isArray(entry.speakers) ? entry.speakers.join(', ') : '';
            const reason = (entry.reason || '').slice(0, 60);

            const card = $(`<div class="gd-ledger-card" data-index="${realIndex}"></div>`);

            // Header
            const header = $(`<div class="gd-ledger-card-header"></div>`);
            if (isEmpty) {
                header.append(`<span class="gd-ledger-card-title" style="color:var(--grey70a);font-style:italic">${settings.lang === 'zh' ? '(已清空)' : '(cleared)'}</span>`);
            } else {
                header.append(`<span class="gd-ledger-card-title">#${realIndex + 1} ${speakers} — ${reason}${entry.reason && entry.reason.length > 60 ? '...' : ''}</span>`);
            }
            header.append(`<span style="flex:1"></span>`);

            // Clear button
            const btnClear = $(`<button class="gd-ledger-btn" style="margin-left:4px" title="${settings.lang === 'zh' ? '清空此条' : 'Clear this entry'}">&#10799;</button>`);
            btnClear.on('click', async (e) => {
                e.stopPropagation();
                if (isLocked()) return;
                if (!await callGenericPopup(settings.lang === 'zh' ? `清空第 ${realIndex + 1} 轮账本？` : `Clear round ${realIndex + 1} ledger entry?`, POPUP_TYPE.CONFIRM)) return;
                await clearEntry(realIndex);
                expandedIndex = -1;
                buildCards();
                toastr.info(settings.lang === 'zh' ? '已清空' : 'Cleared');
            });
            header.append(btnClear);

            // Expand button
            const btnExpand = $(`<button class="gd-ledger-btn" style="margin-left:2px">${expandedIndex === realIndex ? '&#9650;' : '&#9660;'}</button>`);
            btnExpand.on('click', (e) => {
                e.stopPropagation();
                if (isLocked()) return;
                expandedIndex = expandedIndex === realIndex ? -1 : realIndex;
                buildCards();
            });
            header.append(btnExpand);

            header.on('click', () => {
                if (isLocked()) return;
                expandedIndex = expandedIndex === realIndex ? -1 : realIndex;
                buildCards();
            });
            card.append(header);

            // Expanded JSON editor
            if (expandedIndex === realIndex) {
                const safeCopy = Object.assign({}, entry);
                delete safeCopy._anchorDate;
                delete safeCopy._chatLength;
                const jsonStr = JSON.stringify(safeCopy, null, 2);
                const textarea = $(`<textarea class="gd-ledger-edit-area" rows="12">${jsonStr.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>`);

                const errDiv = $('<div class="gd-ledger-edit-err" style="display:none"></div>');

                const btnSave = $(`<span class="menu_button menu_button_icon gd-ledger-btn">${settings.lang === 'zh' ? '保存' : 'Save'}</span>`);
                const btnCancel = $(`<span class="menu_button menu_button_icon gd-ledger-btn" style="margin-left:4px">${settings.lang === 'zh' ? '取消' : 'Cancel'}</span>`);

                btnSave.on('click', async () => {
                    if (isLocked()) return;
                    errDiv.hide();
                    try {
                        const parsed = JSON.parse(textarea.val());
                        if (getEntries().length !== snapshotLength) {
                            errDiv.text(settings.lang === 'zh' ? '账本已被更新，请刷新后重试' : 'Ledger was updated, please refresh and retry').show();
                            return;
                        }
                        parsed._anchorDate = null;
                        parsed._chatLength = 0;
                        await updateEntry(realIndex, parsed);
                        if (onLatestEntryEdited && realIndex === getDirectorHistory().length - 1) {
                            onLatestEntryEdited();
                        }
                        expandedIndex = -1;
                        buildCards();
                        toastr.info(settings.lang === 'zh' ? '已保存' : 'Saved');
                    } catch (e) {
                        errDiv.text(`JSON ${settings.lang === 'zh' ? '解析错误' : 'parse error'}: ${e.message}`).show();
                    }
                });

                btnCancel.on('click', () => { expandedIndex = -1; buildCards(); });

                card.append(textarea);
                card.append(errDiv);
                card.append($('<div style="margin-top:4px"></div>').append(btnSave, btnCancel));
            }

            list.append(card);
        }
    }

    // ── Raw mode ───────────────────────────────────────────────

    function buildRaw() {
        const list = $('#gd-ledger-list');
        list.empty();
        const entries = getEntries(); // newest-first from getEntries()
        const snapshotLen = entries.length; // freeze at build time for consistent validation + indexing
        const safeEntries = entries.map(e => {
            const copy = Object.assign({}, e);
            delete copy._anchorDate;
            delete copy._chatLength;
            return copy;
        });
        const jsonStr = JSON.stringify(safeEntries, null, 2);

        const textarea = $(`<textarea class="gd-ledger-edit-area" rows="20">${jsonStr.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>`);
        const errDiv = $('<div class="gd-ledger-edit-err" style="display:none"></div>');
        const btnSave = $(`<span class="menu_button menu_button_icon">${settings.lang === 'zh' ? '保存全部' : 'Save All'}</span>`);
        const btnCancel = $(`<span class="menu_button menu_button_icon" style="margin-left:4px">${settings.lang === 'zh' ? '切换回卡片' : 'Back to cards'}</span>`);

        btnSave.on('click', async () => {
            if (isLocked()) return;
            errDiv.hide();
            try {
                const parsed = JSON.parse(textarea.val());
                if (!Array.isArray(parsed)) throw new Error(settings.lang === 'zh' ? '必须是数组' : 'Must be an array');
                if (parsed.length !== snapshotLen) {
                    throw new Error(settings.lang === 'zh'
                        ? `条目数量不符（原${snapshotLen}条，现${parsed.length}条）。Raw 模式不支持增删，请回到卡片模式逐条操作。`
                        : `Entry count mismatch (was ${snapshotLen}, now ${parsed.length}). Raw mode does not support add/remove. Use card mode.`);
                }
                const history = getDirectorHistory();
                const historyLen = history.length;
                if (historyLen !== snapshotLen) {
                    throw new Error(settings.lang === 'zh'
                        ? `条目数量变化（原${snapshotLen}条，现${historyLen}条）。请刷新后重试。`
                        : `Entry count changed (was ${snapshotLen}, now ${historyLen}). Refresh and retry.`);
                }
                for (let i = 0; i < parsed.length; i++) {
                    const realIndex = snapshotLen - 1 - i; // newest-first → chronological (push() appends, indices stable)
                    parsed[i]._anchorDate = null;
                    parsed[i]._chatLength = 0;
                    await updateEntry(realIndex, parsed[i]);
                }
                if (onLatestEntryEdited && history.length > 0) {
                    onLatestEntryEdited();
                }
                rawMode = false;
                buildCards();
                toastr.info(settings.lang === 'zh' ? '已保存' : 'Saved');
            } catch (e) {
                errDiv.text(e.message).show();
            }
        });

        btnCancel.on('click', () => { rawMode = false; buildCards(); });

        list.append($('<small style="color:var(--grey70a);display:block;margin-bottom:4px"></small>').text(settings.lang === 'zh' ? '编辑 JSON 数组（不支持增删条目，仅修改内容）。保存时内部字段自动保护。' : 'Edit JSON array (modify only, no add/remove). Internal fields auto-protected.'));
        list.append(textarea);
        list.append(errDiv);
        list.append($('<div style="margin-top:4px"></div>').append(btnSave, btnCancel));
    }

    // ── Rebuild ────────────────────────────────────────────────

    function rebuild() {
        if (isLocked()) { updateLockState(); return; }
        // Preserve in-progress textarea content across re-renders without committing to live data
        let pendingEditText = null;
        if (expandedIndex >= 0 && !rawMode) {
            const $ta = $(`.gd-ledger-edit-area`);
            if ($ta.length) {
                pendingEditText = $ta.val();
            }
        }
        snapshotHistory = getEntries();
        snapshotLength = snapshotHistory.length;
        updateLockState();
        if (rawMode) { buildRaw(); } else { buildCards(); }
        // Restore in-progress edit text after re-render
        if (pendingEditText !== null && expandedIndex >= 0) {
            const $ta = $(`.gd-ledger-edit-area`);
            if ($ta.length) {
                $ta.val(pendingEditText);
            }
        }
    }

    // ── Toolbar ────────────────────────────────────────────────

    rebuild();

    $('#gd-ledger-refresh').on('click', () => { expandedIndex = -1; rebuild(); });
    $('#gd-ledger-raw-toggle').on('click', () => { rawMode = !rawMode; expandedIndex = -1; rebuild(); });

    // Auto-refresh when messages are deleted (ledger may have been pruned)
    eventSource.on(event_types.MESSAGE_DELETED, () => {
        if ($('#gd-ledger-list').is(':visible')) {
            expandedIndex = -1;
            rebuild();
        }
    });
});
