# SillyTavern Group World

[English](README_EN.md) | 中文

面向 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 群聊的导演与连续性扩展。Group World 在每轮生成前决定哪些角色适合发言，并提供角色资料、记忆、世界书、剧情状态和可扩展的提示词数据源，帮助群聊保持节奏与上下文连续。

> 当前版本：0.6.0

## 功能

- **Formula Director**：基于提及、关键词、最近发言、主动性和连续发言惩罚进行本地评分，不产生额外 API 请求。
- **LLM Director**：由模型规划发言角色和顺序；可接管顺序生成，也可仅过滤未入选角色。
- **发言控制**：支持 Top-N、角色关键词触发、Talkativeness 和连续发言惩罚。
- **导演记录与剧本**：保存每轮决策；可为本轮角色注入单独的行动或场景指示。
- **连续性工具**：角色档案、角色记忆、聊天摘要、世界书、NPC、变量与剧情状态。
- **可扩展运行时**：支持 Provider、Prompt 模板、Capability、自定义 Agent 与脚本执行器。
- **配置档**：内置默认与示例配置档，也可导入和导出自己的配置。

## 要求

- 已安装且可正常运行的 SillyTavern。
- 使用群聊功能。
- Formula Director 不需要额外模型调用；LLM Director 和档案、记忆、摘要等 AI 功能需要在 SillyTavern 中配置可用的模型连接。

## 安装

### 通过扩展管理器

1. 在 SillyTavern 中打开 **扩展管理器**。
2. 使用“从 URL 安装”功能，填入：

   ```text
   https://github.com/Windy-Sora/SillyTavern-GroupWorld
   ```

3. 安装完成后刷新页面。
4. 在左侧设置栏打开 **Group World**，并在扩展管理器中确认它已启用。

### 手动安装

将本仓库克隆或下载至 SillyTavern 的以下目录：

```text
public/scripts/extensions/third-party/SillyTavern-GroupWorld
```

然后重启或刷新 SillyTavern。插件不会修改 SillyTavern 核心文件。

## 快速开始

1. 打开一个群聊，并进入 **Group World** 设置。
2. 在“导演”中选择模式：建议先使用 **Formula Director**，无需额外 token，便于观察选角结果。
3. 将 **Top-N** 设为 `1`，让每轮默认只选择一名角色发言。
4. 发送消息，并根据结果调整提及、关键词、最近发言、主动性和连续发言惩罚等权重。
5. 如果需要模型根据剧情决定角色和顺序，切换为 **LLM Director** 并配置导演提示词与模型。

如需立即应用一套推荐设置，可在仪表盘底部选择 `group-world-default` 配置档后点击“应用”。

## 导演模式

| 模式 | 适用场景 | 选择方式 | 额外模型调用 |
| --- | --- | --- | --- |
| Formula Director | 希望稳定控场、低延迟或不增加 token 消耗 | 本地权重评分并选择 Top-N | 无 |
| LLM Director | 需要理解剧情、关系和场景意图 | 模型输出角色计划和可选顺序 | 有 |

## 常用工作流

| 目标 | 建议功能 |
| --- | --- |
| 减少角色抢话 | Formula Director + Top-N `1` + 连续发言惩罚 |
| 按剧情安排出场顺序 | LLM Director + 顺序接管 |
| 让角色记住长期事件 | 角色档案、角色记忆、导演记录和聊天摘要 |
| 为角色提供本轮指令 | Director Script |
| 管理世界、NPC 或任务状态 | 世界书、变量、剧情状态与自定义 Provider |
| 保存或分享设置 | 配置档导入 / 导出 |

## 文档

- [用户手册](USER-GUIDE.md)：界面、设置项、场景配方与常见问题。
- [模板语法](TEMPLATE-SYNTAX.md)：Prompt DSL、占位符与路径查询。
- [设计文档](DESIGN.md)：架构、执行管线和扩展接口。
- [故事蓝图](STORY-BLUEPRINT.md)：剧情状态与蓝图相关说明。
- [测试说明](TESTING.md)：自动化测试平台和测试范围。

## 开发与测试

项目为原生 ES Module 扩展，运行插件本身不需要构建步骤。自动化测试需要 Node.js 22 或更高版本：

```bash
npm test
```

其他可用命令：

```bash
npm run test:static
npm run test:unit
npm run test:integration
npm run test:full
npm run test:coverage
```

## 反馈与贡献

欢迎提交 Issue 或 Pull Request。报告问题时，请尽量附上：

- SillyTavern 与 Group World 版本；
- 使用的导演模式、群聊模式和相关配置；
- Group World 日志；
- 可稳定复现问题的步骤。

## 许可证

本项目采用 [MIT License](LICENSE)。
