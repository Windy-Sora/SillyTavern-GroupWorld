import { MAX_CLARIFICATIONS } from './contract.js';
import { permissionSource } from '../permissions/contract.js';

export const MAX_READ_PERMISSIONS = 32;
export const MAX_CODE_PERMISSIONS = 6;

/** Trusted task counters; shared by tool admission and application settlement. */
export function interactionLimit(task, request) {
    if (request?.kind !== 'permission') return (task?.clarifications || 0) >= MAX_CLARIFICATIONS ? 'CLARIFICATION_LIMIT' : null;
    const code = permissionSource(request.source)?.permission === 'code';
    return (task?.[code ? 'codePermissions' : 'readPermissions'] || 0) >= (code ? MAX_CODE_PERMISSIONS : MAX_READ_PERMISSIONS) ? 'PERMISSION_LIMIT' : null;
}
