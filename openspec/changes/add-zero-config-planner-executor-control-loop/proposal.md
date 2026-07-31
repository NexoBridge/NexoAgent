## Why

当前“大模型规划，小模型执行”不能由系统自行猜测小模型。小模型是谁，应该来自 Settings 中用户明确选择的 executor profile；否则隐藏的旧配置或自动候选排序会导致执行阶段仍落到 Claude、DeepSeek Pro、GPT 等大模型上，用户看到的行为就会和功能名称不一致。

同时，该能力不是简单线性流程。真实任务会在“大模型规划/统筹”和“小模型分析数据/执行”之间多轮交替：小模型拿到完整上下文和阶段约束后执行，产生工具证据或阶段性结果；大模型再基于这些结果继续规划、校准风险、决定继续执行、验证或接管。

## What Changes

- Settings 保留“大模型规划，小模型执行”开关，并恢复“小模型执行器”选择项。
- 运行时 SHALL 只使用 `settings.executorProfileId` 指定的 executor profile，不再自动猜测、排序或选择其他“小模型”。
- 当开关开启但未选择 executor、选择了主模型、profile 不存在、被禁用或缺少 chat/orchestration 能力时，运行时 SHALL 返回配置错误，不得静默回退到主模型伪装成“小模型执行”。
- 复杂任务继续支持迭代控制回路：主模型生成/更新 brief，小模型分析数据并执行，主模型根据阶段证据再规划、验证或接管。
- 路由 metadata SHALL 记录 planner/executor/verifier 使用的 profile、model、执行模式、循环轮次、再规划原因、升级原因和验证结果。

## Impact

- `src/components/Settings/index.tsx`：恢复 executor profile 下拉选择，只列出已启用、非主模型、具备 chat/orchestration 能力的 profile。
- `electron/server/model-runtime.ts`：移除运行时自动 executor 解析路径，改为严格读取 `settings.executorProfileId`。
- `electron/server/agent.ts`：routing trace 使用 `configured_executor_profile` 语义，不再展示 auto executor 口径。
- `scripts/verify-configured-executor-resolution.mjs`：验证“按设置使用 executor、不选不回退”的行为。
- OpenSpec `model-orchestration`：同步从零配置自动选择改为“配置指定小模型 + 迭代控制回路”。

## Non-Goals

- 不自动判断哪个 profile 更“小”或更便宜。
- 不在本变更中新增高级阈值、成本权重或 provider 专用路由规则。
- 不移除高风险场景下主模型验证/接管能力。
