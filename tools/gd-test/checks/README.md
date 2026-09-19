# GD Checker v1 开发标准

静态检查器采用插件式自动发现。每个 `*.check.mjs` 文件只定义一个规则域，新增检查器不应修改 CLI、runner 或 reporter。

## 文件与声明

```js
export default {
    id: 'example-rule',
    title: 'Example rule',
    version: 1,
    order: 80,
    timeoutMs: 30_000,

    async run({ project, services }) {
        return {
            counts: { exampleChecked: project.sourceFiles.length },
            issues: [],
        };
    },
};
```

- 文件名必须以 `.check.mjs` 结尾。
- `id` 必须符合 `^[a-z][a-z0-9-]*$`，全局唯一且发布后保持稳定。
- `title` 是面向人的名称；`version` 当前固定为 `1`。
- 执行顺序为 `order` 升序，再按 `id` 字典序，不能依赖文件系统顺序。
- 默认超时 30 秒；加载和执行均位于独立 Worker Thread。超时会先执行并等待 `worker.terminate()`，再转换为 `CHECK_TIMEOUT` 并继续，确保超时 checker 不会在后台保留副作用或 event-loop handle。异常转换为 `CHECK_CRASH`。

## 输入边界

`project` 是由 `project-index.mjs` 一次构建的公共事实，包括文件清单、源码、JSON 结果、manifest、import 记录、依赖图、可达集合和 smoke candidates。检查器只能读取，不得修改这些对象。

`services` 只提供通用基础能力：规范化相对路径、文件存在检查、限流并发和子进程执行。规则代码不得被放入 service。

子进程必须通过 `services.runCommand()` 启动。它们由主线程托管；Worker 完成、异常或超时时，平台取消并等待尚未结束的托管子进程，然后才运行下一个 checker。直接调用 `child_process` 绕开此生命周期管理，不在隔离保证范围内。加载异常和加载超时也会转换成报告中的 issue，其他 checker 继续执行。

## 输出协议

```js
{
    counts: { checked: 1 },
    issues: [{
        severity: 'error', // error | warning
        code: 'EXAMPLE_INVALID',
        file: 'relative/path.js',
        line: 12,          // 可选，正整数
        message: 'Human-readable explanation',
    }],
}
```

- 不允许打印控制台、写报告或修改被检查项目。
- 不允许调用其他 checker，或读取其他 checker 的结果。
- 每个 count key 只能由一个 checker 拥有，重复 key 会使平台失败。
- checker 返回结构会被运行时校验，格式错误视为 `CHECK_CRASH`。
- checker 的 issue code 属于外部契约，重命名前必须考虑 CI 和历史报告兼容性。

## 测试和规模

- 每个新 checker 必须有正例、反例和异常边界测试。
- 测试应建立最小临时项目，不能依赖开发者机器上的 release 目录。
- checker 建议不超过 150 行；公共索引/runner 达到 200 行时必须进行职责审查。
- Checker 级隔离由平台 Worker 提供；checker 内需要隔离 import 或不可信执行时仍应使用子进程，普通纯检查不要为每个被检查文件启动 Worker/进程。
- 新增 checker 的正常改动范围应只有 checker 文件、对应测试和可选配置/文档。

行为测试继续使用 `tests/**/*.test.js` / `tests/**/*.test.mjs` 和 Node `node:test`，不使用本协议；完整规范见 [`tests/README.md`](../../../tests/README.md)。
