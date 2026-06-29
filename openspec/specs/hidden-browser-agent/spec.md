# hidden-browser-agent Specification

## Purpose
TBD - created by archiving change add-hidden-browser-agent. Update Purpose after archive.
## Requirements
### Requirement: 共享浏览器运行时
系统 SHALL 提供一个 Electron 浏览器运行时，可供 Agent 在隐藏模式下操作外部 Web 页面，也可在可见对话视图中复用同一浏览器会话。

#### Scenario: 按需创建隐藏浏览器
- **当** `browser_action` 被调用且不存在浏览器会话时
- **则** 系统应当创建一个隐藏的 Electron Web 运行时
- **并且** 外部页面不应当表现为独立用户窗口

#### Scenario: 可见视图复用同一会话
- **当** 用户打开浏览器视图时
- **则** 系统应当显示与 `browser_action` 共享的浏览器会话
- **并且** 会话的 Cookie 和站点状态应当保持可复用

#### Scenario: 会话状态持久化
- **当** 浏览器会话在多次隐藏调用或可见视图操作之间切换时
- **则** 系统应当使用持久化 Electron partition 保留 Cookie 和站点状态

### Requirement: 单一 `browser_action` 工具

系统 SHALL 暴露单一 `browser_action` 工具，并在现有固定 action 之外支持 `action: "run"`，使 Agent 能够自主编写浏览器操作目标、目标定位参数、步骤和执行策略。

#### Scenario: 工具暴露 run action

- **WHEN** Agent 查看可用工具 schema
- **THEN** `browser_action.action` 应当包含 `run`
- **AND** `browser_action` 应当接受 `goal`、`target`、`steps`、`strategy` 和 `onFailure` 等参数

#### Scenario: run 支持多步执行

- **WHEN** Agent 使用 `action: "run"` 并提供多个 steps
- **THEN** 浏览器运行时应当按顺序执行这些 steps
- **AND** 每个 step 可以声明操作类型、目标、文本、按键、滚动量、策略和失败处理

#### Scenario: run 复用 DOM resolver

- **WHEN** run step 需要定位自然语言描述的页面元素
- **THEN** 系统应当复用浏览器 DOM descriptor、MiniLM 向量化语义匹配和 DOM 规则融合 resolver
- **AND** resolver 的结果应当可用于 click、type、hover、wheel、drag 等 step

#### Scenario: run 返回执行轨迹

- **WHEN** `browser_action.run` 执行完成
- **THEN** 响应应当包含最终浏览器状态
- **AND** 响应应当包含 run trace，说明每步是否成功、使用的策略、选中的 ref、置信度、MiniLM 状态和失败原因

#### Scenario: 固定 action 向后兼容

- **WHEN** Agent 使用 `snapshot`、`resolve`、`navigate`、`click`、`type`、`scroll`、`screenshot`、`refresh`、`back` 或 `forward`
- **THEN** 系统应当保持现有行为

### Requirement: 页面快照
系统 SHALL 通过 `browser_action` 的 `snapshot` action 返回紧凑的结构化浏览器状态供 Agent 推理使用。

#### Scenario: 快照包含页面标识信息
- **当** Agent 使用 `action: "snapshot"` 调用 `browser_action` 时
- **则** 系统应当返回当前 URL、页面标题、加载状态、`canGoBack`、`canGoForward` 和裁剪后的可见文本

#### Scenario: 快照包含交互元素
- **当** 当前页面包含可见交互元素时
- **则** 系统应当返回裁剪后的元素条目
- **并且** 条目中应当包含稳定引用、角色、名称、标签、可编辑状态和位置信息

#### Scenario: 快照输出受限
- **当** 当前页面包含大量文本或大量交互元素时
- **则** 系统应当截断文本和元素列表以适配 Agent 上下文预算

### Requirement: 浏览器导航动作
系统 SHALL 通过 `browser_action` 的 `navigate` action 在共享浏览器中打开 HTTP 或 HTTPS URL 并返回结果页面状态。

#### Scenario: 导航到有效 Web URL
- **当** Agent 使用 `action: "navigate"` 和 HTTP 或 HTTPS URL 调用 `browser_action` 时
- **则** 系统应当在共享浏览器中加载该 URL
- **并且** 返回更新后的页面状态

#### Scenario: 拒绝不支持的 URL 协议
- **当** Agent 使用 `action: "navigate"` 和非 Web URL 协议调用 `browser_action` 时
- **则** 系统应当返回明确错误

