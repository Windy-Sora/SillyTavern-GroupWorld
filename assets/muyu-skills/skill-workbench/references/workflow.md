# 技能开发和管理合同

## 内容设计

一份 Skill 围绕用户任务，不围绕每个内部函数。description 明确何时使用和何时不使用，主体给执行流程和结束标准；长合同、示例与证据边界放 references。需要的资源在主体明确要求完整读取，不写无法加载的跨包相对路径。名称稳定，界面名称可中文；工具 id 只在执行指南使用。

区分方法与实时事实：技能可描述工具合同，不能携带用户密钥／私密聊天或把某次配置当默认真相。不复制整个配置字段表造成升级漂移；实际目录和合同优先。评测包含直问、模糊追问、资料拒绝、只预览、未知结果和超出能力，而不是只测一条成功路径。

## 管理与包格式

先区分任务加载与资产管理：muyu.skills.discover/load 不代表完整能力。若当前可见工具只有这两项，先用 muyu.tools.list 检查按需目录，若有 skills 组，再单独调用 muyu.tools.select 选入并查实际 schema；未加载不能说“没有保存／编辑Skill动作”或“只能用户在GUI创建”。目录确实没有管理组时才说明本轮不可用，不从指南虚构工具或强行解锁。管理预览不是用户批准，任意路径文件写入仍不支持。

`muyu.skills.list` 返回 Skill 元数据、目标 revision 和 store revision，读取授权为 skillAssets。`muyu.skills.read` 按 id／revision／offset 分页读整个保存包，是资料读取，不激活正文。内置 revision 为 content:policy，用户为十进制字符串；原样使用返回值，不从 version 猜 revision。

`muyu.skills.preview` 的 requestJson 使用 operation、expectedRevision 及操作所需字段。create／update 可用 fields={name,displayName,description,body,contentVersion,modelInvocable,userInvocable,resources:[{path,text}]}，或 package={format:"muyu-skill-package",version:1,files:[{path,text}]}，二选一。update 保留省略字段，稳定 name 不可变。

package 主文件为 SKILL.md，frontmatter 至少 name／description，正文指定需要 references。资源仅允许当前校验的相对 references／assets 文本路径，不使用绝对路径、上级目录或可执行文件；每包最多32文件、单文件256 KiB、整包512 KiB，仓库总量4 MiB。不能通过超短外链指向远程资源绕开限制，运行层不自动下载。

existing update／delete／enable／copy 需精确 id、revision 和 expectedRevision；feature 切总开关，enable 切一份 enabled，不能附带正文。copy 提供 newName；新建／复制默认禁用，不因可调用就视为已启用。

内置原件不能 update／delete，可 disable 或 copy 后改用户副本。modelInvocable 与 userInvocable 分别控制模型选用和手动选用，启用不授予酒馆资料、写入、联网或代码权限。

## 保存、加载与导出

preview 仅候选；普通模式精确 UI 批准，全权限只在明确保存意图下 apply。版本过期重读后重建草稿，不覆盖并发内容；保存未知不自动重试。导入不执行 hooks／Shell／代码，不假称开启新工具。

`muyu.skills.discover/load` 是按需目录与本任务完整加载，不是管理 CRUD。先加载 SKILL.md 再参考文件，使用目录返回 revision；同任务固定快照，不因编辑已保存原件偷偷切换方法。总开关或调用策略拒绝时不能从历史或读取正文绕过加载机制。

GUI 可复制／导出已保存的完整 JSON 包；不能称导出未保存草稿或已写入任意磁盘目录。Agent 当前无专用 Skill export 工具，若用户要求输出包，可在完整读取且容量允许后给兼容 JSON，文件下载用 GUI，不编造工具。管理入口仅悬浮球齿轮，不增加插件设置卡。

同任务已经载入的同一 id 不能换 revision：即使显式传新版 load，也返回 SKILL_STALE，不会替换主文件或参考文件，不建议同任务重新发现再载入新版。任务在授权／澄清续接后仍沿用旧快照。要使用已保存新版，结束旧任务，在下一新任务重新按目录版本加载；正文的 version 不是工具 revision，不自行拼版本。

核对版本：2026-10-05；`muyu/modules/skills/index.js`、`muyu/skills/contract.js`、`muyu/skills/task-runtime.js`、`muyu/skills/README.md`。正文变化更新内置清单 revision，实际 schema 优先。
