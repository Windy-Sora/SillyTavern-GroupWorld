import { validateJson } from '../core/json-contract.js';
const str = maxLength => ({ type: 'string', maxLength });
const int = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = (items, maxItems) => ({ type: 'array', items, maxItems });
const base = { version: { type: 'integer', enum: [1] }, status: { type: 'string', enum: ['ok', 'empty'] } };
const schemas = {
    roots: obj({ ...base, roots: array(obj({ id: str(32), title: str(80), revision: str(64) }), 9) }),
    list: obj({ ...base, root: str(32), items: array(obj({ path: str(300), revision: str(64) }), 30), scanned: int(0, 512), skipped: int(0, 512), limited: { type: 'boolean' }, nextOffset: int(-1, 512) }),
    search: obj({ ...base, root: str(32), items: array(obj({ path: str(300), revision: str(64), line: int(1, 262144), snippet: str(500) }), 20), scanned: int(0, 512), skipped: int(0, 512), limited: { type: 'boolean' }, nextOffset: int(-1, 512) }),
    read: obj({ ...base, root: str(32), path: str(300), revision: str(64), line: int(1, 262144), column: int(0, 262144), text: str(8000), nextLine: int(-1, 262144), nextColumn: int(0, 262144), limited: { type: 'boolean' } }),
};
export function projectDocumentResult(operation, value) {
    try {
        // A missing workspace is a valid empty observation, not a service failure.
        const result = operation !== 'roots' && value?.status === 'empty' && !Object.hasOwn(value, 'scanned')
            ? validateJson(obj({ ...base, root: str(32), items: array(obj({}), 0), limited: { type: 'boolean' }, nextOffset: { type: 'integer', enum: [-1] } }), value)
            : validateJson(schemas[operation], value);
        const paths = result.items?.map(item => item.path) || (result.path ? [result.path] : []);
        if (paths.some(path => !path || /[\\:\x00-\x1f\x7f]/.test(path) || path.startsWith('/') || path.split('/').some(part => !part || part.startsWith('.') || /[. ]$/.test(part)))) throw Error();
        const revisions = result.roots?.map(root => root.revision) || result.items?.map(item => item.revision) || (result.revision ? [result.revision] : []);
        if (revisions.some(revision => !/^[0-9a-f]{64}$/.test(revision))) throw Error();
        if (result.roots?.some(root => !/^[a-z][a-z0-9_-]{0,31}$/.test(root.id)) || result.root && !/^[a-z][a-z0-9_-]{0,31}$/.test(result.root)) throw Error();
        return result;
    } catch { throw Error('SERVICE_INCOMPATIBLE'); }
}
export const DOCUMENT_ERRORS = Object.freeze(['DOCUMENT_INVALID', 'DOCUMENT_ROOT_UNAVAILABLE', 'DOCUMENT_NOT_FOUND', 'DOCUMENT_UNSUPPORTED', 'DOCUMENT_TOO_LARGE', 'DOCUMENT_STALE', 'DOCUMENT_ABORTED', 'DOCUMENT_TIMEOUT', 'DOCUMENT_BUSY', 'DOCUMENT_CONFIG_INVALID']);
