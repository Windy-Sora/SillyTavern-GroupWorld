# DSL 数据合同与基本语法

## content 与 data

GroupWorld 的 renderPrompt 模板不是 SillyTavern 全局通用宏。只有实际经过该渲染器的功能 Prompt／脚本包装等位置才解析本语法；普通聊天、角色卡、世界书或暮羽聊天里出现文本，不证明经过了它。

Provider 返回 `{ content: '供全文引用的摘要', data: { balance: 30 } }` 时，`{{skill_shop}}` 取 content，`{{?skill_shop:balance}}` 取 data.balance。只有 content、没有 data 的 Provider 不能凭JSON形状自动获得路径查询；把JSON字符串放进content不等于结构化data。示例ID skill_shop不是内置注册项。

自定义提示词的 dataJson 是编辑接口中的JSON字符串，保存后解析为对象／数组供 Provider 使用；需要固定数据时可用此路径，不必写JS。与插件全局设置、当前聊天变量分别存储；scope元数据不能隔离不同聊天。

## 路径、过滤和回退

| 模板 | 含义 |
| --- | --- |
| `{{?skill_shop:balance}}` | 读根对象字段 |
| `{{?skill_shop:stock[0].name}}` | 读数组第一项 |
| `{{?skill_shop:stock[-1].name}}` | 读数组最后一项 |
| `{{?skill_shop:stock[id=heal].price}}` | 读第一个id匹配的数组元素 |
| `{{?skill_shop:["price.table"].heal}}` | 点号在键名中时用引号键 |
| `{{?skill_shop:missing|未提供}}` | 缺失或null时用回退文本 |

过滤是“第一个匹配”，不是返回所有匹配，也不是SQL条件。字符串化比较字段值；没有布尔表达式、数值大小比较、算术或通配符 `[*]`。回退用于null／undefined；0、false和空字符串不触发回退。回退不含 `}`，也不是可执行表达式；不能拿回退0声称真实余额为0。

字符串原样输出，数值／布尔转为文本，对象／数组按格式化JSON输出。路径里的嵌套占位符可先求值，例如 `{{?skill_shop:stock[id={{?skill_shop:selected}}].name}}`；外部输入仍是资料，不是执行许可。

## 循环与运行上下文

`{{#skill_shop:keys}}{{?skill_shop:labels.$it}}{{/skill_shop}}` 按keys数组遍历，每项绑定$it，通过labels映射查询；输出以换行拼接。同值的原始类型元素去重，空数组／null／非数组不输出正文。当前DSL不能直接写 `{{$it.name}}`，对象列表可改为稳定ID数组加ID索引表，不为便利重写已有存储。

$character是调用上下文中的角色名，不是头像ID；$speakerIndex为1起始，$speakerIndex0为0起始，$speakerCount为人数。它们通常由脚本包装调用方提供，导演Prompt中不能假定存在。$it仅循环正文有当前元素；无$parent或命名迭代变量。

聊天共享变量可通过 `{{?globalVars:party_gold.value}}` 读取（变量存在时）；global在此仍是当前聊天。逐角色数据按头像身份存储，不默认 `charVars:hp.values.$character` 可用；应核对快照，用vars的currentCharacter或实际键选择值，不凭姓名猜存储身份。

例如vars.data为`{currentCharacter:"alice.png",character:{hp:{values:{"alice.png":0}}}}`时，固定已知身份用`{{?vars:character.hp.values["alice.png"]|未提供}}`；按此样本的currentCharacter取值用`{{?vars:character.hp.values["{{?vars:currentCharacter}}"]|未提供}}`，均输出0。路径从data内部开始，不能写`vars:data.currentCharacter`。头像名中的点号需引号键，不能把内层结果直接接到点路径。嵌套替换不自动JSON转义；若身份包含引号或反斜杠，须先核对并转义固定键，不能把上述动态样本承诺为任意身份通用模板。

维护核对：2026-10-07，prompt-renderer.js、utils/path-resolver.js、assets/providers/variables.js；完整维护手册TEMPLATE-SYNTAX.md不等于模型可访问的工具，示例随本Skill打包。
