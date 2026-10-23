# 酒馆聊天补全预设管理

独立按需模块 `st-preset-editor`，沿用来源授权 → 私有草稿票据 → 精确批准／全权限显式执行 → 宿主操作 → v34 历史回执。不扩展通用 Provider 的写入能力，不修改 SillyTavern 核心。

## 工具与来源

- `muyu.st_preset.list`：`stPresets`，20 项目录分页，返回资源选择器、目录版本与可编辑参数范围。
- `muyu.st_preset.read`：`stPresetContent`；`preset:N` 是已加载保存资源，`current` 是当前内存配置。首次使用目录版本及 offset=0，后续／预览使用返回的资源版本；6000 字符分页，不拆代理对。
- `muyu.st_preset.preview`：同一正文来源授权；生成完整精确批准草稿，不因读取授权直接执行。`apply=true` 仅全权限下且用户明确要求执行；仅预览时不得设置。

## 首版写入范围

| 操作 | 输入与结果 |
| --- | --- |
| copy | 保存资源选择器、版本、新名称及空变更；复制完整私有资源，不覆盖已加载名称、不激活 |
| save_current | current、版本、新名称及空变更；另存当前运行配置，不覆盖、不激活 |
| update | 保存资源、版本、指定 parameters 和／或单项 prompt 正文；保留未指定字段 |
| select | 保存资源、版本、空变更及 replaceCurrent=true；单独批准替换当前运行参数和 Prompt |

可改数值：温度 temperature 0..2、Top P top_p 0..1、频率／存在惩罚 frequency_penalty／presence_penalty -2..2、最大回复长度 openai_max_tokens 整数 1..1048576、上下文上限 openai_max_context 整数 512..2097152。它们是适配器输入范围，不保证宿主滑块或模型支持该窗口；缺少原值拒绝，不填默认。Prompt 仅修改现存唯一 identifier 的非 marker 正文，每项不超过 12000 字符；不改角色、排序、开关和连接。

保存／复制使用私有完整资源，包含未知扩展及连接字段；这些字段仅在本地保留，不进入模型结果、批准投影或回执，不允许模型修改。白名单 Prompt 原文本身仍可能包含用户敏感内容，因此正文读取需独立授权。复制不代表这些未知字段无副作用，后续激活会交由宿主处理。

## 保存与激活分离

官方 `PresetManager.updateList` 普通保存会自动选择预设，本模块不使用它；通过官方 `/api/presets/save` 保存后，仅更新返回的预设缓存和目录 DOM，不触发 change，不重建 Prompt 编辑器。等待保存期间本地缓存／选择改变时，不覆盖新的缓存，返回结果未知。

激活使用 `getPresetManager('openai').findPreset(name)` 的实际 option 值，调用 `selectPreset(value)`，等待匹配的官方 `PRESET_CHANGED` 事件，再核对指定参数及完整白名单 Prompt／排序；仅名称变化不算完成。当前连接绑定必须明确关闭；不自动替用户关闭。Prompt 编辑弹窗打开、ST／GD 正在生成、旧格式自动迁移预设或过时草稿拒绝执行。激活明确丢弃当前运行配置的未保存修改；宿主及第三方回调可能保存设置，不能保证无副作用。

## 证据与限制

保存资源来自宿主已加载缓存，非服务端新鲜读取。目录／源资源／当前值乐观核验不是服务器原子 CAS；其他客户端同名保存仍可能竞争，不承诺绝对防覆盖。完整批准差异超过 24000 UTF-8 字节或 JSON DTO 容量时拒绝，不截断。保存／激活后只报告 `applied_unconfirmed` 或 `outcome_unknown`，不声明磁盘持久化或最终提示词注入；未知不自动重试或回滚。

只支持 OpenAI／聊天补全预设，不开放其他 API 预设、删除、批量、连接绑定修改、角色／顺序编辑或宏渲染。v34 回执仅含版本、操作、选择器及状态，不含名称、正文、连接或差异。未进行真实 GUI、服务器磁盘或付费模型验收。
