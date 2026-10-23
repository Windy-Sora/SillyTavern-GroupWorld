# GroupWorld 测试与维护 / Testing

运行环境：Node.js 22+，开发依赖通过 `npm ci` 安装；插件运行本身无需构建或安装 Acorn。测试工具保留兼容名称 **GD Test Lab**，不要因产品更名重命名工具入口、回归编号或测试协议。

## 命令

```sh
npm ci
npm test
npm run test:static
npm run test:unit
npm run test:integration
npm run test:full
npm run test:coverage
```

Windows 文件多时，测试平台展开参数可能触发系统命令长度限制。Node 24.12.0 已验证以下命令，由 Node 自己展开带引号 glob；这直接执行行为测试，**不包含静态检查**：

```sh
node --test --test-concurrency=2 --test-reporter=tap "tests/**/*.test.mjs"
```

静态检查须另跑 `npm run test:static`。不要把零命中过滤、跳过的测试或仅文件成功当作功能覆盖。真实酒馆事件契约需要 `GD_TEST_ST_ROOT` 或平台的 `--st-root` 参数；未配置而跳过不是已验证宿主兼容。

## 开发规范与覆盖边界

- [测试目录规范](../tests/README.md)：所有权、命名、隔离、并发、回归与评审要求，以此为准。
- [Checker 开发合同](../tools/gd-test/checks/README.md)：检查器规范；平台入口与配置分别为 `tools/gd-test/cli.mjs`、`gd-test.config.mjs`。
- 纯模块使用 `node:test` 和严格断言；有宿主状态的流程使用 `tests/harness/scenario.mjs`／fake host。解析器与状态转换可使用 `tests/harness/property.mjs`，保留失败 seed 便于复现。
- 每个修复补行为回归，异步流程覆盖取消、保存拒绝、聊天切换、面板重建、过时结果及清理。假宿主不能代替真实宿主契约。
- 重点兼容测试：`tests/contract/group-world-*.test.mjs` 与 `tests/integration/group-world-*.test.mjs`；验证名称适配、API 不改名、旧数据、默认配置档、可选服务缺席／错误／旧协议及存储降级。
- 无服务时不得发布相应服务工具；显式指定失效存储源不得静默改读其他数据。保留普通聊天、导出及明确错误提示。
- 使用隔离临时目录和虚构聊天；不得把真实密钥、对话、世界书或账号存档加入 fixture、报告或 Git。服务端文件操作测试需要相应临时文件／符号链接权限；权限错误须与产品缺陷区分，不得改断言伪造通过。

## 发布验收

当前迁入来源、GW 实际测试数字、真实模型结果及尚未完成的桌面／手机手工项目统一写入 [MIGRATION](../MIGRATION.md)。这里不累计上游轮次日志或把历史通过数当作当前结果。

自动测试验证受覆盖的合同，不证明所有用户配置、移植版、模型回答或视觉效果均兼容。真实模型题目须记录实际状态、工具调用、授权及是否写入，不能仅按回答措辞判成功。

English: run static checks separately from the quoted Node test glob. Follow the linked test ownership contracts. Use synthetic data, preserve compatibility IDs and permission boundaries, and report skips honestly. See MIGRATION for current evidence and pending manual acceptance; automated tests are not a browser or live-user upgrade certification.
