## MODIFIED Requirements

### Requirement: 页面快照
系统 SHALL 通过 `browser_action` 的 `snapshot` action 返回结构化浏览器状态供 Agent 推理使用，并为可交互元素生成可被 DOM resolver 使用的 descriptor。

#### Scenario: 快照包含页面标识信息
- **WHEN** Agent 使用 `action: "snapshot"` 调用 `browser_action`
- **THEN** 系统应当返回当前 URL、页面标题、加载状态、`canGoBack`、`canGoForward` 和裁剪后的可见文本

#### Scenario: 快照包含交互元素
- **WHEN** 当前页面包含可见交互元素时
- **THEN** 系统应当返回裁剪后的元素条目
- **AND** 条目中应当包含稳定引用、角色、名称、标签、可编辑状态和位置信息

#### Scenario: 快照包含元素描述符
- **WHEN** 系统生成交互元素条目时
- **THEN** 它应当为元素生成 descriptor
- **AND** descriptor 应当包含 accessible name、role、tag、type、label、title、placeholder、nearest heading、form/dialog/toolbar context、enabled/visible 状态和 bounds 中可获得的信息

#### Scenario: 快照输出受限
- **WHEN** 当前页面包含大量文本或大量交互元素时
- **THEN** 系统应当截断文本和元素列表以适配 Agent 上下文预算

### Requirement: 浏览器交互动作
系统 SHALL 通过 `browser_action` 基于最新页面快照中的引用或 DOM resolver 的高置信度候选进行交互，并在每次操作后返回更新后的页面状态。

#### Scenario: 点击元素引用
- **WHEN** Agent 使用 `action: "click"` 和有效元素引用调用 `browser_action`
- **THEN** 系统应当点击该引用对应的元素并返回更新后的页面状态

#### Scenario: 按查询点击高置信度元素
- **WHEN** Agent 使用 `action: "click"`、`query` 和可选 `minConfidence` 调用 `browser_action`
- **AND** DOM resolver 返回唯一候选且置信度达到阈值
- **THEN** 系统应当点击该候选元素并返回更新后的页面状态

#### Scenario: 按查询点击存在歧义
- **WHEN** Agent 使用 `action: "click"` 和 `query` 调用 `browser_action`
- **AND** DOM resolver 返回低置信度或多个相近候选
- **THEN** 系统不得执行点击
- **AND** 应当返回 Top K 候选、置信度和需要消歧的原因

#### Scenario: 输入文本
- **WHEN** Agent 使用 `action: "type"`、有效可编辑元素引用和文本调用 `browser_action`
- **THEN** 系统应当聚焦该控件、输入文本并返回更新后的页面状态

#### Scenario: 按查询输入文本
- **WHEN** Agent 使用 `action: "type"`、`query` 和文本调用 `browser_action`
- **AND** DOM resolver 返回唯一可编辑候选且置信度达到阈值
- **THEN** 系统应当聚焦该候选控件、输入文本并返回更新后的页面状态

#### Scenario: 元素引用失效
- **WHEN** Agent 使用最新快照中不存在的引用调用交互 action
- **THEN** 系统应当返回引用失效错误
- **AND** 指示 Agent 请求新的 `snapshot` 或使用 `resolve`

### Requirement: DOM 元素解析
系统 SHALL 提供本地 DOM resolver，将用户意图、控件名称或动作描述解析为可操作元素候选，作为截图和视觉模型之前的首选页面感知路径；resolver SHALL 使用 `all-MiniLM-L6-v2` 语义向量分作为融合评分的一部分。

#### Scenario: 解析普通按钮
- **WHEN** Agent 使用 `action: "resolve"` 和 `query: "发送按钮"` 调用 `browser_action`
- **AND** 页面中存在可见且启用的发送按钮
- **THEN** 系统应当返回该按钮作为高置信度候选
- **AND** 候选应当包含 ref、role、name/text、bounds、confidence 和匹配原因

#### Scenario: 解析输入框
- **WHEN** Agent 使用 `action: "resolve"` 和描述输入框的 query 调用 `browser_action`
- **THEN** 系统应当优先返回 accessible name、label、placeholder 或 form context 匹配的可编辑元素

#### Scenario: 使用 MiniLM 匹配模糊意图
- **WHEN** Agent 使用 `action: "resolve"` 和无法精确匹配元素文本的模糊 query 调用 `browser_action`
- **AND** `all-MiniLM-L6-v2` 本地语义索引可用
- **THEN** 系统应当将 query 向量与元素 descriptor 向量的相似度纳入候选排序
- **AND** 候选结果应当返回 semantic score 或语义匹配原因

#### Scenario: MiniLM 不可用时降级
- **WHEN** 本地 MiniLM 模型仍在加载、下载失败或不可用
- **THEN** resolver 应当降级使用规则和词法匹配
- **AND** 响应应当标记 `semanticReady: false` 或等价状态
- **AND** 系统不得因为语义索引不可用而直接改用截图或视觉模型定位普通 DOM 控件

#### Scenario: 语义高分仍需动作安全检查
- **WHEN** MiniLM 返回高相似度候选
- **THEN** 系统仍应当检查候选 visible、enabled、role/editable 与目标动作兼容，并确认 Top 1 与其他候选有足够分差
- **AND** 只有达到直接操作阈值时才允许 query-based click/type

#### Scenario: 解析低置信度目标
- **WHEN** resolver 无法找到高置信度候选
- **THEN** 系统应当返回低置信度候选和 `needsVisionFallback` 或 `needsDisambiguation` 标记
- **AND** 系统不得伪造 ref 或执行操作

#### Scenario: DOM 变化后刷新索引
- **WHEN** 页面导航、滚动、点击、输入或 DOM mutation 使元素状态变化
- **THEN** 系统应当标记 DOM index 过期
- **AND** 下一次 `snapshot` 或 `resolve` 应当使用刷新后的 descriptor/index
