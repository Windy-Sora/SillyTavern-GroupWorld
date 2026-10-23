# 记忆排查试点

## 2026-10-04：单角色业务生成已独立接入

现在由独立memory-generation模块提供targets／prepare／execute、目录读取来源和一次性执行许可，不改变本诊断模块的只读效果。手工记忆草稿权限不批准业务生成；普通模式另确认角色／模式／费用／裁剪。真实业务底座复用原memory Agent，暮羽自身存档不使批准失效；不批量、不进入整单。详见[工具合同](../memory-generation/README.md)。以下“未注册工具”为第一轮历史状态，不代表当前接入情况。

## 2026-10-04：业务生成底座，未注册工具

`systems/memory-generation.js` 复用原memory Agent／Schema／ContextPool／caller，以generateApproved(avatar,{mode,signal,validate,onPhase,saveChatConfirmed})执行单角色提取。`avatar`是私有宿主定位参数，不能由未校验模型直接指定；muyu/host/memory-generation.js用已有memory-character序号创建执行单，未来工具还须在专用读取权限下提供目标目录。inspectGeneration只供私有基线核验，含完整配置指纹／真实对象引用，禁止直接外发、保存至对话或当作授权。

- prepareExecution无渲染／模型／仓库初始化，返回脱敏名称、模式、已有数量、容量、目标类型与风险说明。单任务单角色不因改变trial/save而获得第二次付费机会。
- 执行单绑定任务与聊天、配置／业务连接、Agent函数、Provider注册实现、聊天内容及所选角色记忆；变化拒绝执行。不声明已锁定ST内部所有原生连接细节，原生目的地由ST管理。
- trial不写记忆，报告wouldPrune；save追加并按原上限裁剪，只用注入的确认保存器，不退回条件保存。裁剪可包括本次生成中的较旧条目。不开启功能，不做其他角色提取，不创建角色卡。
- 实际caller每单最多一次调用，强制retries=0；尝试标志不证明已送达或计费。输出经过原Schema与格式边界，仍为不可信生成内容，不证明剧情事实；超过6000字节的正文省略，不代表生成失败。
- 执行超时／取消停止等待，但Provider、原生请求计费、在途保存不保证停止；后续受控阶段禁止写入，底层请求未排空保留busy租约。保存未知保留已赋值内容，不重试或覆盖并发编辑；confirmed不等于历史回执代表当前状态。
- 当前尚无registry/capability/权限来源／GUI接线，不恢复执行单。下一轮必须定义精确任务执行授权、预算、生命周期及中英文状态展示，不能由memoryConfig、记忆正文或手工草稿读权限推导执行权。

2026-09-24。独立内置模块，未从index.js或GUI挂载；不替换现有记忆系统。只读投影与报告在合成宿主数据上测试，真实DeepSeek参与小规模解释测试；不等于真实SillyTavern宿主验收。

## 分层与入口

- knowledge.js：三个完整任务资料块，带id/version/source/scope；目录不是正文。readMemoryKnowledge返回完整文档或明确missing，不截断前提。预算默认12000 UTF-8字节，可设1024–16000，最多3个ID。
- reader.js：createMemoryReader注入extensionKey、同步getTarget/getSettings/getMetadata/getGroup/getMessageCount/getGuards。不得传递整个GD系统对象；生产绑定需要单独核实身份与事件生命周期。getGuards只接受canFinalize/manualGenerating/generationType三项观测，缺失按unknown，不推算历史。
- diagnose.js：确定性的当前条件与证据引用，不让模型决定事实。返回blocker/condition/unknown，历史执行原因始终明确unknown；导航是固定memory-settings标识，不是selector或可执行操作。
- index.js：createMemoryModule({reader})返回registry/handlers及可信应用入口publishReport(app,runId)。三个只读工具为muyu.knowledge.list、muyu.knowledge.read、muyu.memory.inspect；工具列表不包含报告保存或业务写入。

每个应用实例独占一个模块实例；模块缓存键为该应用的runId。组合层负责向Runtime注入registry/handlers、允许列表和同步policy，默认拒绝规则不变。工具数据外发给模型需在未来宿主接入时由用户明确授权；目前只使用合成数据。无需修改core循环增加记忆专用分支。

## 读取与正确性边界

不调用会初始化metadata的getStore/getStats。仅访问白名单设置、覆盖计数、群聊成员键及记忆数组length；不遍历记忆元素，不访问聊天对象、姓名、角色描述、Prompt、模型配置、密钥或正文。成员身份只用于本地关联/变化检测，工具输出为匿名slot。最多64名成员；超限明确拒绝，不部分返回。

间隔按消息条数：成员newMessages=messageCount-covered；memoryCount只是存储记忆条数，不参与间隔计算。intervalStatus为met/pending/unknown，防止把记忆条数误当消息增量。批次门槛与成员门槛分开描述，达到门槛不证明执行成功。发言者过滤开启时，不读取导演历史，明确最终目标未知。异常格式不猜测，使用unknown/-1；不修复计数。NO_NEW_MEMORIES可推进覆盖进度，不等于失败。

读前读后检查绑定聊天，连续两次同步投影须一致。revision是该reader观测到状态或成员身份变化时递增的本地版本，不是宿主持久事务版本，无法发现两次读取之间发生又恢复的变化。私有成员身份参与版本检测，即使匿名统计相同也能使旧报告失效。

inspect仅缓存确定性报告（默认最多128个Run）；模型最终措辞不进入证据产物。publishReport检查运行成功、目标一致、最新投影未变，再通过app.createArtifact绑定任务和来源运行；保存后删除缓存，重复保存拒绝。应用关闭会话、切聊天或配置变化不能把旧报告存进新目标。组合层须对放弃的报告调用forgetRun，应用卸载时dispose。快照与产物是历史证据，不宣称一直实时有效。

## 验证与未完成项

tests/unit/muyu-memory.test.mjs覆盖无正文读取/无初始化、脱敏、间隔及逐角色进度、缺失状态、目标切换、快照变化、完整资料预算、Broker拒绝越权、产物归属/过期拒绝和清理。还需要真实宿主绑定、浏览器CORS、用户外发授权及经典GUI；不添加配置写入、记忆生成、向量库或完整模块加载器。

真实模型首轮虽然工具断言通过，但人工检查发现把memoryCount当作消息增量的问题。随后新增显式newMessages/intervalStatus并复测；模型回答与代码合同分别记录，不以接口通过替代答案质量验收。外部实测脚本及结果位于仓库外muyu-agent-live-harness，不进release。
