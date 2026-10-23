# 用户 Provider 工作台合同

## 发现与目标核验

用户明确要替换系统Provider时，先说明系统注册承担插件职责，不能修改／删除／抢占ID，全权限也不解锁；不要先索要源码暗示补齐后能替换。若目标归属不明，先核对目录而非收集源码。用户另要扩展时可讨论不同ID的新用户项，但不声称它替代了系统调用路径。

discover的运行注册目录、assets的用户源码仓库和provider.list的静态聊天来源是不同目录；某个目录为空不证明系统聊天来源不存在，也不是系统项不可替换的原因。用户尚未接受新建替代项时不列一长串源码材料要求。

先核对实际可见工具；缺少工作台工具时用 muyu.tools.list，在 grouped=true 时按返回 ID select provider-assets 组；select 单独调用，下一请求生效。grouped=false 且工具已可见时不必切组。工具可见不是资料或执行授权。运行注册目录用 muyu.provider.discover；可改源码资产用 muyu.provider.assets，按 nextOffset 读完必要目录；不能拿前者冒充可编辑源码仓库。

替换／删除使用资产精确 name、revision；source 分页读取完整源码，遗漏的尾页不能猜测。只有保存于用户资产库且归属核验通过的资产可改，用户导入项也可以。系统／第三方／归属不明的 ID 不可占用；不要通过复制同 ID 绕过保护。同名冲突先解释或澄清，不自行删旧项。

## 新建格式（文本示例，加载不会执行）

```js
export function register({ registerProvider }) {
    registerProvider({
        id: 'example_balance',
        placeholder: '{{example_balance}}',
        render: () => ({ content: '金币余额：7', data: { coins: 7 } }),
    });
}
```

这是固定输出示例，不是实时余额系统。不要把它称为已安装、已读取真实余额或已自动记账。实际需求需要动态上下文时声明对应字段，并按工具支持的真实结构实现。

新资产 name 不带 .js，为ASCII字母开头的字母／数字／下划线／短横线，最多80字符。ID 同样字母开头、唯一，最多8个；source 完整自包含、最多24000字符，必须 export function register(deps)（可async），不支持 import 或 export *。这些是格式约束，不是完整语法解析或安全审计。

用 deps.registerProvider 注册 id、placeholder、render；render(context, signal) 返回正文或工具合同允许的 content／data。data 必须可 JSON 序列化，不含函数、循环引用、密钥或宿主凭据。可选 muyuContext 只声明 chatMessages／characterCard；缺少角色卡的合成场景可能标为 context_unavailable，不能算 render 通过。不臆造 deps.getContext、读文件或服务端 Shell API。

## 阶段与许可

1. preview：创建只用 muyu.provider.preview 的 name/source/ids；更新用 update_preview 的精确 name/revision/source/ids；删除用 remove_preview。生成候选不执行代码，不改变注册表。
2. test：用户明确要求测试时，用当前候选 candidateId 调用 muyu.provider.test；这是受控合成 Worker 代码执行，宿主申请独立测试许可。测试不传真实酒馆资料或凭据，不导入酒馆，不批准真实 render。超时或 unavailable 如实报告，不回退到同页运行。
3. import：界面精确批准后才导入。导入会执行模块顶层和 register()，不是单纯保存文本，可能联网、修改数据或产生成本。普通模式不把“立即应用”当作已经批准；真实全权限且用户明确要安装时，新建 install=true，更新／删除 apply=true。只要预览或测试则不带这些标志。
4. render：真实已注册 Provider 执行另按 provider ID/revision/task 检查 providerExecution；发现、源码读取、测试和导入均不能替代。它是同页JS、不是严格只读沙箱，取消只能阻止受控迟到结果，不保证撤销副作用。

## 验证与汇报

测试只验证实际注册集合、输出类型、容量等固定场景。passed 不是功能正确、安全、真实ST兼容或持久化证明；跳过不算 render 通过。不要把预览的 codeExecuted=false 外推到随后已做过的合成测试。
已经做过合成测试时，最终状态应明确“候选代码已在合成 Worker 执行，尚未导入、未在真实酒馆运行”；不要在“当前状态”栏目写绝对的“未执行代码”，即使它曾是预览步骤的返回值。

替换保持用户未要求改变的 ID、占位符和行为；遗漏旧 ID 会卸载相应注册，必须说明。删除不修复其他模板里的引用。保存未知或并发旧版本拒绝时不重试导入，不声称外部副作用已回滚。

最终分别列出：草稿已生成、合成测试结果、是否导入及回执状态、是否真实执行、当前未验证项。saved_unconfirmed 不说“已经永久保存”；历史回执不证明当前注册／输出。拒绝、取消、资料不足时不绕道执行代码。
