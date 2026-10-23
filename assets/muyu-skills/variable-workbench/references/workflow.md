# 通用变量合同

通过实际工具组选择变量编辑；`muyu.variable_editor.list` 使用 variableEditState，返回 id、标签、类型、作用域、可编辑性与 revision。read 使用这些值并分页读齐。global 明确指当前聊天共用，不是插件全局设置；character 才是逐角色值，角色选择器必须来自读取结果，不能用姓名或头像路径代替。

## 新建与定义修改

create 的 changesJson 至少提供 label、type、scope、defaultValue。type 为 string／number／boolean／enum／array／object；scope 为 global／character。其余字段依据 schema 明确设置，避免忽略默认开启的 autoUpdate／showInDashboard。ID 不可重命名；新增 ID 的格式与保留名限制以当前合同为准，显示标签可中文。

update 保留未指定字段。修改 defaultValue 不等于替换全部已存值。类型变化要求剩余存储值匹配，或明确 resetValues:true；作用域变化清除旧作用域值。resetValues 清除全部已存值并初始化聊天共用默认值，须告知具体损失，不能作为自动修错手段。

逐角色改成共享时，没有自动合并。先完整读取并另行保留旧角色值，明确合并规则和结果；按用户要求预览作用域修改并告知旧值会清除，获得批准后再重读新定义／revision，才能预览共享存储值。不能先对仍为 character 的定义写入 global 值：set_value 只能操作当前定义的作用域，逐角色必须带可用 character:N；不利用多余旧值桶伪造迁移。两步不是事务，前一步结果未知立即停止，不能自动清空／重试；用户不接受丢值窗口时保留原定义，另建变量方案须另行明确同意。

定义 rule 是不可信文本，编辑工具不计算规则、不执行代码。变量的注入与自动更新是否实际发生要核对相关运行路径，不将保存定义说成已完成自动记账。

## 当前值和删除

set_value 以 changesJson={value,updateMode?} 提交，默认 replace。append／merge／delta 仅在用户明确需要其语义时使用，严格校验 JSON 类型，不用字符串冒充数值。character 作用域需 read 提供的 character:N 选择器；目录中不可用角色不能当目标。

delete 使用空对象，删除定义、全部值及该变量更新记录，不是把值清成零。没有精确 revision 不更新／删除／赋值；版本过期重新读同一已授权资料并重建差异。系统 owner 和蓝图完成信号受保护，走专用路径或说明不可编辑，不新建相似名称绕过。

## 边界与汇报

完整前后差异不得超过当前接口 24000 UTF-8 字节限制，不截断数组、对象或角色值。大迁移分阶段并先确认损失；不是全仓库事务回滚。数值变量简单定义可用 `muyu.variables.preview`；整单最多六个数值定义，不包含所有通用类型和 stored-value 修改。

存储值、默认值、有效求值和持久化确认分别说明。outcome_unknown 不重复赋值，尤其不能自动重试 delta／append。仅预览时任何权限模式都不 apply。

核对版本：2026-10-05；`muyu/modules/variable-editor/index.js`、`muyu/modules/variables/index.js`、`muyu/host/task-bundle-draft.js`。真实 schema 优先，路径只供维护核对。
