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
The orchestrator SHALL treat tool outputs as complete when the runtime successfully appends them to model context. It SHALL only assume missing output when the runtime explicitly reports `context_overflow` or a tool itself returns a deliberate summary/cache key.

#### Scenario: Tool result is passed through completely
- **WHEN** a tool result is present in the model context and no `context_overflow` has occurred
- **THEN** the orchestrator SHALL reason from that complete tool result
- **AND** it SHALL NOT claim that a hidden raw reference must be fetched solely because the result is large

#### Scenario: Tool intentionally returns a summary or cache key
- **WHEN** a tool or script deliberately returns a summary, artifact reference, or script cache key instead of raw data
- **THEN** the orchestrator SHALL respect that tool-authored contract
- **AND** it SHALL fetch or inspect the referenced data only when the task requires the full payload

#### Scenario: Runtime reports context overflow
- **WHEN** the runtime stops with `stopReason="context_overflow"`
- **THEN** the orchestrator SHALL NOT claim it inspected omitted content
- **AND** the user-facing response SHALL state that the complete context exceeded the active model input budget

### Requirement: Browser script orchestration uses script-owned results
The orchestrator SHALL treat `browser_action.action="script"` as script-output-only and avoid assuming that full page state is present in each script result.

#### Scenario: Script result needs page state after execution
- **WHEN** a script response does not include DOM elements, readable page text, or browser history and the Agent needs that state to continue
- **THEN** the Agent SHALL call `browser_action` with `action="snapshot"`
- **AND** the Agent SHALL NOT repeat the same script solely because the script response omitted unrelated page snapshot data

### Requirement: Preserve user-provided long-form text as authoritative context
The orchestrator SHALL treat long-form text supplied in the current session as authoritative when it is accepted by the server and included in the prompt.

#### Scenario: User sends a large plain-text document
- **WHEN** the server accepts and stores a large plain-text user message
- **THEN** the orchestrator SHALL treat that complete message as current-session context
- **AND** it SHALL NOT assume the application retained only a recent excerpt

#### Scenario: Long-form text cannot fit the model
- **WHEN** the accepted long-form text cannot fit into the active model input budget with the rest of the prompt
- **THEN** the runtime SHALL return `context_overflow`
- **AND** the orchestrator response SHALL ask for explicit compression, deletion, or a larger-context model rather than silently proceeding with a partial excerpt

### Requirement: 可配置的 planner/executor 路由模式
系统 SHALL 为常规 Agent 运行提供可选的 planner/executor 路由模式。模式禁用时，运行时 MUST 保留现有单一主编排器行为。

#### Scenario: 禁用路由时使用现有主模型
- **WHEN** planner/executor 路由被禁用且用户发送常规 chat 请求
- **THEN** 运行时 SHALL 解析与本变更前相同的主模型配置
- **AND** 它 SHALL 运行现有 Agent 循环，且不要求 executor profile 设置

#### Scenario: 启用路由且小模型有效
- **WHEN** planner/executor 路由已启用，且配置的 executor profile 已启用并具备 chat 能力
- **THEN** 运行时 SHALL 使用当前主模型处理 planning 或 verification 模型调用
- **AND** 它 SHALL 使用 executor profile 处理常规 execution 与 tool-use 模型轮次

#### Scenario: 启用路由但无 executor
- **WHEN** planner/executor 路由已启用，但无法解析任何已启用的 executor profile
- **THEN** 运行时 SHALL 在模型运行开始前停止，并返回清晰的配置错误
- **AND** 它 SHALL NOT 静默将所有路由模式工作执行在主模型上

### Requirement: 本地路由分类
系统 SHALL 使用确定性本地逻辑对 planner/executor 路由的模型工作进行分类，且 SHALL NOT 发起额外的 AI 请求。

#### Scenario: 简单请求由 executor 处理
- **WHEN** planner/executor 路由已启用，且用户请求被分类为 simple 或 medium，且不需要工具、多步规划、高风险推理或验证
- **THEN** 运行时 SHALL 将回复生成路由到 executor profile
- **AND** 它 SHALL NOT 仅为分类请求而调用 planner

#### Scenario: 复杂请求获得 planner 指引
- **WHEN** planner/executor 路由已启用，且用户请求被分类为 complex、reasoning-heavy 或 agentic
- **THEN** 运行时 SHALL 在 executor 工具调用开始前调用当前主模型生成紧凑 execution brief
- **AND** executor SHALL 接收该 brief 作为本次运行的指引

