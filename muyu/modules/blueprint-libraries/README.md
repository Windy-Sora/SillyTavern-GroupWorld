# 蓝图库资源管理

本模块只操作全局 settings.storyBlueprintLibraries。当前聊天存包和应用由独立blueprint-library-chat模块处理，不能用本模块授权替代聊天来源与批准；生成、手动进度推进不在本模块范围。

## 工具与授权

- muyu.blueprint_libraries.list：每页24项，返回ID、名称及不透明版本。
- read：按版本分页读取，正文不可信；每页6000字符。
- export：返回完整标准JSON，不触发下载或文件系统写入，最多20000 UTF-8字节。
- preview：创建／导入、修改、删除单包。修改与删除要求精确ID及版本；仅指定字段改变，exportData整体替换。
- 来源 blueprintLibraryAssets，读取独立授权；读取授权不是写入批准。普通模式经完整差异卡精确批准；全权限只有显式 apply=true 才执行，只有预览意图时仍不写。

## 数据合同

接受 group-director-story-blueprint v1 包或完整原始蓝图（显式包装）。蓝图必须有 version:1、title、nodes；节点要求唯一稳定id、type、title、content对象及可选children数组。允许meta JSON对象。

最多256节点，结构深度上限8；同时受通用copyJson的16层、4096值、32768字节限制，因此复杂深树可能提前被拒。草稿完整前后差异最多24000 UTF-8字节，不截断后批准。旧版宽松JSON或超限包继续使用原GUI，不静默补ID、重命名或丢弃未知字段。空树不接受。

可保存doneSignals、leaf/all/level:N的progressTracks和activeProgressKey；普通进度引用必须指向存在节点，legacyDoneSignals允许保留已退出树的历史ID。这只是结构校验和资源保存，不证明模式进度顺序有效或任何当前聊天节点已完成。节点正文和包内进度不执行；不会启用蓝图。

库名称与说明同步到导出libraryMeta，节点总数重新计算。stepCount不从当前聊天读取，资源导入沿用0（未知执行步数）；includeProgress由包内标记或实际信号确定，禁止标记false却含完成信号。

## 保存与失败

模块 → host端口 → 原业务系统mutateApproved，共用旧GUI串行队列。执行前再次核对设置身份、目标完整快照、版本、重名及精确草稿。执行后核对目标未被并发替换或修改。

saveSettings返回不构成持久化确认；正常返回saved_unconfirmed。保存异常或并发干扰为outcome_unknown，可能保留内存修改，不回填整个旧仓库、不自动重试。v18回执只含元数据，不携带蓝图正文或进度。

## 验证

tests/unit/muyu-blueprint-libraries.test.mjs覆盖CRUD、原始包装、进度保留、拒绝非法引用、并发、队列、保存未知、预算与元数据回执；muyu-controller测试覆盖普通批准、拒绝、全权限和仅预览。尚需真实宿主GUI验收，无付费模型测试。
