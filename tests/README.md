# GD Behavior Test v1 开发标准

行为测试使用 Node 原生 `node:test`，由 GD Test Lab 自动发现和执行。本规范适用于 `tests/unit`、`tests/regression`、`tests/integration` 和 `tests/contract`；静态 Checker 使用独立的 [Checker v1 标准](../tools/gd-test/checks/README.md)。

## 1. 核心原则

- 测试描述稳定的业务行为，不绑定私有实现步骤。
- 一个测试文件只负责一个业务域或一组强相关状态转换，不建立跨域“总测试文件”。
- 生产依赖通过 factory 参数注入；不要为了测试导出内部可变状态。
- 所有异步交错必须可确定复现，不依赖机器速度、网络或真实 LLM。
- 每个已确认 Bug 必须有能在修复前失败、修复后通过的回归契约。
- 测试不得依赖执行顺序，也不得读取开发者机器上的 release 目录。

## 2. 自动发现与目录职责

测试文件名必须以 `.test.mjs` 或 `.test.js` 结尾。`gd-test.config.mjs` 按目录自动发现，无需修改 CLI、runner 或中央清单。

| 目录 | 唯一职责 | 适用场景 |
|---|---|---|
| `tests/unit/` | 单模块、纯函数、注入式 factory 行为 | parser、validator、coordinator、repository、system 门面 |
| `tests/regression/` | 已确认历史缺陷的长期契约 | 需要保留 `BUG-N` 名称的审计缺陷 |
| `tests/integration/` | 多模块协作和 fake SillyTavern 生命周期 | takeover、事件顺序、并发生成、停止/取消 |
| `tests/contract/` | Group World 与宿主/UI 源码边界 | UI 委托、装配、真实 ST 可选契约 |
| `tests/harness/` | 通用、无业务结论的测试基础设施 | fake host、scenario、property、event source |
| `tests/unit/helpers/` | 仅供相邻 unit 测试复用的轻量 subject builder | 重复的 factory 依赖组装 |

不要仅因为缺陷来自历史审计就新建一个不断增长的 `historical.test.mjs`。测试文件按业务所有权归档，`BUG-N` 只标识必须长期保留的契约。

## 3. 文件与命名规范

- 文件名使用 kebab-case，并以业务对象命名，例如 `critique-repository.test.mjs`。
- 测试名写成可观察结果，例如 `a saved manual edit wins over an older response`，不要写成 `calls assertExecutionSnapshot`。
- 一个文件达到 400 行时必须进行职责审查；超过 600 行应按 system、repository、validation 或并发场景拆分。
- 同一 subject 组装重复三次以上时提取到文件内 `harness()`；跨文件复用才放入 `tests/unit/helpers/` 或 `tests/harness/`。
- helper 不得包含测试断言或替业务模块做决策。

最小模板：

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSubject } from '../../systems/example-system.js';

test('a saved edit survives an older asynchronous response', async () => {
    const subject = createSubject(/* injected dependencies */);
    const result = await subject.run();
    assert.equal(result.state, 'expected');
});
```

## 4. 隔离与清理

GD Test Lab 以 `concurrency: 2` 运行测试文件，因此每个文件必须拥有自己的 fixture。

- 修改 singleton registry 时使用 `t.after()` 注销。
- 替换 `globalThis.fetch`、`globalThis.$`、`window` 或其他浏览器全局时，必须在 `finally` 或 `t.after()` 中恢复。
- 临时文件使用独立临时目录并在测试结束时清理。
- 不共享可变 metadata、chat、settings 或 deferred promise 给其他测试。
- 不使用真实网络、真实 API Key、真实 LLM 或用户 release 数据。
- 随机测试必须使用 `tests/harness/property.mjs` 并输出 seed 和失败 case。

## 5. 异步与并发测试

并发契约使用显式 deferred gate 控制顺序，不用长时间 `setTimeout()` 猜测时机：

```js
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    return { promise, resolve, reject };
}
```

每个异步交错测试必须同时断言：

1. 请求的最终结果或错误类型；
2. 新状态没有被旧响应覆盖；
3. 保存、POST、停止等副作用的调用次数；
4. 聊天切换或原地消息修改后，结果归属仍正确；
5. 测试结束前所有 pending promise 已 settle。
6. 对事务回滚，同时断言失败操作的写入已移除、等待期间的并发写入仍保留；数组等复合值必须覆盖同一路径追加，而不只测试另一个字段。

普通旧结果使用 `StaleExecutionError` 拒绝。不可逆外部副作用必须分别测试“副作用前失效”和“远端成功、本地协调失败”；后者不能伪装成普通失败或完整成功。

## 6. Harness 选择

- 纯函数和注入式 factory：直接使用 `node:test`。
- 需要聊天、群组、角色、metadata、生成队列或停止计数：使用 `tests/harness/fake-st-host.mjs`。
- 需要完整场景生命周期：使用 `tests/harness/scenario.mjs`。
- parser、validator、状态变换的宽输入空间：使用 `tests/harness/property.mjs`。
- 只有依赖事件传播、焦点、布局或 SillyTavern 自有控件时才增加浏览器级契约。

Fake host 只模拟已确认的 SillyTavern 契约。若 fake 行为与真实宿主存在疑问，先在 `tests/contract/` 增加可选 real-host contract，再调整 fake。

## 7. 回归契约

- 修 Bug 时先写最小复现，测试名描述用户可观察行为。
- `gd-test.config.mjs` 中的历史 `requiredBugIds` 必须至少出现在一个实际执行的测试名中。
- 一个测试可覆盖多个强相关 BUG ID，但不得为了满足名称检查写空断言。
- 修复相邻并发缺陷时，应补同一状态机的边界组合：聊天切换、原地编辑、手动保存、删除/回退、保存失败和外部副作用。
- 历史 ID 不决定文件位置；业务模块所有权优先。

## 8. 禁止事项

- 禁止修改 runner/CLI 来注册单个行为测试。
- 禁止测试私有调用次数来代替业务结果，除非调用本身就是副作用契约。
- 禁止吞掉 promise rejection、使用无断言 smoke case，或只打印结果。
- 禁止通过超长 sleep 修复时序测试。
- 禁止在 UI 测试中复制系统业务逻辑；UI 契约只验证委托、反馈和 DOM 安全边界。
- 禁止让 harness 反向依赖具体业务模块。

## 9. 提交前检查清单

- [ ] 文件位于正确 suite，名称以 `.test.mjs` / `.test.js` 结尾。
- [ ] 测试名描述行为；修复缺陷时包含必要的 `BUG-N` 契约。
- [ ] 正常、失败和关键异常边界均有覆盖。
- [ ] 全局、registry、临时文件和 pending promise 已清理。
- [ ] 测试在独立运行和全量运行中都通过。
- [ ] 没有修改中央 runner 来接入测试。
- [ ] `npm run test:full` 通过，配置中的全部历史回归契约仍完整。

常用命令：

```powershell
npm run test:unit
npm run test:integration
npm run test:full
node --test tests/unit/example.test.mjs
```
