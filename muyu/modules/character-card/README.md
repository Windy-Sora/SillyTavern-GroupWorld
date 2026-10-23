# 酒馆角色卡端口

第六／七轮：独立按需 character-card 工具组，list / read / preview。通过酒馆官方 `/api/characters/get`、`merge-attributes`、`duplicate`、`create`、`delete` 接口，不修改酒馆核心，不调用整卡编辑表单或全量角色界面刷新。

## 权限与范围

- list：stCharacters，仅名称、card:N 与目录版本；read/preview：stCharacterCardState，独立角色卡正文来源。读取许可不授予写入。
- read：保存卡的八项文本与 creator、character_version、tags、alternate_greetings、主世界书名称投影；不是任意扩展／raw json_data，不是编辑草稿或最终注入证据。每页6000字符、总投影131072字符，累计计入资料预算。
- update：description、personality、scenario、first_mes、mes_example、system_prompt、post_history_instructions、creator_notes，每项最多12000字符，仅编辑已存在字段。指定字段同时提交顶层与data。按原始保存JSON而非酒馆转换后的读取视图判定格式：无spec的旧V1卡不支持修改创作者备注、系统提示词、历史后指令；read的unsupportedUpdateFields列明限制，包含任一受限字段的整份预览拒绝，不写入、不暗中迁移整卡。其他五项文本及显示名仍可修改。未指定字段、未知元数据、头像、显示名和聊天路径不提交。
- copy：完整保存PNG（必须有json_data），保留未知字段与原显示名，宿主分配新文件名；不复制聊天、标签映射或外部附加世界书绑定，不切换聊天或选中角色。
- create：空selector与目录revision，name最多80字符及可选八项文本。默认头像、空绑定，不上传文件；file_name为muyu-UUID，避免名字派生路径及覆盖已知卡。拒绝已加载目录标准化同名，不保证跨窗口显示名唯一。不选择角色、不切换聊天。
- rename：仅顶层name和data.name的显示名修改，保留文件名／聊天目录／关联和旧消息。不是原生rename端点的迁移，不传其副作用给用户。
- delete：独立stCharacterCardReferences授权与可用引用计数；阻止当前使用、已加载群组、标签、作者注、附加世界书、本聊天NPC导入关联。完整保存旧JSON预览后永久删除PNG，delete_chats=false，保留聊天文件但可能失去入口。未知历史／第三方引用不清理，不承诺没有外部引用，须先备份。
- 不含物理文件重命名、绑定、宏执行、生成或ST消息修改，以及删除聊天文件。

## 审批、草稿与保存边界

预览不写。完整批准内容最多24000 UTF-8字节，并受通用DTO深度／节点上限约束；超过限制拒绝，不能截断后批准。普通模式精确批准；全权限仅显式执行意图的apply=true可自动执行。正在生成或目标卡仍选中在酒馆角色编辑器时拒绝写入和复制，须用户保存／放弃草稿后选择其他角色。

写前重读服务端整卡与目录基线，私有票据跟随模块生命周期失效。服务器字段合并保持未指定字段；没有服务端ETag／原子CAS，不能保证跨客户端同字段并发写不冲突。HTTP成功后再读取指定字段；复制后核对完整已批准保存JSON。报告applied_unconfirmed或outcome_unknown，不声称磁盘持久化确认，不自动重试／整卡回滚。

缓存只同步已核对文本／显示名或追加新卡，保留聊天路径／运行状态，不重载酒馆编辑器或强制触发第三方事件。删除只在暮羽目录隐藏已删除旧缓存对象，不重排酒馆角色索引，避免其他选中角色跳号；其他目录缓存仍可能有旧卡，须手动刷新酒馆。重载后的新对象不被旧删除标记隐藏。删除后重查404与引用；不确定／并发引用则报告未知，不恢复PNG／重试。跨资源没有服务器锁。

历史回执v33只保留操作、card:N（create为空）、保存分类和标识时间，不包含角色名、文件名、文本或扩展。对应Skill character-npc-workbench revision4。隔离验证不替代真实酒馆GUI与磁盘验收。
