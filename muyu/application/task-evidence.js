import { configFields } from '../config/registry.js';
import { providerCatalog } from '../modules/providers/catalog.js';
import { validateConfigData } from '../modules/providers/config-contract.js';
import { SELF_SECTIONS } from '../self/config.js';
import { selfConfigCoverage } from '../self/coverage.js';
import { SELF_TEXT_ITEMS } from '../self/text.js';

const fields = new Set(configFields), sources = new Set(providerCatalog.map(row => row.id));
const previewTools = new Set(['muyu.config.preview', 'muyu.settings.preview', 'muyu.task.preview', 'muyu.profile.preview', 'muyu.variables.preview']);
const knownTools = new Set(['muyu.config.contract', 'muyu.settings.catalog', 'muyu.settings.contract', 'muyu.settings.read', 'muyu.self.read', 'muyu.self.read_text', 'muyu.provider.list', 'muyu.provider.read', 'muyu.task.plan', 'muyu.skills.load', 'muyu.context.read', 'muyu.tools.list', ...previewTools]);
const ids = value => Array.isArray(value) ? [...new Set(value.filter(id => fields.has(id)))] : [];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const candidate = value => typeof value === 'string' && /^[a-z][a-z-]*:[a-zA-Z0-9-]{1,80}$/.test(value) ? value : null;
const note = 'Host evidence footing for this execution trajectory only, not a goal-completion verdict. Observed field IDs describe past reads, not current values, runtime events or durable saving. Catalog and contract queries are not reads. Draft references are historical candidates, not published/validated artifacts, approvals or writes. Provider directory/page results do not prove whole-source coverage or runtime causation; use the source scope and body coverage. A text difference does not establish a historical edit, and a missing field does not establish lack of support. No permissions are granted; use the original results and separate action receipts. An answer/run finishing does not complete a goal. selfConfigReads records only validated reads of self settings, not a requested-work checklist or goal verdict. Its overview is a summary, not full section coverage. known/unknown/not_applicable lists are field coverage, never values. order/segment identify past observations in this task, not freshness guarantees; a later failed attempt does not refresh the last observation. Skill/interface/catalog lookup is not a configuration read. With only these query outcomes and no selfConfigReads, no self-parameter observation has been recorded in this task; do not treat reading the guide as the requested current check. For a user-requested current check, being able to reject a proposed cause from rules does not complete the requested observation. Compare the user request with actual observations before answering; no extra read or permission is implied. Unlisted tools and earlier omitted observations are not assessed.';

/** No content/value cache and no execution authority. One bounded, replaceable projection. */
export function createTaskEvidence() {
    const observed = new Set(), contracts = new Set(), latestMissing = new Set(), rows = [];
    const seen = new Set(), selfReads = new Map(), segments = new Map(); let omitted = 0;
    function observe(call, result, runId) {
        if (!knownTools.has(call.toolId) || typeof call.callId !== 'string' || call.callId.length > 100 || typeof runId !== 'string') return;
        const key = runId + ':' + call.callId;
        if (seen.has(key)) return;
        // Stop accepting observations rather than evicting deduplication identities.
        if (seen.size >= 128) return;
        seen.add(key);
        if (!segments.has(runId)) segments.set(runId, segments.size + 1);
        let selfCoverage = null;
        const selfSection = call.args?.section === undefined ? 'overview' : call.args.section;
        const row = { tool: call.toolId, outcome: 'not-established' };
        if (result?.ok !== true) row.outcome = result?.effectState === 'unknown' ? 'outcome-unknown' : 'failed-or-denied';
        else {
            const data = result.data;
            let body = null;
            if (typeof data?.text === 'string' && data.text.length <= 24000 && call.toolId !== 'muyu.provider.read') {
                try { body = JSON.parse(data.text); } catch { /* No evidence from free text. */ }
            }
            if (call.toolId === 'muyu.skills.load') row.outcome = 'skill-reference-query';
            else if (call.toolId === 'muyu.tools.list') row.outcome = 'tool-catalog-query';
            else if (call.toolId === 'muyu.context.read' && Array.isArray(call.args?.ids) && call.args.ids.length && call.args.ids.every(id => id === 'muyu.interface')) row.outcome = 'interface-reference-query';
            else if (call.toolId === 'muyu.config.contract' && Array.isArray(data?.fields)) {
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
            } else if (call.toolId === 'muyu.self.read') {
                row.source = 'muyuSelfConfig';
                row.outcome = data?.status !== 'ok' ? 'source-read-failed' : 'not-established';
                selfCoverage = data?.status === 'ok' ? selfConfigCoverage(body, selfSection) : null;
                if (selfCoverage) { row.outcome = 'self-config-snapshot'; row.section = selfSection; }
            } else if (call.toolId === 'muyu.self.read_text') {
                row.source = 'muyuSelfText'; row.outcome = data?.status === 'ok' ? 'not-established' : 'source-read-failed';
                if (data?.status === 'ok' && body?.version === 1 && body.readOnly === true && SELF_TEXT_ITEMS.includes(body.item) && body.item === call.args?.item && typeof body.complete === 'boolean') {
                    row.item = body.item; row.outcome = body.complete && body.offset === 0 ? 'self-text-snapshot' : 'self-text-page';
                }
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
        if (call.toolId === 'muyu.self.read' && SELF_SECTIONS.includes(selfSection)) {
            const entry = selfReads.get(selfSection) || { section: selfSection };
            const stamp = { order: seen.size, segment: segments.get(runId) };
            const status = selfCoverage ? 'ok' : result?.ok === true
                ? ['unavailable', 'budget_exceeded'].includes(result.data?.status) ? result.data.status : 'invalid_result'
                : ['BUDGET_EXCEEDED', 'PROVIDER_BUDGET_EXCEEDED'].includes(result?.error?.code) ? 'budget_exceeded'
                    : result?.error?.code === 'PERMISSION_REQUIRED' ? 'permission_required'
                    : result?.error?.code === 'PERMISSION_DENIED' ? result.error.reason === 'user_denied' ? 'user_denied' : 'access_denied' : 'failed';
            entry.latestAttempt = { ...stamp, outcome: row.outcome, status };
            if (selfCoverage) entry.lastObservation = { ...stamp, ...selfCoverage };
            selfReads.set(selfSection, entry);
        }
        rows.push(row);
        if (rows.length > 16) { rows.shift(); omitted++; }
    }
    function snapshot() {
        return { version: 1, scope: 'execution-trajectory', goalCompletion: 'not-assessed', writesAndPersistence: 'consult-separate-receipts',
            observedSettingFields: [...observed].sort(), queriedContractFields: [...contracts].sort(), latestMissingSettingFields: [...latestMissing].sort(),
            selfConfigReads: JSON.parse(JSON.stringify([...selfReads.values()])),
            observations: rows.map(row => ({ ...row })), omittedObservations: omitted, observationCapacityReached: seen.size >= 128 };
    }
    return { observe, snapshot, project() {
        if (!rows.length) return [];
        return [{ role: 'user', content: note + '\n' + JSON.stringify(snapshot()) }];
    } };
}
