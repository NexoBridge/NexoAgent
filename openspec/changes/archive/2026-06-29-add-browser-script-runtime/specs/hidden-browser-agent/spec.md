## ADDED Requirements

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
