export function createCritiqueRepository({ getChatMetadata, EXT_KEY, saveChatConditional }) {
    const revisions = new WeakMap();
    const fieldRevisions = new WeakMap();

    function getRevision(entry) {
        return entry && typeof entry === 'object' ? revisions.get(entry) || 0 : 0;
    }

    function bumpRevision(entry) {
        if (entry && typeof entry === 'object') {
            const revision = getRevision(entry) + 1;
            revisions.set(entry, revision);
            return revision;
        }
        return 0;
    }

    function getFieldRevision(entry, key) {
        return fieldRevisions.get(entry)?.get(key) || 0;
    }

    function bumpFieldRevision(entry, key) {
        let fields = fieldRevisions.get(entry);
        if (!fields) {
            fields = new Map();
            fieldRevisions.set(entry, fields);
        }
        const revision = getFieldRevision(entry, key) + 1;
        fields.set(key, revision);
        bumpRevision(entry);
        return revision;
    }

    function setActive(changes, entry, active) {
        if (!entry || typeof entry !== 'object') return;
        const previous = changes.has(entry) ? changes.get(entry).previous : entry.active;
        const hadPrevious = changes.has(entry) ? changes.get(entry).hadPrevious : Object.hasOwn(entry, 'active');
        const revision = bumpFieldRevision(entry, 'active');
        entry.active = active;
        changes.set(entry, { previous, hadPrevious, active, revision });
    }

    function rollbackActive(changes) {
        for (const [entry, change] of changes) {
            if (getFieldRevision(entry, 'active') !== change.revision || !Object.is(entry.active, change.active)) continue;
            if (change.hadPrevious) entry.active = change.previous;
            else delete entry.active;
            bumpFieldRevision(entry, 'active');
        }
    }

    function getCritiques(metadata = getChatMetadata()) {
        if (!metadata[EXT_KEY] || typeof metadata[EXT_KEY] !== 'object' || Array.isArray(metadata[EXT_KEY])) {
            metadata[EXT_KEY] = {};
        }
        if (!Array.isArray(metadata[EXT_KEY].critiques)) metadata[EXT_KEY].critiques = [];
        return metadata[EXT_KEY].critiques;
    }

    function getLatestActive(metadata = getChatMetadata()) {
        const critiques = getCritiques(metadata);
        for (let index = critiques.length - 1; index >= 0; index--) {
            if (critiques[index]?.active) return critiques[index];
        }
        return null;
    }

    async function add(entry, metadata = getChatMetadata()) {
        const critiques = getCritiques(metadata);
        const changes = new Map();
        for (const item of critiques) {
            setActive(changes, item, false);
        }
        critiques.push(entry);
        try { await saveChatConditional(); }
        catch (error) {
            const index = critiques.indexOf(entry);
            if (index >= 0) critiques.splice(index, 1);
            rollbackActive(changes);
            throw error;
        }
        return entry;
    }

    async function update(entry, updates) {
        const previous = new Map(Object.keys(updates).map(key => [key, { value: entry[key], present: Object.hasOwn(entry, key) }]));
        const committed = new Map(Object.keys(updates).map(key => [key, bumpFieldRevision(entry, key)]));
        Object.assign(entry, updates);
        try { await saveChatConditional(); }
        catch (error) {
            for (const [key, before] of previous) {
                if (getFieldRevision(entry, key) !== committed.get(key) || !Object.is(entry[key], updates[key])) continue;
                if (before.present) entry[key] = before.value;
                else delete entry[key];
                bumpFieldRevision(entry, key);
            }
            throw error;
        }
        return entry;
    }

    async function revert(metadata = getChatMetadata()) {
        const critiques = getCritiques(metadata);
        let foundIndex = -1;
        for (let index = critiques.length - 1; index >= 0; index--) {
            if (critiques[index]?.active) { foundIndex = index; break; }
        }
        if (foundIndex < 0) return false;
        const changes = new Map();
        const target = critiques[foundIndex];
        setActive(changes, target, false);
        if (Number.isInteger(target.basedOn) && target.basedOn >= 0 && target.basedOn < foundIndex && critiques[target.basedOn]) {
            setActive(changes, critiques[target.basedOn], true);
        }
        try { await saveChatConditional(); }
        catch (error) {
            rollbackActive(changes);
            throw error;
        }
        return true;
    }

    async function reset(metadata = getChatMetadata()) {
        const critiques = getCritiques(metadata);
        const changes = new Map();
        for (const item of critiques) {
            setActive(changes, item, false);
        }
        try { await saveChatConditional(); }
        catch (error) {
            rollbackActive(changes);
            throw error;
        }
    }

    async function prune(chatLength, metadata = getChatMetadata()) {
        const critiques = getCritiques(metadata);
        const changes = new Map();
        let changed = false;
        for (let index = critiques.length - 1; index >= 0; index--) {
            const item = critiques[index];
            if (item?.active && Number(item.rangeEnd) > chatLength) {
                setActive(changes, item, false);
                changed = true;
                if (Number.isInteger(item.basedOn) && item.basedOn >= 0 && item.basedOn < index && critiques[item.basedOn]) {
                    setActive(changes, critiques[item.basedOn], true);
                }
            }
        }
        if (!changed) return false;
        try { await saveChatConditional(); }
        catch (error) {
            rollbackActive(changes);
            throw error;
        }
        return true;
    }

    return { getCritiques, getLatestActive, getRevision, add, update, revert, reset, prune };
}
