# model-orchestration Specification

## Purpose
TBD - created by archiving change multimodal-model-orchestration. Update Purpose after archive.
## Requirements
### Requirement: 编排器管理浏览器脚本短期缓存生命周期

编排器 SHALL 在请求捕获和重放任务中优先使用 `action="script"` 的短期 `scriptCache` 保存临时抓包样本，并负责在样本完成用途后主动移除；只有稳定、可跨会话复用的脚本、runbook 或回放模板才应升格到 `store_script_memory`。

#### Scenario: 短期抓包样本进入 scriptCache
- **WHEN** 用户要求捕获网页网络请求、监听表单提交、保存一次性请求样本或临时重放请求
- **THEN** 编排器应当让 `action="script"` 使用 `scriptCache` 保存短期样本
- **AND** 编排器不应为了短期抓包样本默认调用 `store_script_memory`

#### Scenario: 用完临时样本后主动清理
- **WHEN** 缓存样本已经完成一次性检查、提取、对比或重放
- **THEN** 编排器应当让脚本调用 `scriptCache.consume`、`scriptCache.delete`、`scriptCache.clear`
- **AND** 在重放时也可以使用 `scriptCache.replay(key, { deleteAfter: true })` 或 `scriptCache.replay(key, { deleteOnSuccess: true })`

#### Scenario: 稳定复用内容升格长期记忆
- **WHEN** 捕获样本已经被整理成稳定的复用脚本、回放模板、操作 runbook 或跨会话工作流
- **THEN** 编排器可以调用 `store_script_memory` 保存该稳定内容
- **AND** 长期记忆内容应当是提炼后的模板或脚本，而不是未清理的短期抓包流水

#### Scenario: 缓存清理结果可用于后续推理
- **WHEN** 脚本响应包含 `script.cache.deletedKeys`、`script.cache.cleared` 或自动缓存摘要
- **THEN** 编排器应当把该摘要作为缓存生命周期状态使用
- **AND** 编排器不应假设已删除的缓存 key 仍可用于后续重放

### Requirement: Single primary orchestrator profile
The system MUST allow exactly one enabled model profile to be marked as the primary orchestrator, and the runtime MUST use that profile as the default planning model when one is configured. The same profile data model MUST also support optional context-budget metadata used by the runtime to manage prompt assembly and compaction.

#### Scenario: Save a new primary profile
- **WHEN** the user marks a profile as primary and saves it
- **THEN** the system clears the primary flag from any other saved profiles

#### Scenario: Use the primary orchestrator
- **WHEN** a user sends a normal chat request and a primary profile exists
- **THEN** the runtime uses that profile for planning and top-level reasoning

#### Scenario: Fall back without a primary
- **WHEN** no enabled profile is marked as primary
- **THEN** the runtime falls back to the existing default chat model settings

#### Scenario: Save profile context-budget metadata
- **WHEN** a user saves or edits a model profile with context window or compaction budget fields
- **THEN** the system persists those fields with the profile and makes them available to the runtime

#### Scenario: Store lookup provenance
- **WHEN** the system resolves a model context budget from dictionary, provider metadata, or first-use AI lookup
- **THEN** it persists the resolved value with enough provenance to explain where that budget came from

### Requirement: Capability-based specialist resolution
The system MUST resolve specialist work by capability tag rather than by raw model ID, and it MUST skip disabled profiles when selecting a specialist. Specialist and orchestrator profiles MUST expose enough budget metadata for the runtime to compact context against the active model limit.

#### Scenario: Resolve a vision specialist
- **WHEN** the runtime requests a model with the vision capability
- **THEN** the system returns an enabled profile tagged for vision work

#### Scenario: Skip a disabled match
- **WHEN** the only matching specialist profile is disabled
- **THEN** the system does not select that profile and reports that no enabled specialist is available

#### Scenario: Use specialist budget metadata
- **WHEN** the runtime selects a specialist profile for a model call
- **THEN** prompt budgeting and compaction decisions use that selected profile's explicit or inferred context budget

### Requirement: Deterministic routing for multiple matches
When more than one enabled profile satisfies a requested capability, the system MUST choose a single profile using deterministic rules and must not depend on manual model-name entry.

