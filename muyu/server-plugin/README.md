# 暮羽可选服务端插件

本目录是 GroupDirector 与 GroupWorld 共用的暮羽服务端运行时源码，供单独部署。使用任意一个客户端都只需一份服务，不需要 GroupWorld 专用版本。面向用户的完整安装与功能说明在 [SillyTavern Muyu Services 仓库](https://github.com/Windy-Sora/SillyTavern-Muyu-Services)。

它不是前端扩展，不能把服务仓库地址填入酒馆「安装扩展」来安装。没有安装时，暮羽仍可使用原有聊天与支持的浏览器存储；可选服务工具不会因此自动启用。

## 共用与兼容

- GroupDirector、GroupWorld 前端只启用其中一个；共享服务统一安装到 `plugins/gd-muyu-history/`，不要重复加载同 ID 的服务。
- 插件 ID `gd-muyu-history`、路由 `/api/plugins/gd-muyu-history` 和数据目录 `.group-director/muyu/` 保持原样，不因产品名改成 GW。
- 同一酒馆账号的历史可能共用命名空间和文件，不是两套隔离数据。切换客户端前先备份，不手动改名或搬动存档。
- 更新当前使用的客户端和共享服务即可；实际可用工具以能力协议、启用项与权限为准，不靠仓库版本号相同来推定。显式选择服务读取源时，服务不可用会报错，不静默切换历史来源。

## 安装

推荐在 **SillyTavern 根目录**运行：

```sh
git clone https://github.com/Windy-Sora/SillyTavern-Muyu-Services.git plugins/gd-muyu-history
```

在酒馆的 `config.yaml` 开启：

```yaml
enableServerPlugins: true
```

然后重启酒馆、刷新网页，在暮羽齿轮 → 存储与记忆 → 可选服务中检查能力，并按需开启工具。

也可复制本目录的全部七个 `.cjs` 文件到 `plugins/gd-muyu-history/`：

- `index.cjs`
- `web-search.cjs`
- `web-page.cjs`
- `documents.cjs`
- `workspace.cjs`
- `service-status.cjs`
- `diagnostics.cjs`

独立仓库还提供 `package.json`、许可证与测试。没有额外运行时依赖；服务端更新后必须重启，单独刷新前端不能重载服务代码。已有安装请更新原目录，不要加载第二份相同 ID 的插件。

## 能力

| 能力 | 范围 |
|---|---|
| 文件历史 | 当前认证账户的暮羽会话文件，按修订检查更新 |
| Brave 搜索 | 固定搜索服务返回标题、摘要和链接，需 Brave 密钥 |
| 网页正文 | 受限公共 HTTP(S) 文本读取，不登录、不执行网页脚本 |
| 本地资料检索 | 账户工作区及管理员登记的额外只读目录 |
| 工作区草稿 | 私有工作区平级 md/txt/json 的预览与一次性提交 |
| JSON 校验 | 语法及有界数据检查，不应用 GroupDirector／GroupWorld／ST 配置 |
| 自检与诊断 | 显式存储自检、服务自身的有界脱敏错误记录 |

能力声明不授予权限；客户端还须检查启用项、授权、目标和预算。搜索与网页读取是独立能力，搜索本身不抓取结果网页。

## 存储与安全边界

**此目录不得放真实聊天记录。** 酒馆会公开提供前端扩展文件，私密数据不能写进本目录。

文件数据由酒馆提供的账户目录定位：

```text
<用户数据根目录>/.group-director/muyu/
├── history/<namespace>/<conversation-id>.json
├── workspace/
└── workspace-backups/
```

- 账户目录可为绝对或相对路径；相对路径按酒馆进程工作目录解析。缺少身份时不回退默认账户，也不接受请求自定义目录。
- 文件未加密，管理员和具有磁盘权限的人可以读取；备份与服务器访问保护由用户管理。
- 历史删除清除正文并保留 ID 删除标记，防止旧浏览器备份重新迁入。历史记录不恢复授权或可执行任务。
- 工作区写入不修改酒馆配置、脚本或额外只读资料根；结果未知不能盲目重试，不提供跨进程文件系统事务保证。
- 诊断只记录本服务的历史／搜索／存储自检失败，不是全酒馆 Console 或 CMD 日志；内存记录在重启后清空。
- 健康检查只证明路由已加载，不证明真实对话已保存、磁盘可写或搜索密钥有效。
- 读取内容用于模型回答时可能发送给当前模型；网址和搜索词分别发送到目标网站和 Brave。不要将密钥或私密资料放进这些输入。

客户端合同见[可选服务](../services/README.md)、[会话存储](../sessions/README.md)和[联网搜索](../web/README.md)；具体容量、参数和安装更新步骤以独立仓库及当前代码为准。