#### Scenario: 深度规划模式提高路由敏感度
- **WHEN** planner/executor 路由已启用且 `planningMode` 设为 `deep`
- **THEN** 路由分类器 SHALL 将含糊的多步、代码变更或工具密集型请求视为需 planner 指引，除非确定性规则将其标记为 simple

### Requirement: Executor 结果检查
系统 SHALL 在最终完成前评估 executor 结果，且当未满足默认质量标准时 SHALL 升级至当前主模型检查。

#### Scenario: Executor 结果通过检查
- **WHEN** executor 完成路由运行，且无工具错误、未解决必要证据、context overflow、circuit-breaker 干预或低质量分数
- **THEN** 运行时 SHALL 直接定稿 executor 结果，无需额外主模型检查调用

#### Scenario: Executor 结果需要检查
- **WHEN** executor 结果包含失败的必要工具调用、不支持的断言、重复循环停止、显式不确定性，或质量分数低于默认阈值
- **THEN** 运行时 SHALL 调用当前主模型审查并修复最终回复
- **AND** 它 SHALL 在路由元数据中记录升级原因

#### Scenario: 主模型检查无法修复
- **WHEN** 当前主模型无法生成有效的修复回复
- **THEN** 运行时 SHALL 返回最佳可用 executor 结果，并附关于未解决问题的清晰说明
- **AND** 它 SHALL NOT 在路由元数据中隐藏失败的验证状态

### Requirement: Provider 无关的模型角色解析
系统 SHALL 使用当前主模型解析 planner/verifier，并从已保存 model profile 与 provider 连接数据解析 executor，而非从硬编码模型名或 provider 专用包解析。

#### Scenario: 选择 OpenRouter profile 作为 executor
- **WHEN** 用户选择已保存的 OpenAI 兼容 OpenRouter profile 作为 executor
- **THEN** 运行时 SHALL 通过现有 provider/profile 连接路径调用该 profile
- **AND** 它 SHALL NOT 为基本 chat completion 路由要求单独的 OpenRouter 专用包

#### Scenario: 主模型与 executor 使用不同 provider
- **WHEN** planner/executor 路由使用的 profile 来自不同兼容 provider
- **THEN** 每次模型调用 SHALL 使用该次调用所选角色 profile 的 API base、provider 协议、API key、temperature、thinking 设置与 context budget

#### Scenario: 跳过已禁用的 executor profile
- **WHEN** 配置的 executor profile 被禁用
- **THEN** 运行时 SHALL 将该角色视为未解析
- **AND** 它 SHALL 返回清晰配置错误

### Requirement: Specialist capability 路由保持权威
系统 SHALL 将基于 capability 的 specialist 模型路由与 planner/executor 角色路由分离。

#### Scenario: Vision specialist 仍按 capability 路由
- **WHEN** planner/executor 路由已启用，且工具调用请求 `invoke_model` 且 `capability="vision"`
- **THEN** 运行时 SHALL 按 capability 解析已启用的 vision-capable specialist profile
- **AND** 它 SHALL NOT 用 planner 或 executor profile 替代，除非该 profile 本身也是确定性 capability 匹配

#### Scenario: 常规 chat 子任务使用 executor
- **WHEN** planner/executor 路由已启用，且常规 chat 子任务未请求 specialist capability
- **THEN** 运行时 SHALL 使用 executor profile，planning 与 verification SHALL 使用当前主模型
- **AND** 启用路由时 executor profile SHALL 是必需项

### Requirement: 路由可观测性
系统 SHALL 为 planner/executor 运行暴露路由决策与用量元数据，且 SHALL NOT 暴露密钥或隐藏 prompt。

#### Scenario: 路由运行完成
- **WHEN** planner/executor 路由运行完成
- **THEN** 运行时 SHALL 记录 route class、角色序列、profile 名称、model ID、升级状态与 token 用量（若可用）
- **AND** 它 SHALL 省略 API key 与原始 authorization 头

#### Scenario: 路由前置条件失败
- **WHEN** planner/executor 路由因 executor profile 缺失、禁用或缺少凭证而无法启动
- **THEN** 运行时 SHALL 返回用户可见的配置错误
- **AND** server 日志 SHALL 标识未解析的角色，且 SHALL NOT 记录密钥值

### Requirement: 配置指定 planner/executor 开关
系统 SHALL 将“大模型规划，小模型执行”作为用户可配置功能提供。用户启用该功能时，系统 MUST 使用 Settings 中选择的 executor profile 作为小模型执行器。

