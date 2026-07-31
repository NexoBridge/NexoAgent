## 1. Settings Contract

- [x] 1.1 在共享 `AgentSettings` 类型、默认值、规范化逻辑、desktop settings、web settings 与持久化 settings 加载中新增 planner/executor 路由设置。
- [x] 1.2 新增路由开关与 executor profile 引用字段；planner 与 verifier 固定使用当前主模型。
- [x] 1.3 结果检查策略与质量分数阈值使用内部默认值，不暴露为设置项。

## 2. Role Resolution

- [x] 2.1 新增 model-runtime 辅助函数，使用主模型解析 planner/verifier，并从已保存 profile ID 解析 executor 的 `ModelRuntimeConfig`。
- [x] 2.2 校验每个已解析角色的 enabled 状态、chat/orchestration capability、provider 连接、API key 可用性、thinking 设置与 context budget。
- [x] 2.3 启用路由但无法解析必要角色时，返回清晰的前置条件错误。

## 3. Local Router

- [x] 3.1 创建确定性本地路由分类器，覆盖 simple、medium、complex、reasoning、agentic 请求，且不发起额外 AI 调用。
- [x] 3.2 纳入 prompt 长度、附件、工具倾向动作、代码/变更意图、多步语言、验证请求、风险词与 `planningMode` 等启发式规则。
- [x] 3.3 为典型的 simple、medium、complex、reasoning、agentic 路由决策添加单元测试或验证 fixture。

## 4. Planner Brief

- [x] 4.1 新增非流式 planner 调用，为 complex、reasoning、agentic 路由运行生成紧凑 execution brief。
- [x] 4.2 将 planner brief 注入 executor 上下文，但不替换 current-session、memory、knowledge、attachment、browser 或 tool 指引。
- [x] 4.3 单独跟踪 planner 用量与 planner 调用失败，区别于 executor 流式用量。

## 5. Executor Agent Loop

- [x] 5.1 启用路由且无需 planner 指引时，将 simple 与 medium 请求直接路由到 executor。
- [x] 5.2 将 complex 执行、工具调用轮次、最终草稿生成与常规 chat 子任务路由到 executor profile。
- [x] 5.3 每次模型调用按活跃角色模型计算 prompt budget、context overflow 检查、retry 设置、thinking 选项与 prompt-cache 选项。
- [x] 5.4 确保 `invoke_model` specialist 调用仍按 capability 解析，除非该 profile 本身是确定性 specialist 匹配，否则不被 planner/executor 角色替换。

## 6. Quality Gate And Fallback

- [x] 6.1 实现确定性质量检查：工具错误、缺失必要证据、显式不确定性、circuit-breaker 停止、context overflow、重复失败与默认分数阈值。
- [x] 6.2 新增主模型检查路径，可批准、修复或解释未解决的 executor 输出。
- [x] 6.3 验证失败或无法修复时，保留最佳可用 executor 结果，并附明确的未解决状态说明。

## 7. UI And Observability

- [x] 7.1 在 Settings UI 中新增启用 planner/executor 路由的控件，以及从已保存 model profile 中选择小模型 executor 的选项。
- [x] 7.2 当选中 executor profile 被禁用、缺少凭证或不适合 chat/orchestration 时，展示校验提示。
- [x] 7.3 将路由元数据写入 server 日志、SSE done payload、持久化消息元数据与可选 UI 诊断，且不暴露 API key 或隐藏 prompt。
- [x] 7.4 在有路由元数据时展示 route class、角色序列、profile/model 名称、升级原因与 token 用量。

## 8. Dependency Evaluation

- [x] 8.1 评估 `llm-switchboard`、`@cascadeflow/langchain` 与 `@langchain/openrouter` 与本仓库 TypeScript、Electron、LangChain、流式、tool-call、重试与 provider-profile 约束的兼容性。
- [x] 8.2 仅采用能简化实现且不打弱 provider 无关 profile 路由的依赖；否则保留本地 router 与现有 OpenAI 兼容 OpenRouter 路径。

## 9. Verification

- [x] 9.1 验证禁用路由时保留当前单一主模型行为。
- [x] 9.2 验证启用路由时，simple/medium 请求仅使用 executor 行为。
- [x] 9.3 验证启用路由时，complex/agentic 请求使用 planner brief + executor 工具循环。
- [x] 9.4 验证 executor 质量失败会升级至主模型检查，并记录升级原因。
- [x] 9.5 验证缺失或禁用的角色 profile 会以清晰前置条件错误失败，且不会静默将所有工作跑在 planner 上。
- [x] 9.6 验证 OpenRouter profile 可通过现有 OpenAI 兼容 provider 路径工作。
- [x] 9.7 运行 `npm run typecheck` 以及为路由行为新增的任何针对性验证脚本。
