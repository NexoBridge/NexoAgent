## ADDED Requirements

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
