# 暮羽 Skill 开发与运行合同

Skill 是可复用的任务方法，说明何时采用、需要哪些证据、如何组合已有工具及验证结果。工具提供能力，Provider 提供事实，用户笔记保存明确约定；Skill 不增加权限或执行环境。

内置内容在 [assets/muyu-skills](../../assets/muyu-skills) 独立维护，包名、revision 与资源清单以 [builtin-manifest.js](builtin-manifest.js) 为准，不在此复制一份容易过时的版本表。当前指南覆盖配置检查、导演／记忆／蓝图、变量及复杂系统、Provider／DSL、Prompt／脚本／Agent、角色与资源库、世界书、界面与排障，以及常见 ST 卡片配件、EJS 和酒馆助手协作机制。

## 分层

| 部件 | 职责 |
| --- | --- |
| contract.js | 文档包、受限 frontmatter、资源路径、容量及导入导出 |
| registry.js | 合并内置与用户目录，按 ID／revision／调用方式取得不可变快照 |
| builtin-manifest.js / builtin-loader.js | 白名单静态资源加载；清单存元数据，不嵌入正文 |
| host/skill-store.js / management.js | 账户插件设置、版本校验及共用保存队列 |
| editor.js / GUI 工作台 | 表单与包转换、用户编辑草稿、导入及完整包导出 |
| modules/skills | 管理候选与运行发现／加载分离 |
| task-runtime.js | 同任务版本快照、完整度、续接与上下文投影 |

新增技能主要修改内容与清单，修改已发布内容须提升 revision；不为每个包增加工具，不将正文硬编码进 controller。文档只从本插件清单路径加载，拒绝重定向，不扫描任意目录或接受用户 URL。

设计参考本地 Codex、Claude Code 和 DeepSeek harness 快照中的目录／正文分离、显式调用及任务快照思路；这些项目不是运行依赖。暮羽不提供 MCP、Shell 插值、技能钩子、技能市场、远程自动下载或后台学习；代码示例仅为文本。

## 文档包

```json
{
  "format": "muyu-skill-package",
  "version": 1,
  "files": [
    { "path": "SKILL.md", "text": "---\nname: example\ndescription: Explain a particular workflow.\n---\nRead the applicable contracts before acting." },
    { "path": "references/rules.md", "text": "Supporting instructions." }
  ]
}
```

importSkillPackage 接受单篇 SKILL.md 或完整 JSON 文本包；exportSkillPackage 输出完整紧凑 JSON，避免格式化膨胀超过导入上限。资源只支持 SKILL.md 及 references／assets 下的 md、txt、json，不支持 ZIP 解压或任意目录导入。

SKILL.md 必填 name、description 和非空正文；name 为最多 64 字符的 kebab-case。可选 display-name、version、disable-model-invocation、user-invocable；作者 version 不代替仓库 revision。两个调用标志独立，默认允许。

frontmatter 仅支持标量、引号字符串及 |／> 块文本，不是完整 YAML。重复／未知字段、引用或对象及 hooks／allowed-tools／context／model 等未支持语义明确拒绝，不模拟其他 Agent 的执行能力。

路径禁止绝对路径、反斜杠、.. 段、URL、编码逃逸、控制字符及 Windows 保留名称；大小写重复路径拒绝，主文档必须恰为 SKILL.md。引用资源缺失时报错，不能转向网络或其他包补齐。

容量为每包 32 文件、单文件 256 KiB UTF-8、完整包 512 KiB JSON、用户 128 包、总存储 4 MiB。超限拒绝，不截断。实际模型使用另受资料和输入预算限制。

## 身份、存储与管理

内置 ID 为 builtin:name，用户为 user:name，同名并存而不静默覆盖。内置原件只读，可停用、导出或复制为用户包；稳定身份改名使用明确复制，新包默认禁用，不把“保存”解释为“启用”。

用户仓库 v2 包含 version、revision、skills、enabled、builtinPolicies。旧 v1 读取做纯迁移，仅下一次成功保存写入 v2；未知版本、null 或损坏策略拒绝并保留原始数据，不自动清空。

总开关、每包 enabled、modelInvocable／userInvocable 分别管理。内置 revision 由内容与策略版本组合为字符串，用户包使用单调修订；执行时同时检查仓库与目标包精确版本，删除重建不能复用旧批准。