#### Scenario: 用户打开开关并选择小模型
- **WHEN** 用户在 Settings 中启用“大模型规划，小模型执行”
- **AND** 用户选择一个已启用、非主模型、具备 chat 或 orchestration 能力的 executor profile
- **THEN** 系统 SHALL 保存启用状态和 `executorProfileId`
- **AND** 下一轮请求 SHALL 使用该 profile 作为 executor

#### Scenario: 禁用开关保持现有行为
- **WHEN** 该功能被禁用且用户发送常规 chat 请求
- **THEN** 运行时 SHALL 使用现有单一主模型编排行为
- **AND** 它 SHALL NOT 发起 planner/executor 角色拆分

#### Scenario: 开启但未选择小模型
- **WHEN** 该功能已启用但 `executorProfileId` 为空
- **THEN** 运行时 SHALL 返回模型路由配置错误
- **AND** 它 SHALL NOT 自动选择其他 profile
- **AND** 它 SHALL NOT 静默使用主模型作为 executor

### Requirement: 显式 executor profile 解析
系统 SHALL 只根据 `settings.executorProfileId` 解析 executor。系统 MUST NOT 根据模型名称、成本、大小、provider 或候选排序自动决定哪个 profile 是小模型。

#### Scenario: 使用设置中的 executor
- **WHEN** `executorProfileId` 指向一个可用 profile
- **THEN** 运行时 SHALL 将该 profile 转换为 executor runtime config
- **AND** routing metadata SHALL 记录选择原因为 `configured_executor_profile`

#### Scenario: 选择了主模型
- **WHEN** `executorProfileId` 指向当前主模型 profile
- **THEN** 运行时 SHALL 返回配置错误
- **AND** 它 SHALL 要求 executor 与主模型不同

#### Scenario: 选择的 executor 不可用
- **WHEN** `executorProfileId` 指向不存在、禁用、缺少模型 ID、缺少连接凭据或缺少 chat/orchestration 能力的 profile
- **THEN** 运行时 SHALL 返回配置错误
- **AND** 它 SHALL NOT 自动改用其他候选 profile

#### Scenario: Specialist 调用不被 executor 替代
- **WHEN** 运行时需要按 `vision`、`image_generation`、`speech_to_text`、`embedding` 或其他 specialist capability 解析模型
- **THEN** 系统 SHALL 继续使用 capability-based specialist 解析
- **AND** 它 SHALL NOT 仅因为 planner/executor 功能启用就用 executor profile 替代 specialist profile

### Requirement: 自适应迭代控制回路
系统 SHALL 使用控制器根据任务复杂度、风险、工具需求、上下文压力和阶段性执行结果动态选择执行路径，而不是固定执行“规划 -> 执行 -> 验证”流水线。控制器 MUST 支持主模型规划/统筹与配置 executor 分析/执行之间的多轮交替。

#### Scenario: 简单低风险任务快速执行
- **WHEN** 功能已启用，且用户请求被判定为简单、低风险、不需要多步工具执行
- **THEN** 控制器 SHALL 跳过 planner brief
- **AND** 它 MAY 使用配置 executor 直接生成回复
- **AND** 它 SHALL NOT 默认调用主模型 verifier

#### Scenario: 需要显式交接锚点时物化 brief
- **WHEN** 控制器判断 executor 虽有正常上下文但仍可能遗漏关键约束、停止条件、非目标或策略选择
- **THEN** 控制器 SHALL 在 executor 开始相关工作前调用主模型生成结构化 execution brief
- **AND** executor SHALL 同时接收正常上下文和该 brief 作为本轮执行约束

#### Scenario: 阶段性数据回传后再规划
- **WHEN** executor 完成一批数据分析、工具执行、文件检查、浏览器操作或局部草稿，并且结果可能改变后续策略
- **THEN** 控制器 SHALL 能够把阶段性证据交回主模型进行再规划或统筹
- **AND** 主模型 MAY 改写下一阶段 brief、调整风险等级、要求继续 executor 执行、触发 verifier 或接管本轮

#### Scenario: 高风险任务主模型接管
- **WHEN** 请求涉及高风险操作、生产环境、破坏性文件行为、权限/密钥/依赖变更，或用户明确要求高可靠
- **THEN** 控制器 SHALL 选择主模型验证或主模型接管路径
- **AND** 它 SHALL NOT 仅为了节省成本而强制使用 executor 完成关键判断

