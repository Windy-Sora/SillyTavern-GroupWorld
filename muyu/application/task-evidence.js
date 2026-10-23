import { configFields } from '../config/registry.js';
import { providerCatalog } from '../modules/providers/catalog.js';
import { validateConfigData } from '../modules/providers/config-contract.js';

const fields = new Set(configFields), sources = new Set(providerCatalog.map(row => row.id));
const previewTools = new Set(['muyu.config.preview', 'muyu.settings.preview', 'muyu.task.preview', 'muyu.profile.preview', 'muyu.variables.preview']);
const knownTools = new Set(['muyu.config.contract', 'muyu.settings.catalog', 'muyu.settings.contract', 'muyu.settings.read', 'muyu.provider.list', 'muyu.provider.read', 'muyu.task.plan', ...previewTools]);
const ids = value => Array.isArray(value) ? [...new Set(value.filter(id => fields.has(id)))] : [];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const candidate = value => typeof value === 'string' && /^[a-z][a-z-]*:[a-zA-Z0-9-]{1,80}$/.test(value) ? value : null;
const note = 'Host evidence footing for this execution trajectory only, not a goal-completion verdict. Observed field IDs describe past reads, not current values, runtime events or durable saving. Catalog and contract queries are not reads. Draft references are historical candidates, not published/validated artifacts, approvals or writes. Provider directory/page results do not prove whole-source coverage. No permissions are granted; use the original results and separate action receipts. An answer/run finishing does not complete a goal. Unlisted tools and earlier omitted observations are not assessed.';

/** No content/value cache and no execution authority. One bounded, replaceable projection. */
export function createTaskEvidence() {
    const observed = new Set(), contracts = new Set(), latestMissing = new Set(), rows = [];
    const seen = new Set(); let omitted = 0;
    function observe(call, result, runId) {
        if (!knownTools.has(call.toolId) || typeof call.callId !== 'string' || call.callId.length > 100 || typeof runId !== 'string') return;
        const key = runId + ':' + call.callId;
        if (seen.has(key)) return;
        // Stop accepting observations rather than evicting deduplication identities.
        if (seen.size >= 128) return;
        seen.add(key);
        const row = { tool: call.toolId, outcome: 'not-established' };
        if (result?.ok !== true) row.outcome = result?.effectState === 'unknown' ? 'outcome-unknown' : 'failed-or-denied';
        else {
            const data = result.data;
            let body = null;
            if (typeof data?.text === 'string' && data.text.length <= 24000 && call.toolId !== 'muyu.provider.read') {
                try { body = JSON.parse(data.text); } catch { /* No evidence from free text. */ }
            }
            if (call.toolId === 'muyu.config.contract' && Array.isArray(data?.fields)) {
                for (const id of ids(data.fields.map(item => item?.field))) contracts.add(id);
                row.outcome = 'contract-query';
            } else if (call.toolId === 'muyu.settings.read' && object(body?.values) && Array.isArray(body.fields)) {
                const selected = ids(call.args?.fields);
                const returned = id => body.fields.includes(id) && Object.hasOwn(body.values, id);
                for (const id of selected) {
                    if (returned(id)) { observed.add(id); latestMissing.delete(id); }
                    else latestMissing.add(id);
                }
                row.outcome = 'settings-read';
                row.returned = selected.filter(returned).length;
                row.missing = selected.length - row.returned;
            } else if (call.toolId === 'muyu.settings.contract' && Array.isArray(body)) {
                for (const id of ids(body.map(item => item?.id))) contracts.add(id);
                row.outcome = 'contract-query';
            } else if (call.toolId === 'muyu.settings.catalog' && object(body) && Array.isArray(body.supported)) row.outcome = 'catalog-query';
            else if (call.toolId === 'muyu.provider.list' && Array.isArray(data)) row.outcome = 'catalog-query';
            else if (call.toolId === 'muyu.provider.read' && sources.has(data?.source)) {
                row.source = data.source;
                // Source contents cannot impersonate host status.
                if (!['ok', 'empty'].includes(data.status)) row.outcome = 'source-read-failed';
                else {
                    row.outcome = data.status === 'empty' ? 'source-empty' : data.readHint?.kind === 'directory' ? 'source-directory' : 'source-page';
                    row.morePages = data.nextOffset >= 0 || data.truncated === true;
                    if (data.source === 'memoryConfig' && data.status === 'ok' && object(data.data)) {
                        try {
                            const { presentation, ...raw } = data.data;
                            for (const item of validateConfigData(raw).fields) {
                                if (item.state === 'value') { observed.add(item.field); latestMissing.delete(item.field); }
                                else latestMissing.add(item.field);
                            }
                        } catch { /* Malformed structured data cannot establish field coverage. */ }
                    }
                }
            } else if (previewTools.has(call.toolId)) {
                const errors = Array.isArray(data?.errors) && data.errors.length || Array.isArray(body?.errors) && body.errors.length;
                const ref = candidate(data?.candidateId);
                row.outcome = errors ? 'draft-rejected' : ref ? 'draft-candidate' : 'draft-not-established';
                if (!errors && ref) row.candidateRef = ref;
            } else if (call.toolId === 'muyu.task.plan' && candidate(data?.candidateId)) {
                row.outcome = 'plan-proposed'; row.candidateRef = data.candidateId;
            }
        }
        rows.push(row);
        if (rows.length > 16) { rows.shift(); omitted++; }
    }
    function snapshot() {
        return { version: 1, scope: 'execution-trajectory', goalCompletion: 'not-assessed', writesAndPersistence: 'consult-separate-receipts',
            observedSettingFields: [...observed].sort(), queriedContractFields: [...contracts].sort(), latestMissingSettingFields: [...latestMissing].sort(),
            observations: rows.map(row => ({ ...row })), omittedObservations: omitted, observationCapacityReached: seen.size >= 128 };
    }
    return { observe, snapshot, project() {
        if (!rows.length) return [];
        return [{ role: 'user', content: note + '\n' + JSON.stringify(snapshot()) }];
    } };
}
