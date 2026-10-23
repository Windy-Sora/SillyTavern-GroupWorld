import { copyJson, jsonKey } from '../../core/json-contract.js';

const toggle = value => value === true ? 'on' : value === false ? 'off' : 'unknown';
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : -1;

/** Trusted synchronous getters only; never calls GD getStore/getStats or scans message bodies. */
export function createMemoryReader({ extensionKey, getTarget, getSettings, getMetadata, getGroup, getMessageCount, getGuards = () => ({}) }) {
    if (typeof extensionKey !== 'string' || !extensionKey || [getTarget, getSettings, getMetadata, getGroup, getMessageCount, getGuards].some(fn => typeof fn !== 'function')) throw new TypeError('Missing memory read ports');
    let fingerprint = null, revision = 0;
    function project() {
        const settings = getSettings(), metadata = getMetadata(), group = getGroup(), guards = getGuards();
        const store = metadata?.[extensionKey];
        const rawInterval = settings?.autoMemoryInterval;
        const messageCount = count(getMessageCount());
        const interval = !rawInterval ? 10 : count(rawInterval) > 0 ? rawInterval : -1;
        const baseline = store?._autoMemLen !== undefined ? count(store._autoMemLen) : store?._autoCheckLength !== undefined ? count(store._autoCheckLength) : 0;
        const members = group == null ? [] : Array.isArray(group.members) && (group.disabled_members == null || Array.isArray(group.disabled_members)) ? group.members.filter(id => !group.disabled_members?.includes(id)) : null;
        if (members && (members.length > 64 || members.some(id => typeof id !== 'string') || new Set(members).size !== members.length)) throw new Error('EVIDENCE_LIMIT');
        const state = copyJson({
            memoryEnabled: toggle(settings?.memoryEnabled), autoMemoryEnabled: toggle(settings?.autoMemoryEnabled), speakersOnly: toggle(settings?.autoMemorySpeakers),
            interval, messageCount, baseline,
            baselineSource: store?._autoMemLen !== undefined ? 'batch' : store?._autoCheckLength !== undefined ? 'legacy' : 'initial',
            hasGroup: group == null ? 'off' : 'on', enabledMembers: members ? members.length : -1,
            canFinalize: toggle(guards?.canFinalize), manualGenerating: toggle(guards?.manualGenerating),
            generationType: ['normal', 'swipe', 'regenerate'].includes(guards?.generationType) ? guards.generationType : 'unknown',
            members: (members || []).map((id, index) => {
                const entry = store?.charMemories?.[id];
                const progress = store?._autoMemCharLen;
                const covered = progress && !Array.isArray(progress) && typeof progress === 'object' && Object.hasOwn(progress, id) && progress[id] != null ? count(progress[id]) : baseline;
                const newMessages = messageCount >= covered && covered >= 0 ? messageCount - covered : -1;
                return { slot: index + 1, memoryCount: entry === undefined ? 0 : Array.isArray(entry) ? entry.length : -1, covered, newMessages,
                    intervalStatus: newMessages < 0 || interval < 1 ? 'unknown' : newMessages >= interval ? 'met' : 'pending' };
            }),
        });
        return { state, identity: members };
    }
    function assertTarget(expected) {
        if (expected?.kind !== 'chat' || jsonKey(getTarget()) !== jsonKey(expected)) throw new Error('TARGET_UNAVAILABLE');
    }
    return Object.freeze({
        read(expected) {
            assertTarget(expected); const first = project(); assertTarget(expected);
            const key = jsonKey(first);
            if (key !== jsonKey(project())) throw new Error('STALE_EVIDENCE');
            assertTarget(expected);
            const nextFingerprint = jsonKey({ target: expected, key });
            if (fingerprint !== nextFingerprint) { fingerprint = nextFingerprint; revision++; }
            return { ...first.state, revision };
        },
    });
}
