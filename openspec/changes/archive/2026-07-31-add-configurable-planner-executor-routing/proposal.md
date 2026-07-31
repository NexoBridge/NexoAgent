## Why

Nexo Agent 目前将常规 Agent 运行路由到主编排模型，这可能导致每一步都使用最强模型，即使只有规划阶段才需要该级别的推理能力。用户需要一种可选的成本控制模式：让更强的模型负责规划与验证，更便宜的模型负责常规执行，同时保留现有的单一主模型行为。

## What Changes

- 新增由设置控制的 planner/executor 路由模式，可在运行时配置中启用或禁用。
- 允许用户从现有模型配置中选择一个小模型作为 execution profile；planning 与 verification 固定使用当前主模型。
- 将 Agent 轮次与内部模型调用分类为 planning、execution 或 verification 工作，使运行时能确定性地选择合适 profile。
- 为执行结果增加质量检查：复杂、不确定或失败的低成本执行，在最终答案定稿前默认交给主模型检查。
- 在日志与运行时结果中暴露路由元数据，使用户能看到 planning、execution、verification 分别由哪个 profile 处理。
- 通过现有 OpenAI 兼容 provider/profile 路径继续支持 OpenRouter，无需单独搭建 provider 栈。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `model-orchestration`：新增可选 planner/executor 路由、执行结果检查、质量升级与路由可观测性需求。

## Impact

- `src/shared/types.ts` 与共享设置默认值：新增持久化路由开关与 executor profile 引用。
- `electron/server/settings.ts`、`electron/main.ts` 与 settings 路由：规范化并持久化新路由选项。
- `src/components/Settings/index.tsx`：暴露启用开关、小模型选择器及 planner/executor 模式状态提示。
- `electron/server/model-runtime.ts` 与 `electron/server/model-profiles.ts`：使用主模型解析 planner/verifier，从现有 profile 数据解析 executor 运行时配置。
- `electron/server/agent.ts`：将初始规划、工具调用轮次、摘要/压缩、最终回复及验证/升级路由到所选模型角色。
- `electron/server/tools/model-call.ts`：确保 specialist 调用仍按 capability 解析，启用 executor 路由时不会误用 planner 处理常规 chat 子任务。
- `electron/server/logger.ts`、SSE done payload 与消息元数据：记录路由决策与用量，便于诊断与成本审查。
- `package.json`：评估是否需要轻量本地分类器或外部路由辅助库；优先沿用当前 LangChain/OpenAI 兼容栈，除非某依赖能明确降低实现复杂度。