#### Scenario: Multiple specialists satisfy one capability
- **WHEN** two or more enabled profiles are tagged for the same capability
- **THEN** the system chooses one profile consistently using the same priority rules each time

#### Scenario: User switches provider connection
- **WHEN** the user updates provider base URL or API Key for a profile
- **THEN** the routing logic continues to work from capability tags without requiring a new manual model-name lookup

### Requirement: Reduced Orchestrator Tool Surface
The orchestrator SHALL operate with the reduced built-in tool catalog and MUST not rely on removed dedicated utility tools for default runtime planning.

#### Scenario: Orchestrator chooses from reduced toolset
- **WHEN** the runtime prepares the orchestrator prompt and tool bindings
- **THEN** the available tool surface SHALL exclude removed file, HTTP, skills, and scheduled-task tools

#### Scenario: Orchestrator uses shell command for operational work
- **WHEN** the user asks for a filesystem or command-line task that does not require multimodal or memory behavior
- **THEN** the orchestrator SHALL prefer `shell_command` over any removed dedicated utility path

### Requirement: 允许共享浏览器工具
编排器 SHALL 在精简的内置工具目录下运行，并在加载可用工具时包含 `browser_action`；它 MUST NOT 在默认运行时规划中依赖已移除的分散浏览器工具名。

#### Scenario: 工具目录包含共享浏览器能力
- **当** 编排器加载可用工具时
- **则** 它应当包含 `shell_command`、`invoke_model`、`recall_memory`、`write_knowledge` 和 `browser_action`

#### Scenario: 不再依赖移除的分散浏览器工具
- **当** 编排器规划浏览器任务时
- **则** 它不应当依赖已移除的分散浏览器工具名

### Requirement: 浏览器任务路由
编排器 SHALL 在交互式 Web 浏览和 Web 应用操作任务中使用 `browser_action`，通过 `action` 参数分发浏览器操作，并在需要视觉确认时将截图作为 assistant 消息附件返回对话。

#### Scenario: 交互式网页任务使用 browser_action
- **当** 用户请求浏览网页、检查页面、操作表单或操控 Web 应用时
- **则** 编排器应当在需要浏览器交互时使用 `browser_action`

#### Scenario: 浏览器任务按 action 分发
- **当** 编排器调用 `browser_action` 时
- **则** 它应当通过 `browser_action.action` 选择对应动作
- **并且** 在元素引用过期时先请求新的 `snapshot`

#### Scenario: 截图作为对话结果的一部分
- **当** 浏览器任务需要视觉确认或用户要求查看当前页面时
- **则** 编排器应当使用 `browser_action.action="screenshot"`
- **并且** 运行时应当把截图作为 assistant 消息附件返回到对话中

### Requirement: 浏览器任务使用自主 `browser_action`

编排器 SHALL 使用共享 `browser_action` 操作 Electron 浏览器会话；对于复合、模糊或需要策略表达的浏览器任务，编排器 SHOULD 使用 `browser_action.action="run"`，由 Agent 自主编写 goal、target、steps 和 strategy 参数，并由浏览器运行时负责解释执行。

#### Scenario: 简单任务可以使用固定 action

- **WHEN** 用户请求简单导航、截图、刷新、后退、前进、单次点击、单次输入或滚动
- **THEN** 编排器可以继续使用现有固定 `browser_action` action
- **AND** 固定 action 的行为应保持向后兼容

#### Scenario: 复合浏览器任务使用 run

- **WHEN** 用户请求需要多步浏览器操作的任务
- **THEN** 编排器应当可以调用 `browser_action` 且设置 `action: "run"`
- **AND** 编排器可以在一次调用中提供多个 steps
- **AND** 浏览器运行时应当按 steps 执行并返回 run trace

#### Scenario: 模糊目标由 run 内部解析

- **WHEN** `browser_action.run` 的 goal、target 或 step target 包含自然语言目标描述
- **THEN** 浏览器运行时应当通过 DOM descriptor、MiniLM 向量语义匹配、词法匹配、角色匹配、上下文匹配和可见/可用状态融合来解析目标
- **AND** 编排器不需要为了每个自然语言目标手动先调用 `resolve`

