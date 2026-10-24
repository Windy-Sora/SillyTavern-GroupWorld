# 文档目录 / Documentation

项目介绍与安装入口：[中文](../README.md) · [English](../README_EN.md)。根目录仅保留中英文 README；用户手册、设计、测试和迁移说明集中在本目录，不保留重复的根目录跳转页。模块内 README 和 Skill 资源保留原路径。

本仓库为 **GroupWorld / Group World**，迁入来源及本地验收见 [MIGRATION](MIGRATION.md)。`GroupDirector`／`GD` 在 API、设置键、日志、存档和测试平台中是保留的兼容名称，不是另一个必须安装的依赖。只启用 GD／GW 其中一个；不能把共享标识当作两套隔离数据。

## 使用 / Usage

- 用户手册：[中文](USER-GUIDE.md) · [English](USER-GUIDE_EN.md)
- 模板与DSL：[中文](TEMPLATE-SYNTAX.md) · [English](TEMPLATE-SYNTAX_EN.md)
- [故事蓝图 / Story blueprint](STORY-BLUEPRINT.md)

## 开发 / Development

- [GroupWorld 迁移与兼容 / Migration and compatibility](MIGRATION.md)
- 架构设计：[中文](DESIGN.md) · [English](DESIGN_EN.md)
- [测试与维护 / Testing](TESTING.md)
- [暮羽架构 / Muyu architecture](MUYU-AGENT-ARCHITECTURE.md)
- [暮羽开发规范 / Muyu development](MUYU-AGENT-DEVELOPMENT.md)
- [暮羽能力总表 / Muyu capabilities](MUYU-AGENT-STATUS.md)
- [暮羽模块合同 / Muyu module contracts](../muyu/README.md)

## 设计历史 / Design history

- [UI重构设计 / UI rework](UI-REWORK.md)：阶段设计参考，不代表新版导航入口当前开放；当前使用方式见用户手册。

能力总表、架构、开发规范及模块合同描述当前行为，不追加轮次日志或“未提交／push”状态。工具、字段和资源版本优先引用对应源码清单，避免多份手写统计失配。

TESTING 与 Skill EVALUATION 中保留的带日期记录属于历史验证证据，不能代替当前测试或发布状态。本地排查报告不随仓库发布；已移除的计划与日志可从 Git 历史恢复。
