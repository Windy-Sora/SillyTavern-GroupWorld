// Memory settings affect later extraction/compression; changing them alone
// does not start generation, compression, or deletion.
import { memoryFieldSchemas } from '../modules/config-draft/contracts.js';

export const memoryRuleDefinitions = {
    autoMemoryInterval: {
        domain: 'memory', schema: memoryFieldSchemas.autoMemoryInterval, dependencies: ['memoryEnabled', 'autoMemoryEnabled'],
        source: 'ui/sections/memory.js',
        description: '自动提取的新增消息条数调度阈值，不是对话轮数或时间。总开关、自动提取开关及运行触发条件满足后才可能执行，不证明发生或成功。1..200是本工具范围，不是运行时强制上限；缺失保持未知，不补默认或开关。',
        readCaution: '仅读取间隔值时只报告GUI名称与N条新消息；不能改述为“每N条就触发”。本次未证明开关启用、调度触发或提取成功；不要为单值问题扩读其他设置。',
    },
    memoryPrompt: {
        domain: 'memory', schema: { type: 'string', maxLength: 4000 }, dependencies: ['memoryEnabled'], idle: true,
        source: 'ui/sections/memory.js',
        description: '角色记忆提取的原始 Prompt；空串恢复内置 Prompt。先替换 charName、charDescription、charPersonality、existingMemories，再由 renderPrompt 解析 newRecentMessages 和已注册 Provider；不是压缩 Prompt。应要求输出 memories 数组的 JSON 对象（运行时也可解析直接数组），否则可能无法提取。只影响后续手动或自动提取，不改已有记忆；本工具最多 4000 字符。',
    },
    memoryCompressPrompt: {
        domain: 'memory', schema: { type: 'string', maxLength: 4000 }, dependencies: ['memoryEnabled'], idle: true,
        source: 'ui/sections/memory.js',
        description: '手动压缩旧记忆使用的原始 Prompt；空串恢复内置 Prompt。非空新草稿必须包含 {{memories}}，否则被压缩的旧记忆不会进入模型请求。运行时只替换 charName、charDescription、charPersonality、memories 四个占位符，不执行通用 Provider 渲染；其他占位符保持原样。修改设置本身不会压缩或删除记忆；之后用户点击压缩才可能替换当前聊天的旧条目，模型失败时运行时会退回本地分号拼接。工具最多 4000 字符。',
    },
    memoryJsonSchema: {
        domain: 'memory', schema: { type: 'string', maxLength: 4000 }, dependencies: ['memoryEnabled'], idle: true,
        source: 'ui/sections/memory.js',
        description: '角色记忆提取的 JSON Schema；空串维持原有宽松解析，非空值必须是 memories 数组、event 字符串及可选 mood 字符串的有界结构。自定义 Schema 会加入后续模型 Prompt，并在入库前校验模型输出；不支持新增持久化字段或保证模型服务商的原生结构化输出。错误 Schema 拒绝生成草稿；已有错误配置会让新提取明确失败，不影响已存记忆。本工具最多 4000 字符。',
    },
    memoryRenderTemplate: {
        domain: 'memory', schema: { type: 'string', maxLength: 4000 }, dependencies: ['memoryEnabled'], idle: true,
        source: 'ui/sections/memory.js',
        description: '仅控制之后 {{charMemory}} Provider 的纯文本输出，不改变已存记忆或 {{charMemoryCurrent}}。空串保留旧版按角色分组格式；非空文本使用只读 charMemory:all/groups 块与字段查询，不执行其他 Provider 或脚本。无效旧模板会警告并回退旧格式；本工具最多 4000 字符。',
    },
    memoryKeepRecent: {
        domain: 'memory',
        schema: { type: 'integer', minimum: 1, maximum: 100 },
        dependencies: ['memoryEnabled'],
        source: 'ui/sections/memory.js',
        description: '手动压缩时保留最近的完整记忆条数；界面的“撤销最近一次提取”也用此数值删除最近 N 条记忆，并不按提取批次识别。修改此全局设置不会立即压缩或删除当前聊天记忆；仅影响之后点击这两个按钮的操作。本工具支持 1..100，原界面输入处理只有下限，运行时不强制该上限。',
    },
};