GUI 与 Agent 共用管理和保存队列。读取等待在途写入排空，保存前队列内再次检查基线。失败只按精确对象／内容匹配条件恢复，不覆盖无关并发编辑；结果未知不自动重试。宿主保存返回及内存匹配不单独证明落盘。

技能明文保存在账户插件设置，排除于剧情配置档导入导出；不是密钥保险箱。用户启用表示相关说明可按需发给当前模型，不代表酒馆资料读取或代码执行批准。

## GUI 与模型管理

管理入口为悬浮球齿轮 → 技能与工具。目录／详情／导入互斥，内置组默认收起，搜索和筛选临时展开匹配组；正文、资源、高级设置分页。菜单放低频操作，设置页承担滚动，不套大块独立滚动列表。

草稿由控制器持有，目录刷新、筛选和模型保存不覆盖未保存正文。返回目录可继续编辑，切换／重载有修改时确认；导入仅填草稿，不自动保存或启用。导出针对已保存精确版本，完整 JSON 含参考文件。原始资源 JSON 无效时保留输入并阻止保存。

muyu.skills.list/read/preview 使用 skillAssets 来源，管理读取不激活技能。create/update/delete/enable/copy/feature 候选绑定完整基线与精确版本；正文放私有票据，普通模式审阅完整差异再批准，全权限仍需显式 apply=true 与真实写入意图。

内置覆盖／删除、隐藏启用和身份改名拒绝。票据单次消费；取消、失败或删除产物释放自身资源。v31 回执只含操作与保存元数据，不能恢复权限。不根据历史建议或 Skill 自身内容推导用户要求保存。

管理目录分页与正文分页保持明确：list 附精确 readCall，有后页才附 nextCall；read 续页使用同 ID／原样 revision 及宿主 nextOffset。版本过期重建基线，不自行计算偏移或绕向运行加载读取被拒资产。管理 preview 的 requestJson 上限与 GUI 完整包容量不同，以公开工具 Schema 为准。

## 运行加载与上下文

muyu.skills.discover/load 与管理工具分开。新任务获得可自动选用目录第一页，最多 16 项、条目 JSON 最多 8000 UTF-8 字节；剩余页按返回游标继续。禁用和仅手动包不进入自动目录，目录不完整或不可用不证明没有相关技能。

输入区可为下一任务选择精确 ID／revision；真实结构化选择才构成用户调用，引用、旧历史或模型回答不能伪造。发送后清除选择，版本失效不悄悄切到新版。

load 先完整加载 SKILL.md，再按白名单路径读取必要参考资源。工具返回身份、完整度与资源元数据；完整说明经 taskGuides 单独投影到正常请求，不用被截断的工具正文或摘要替代。

每任务最多 8 包、已加载文本总量最多 4 MiB；首次读取计 UTF-8 资料预算，同路径去重。每次外发仍计请求输入与请求体预算；预算不足不留下半份说明、不自动加额度。

Task 持有固定不可变版本，权限／澄清续接转移原状态；编辑、停用或删除影响新任务，不声称撤回已发给模型的内容。方案续接保留原版本，对保留资料按新执行段合同计费；停放缓存有界，不能容量不足时静默重载新版本。

历史、摘要和产物不自动存 Skill 正文或恢复加载／批准。压缩只处理历史，正常请求重新投影同 Task 完整指南；taskGuides 在私有思考索引映射后插入，不能破坏工具与 reasoning 对应。任务结束回收正文，停放／停止清理遵守 Task 生命周期。

按需工具组只改变可见定义，不授权；切组保留稳定旧调用别名但不能用旧别名执行已不可见工具。管理、运行与业务权限始终独立。

## 内容维护与验证

指南围绕完整用户任务编写：所需证据、适用环境、最小步骤、实际效果、验证与停止条件。区分事实、推断、建议及用户接受的目标；不将目录、预览、合成测试或保存返回冒充已执行、已注入或已持久化。

第三方插件和卡片生态指南讲机制与排查路径，不穷举写法；案例使用原创合成数据，不复制私有角色卡或预设的名称与正文。用户含糊反馈应先取得授权范围内的环境证据，再选择指南。

确定性回归覆盖格式、路径、容量、同名、版本、内置保护、保存未知、续接、取消、完整投影、上下文预算与工具映射。真实模型评测区分自动选用与手动指定，保留失败和复测；记录见 [EVALUATION.md](EVALUATION.md)，不是通用质量保证。真实 ST GUI、CSP、代码导入／执行及持久化需单独验收。
