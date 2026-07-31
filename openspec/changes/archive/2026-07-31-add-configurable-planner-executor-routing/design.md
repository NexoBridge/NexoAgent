## Context

Nexo Agent 已具备模型 profile、单一主编排器、基于 capability 的 specialist 解析、OpenAI 兼容 provider、Anthropic 兼容 provider、OpenRouter 作为 service-provider 预设、LangChain chat model 包装、prompt 预算、重试、SSE 流式传输与运行时日志。常规 chat 运行目前解析一个主模型，并将其用于编排、工具调用轮次、压缩摘要、最终回复与记忆提取，除非工具显式调用 specialist capability。

本次变更新增一条成本控制路径：用当前主模型做规划与验证，用用户选择的小模型做常规执行。该能力必须是可选的，因为部分用户偏好现有单模型行为，且 executor 配置不完整时不应静默产生低质量路由。

## Goals / Non-Goals

**Goals:**

- 禁用 planner/executor 路由时，保留现有单一主模型行为。
- 新增设置开关，为 Agent 运行启用 planner/executor 路由。
- 使用当前主模型作为 planner/verifier，并从现有 model profile 解析 executor，而非硬编码 GPT、Claude 或 OpenRouter 模型 ID。
- 使用本地确定性分类器做路由决策，避免分类本身增加模型调用成本。
- 对复杂或 agentic 请求，在 executor 开始工具工作前由 planner 生成执行简报。
- 当质量检查、工具错误或运行时不确定性表明需要更高推理能力时，将 executor 输出交给主模型检查。
- 记录路由决策与模型用量，便于用户检查成本控制路由是否实际生效。

**Non-Goals:**

- 不移除 vision、image、speech、embedding 等 specialist 的 capability 路由。
- 不要求所有用户配置 OpenRouter；现有 OpenAI 兼容与 Anthropic 兼容 profile 仍然有效。
- 除非单独配置定价元数据或由 provider 提供，否则不保证精确的美元成本核算。
- 不在本提案阶段用新框架替换整个 Agent 循环。
- 不只因架构草图出现就添加未经验证的依赖。

## Decisions

### 模型角色放在 Settings，而非新增 Provider 类型

新增 planner/executor 路由的持久化设置：启用标志与 executor profile ID。planner 与 verifier 始终使用当前主模型。启用路由时，executor 必须解析为已启用的、具备 chat 能力的 profile。

**备选方案：** 在 `MODEL_CAPABILITIES` 中引入新的 `planner` 与 `executor` capability。这会把 specialist capability 与运行时角色混为一谈，并要求 profile 编辑器、发现结果与确定性 capability 排序器都理解角色语义。Settings 级角色引用可将角色策略与模型能力分离。

### 在模型调用前使用本地 Router

在 server runtime 中实现小型本地路由分类模块。应基于 prompt 长度、附件存在、工具倾向动词、代码/变更意图、多步表述、风险词、验证请求以及当前 `planningMode`，将用户轮次分类为 simple、medium、complex、reasoning 与 agentic/tool-use。

**备选方案：** 调用 LLM 分类每个请求。这会给每一轮增加成本与延迟，与本变更初衷冲突。

### Planner 为复杂运行生成 Execution Brief

启用路由且路由为 complex、reasoning 或 agentic 时，planner 应发起一次非流式、无工具调用，生成紧凑 execution brief：目标、约束、可能工具、停止条件与验证标准。executor 在 system/developer 上下文中接收该 brief，并运行现有流式工具循环。

**备选方案：** 让 planner 持有全部工具调用，仅通过 `invoke_model` 将单个 prompt 委派给 executor。这会让昂贵模型参与每一步，无法满足成本控制目标。

### Executor 负责常规执行

启用路由时，simple 与 medium chat 请求可由 executor 直接回答。复杂运行中，executor 在 planner brief 下执行工具调用轮次、浏览器操作、shell 工作与草稿回复生成。选择 execution 角色后，executor 使用自身 context budget 组装 prompt。

**备选方案：** 即使简单任务也始终先调用 planner。这更可预测，但会在 executor 能处理的工作上浪费 planner。

### 验证是有条件的

质量检查应首先确定性执行：检查 executor 结果是否包含工具错误、未解决 TODO 标记、缺失必要证据、circuit-breaker 停止、context overflow、重复失败，或 executor 提供的显式低自检分数。若质量分数低于默认阈值，则调用主模型修订或批准最终答案。

**备选方案：** 每次 executor 结果后都运行主模型检查。质量最高，但节省效果差，开关价值降低。

### 外部路由辅助库保持可选

实现阶段在本地 adapter 接口后评估 `llm-switchboard` 与 `@cascadeflow/langchain`。仅当它们与当前 TypeScript、ESM/CommonJS、Electron、LangChain、流式、tool-call、重试与 provider-profile 约束干净匹配时才采用。若不能干净集成，则直接实现本地 router 与质量检查。

**备选方案：** 立即添加 `@langchain/openrouter`。仓库已通过 OpenAI 兼容 provider 预设与现有 LangChain/OpenAI 配置支持 OpenRouter，除非需要 provider 特有行为，否则不必额外引入 OpenRouter 包。

### 可观测但不泄露密钥

路由元数据应包含 role、route class、profile 名称、model ID、升级原因与 usage token。不得包含 API key、原始 provider 鉴权头或隐藏 prompt 内容。SSE done 事件与持久化消息元数据可包含摘要化路由 trace 供 UI 展示，server 日志可包含结构化路由诊断。

## Risks / Trade-offs

- **误分类** 可能让困难任务先走 executor。**缓解：** 加入 agentic/风险启发式，尊重 `planningMode`，质量检查失败时交给主模型检查。
- **Planner brief 过时**：工具结果改变局面后 brief 可能失效。**缓解：** 允许 executor 在工具证据与 brief 矛盾时请求验证。
- **不同 context window**：主模型与 executor 窗口差异可能导致某一角色 overflow。**缓解：** 每次模型调用前按活跃角色配置计算 budget。
- **多模型调用增加延迟**（复杂任务）。**缓解：** simple/medium 路由跳过 planner 与 verifier，brief 保持紧凑。
- **外部路由库** 可能不支持当前 Electron/LangChain/tool streaming 路径。**缓解：** 依赖采用保持可选并放在 adapter 后；必要时先交付本地实现。

## Migration Plan

- 新路由开关默认禁用，现有用户与已保存设置行为完全不变。
- settings 加载时只规范化路由开关与 executor profile ID。
- 启用路由但缺少 executor profile 或 profile 已禁用时，以清晰前置条件消息失败运行，而非静默将所有工作路由到主模型。
- 回滚在设置层完成：禁用开关即恢复现有主模型路径。

## Open Questions

- 首版 UI 是否暴露数值型质量阈值，还是在高级设置中保留保守默认值。
- 路由元数据是展示在每条 assistant 消息中，还是仅在日志/settings 诊断中展示。
- 是否后续加入 provider 特有 token 价格表以估算美元节省。
