# GroupWorld synchronization and release checks

核对日期 / Checked: **2026-10-23**。本文记录本次迁入与验收；提交及推送状态以 Git 为准，不代表已安装到 release 或完成真实环境发布验收。版本号仍为 0.6.0，不能仅凭版本号判断 GD／GW 能力相同。

## Locked sources

- Source: GroupDirector main, `a507a143e5ee509b9d0c1470877223a1667b5ac8`.
- Target base: GroupWorld master, `b42d5647c5abeb8a441e3c35b46a27a14748e2cb`.
- Previous GD synchronization: `852eb1e83e90ecb4a6901178cddb99b420b80bd2`.
- Only Git-tracked source files were eligible. Local audit logs, temporary plans, `.env`, credentials, user histories, dependency folders and untracked source drafts were not imported.

## Retained GroupWorld adaptations

- Display product: **GroupWorld / Group World**. Installation repository and folder: `SillyTavern-GroupWorld`; recommended profile: `group-world-default`.
- Preserve GW manifest/package identity, bilingual READMEs and the adapted default-profile registry. Package scripts and development dependencies follow the locked source.
- Template/profile discovery prefers the GW directory, retaining GD fallback. NPC and character-profile preset URLs use GW. Muyu resources and Skills resolve relative to their modules.
- Product metadata lives in `utils/product-identity.js`. Trusted model instructions explain the current product and old aliases without extra model requests or a new API namespace.
- Built-in Skill descriptions and shipped assistant prose are adapted; changed Skill revisions are incremented. User Skills, Providers, cards, world books and historical messages are not rebranded.
- Public extension UI remains classic. Preview navigation code is retained but not exposed. Muyu remains available through the summon menu and floating window.

## Stable compatibility contract

**Enable only one of GroupDirector and GroupWorld.** They share settings, globals and UI identifiers; two installation folders do not make concurrent enablement safe. Back up before upgrading. Histories on the same site/account may share a namespace: this is not isolated storage or an automatic copy/migration promise.

The following identifiers intentionally remain unchanged:

- `group-director` extension settings/chat metadata; `window.GroupDirector`; `groupDirector_Interceptor`; DOM IDs and existing callbacks.
- Provider, tool and Skill IDs, placeholder/DSL syntax, schemas and resource owners such as `group-director/user-provider`, `group-director/user-capability`, `group-director/custom-agent` and `group-director-story-blueprint`.
- Shared service ID and `/api/plugins/gd-muyu-history` routes; server `.group-director/muyu/` paths; IndexedDB `gd-muyu-history-v1`; `gd-muyu-history-v1:` and `gd-muyu-recovery-v1:` digest prefixes.
- `GD-Muyu-History-v1-` / v2 world-book prefixes, `gdMuyuHistory`, `gd-muyu-history-worldbook` schema and the exact legacy notice text used for validation. Do not translate or rename these stored values.
- Real console prefixes such as `[GroupDirector]` and GD Test Lab command names. Director/导演 is also a functional term, not always a product name.

Changing a visible name must not change grants, asset ownership, stored data or validation strictness. Historical imports never revive execution approvals. Broken or conflicted archives must still be rejected explicitly.

## Optional services and storage

