/**
 * World Book Scanner — loads all world books from ST and builds a
 * queryable JSON snapshot. Also computes per-entry importance scores.
 *
 * Dependencies (injected):
 *   world_names      — string[] of world book file names
 *   loadWorldInfo    — async (name) => { entries: {...} }
 */

export function createWorldBookScanner({ world_names, loadWorldInfo, getSelection, getMaxEntries, getSourceMode, getStSelection, renderMacros, log }) {

    let cache = null;
    let cacheKey = '';
    // Concurrency guard: promise-based in-flight dedup — when two providers call
    // scanAll() concurrently (e.g. {{worldBooks}} and {{worldBookImportance}} under
    // parallel Phase 1), the second waiter returns the same promise instead of
    // duplicating all loadWorldInfo calls.
    let inFlight = null;

    /**
     * Scan only the world books the user has manually selected
     * in the Group World settings panel.
     */
    function getSelectedNames() {
        const allNames = world_names || [];
        if ((getSourceMode?.() || 'st') === 'st') {
            const stNames = (getStSelection?.() || []).filter(n => allNames.includes(n));
            return [...new Set(stNames)];
        }
        const selection = getSelection ? getSelection() : {};
        return allNames.filter(n => selection[n] === true);
    }

    async function scanAll() {
        const names = getSelectedNames();
        if (names.length === 0) return [];
        const key = names.slice().sort().join('|') + '|' + (getMaxEntries ? getMaxEntries() : 20);
        if (cache && cacheKey === key) return cache;
        if (inFlight && inFlight.key === key) return inFlight.promise;

        // No cached result and no in-flight scan — start a new one.
        // If a concurrent caller arrives during this scan it will hit the inFlight guard.
        const promise = (async () => {
            try {
                const results = [];

                const books = await Promise.all(names.map(async (name) => {
            try {
                const data = await loadWorldInfo(name);
                return { name, data };
            } catch (e) {
                console.warn(`[GroupDirector] Failed to load world book "${name}":`, e.message);
                return { name, data: null };
            }
        }));

        for (const { name, data } of books) {
            if (!data || !data.entries) continue;
            const entries = Object.values(data.entries);
            results.push({
                name,
                entryCount: entries.length,
                entries: entries.map(e => ({
                    uid: e.uid ?? null,
                    comment: e.comment || '',
                    content: e.content || '',
                    contentPreview: (e.content || '').slice(0, 120).replace(/\n/g, ' '),
                    constant: !!e.constant,
                    disable: !!e.disable,
                    depth: typeof e.depth === 'number' ? e.depth : 4,
                    probability: typeof e.probability === 'number' ? e.probability : 100,
                    sticky: typeof e.sticky === 'number' ? e.sticky : 0,
                    order: typeof e.order === 'number' ? e.order : 100,
                    key: e.key || [],
                    keysecondary: e.keysecondary || [],
                    keyCount: (e.key || []).length,
                    keySecondaryCount: (e.keysecondary || []).length,
                    selectiveLogic: e.selectiveLogic ?? 0,
                    group: e.group || '',
                    groupWeight: e.groupWeight ?? 100,
                    cooldown: e.cooldown ?? 0,
                    delay: e.delay ?? 0,
                    position: e.position ?? 0,
                    characterFilter: {
                        isExclude: !!(e.characterFilter?.isExclude),
                        names: e.characterFilter?.names || [],
                        tags: e.characterFilter?.tags || [],
                    },
                })),
            });
        }

            if (results.length === 0) {
                console.warn('[GroupDirector] World book scanner: NO activated books found. Check that world books are selected in ST\'s World Info panel for this chat.');
            } else if (log) {
                log(`World book scanner: loaded ${results.length} activated books (${results.reduce((s, b) => s + b.entryCount, 0)} entries)`);
            }
            cache = results;
            cacheKey = key;
            return results;
            } finally {
                inFlight = null;
            }
        })();

        inFlight = { key, promise };
        return promise;
    }

    /**
     * Compute per-entry importance score (0.000 to 1.000).
     *
     * Factors:
     *   constant      → 0.50 if always-on, 0.10 if keyword-triggered
     *   depth         → min(depth / 10, 1) × 0.15
     *   probability   → (probability / 100) × 0.10
     *   sticky        → 0.05 if > 0
     *   keyword count → min((key + keysecondary) / 10, 1) × 0.10
     *   secondaryKeys → 0.05 if any secondary keywords
     *   order         → min(order / 100, 1) × 0.05
     *
     *   Sum ceiling: 1.000. Disabled entries → 0.000.
     */
    function calculateImportance(scanResult) {
        const scored = [];
        for (const book of scanResult) {
            for (const entry of book.entries) {
                if (entry.disable) {
                    scored.push({ book: book.name, entry, importance: 0 });
                    continue;
                }

                const constantScore = entry.constant ? 0.50 : 0.10;
                const depthScore = Math.min(entry.depth / 10, 1) * 0.15;
                const probScore = (entry.probability / 100) * 0.10;
                const stickyScore = entry.sticky > 0 ? 0.05 : 0;
                const kwTotal = entry.keyCount + entry.keySecondaryCount;
                const kwScore = Math.min(kwTotal / 10, 1) * 0.10;
                const secScore = entry.keySecondaryCount > 0 ? 0.05 : 0;
                const orderScore = Math.min(entry.order / 100, 1) * 0.05;

                const raw = constantScore + depthScore + probScore + stickyScore + kwScore + secScore + orderScore;
                const importance = Math.round(Math.min(raw, 1) * 1000) / 1000;

                const factors = [];
                if (entry.constant) factors.push('always-on');
                if (entry.keyCount > 0) factors.push(`keys:${entry.key.slice(0, 5).join(',')}`);
                if (entry.keySecondaryCount > 0) factors.push(`sec:${entry.keysecondary.slice(0, 3).join(',')}`);
                if (entry.sticky > 0) factors.push(`sticky:${entry.sticky}`);
                if (entry.depth !== 4) factors.push(`depth:${entry.depth}`);
                if (entry.probability < 100) factors.push(`prob:${entry.probability}%`);

                const cf = entry.characterFilter || {};
                if (cf.names && cf.names.length > 0) factors.push(`bound:${cf.names.map(n => `@${n}`).join(',')}`);
                if (cf.tags && cf.tags.length > 0) factors.push(`tags:${cf.tags.map(t => `#${t}`).join(',')}`);

                scored.push({
                    book: book.name,
                    comment: entry.comment,
                    uid: entry.uid,
                    importance,
                    constant: entry.constant,
                    depth: entry.depth,
                    probability: entry.probability,
                    keyCount: entry.keyCount,
                    keySecondaryCount: entry.keySecondaryCount,
                    keywords: entry.key,
                    keysecondary: entry.keysecondary,
                    characterFilter: entry.characterFilter || { isExclude: false, names: [], tags: [] },
                    factors: factors.join(', '),
                    contentPreview: entry.contentPreview,
                });
            }
        }
        scored.sort((a, b) => b.importance - a.importance);
        return scored;
    }

    function clearCache() {
        cache = null;
    }

    function applyMacros(value) {
        const text = String(value ?? '');
        if (!text || typeof renderMacros !== 'function') return text;
        try {
            return renderMacros(text);
        } catch (e) {
            console.warn('[GroupDirector] World book macro substitution failed:', e.message);
            return text;
        }
    }

    function renderEntry(entry) {
        const content = applyMacros(entry.content);
        const key = Array.isArray(entry.key) ? entry.key.map(applyMacros) : [];
        const keysecondary = Array.isArray(entry.keysecondary) ? entry.keysecondary.map(applyMacros) : [];
        return {
            ...entry,
            comment: applyMacros(entry.comment),
            content,
            contentPreview: content.slice(0, 120).replace(/\n/g, ' '),
            key,
            keysecondary,
            keyCount: key.length,
            keySecondaryCount: keysecondary.length,
            group: applyMacros(entry.group),
        };
    }

    function renderBooks(scanResult) {
        return (scanResult || []).map(book => ({
            ...book,
            entries: (book.entries || []).map(renderEntry),
        }));
    }

    async function getRenderedBooks() {
        return renderBooks(await scanAll());
    }

    function flattenEntries(scanResult, predicate = () => true) {
        const rows = [];
        for (const book of scanResult || []) {
            for (const entry of book.entries || []) {
                if (entry.disable) continue;
                if (!predicate(entry, book)) continue;
                rows.push({ ...entry, book: book.name });
            }
        }
        return rows;
    }

    function formatEntries(entries) {
        return (entries || []).map((entry) => {
            const title = entry.comment || `uid:${entry.uid ?? '?'}`;
            const keys = entry.key?.length ? ` | keys: ${entry.key.join(', ')}` : '';
            const flags = entry.constant ? ' | always-on' : '';
            return `## [${entry.book}] ${title}${flags}${keys}\n${entry.content || ''}`.trim();
        }).filter(Boolean).join('\n\n');
    }

    async function buildSnapshot() {
        const books = await getRenderedBooks();
        const fullEntries = flattenEntries(books);
        const constantEntries = flattenEntries(books, (entry) => !!entry.constant);
        const names = books.map(b => b.name);
        const fullText = formatEntries(fullEntries);
        const constantText = formatEntries(constantEntries);
        return {
            books,
            names,
            fullEntries,
            constantEntries,
            fullText,
            constantText,
            stats: {
                bookCount: books.length,
                entryCount: fullEntries.length,
                constantCount: constantEntries.length,
                fullChars: fullText.length,
                constantChars: constantText.length,
            },
        };
    }

    return { scanAll, getRenderedBooks, calculateImportance, clearCache, getSelectedNames, buildSnapshot };
}