#### Scenario: 刷新当前页面
- **当** Agent 使用 `action: "refresh"` 调用 `browser_action` 时
- **则** 系统应当刷新当前页面并返回更新后状态

#### Scenario: 后退和前进
- **当** Agent 使用 `action: "back"` 或 `action: "forward"` 调用 `browser_action` 时
- **则** 系统应当在浏览器历史中后退或前进
- **并且** 当对应历史不可用时返回不可用错误

### Requirement: 浏览器交互动作
系统 SHALL 通过 `browser_action` 基于最新页面快照中的引用进行交互，并在每次操作后返回更新后的页面状态。

#### Scenario: 点击元素引用
- **当** Agent 使用 `action: "click"` 和有效元素引用调用 `browser_action` 时
- **则** 系统应当点击该引用对应的元素并返回更新后的页面状态

#### Scenario: 输入文本
- **当** Agent 使用 `action: "type"`、有效可编辑元素引用和文本调用 `browser_action` 时
- **则** 系统应当聚焦该控件、输入文本并返回更新后的页面状态

#### Scenario: 输入后可选提交
- **当** Agent 使用 `action: "type"` 且 `submit` 为 `true` 时
- **则** 系统应当在输入后触发该控件合适的提交行为

#### Scenario: 滚动页面
- **当** Agent 使用 `action: "scroll"` 和方向参数调用 `browser_action` 时
- **则** 系统应当滚动当前页面并返回更新后状态

#### Scenario: 元素引用失效
- **当** Agent 使用最新快照中不存在的引用调用交互 action 时
- **则** 系统应当返回引用失效错误
- **并且** 指示 Agent 请求新的 `snapshot`

### Requirement: 浏览器截图动作
系统 SHALL 通过 `browser_action` 的 `screenshot` action 捕获浏览器视口供视觉检查工作流使用，并将截图作为对话附件返回。

#### Scenario: 捕获当前视口
- **当** Agent 使用 `action: "screenshot"` 调用 `browser_action` 时
- **则** 系统应当捕获当前浏览器视口
- **并且** 返回截图 artifact

#### Scenario: 截图进入对话附件
- **当** `screenshot` 返回 artifact 时
- **则** 系统应当把该 artifact 作为 assistant 消息附件透传到对话结果

#### Scenario: 截图不膨胀普通文本输出
- **当** 系统返回常规页面状态时
- **则** 系统不应当将完整截图二进制或大段 base64 嵌入常规文本响应中

### Requirement: `browser_action` 支持高权限脚本动作
系统 SHALL 继续暴露单一 `browser_action` 工具，并为该工具新增一个高权限脚本动作，使 Agent 可以对共享浏览器会话执行 Electron 侧脚本。

#### Scenario: 工具 schema 暴露脚本动作
- **WHEN** Agent 查看 `browser_action` 的可用 schema
- **THEN** `browser_action.action` 应当包含高权限脚本动作
- **AND** 该动作应当接受脚本源码、可选参数和可选超时参数

#### Scenario: 脚本动作与固定 action 共存
- **WHEN** Agent 继续使用 `snapshot`、`resolve`、`navigate`、`click`、`type`、`scroll`、`run`、`screenshot`、`refresh`、`back` 或 `forward`
- **THEN** 系统应当保持这些 action 的现有行为
- **AND** 新增脚本动作不得移除既有 DOM-first 与 AX tree/ref 结构化解析路径

#### Scenario: 脚本动作复用共享浏览器会话
- **WHEN** Agent 通过 `browser_action` 调用高权限脚本动作
- **THEN** 脚本应当作用于与固定 action 和可见浏览器视图相同的共享浏览器会话
- **AND** 该动作不得悄悄切换到单独的隐藏浏览器实例

### Requirement: 标准 DOM 控件继续使用 AX tree + 稳定 ref + stale 重解析
系统 SHALL 继续为标准 DOM 控件任务提供基于 AX tree、稳定 ref 和 stale 重解析的结构化定位路径。

#### Scenario: 结构化快照为控件分配稳定 ref
- **WHEN** Agent 通过 `snapshot` 或等价结构化页面感知动作读取页面
- **THEN** 系统应当基于可访问性树为可交互元素分配稳定 ref
- **AND** 后续 `click`、`type`、`scroll` 或 `resolve` 应当复用这些 ref

#### Scenario: stale ref 可被结构化重解析
- **WHEN** 先前返回的元素 ref 因导航、DOM 变化或重渲染而失效
- **THEN** 系统应当基于同一结构化页面信息执行 stale 重解析
- **AND** 普通控件任务不应默认退化为 MiniLM 向量匹配或视觉坐标点击

