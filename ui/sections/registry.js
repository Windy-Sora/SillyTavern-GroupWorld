/**
 * Section registry — new UI sections self-register here.
 * settings-init.js only calls initAllSections(); it never needs to
 * know which sections exist or what they import.
 */
const sections = [];

export function registerSection(name, initFn) {
    sections.push({ name, initFn });
}

export function initAllSections(ctx) {
    for (const { name, initFn } of sections) {
        try {
            initFn(ctx);
        } catch (e) {
            console.error(`[GroupDirector] UI section "${name}" init failed:`, e);
        }
    }
}