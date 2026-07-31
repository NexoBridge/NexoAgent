## ADDED Requirements

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