The shared [Muyu Services](https://github.com/Windy-Sora/SillyTavern-Muyu-Services) remains optional and is installed on the ST server, not through the front-end Extension Manager. No GW-specific server fork or second installation is required.

- Missing, disabled, slow, failed, legacy or incompatible services must not block ordinary chat or expose unavailable service tools. A successful health check alone does not enable every capability.
- Browser, account-settings, world-book and optional server storage keep their existing contracts. Write switches select destinations; one explicit read source selects the library. Source changes do not silently merge data.
- Legacy automatic backend selection may choose browser storage when the service is absent. An explicitly selected server reader instead reports `HISTORY_UNAVAILABLE`; it must not silently read a different library. Page-local chat and export remain available.
- World-book archives are visible plaintext, carry bilingual purpose/deletion notices, and remain disabled/recursion-protected. Preserve v1 compatibility, v2 volume handling, tombstones, duplicate-import checks and stale-cache rejection.

## Automated evidence

Windows / Node **24.12.0**. Counts below are GW-local results, not copied upstream totals.

- Round 4 full behavior suite: **4024 total, 4022 passed, 2 skipped, 0 failed**.
- Static validation: **929 source files, 16 JSON files, 470 import smoke checks** passed.
- Focused old-data / optional-service / storage / lifecycle checks: **117 passed**, no failures or skips.
- Independent optional-service suite: **41 total, 40 passed, 1 skipped, 0 failed**. All seven bundled server `.cjs` files match the standalone service repository.
- Synthetic old settings, variables, memories, libraries and user Provider load through the real startup/loader paths. No live user data was read or modified. Storage/permission implementations retain the locked-source logic.
- Round 5 final full rerun, including four documentation contracts: **4028 total, 4026 passed, 2 skipped, 0 failed**, about 65.7 seconds.
- Round 5 final static rerun: **930 source files, 16 JSON files, 470 module smoke checks**, passed in about 93.4 seconds. Local Markdown file links and old-root redirects pass; installation/default-profile instructions use GW names. `git diff --check` passes.
- The source HEAD remains locked; GD and standalone-service working trees were not changed. Archive codecs/stores, storage routing, import/export and permission stores remain source-identical; all seven bundled CJS files remain standalone-service-identical. Skipped optional host contracts are not a claim of real-ST acceptance.

Commands:

```sh
npm run test:static
node --test --test-concurrency=2 --test-reporter=tap "tests/**/*.test.mjs"
git diff --check
```

Quoted Node glob avoids Windows expanded-command limits. Static checks run separately. The optional real-host contract requires `GD_TEST_ST_ROOT` or `--st-root`. See [testing rules](TESTING.md).

## Real-model spot checks

Four isolated DeepSeek scenarios used the real controller, instruction composition and Chat Completions adapter, with fictional settings and no live chat, world-book, credential persistence, file execution or configuration application:

1. Chinese self-introduction and GD dependency question: identifies GroupWorld; does not require installing GD.
2. English API/alias and world-book distinction: retains `window.GroupDirector`, rejects inventing `window.GroupWorld`, distinguishes product from world-book functionality.
3. GUI navigation: calls `muyu.context.list` / `muyu.context.read` for the public interface reference; finds the Group World classic entry and Muyu connection settings.
4. Automatic-memory interval preview: reads/requests only `memoryConfig`, queries the field contract, invokes `muyu.settings.preview`, produces 10 → 15 without applying; the synthetic value remains 10.

All four runs reached `succeeded`; no application/write was performed. The read case received one task-only grant from the test driver, not natural-language authorization or full access. These are spot checks, not a guarantee of all model replies: the English answer retained a Chinese owl interjection, and the navigation answer over-qualified a floating-ball opening step. Neither changed API/storage identity or execution behavior.

## Remaining manual release gate

### Expanded live harness / 扩大模型实测

2026-10-23 使用环境中的 DeepSeek 配置运行真实控制器、模型适配器、22 个内置 Skill、Provider 和可选服务端口，覆盖 **16 个场景、19 条首轮用户消息**；加两项定向复测共 **64 次实际模型请求**。数据全部为虚构内存样本，不读取真实用户聊天或配置，不执行生成代码，不安装／render Provider，不应用草稿。

- 产品身份、中英文 API 别名、诱导错误改名、导航、配置预览及追问、拒绝读取、Provider 工作台、系统项保护、DSL、旧变量、单人聊天、旧存档标识、服务缺席／断网、连续三轮身份核对：核心适配目标均通过。
- 旧变量经真实 Provider 投影读到金币 73；预览产生 37 → 15 草稿但设置保持37；任务读取授权仅覆盖请求的来源。拒绝后不绕读。系统 Provider 不可同 ID 覆盖。缺少／断网的服务不暴露其工具，不阻断普通聊天。
- 首轮自动断言为14/16；两个标记均为 harness 判据问题：只接受新预览工具名、未接受合法兼容工具 `muyu.config.preview`，以及否定语料漏了“不行”。只修正忽略目录中的测试脚本；两项真实定向复测均通过，没有因此修改生产代码或放宽权限。
- 另跑 GW 适配、身份、文档、旧数据、可选服务五组确定性测试：**45/45 passed**，无跳过或失败；`git diff --check` 通过。
- 仍有两类回答知识待收紧，不算运行时故障：一是内部历史世界书禁用／非剧情注入的说明不够明确；二是把暮羽会话与酒馆聊天绑定／存储隔离的关系过度简化，并可能将两个实际仓库说成仅有名称区别。应补充可信存储说明，指向暮羽新对话／历史入口，不能让用户靠切换酒馆聊天或双开插件实现隔离。

详细报告与脚本仅在被 Git 忽略的 `test-results/gw-adaptation-live-results.json`、`test-results/gw-adaptation-live.mjs`；不含密钥、隐藏思考或原始 HTTP 请求，不随仓库发布。这不是实际浏览器或实存档迁移验收；前述手工发布门槛仍保留。

The following **have not been run in a real desktop/phone ST browser during this migration** and must not be marked as passed by unit tests or model answers:

- [ ] Desktop and LAN phone: open/minimize/reopen Muyu; keyboard resize, history sidebar, permission positioning, light/dark/auto theme and field contrast.
- [ ] Chat switch, panel rebuild and completion of an old asynchronous task: drafts, result ownership, task status, scroll anchors and one-click/one-operation behavior.
- [ ] Both install folders exist, only GW enabled: assets, presets, Skills and assistant import resolve from the intended directory; no duplicate global listeners/UI.
- [ ] Real upgraded user backup: old settings, custom assets and archived world books open as expected; source switching and user-edited conflicts show correct notices without silent overwrite.
- [ ] Real absent/present server installation: ordinary chat works without it; explicitly enabled supported tools appear only after capability detection.
- [ ] Review changes, choose version/release notes, commit/push and install to release **only when requested**.

## Documentation

### Knowledge follow-up / 知识说明补充与复测

2026-10-23 补齐上述两类知识，不改存储实现、工具协议、服务文件或用户数据：

- 暮羽界面技能升为 revision **6**（文档1.4）：侧栏“新对话”分开会话上下文，不必新建酒馆聊天；同一暮羽会话可跨酒馆聊天继续，但工具目标是当前聊天，旧资料／批准不代表新目标状态或权限。账号、浏览器与后端决定存储，不承诺物理隔离。说明两个实际仓库共享兼容命名空间，只能启用其中一个。
- 世界书技能升为 revision **9**（文档1.7）：内部历史书由存储协议直接读写，条目保持禁用／防递归、不激活或绑定；误启用可能把私人对话注入模型。解释v1／v2范围、删除整卷／保护标记的风险、先导出再在历史侧栏管理；删除存档不撤回配置，也不保证清空其他副本。书名不证明归属、格式和内容完好。
- `window.GroupDirector`、`group-director`、工具／Provider ID、旧存档前缀／元数据／schema 均原样保留。原技能代码与JSON示例逐字校验仍通过，仅增加四个真实存档名称的行内引用。用户技能、禁用策略与原文不覆盖；旧版技能快照按既有规则失效。
- DeepSeek真实控制器复测 **10/10 passed**：中文／英文、旧名、诱导启用、诱导删除回滚、假前缀有效性、跨聊天续聊、新对话、双开隔离与连续三轮追问。对应技能完整读取到6:0／9:0，未调用写入或真实render。初跑两个词汇断言误报经核对原答后修正；完整复测通过，不因此改生产规则。
- 最终全量：**4030项，4028通过、2跳过、0失败**，约50.4秒；静态：930源码、16 JSON、470模块smoke通过。原三项测试的技能版本／核对日期预期随文档升级更新，行为断言保留；新增两项知识契约，增加升级不重启用户禁用技能的验证。

详报仅在忽略目录 `test-results/gw-knowledge-live-results.json`，不含密钥、隐藏思考或真实用户数据。上述两项说明缺口已补齐，不保证每次模型措辞完全一致；真实设备／实存档的手工验收门槛不变，release 部署需另行安排。

[中文 README](../README.md) · [English README](../README_EN.md) · [docs index](README.md). Manuals, designs and this migration record live in `docs/`; the repository root retains only the bilingual READMEs, without duplicate redirect pages. Upstream dated test logs are not current release evidence. The temporary synchronization checklist remains local until its outstanding manual gate is reconciled; it is not a product manual.
