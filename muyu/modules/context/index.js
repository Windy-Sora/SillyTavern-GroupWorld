import { createToolRegistry } from '../../tools/registry.js';
import { listMemoryKnowledge, readMemoryKnowledge } from '../memory/knowledge.js';
import { listDirectorKnowledge, directorDocument } from '../director/knowledge.js';
import { navigationDocument } from '../../ui/navigation-metadata.js';
const str = { type: 'string', maxLength: 2000 };
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items, maxItems) => ({ type: 'array', items, maxItems });
const metadata = { id: str, version: { type: 'integer' }, title: str, source: str, scope: str };
export function createContextModule() {
    const registry = createToolRegistry();
    function register(id, description, inputSchema, outputSchema) {
        registry.register({ id, version: 1, description, inputSchema, outputSchema, scope: 'global', effect: 'read', dataClasses: ['public-knowledge'], confirmation: 'policy', resourceKeys: [], timeoutMs: 1000, retryPolicy: { kind: 'none', maxAttempts: 1 } });
    }
    register('muyu.context.list', '列出记忆/导演静态资料和暮羽GUI入口指南muyu.interface；找按钮、连接配置、导出、悬浮球或长期记忆入口时读取该指南。目录不是全文，不授予状态或正文读取权限。', obj({}), arr(obj(metadata), 7));
    register('muyu.context.read', '按目录ID读取完整资料，最多3篇；complete=false时missing明确列出未读项。不支持任意路径、URL或聊天正文。', obj({ ids: arr({ type: 'string', maxLength: 64 }, 3) }), obj({ complete: { type: 'boolean' }, documents: arr(obj({ ...metadata, text: { type: 'string', maxLength: 4000 } }), 3), missing: arr({ type: 'string', maxLength: 64 }, 3) }));
    registry.seal();
    return { registry, handlers: {
        'muyu.context.list': () => [...listMemoryKnowledge(), ...listDirectorKnowledge(), (({ text, ...meta }) => meta)(navigationDocument())],
        'muyu.context.read': ({ ids }) => {
            if (new Set(ids).size !== ids.length) throw Error('INVALID_IDS');
            const result = { complete: true, documents: [], missing: [] };
            for (const id of ids) {
                const d = id === 'muyu.interface' ? navigationDocument() : directorDocument(id) || (listMemoryKnowledge().some(m => m.id === id) ? readMemoryKnowledge([id]).documents[0] : null);
                if (!d || new TextEncoder().encode(JSON.stringify([...result.documents, d])).length > 12000) result.missing.push(id);
                else result.documents.push(d);
            }
            result.complete = !result.missing.length; return result;
        },
    }, transferRun() {}, retainArtifacts() {}, dispose() {}, forgetRun() {} };
}
