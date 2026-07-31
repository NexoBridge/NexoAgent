## Context

用户明确要求：小模型不是系统自动决定的，而是在 Settings 中选择哪个 profile 作为“小模型执行器”。因此控制回路可以自动判断任务路径，但 executor profile 的身份必须来自用户配置。

## Decisions

### Configured Executor Only

运行时不再调用自动候选选择作为 planner/executor 的 executor 来源。开关开启后：

- `planner` 使用主模型。
- `verifier` 默认使用主模型。
- `executor` 使用 `settings.executorProfileId` 指定的 profile。
- 未配置或配置不可用时返回 precondition failed，不静默回退到主模型。

这保证“打开该功能后，小模型执行”不是由系统猜测出来的。

### Settings Candidate Filter

Settings 下拉只展示满足执行条件的 profile：

- enabled 为 true。
- 不是 primary。
- capabilities 包含 `chat` 或 `orchestration`。

用户仍可把任何模型 profile 命名为“小模型”，但它必须具备文本执行能力。

### Iterative Control Loop

控制回路仍然不是线性的“planner -> executor -> output”。复杂任务可以多轮交替：

1. 主模型根据上下文和任务风险生成 brief。
2. 设置中选中的 executor 基于完整上下文和 brief 执行。
3. executor 回传阶段性工具证据、数据摘要和不确定性。
4. 主模型基于新证据再规划、验证或接管。
5. executor 按新指令继续执行，直到完成或触发停止条件。

### Error Policy

配置错误应该显式暴露，因为它表示用户打开了该功能但没有指定可执行小模型。自动用主模型兜底会掩盖问题，并造成“全是大模型”的体验。

## Risks

- 用户没有可选 executor profile 时会看到配置错误。
  缓解：Settings 下拉明确显示无可用执行模型，用户需要启用或创建具备 chat/orchestration 能力的 profile。
- 用户选择了实际成本较高的模型作为 executor。
  缓解：这是显式设置结果，系统不再替用户判断模型大小或成本。
