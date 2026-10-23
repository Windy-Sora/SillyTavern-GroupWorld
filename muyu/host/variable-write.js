import { jsonKey } from '../core/json-contract.js';
import { slugifyId } from '../../systems/variable-system.js';

/** Trusted one-variable chat write. An exception after mutation is an unknown outcome, never a retry signal. */
export function createVariableWriter({ draftPort, getTarget, getMetadata, extensionKey, saveChatConfirmed, editorPort, isBusy = () => false, changed = () => {} }) {
    return Object.freeze({
        async apply(content) {
            if (isBusy()) throw Error('VARIABLE_BUSY');
            if(content?.module==='variable-editor') { if(!editorPort)throw Error('WRITE_UNAVAILABLE');return editorPort.apply(content); }
            if (typeof saveChatConfirmed !== 'function') throw Error('WRITE_UNAVAILABLE');
            draftPort.assertFresh(content);
            const metadata = getMetadata(), target = content.target, { request, definition } = content;
            if (jsonKey(getTarget()) !== jsonKey(target)) throw Error('TARGET_UNAVAILABLE');
            // All checks above are synchronous; no await before this bounded mutation.
            if (!metadata[extensionKey]) metadata[extensionKey] = {};
            const root = metadata[extensionKey];
            if (!root.variables) root.variables = { defs: [], values: { global: {}, character: {} }, log: [] };
            const vars = root.variables;
            let changedDefinition;
            if (request.action === 'create') {
                changedDefinition = { ...definition };
                vars.defs.push(changedDefinition);
                vars.values.global[definition.id] = definition.defaultValue;
            } else {
                changedDefinition = vars.defs.find(item => slugifyId(item?.id) === definition.id);
                if (!changedDefinition) throw Error('STALE_VARIABLE_DRAFT');
                for (const row of content.preview.diff) changedDefinition[row.field] = definition[row.field];
            }
            try { changed(definition.id); } catch { /* Observers cannot change write outcome. */ }
            let saveError = false, confirmed = false;
            try { await saveChatConfirmed(metadata); confirmed = true; } catch { saveError = true; }
            let stale = true;
            try {
                stale = getMetadata() !== metadata || jsonKey(getTarget()) !== jsonKey(target) || metadata[extensionKey]?.variables !== vars ||
                    !vars.defs.includes(changedDefinition) || content.preview.diff.some(row => jsonKey(changedDefinition[row.field]) !== jsonKey(row.after)) ||
                    request.action === 'create' && jsonKey(vars.values.global[definition.id]) !== jsonKey(definition.defaultValue);
            } catch { /* Verification unavailable is a warning, not a successful save. */ }
            draftPort.forget(content);
            return { status: !confirmed ? 'outcome_unknown' : stale ? 'partial' : 'applied_confirmed',
                chatSave: confirmed ? 'confirmed' : 'unknown', saveError, changed: stale };
        },
    });
}