### Requirement: 结构化 execution brief
系统 SHALL 在需要显式交接锚点时让 planner 生成结构化 execution brief，以补充 executor 已有上下文、约束执行边界、定义阶段性回传要求并提供可验证成功标准。

#### Scenario: Brief 包含执行合约字段
- **WHEN** 控制器决定需要 planner brief
- **THEN** planner 输出 SHALL 包含目标、范围、非目标、约束、步骤、允许工具、成功标准、阶段性回传要求和升级规则
- **AND** brief SHALL 保持紧凑，适合注入 executor 上下文

#### Scenario: Executor 可直接使用已有上下文
- **WHEN** executor 已具备完成任务所需的用户请求、历史、工具说明、附件、记忆和知识上下文，且控制器未发现显式交接风险
- **THEN** 控制器 MAY 跳过 planner brief
- **AND** executor SHALL 基于已有上下文执行

#### Scenario: 工具证据优先于过期 brief
- **WHEN** executor 在执行中发现工具结果、当前用户请求或运行时状态与 planner brief 冲突
- **THEN** executor SHALL 将工具结果、当前用户请求和运行时状态视为权威事实
- **AND** 它 SHALL 触发检查或升级，而不是继续遵循已过期的 brief

### Requirement: Executor 证据和不确定性信号
系统 SHALL 要求 executor 结果提供可验证信号和阶段性数据分析，使控制器可以判断是否定稿、继续执行、再规划、验证、重试或升级。

#### Scenario: Executor 结果包含证据摘要
- **WHEN** executor 完成需要工具、文件、浏览器或外部状态的任务
- **THEN** executor 结果 metadata SHALL 包含关键工具证据、执行状态或未完成阻塞的摘要
- **AND** 最终用户回答 MAY 只展示简洁结果

#### Scenario: Executor 请求再规划
- **WHEN** executor 已完成阶段性数据分析，但新的数据使原策略不再充分、范围需要调整或下一步不明确
- **THEN** 控制器 SHALL 能够调用主模型基于阶段性结果继续规划
- **AND** 它 SHALL NOT 要求 executor 在不确定策略下继续独立推进

#### Scenario: Executor 不得臆造工具结果
- **WHEN** 没有工具结果、测试输出、浏览器状态或文件证据证明某项动作已经发生
- **THEN** executor SHALL NOT 把该动作描述为已完成
- **AND** 控制器 SHALL 将 unsupported assertion 视为质量风险

### Requirement: 分层验证和升级
系统 SHALL 对 executor 输出执行分层验证。验证 MUST 优先使用确定性检查，并在风险、失败或不确定性达到阈值时升级到主模型。

#### Scenario: 确定性检查通过
- **WHEN** executor 完成任务，且没有工具错误、context overflow、circuit breaker、必要证据缺失、低置信度或高风险标记
- **THEN** 控制器 SHALL 直接定稿 executor 结果
- **AND** 它 SHALL NOT 为该低风险结果调用主模型 verifier

#### Scenario: 确定性检查触发主模型验证
- **WHEN** executor 结果包含失败工具调用、重复失败、context overflow、circuit breaker、未解决 TODO、必要证据缺失、unsupported assertion 或需要策略重评估的阶段性数据
- **THEN** 控制器 SHALL 调用主模型 verifier 审查、修复或接管
- **AND** 它 SHALL 记录触发验证的检查项

### Requirement: 面向用户降噪的路由可观测性
系统 SHALL 记录 planner/executor 控制回路的关键 trace，同时面向普通用户展示简洁状态，且 SHALL NOT 暴露密钥或隐藏 prompt。

#### Scenario: 用户看到轻量状态
- **WHEN** 控制回路正在运行
- **THEN** UI MAY 展示“正在分析”、“正在执行”、“正在检查”或“已升级”等轻量状态
- **AND** UI SHALL NOT 要求用户理解 planner、executor、verifier 参数

#### Scenario: 诊断 trace 默认折叠
- **WHEN** 路由运行完成且 metadata 可用
- **THEN** UI SHALL 能够展示默认折叠的诊断 trace
- **AND** trace SHALL 包含 route class、execution mode、循环轮次、角色序列、profile/model 名称、选择原因、再规划原因、升级原因和 token 用量（若可用）

#### Scenario: Trace 不泄露敏感信息
- **WHEN** 系统写入日志、SSE done payload 或持久化消息 metadata
- **THEN** trace SHALL 省略 API key、authorization header、隐藏 prompt 和敏感上下文原文
- **AND** 它 SHALL 只记录诊断所需的摘要化路由信息

