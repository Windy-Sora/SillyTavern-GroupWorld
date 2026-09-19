export function toBoundedInt(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function matchesDataId(value, id) {
    return String(value) === String(id);
}
