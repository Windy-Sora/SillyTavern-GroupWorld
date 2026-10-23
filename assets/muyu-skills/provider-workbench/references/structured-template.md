# Provider 与 DSL 的完整样本

## 选择数据来源

已有聊天状态用变量及内置globalVars／vars；固定文本或静态JSON用自定义提示词的content／dataJson；确需动态计算或特殊来源才写用户Provider。Provider是视图／适配器，不是自动持久存储。不能用固定data.balance冒充实时金币，不能把聊天摘要解析当权威交易账本。

## 自包含用户资产

以下代码可用于合成测试，固定数据便于核对DSL；不导入源码文件，不读取酒馆资料、不产生网络请求。skill_shop必须先查无同名冲突，实际实施时按用户命名；系统ID不能覆盖。

```js
export function register({ registerProvider }) {
    registerProvider({
        id: 'skill_shop',
        placeholder: '{{skill_shop}}',
        render: () => ({
            content: '示例商店（静态样本）',
            data: {
                balance: 30, selected: 'heal', zero: 0, active: false, blank: '', none: null,
                stock: [{ id: 'heal', name: '药水', price: 5 }, { id: 'torch', name: '火把', price: 2 }],
                'price.table': { heal: 5, torch: 2 },
                keys: ['heal', 'torch', 'heal'], empty: [],
                labels: { heal: '药水', torch: '火把', a: '治疗', b: '照明' },
                children: { heal: ['a'], torch: ['b'] },
            },
        }),
    });
}
```

## 模板接入

```text
余额样本：{{?skill_shop:balance}}
药水单价：{{?skill_shop:stock[id=heal].price}}
{{#skill_shop:keys}}{{?skill_shop:labels.$it}}{{/skill_shop}}
```

预期：余额样本30、药水单价5，列表药水／火把各一行；重复heal去重。查询依赖data而非content。完整DSL及嵌套样本按需加载“DSL与结构化模板”，先读其syntax参考，再按需要读runtime或examples资源，不默认所有资源常驻。

将模板放进用户指定且实际经过GroupWorld渲染的功能Prompt或脚本包装，不自动替换整份Prompt，不为了演示补开功能。自定义提示词数据源启用及其总开关也要核对；保存资产、注册成功、调用模板和模型正确理解是不同事实。

## 动态数据适配与上下文

真实用户Provider导入契约为register(deps)，render(context, signal)；不能照搬内部assets/providers的import路径，也不臆造deps.variableSystem／getContext。需要实时变量展示优先直接引用内置globalVars／vars。自定义计算需核对调用方真正提供的context字段，再实现；不能假定所有调用路径共享一个完整宿主对象。

暮羽受控Provider执行的基本context是recentMessages（最近最多50条）、enabledMembers、character、avatar；可选muyuContext只声明chatMessages／characterCard。前者最多最近200条并有chatMessagesLimited，后者仅单角色可用，字段有长度界限；群聊角色卡不可用不能算测试通过。这个投影是暮羽执行路径的合同，不等于普通GroupWorld模板render调用方的全部字段。来源授权仍以执行工具为准。

render尽量返回可序列化、最小必要的content/data，尊重signal，不放密钥、凭据、函数或循环对象。完整GroupWorld模板会执行所有未禁用Provider，不仅引用项；同一renderPrompt内缓存一次，不能在render中顺手扣钱。派生显示与余额写入应解耦，持久余额由变量或明确存储通道维护。

## 分层验证

先生成候选；用户要求测试时做合成Worker注册与输出检查。合成测试通过不证明模板已渲染，也不证明真实聊天适配成功。导入需精确批准；之后只有明确授权的真实执行才能验证实际数据。没有真实模板执行工具时提供模板与预期，明确“模板尚未在酒馆验证”，不冒充调用muyu.dsl.eval。

加载此Markdown不会执行示例源码。维护核对：2026-10-07，muyu/host/provider-context.js、prompt-renderer.js、assets/providers/variables.js；阶段与资产保护沿用references/contracts.md。
