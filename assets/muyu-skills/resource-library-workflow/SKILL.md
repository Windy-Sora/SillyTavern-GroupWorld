---
name: resource-library-workflow
display-name: 资源库与配置档复用
description: 用户希望查找、核对已保存的角色档案包、NPC包、蓝图包，或保存、导入导出、修改、应用资源及生成可复用全局配置档时使用；区分资源库、当前聊天与运行开关。
version: "1.4"
---

# 资源库与配置档复用

用户说“库里的资料还在不在／看看以前保存的包”，已有专用只读入口，不要求先启用业务，也不生成新内容。工具暂未显示时先用 muyu.tools.list 查看实际可用组及 readPath：档案库 libraries → muyu.libraries.list/read，NPC库 npc-libraries → muyu.npc_libraries.list/read，蓝图库 blueprint-libraries → muyu.blueprint_libraries.list/read。grouped=true 时先单独调用 muyu.tools.select，保留仍需要的组。工具组选择不授予资料权限；组未列出不假装可用，不转去执行 Provider，也不借当前聊天内容冒充库资源。

list 是保存资源的目录，read 才读取对应 id／revision 的分页正文，第一页 offset=0，后续用同一版本的 nextOffset；旧版本失效就重列目录。库存在不证明已应用、持久化成功或当前聊天使用它；读当前聊天应使用相应来源另行授权。只读检查不调用 preview、export、apply、capture 或生成工具。拒绝后保留缺口，不通过其他入口读取同一份被拒资料。自定义 Prompt 条目不是这些库，使用 prompts 组的 muyu.prompts.list/read 并加载 Prompt 专项 Skill；内置提示词、酒馆预设和暮羽自身指令也不能混为该资源。

先完整读取 references/workflow.md。先弄清是“存到库”“导出”“应用到聊天”还是“保存配置档”，不要因名字相近使用错误工具。

按库列表返回的 id／revision 阅读完整资源，保护未指定内容。资源包保存不等于已应用；应用聊天不必替换全局生成模板。覆盖、按姓名匹配、携带进度和导入模板仅按明确意图设置。

展示匹配／跳过／替换范围及数据损失，说明是否同时影响所有聊天。格式校验不能保证语义正确或恢复全部运行状态。未知保存不重试，不把生成配置档说成实时设置已改变。

导出工具返回 JSON，不代表已在磁盘写文件；需要下载时用现有界面。Skill 不增加任意文件访问或后台导入能力。
