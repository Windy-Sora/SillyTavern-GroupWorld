// Private account repositories share one host settings document. Serialize their mutations,
// not merely their HTTP saves, so one cannot persist another's unconfirmed working copy.
const queues = new WeakMap();
export function serializeSettings(owner, work) {
    const pending = (queues.get(owner) || Promise.resolve()).then(work);
    queues.set(owner, pending.catch(() => {})); return pending;
}
export async function waitSettingsWrites(owner) {
    let pending; do { pending = queues.get(owner); await pending; } while (pending !== queues.get(owner));
}