#### Scenario: Agent 自主编写浏览器参数

- **WHEN** 编排器调用 `browser_action.run`
- **THEN** 它应当能够自主填写 `goal`、`target`、`steps`、`strategy` 和 `onFailure`
- **AND** 工具 schema 不应把复合浏览器行为限制为只能通过固定 action enum 逐步表达

#### Scenario: MiniLM 仅用于浏览器 DOM 解析

- **WHEN** `browser_action.run` 或 `browser_action.resolve` 使用 MiniLM
- **THEN** MiniLM 应仅用于浏览器 DOM descriptor 与目标 query 的语义匹配
- **AND** MiniLM 不应被该能力用于记忆、知识库、通用问答或非浏览器 DOM 解析

#### Scenario: 视觉作为显式策略或兜底

- **WHEN** Agent 在 `browser_action.run` 中指定 `strategy: "visionFallback"` 或 DOM/semantic resolver 无法提供足够证据
- **THEN** 浏览器运行时可以返回需要视觉兜底的信息或截图结果
- **AND** 截图和视觉不应替代 MiniLM DOM resolver 的保留要求

### Requirement: 编排器可使用高权限浏览器脚本入口
编排器 SHALL 在需要直接编程浏览器运行时、直接操控 `BrowserView` / `webContents` / CDP，或用户明确要求高权限浏览器脚本时，能够调用共享 `browser_action` 的高权限脚本动作。

#### Scenario: 用户明确要求原始浏览器运行时控制
- **WHEN** 用户明确要求把浏览器运行时高权限暴露给 Agent，或要求 Agent 自己写 Electron 侧服务端浏览器脚本
- **THEN** 编排器应当可以调用共享 `browser_action` 的高权限脚本动作
- **AND** 不应当强制把该请求改写回固定 action、受控 primitive 或页面内脚本

#### Scenario: 自定义渲染层任务可使用脚本动作
- **WHEN** 浏览器任务涉及 Three.js canvas、自定义绘图层、复杂前端状态机或需要直接调试浏览器运行时的场景
- **THEN** 编排器应当可以选择高权限浏览器脚本动作
- **AND** 不需要先把问题压缩成普通 DOM 控件定位任务

#### Scenario: 普通控件任务仍优先 DOM-first
- **WHEN** 用户请求点击、输入、选择或提交普通 DOM 控件
- **THEN** 编排器仍应当优先使用现有 DOM snapshot、AX tree + 稳定 ref + stale 重解析路径、固定 action 或 `run`
- **AND** 高权限脚本动作不应取代标准 DOM 控件任务的默认路径

#### Scenario: 高权限脚本与 AX/ref resolver 可混合使用
- **WHEN** 编排器先使用高权限浏览器脚本完成部分浏览器运行时操作
- **THEN** 它后续仍应当可以继续使用 `snapshot`、`resolve`、`click`、`type`、`run` 或 `screenshot`
- **AND** DOM + AX tree/ref/stale 重解析路径应当继续可用

### Requirement: Orchestrate from bounded tool output summaries
编排器 SHALL 基于工具输出摘要、缓存 key 和 raw 引用继续工作，而不是依赖完整大输出默认存在于上下文中。

#### Scenario: 工具返回 raw 引用
- **WHEN** 工具结果包含 `rawRef`、artifact 引用或 `scriptCache` key
- **THEN** 编排器 SHALL 使用摘要判断下一步
- **AND** 只有在确实需要完整原文时才显式读取该引用

#### Scenario: 浏览器脚本产生大量抓包数据
- **WHEN** `browser_action.action="script"` 用于网络请求捕获、CDP 日志或页面调试
- **THEN** 编排器 SHALL 指导脚本把短期样本放入 `scriptCache`
- **AND** 编排器 SHALL 避免要求脚本直接返回完整日志数组作为普通工具输出

#### Scenario: 用户要求查看完整原始输出
- **WHEN** 用户明确要求查看、复制或下载完整原始输出
- **THEN** 编排器 SHALL 使用 raw 引用或 UI/API 检索路径提供原始数据
- **AND** 不应把完整原文自动塞回后续模型上下文

