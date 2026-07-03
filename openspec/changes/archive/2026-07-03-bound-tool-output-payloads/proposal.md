## Why

现在 `browser_action.action="script"` 可以直接通过 CDP、页面上下文或 Electron 运行时拿到大量数据，例如完整 history、网络日志、请求/响应 body、DOM 状态或调试对象。问题是这些原始结果目前容易被当作普通 tool result 直接回传：

- SSE 会把大 JSON 推到前端，导致 UI 卡顿、详情面板渲染慢或浏览器内存暴涨。
- assistant 下一轮上下文可能保留完整 tool 输出，模型需要重新吞掉大量低价值原始数据，容易超 token、超时、断流，或者把注意力耗在日志噪声上。
- 捕获类数据已经适合进入 `scriptCache`，但普通脚本返回值、超大 tool 输出和 UI 展示还缺少统一的“摘要 + 引用 + 懒加载原文”机制。

所以需要把工具输出改成双通道：给模型和默认 UI 的是安全、有预算的摘要；完整原始数据放入可清理的本地 artifact 或短期缓存，只有用户展开、下载、后续脚本读取或需要长期沉淀时才取出。

## What Changes

- 为所有内置工具输出增加统一的大小/Token 预算守卫，特别覆盖 `browser_action` 和 `action="script"`。
- 当工具输出超过阈值时，运行时不再把完整原始输出内联进模型上下文和默认消息块，而是生成：
  - `summary`: 给 AI 推理使用的紧凑摘要。
  - `preview`: 给 UI 默认展示的短预览。
  - `rawRef` / `artifact`: 指向完整原始输出的本地引用。
  - `stats`: 原始字节数、截断原因、条目数等诊断信息。
- 对 `browser_action.action="script"` 增加输出策略：捕获类结果优先写入 `scriptCache`，非捕获但超大的返回值写入临时 tool artifact，并只把摘要和引用返回给模型。
- 前端工具详情默认显示摘要和预览；用户展开“原始输出”时按引用懒加载完整数据，而不是在消息流里一次性塞完整 JSON。
- Agent prompt 和压缩摘要规则应明确：引用类 tool output 不能被说成完整原文已经在上下文里；需要查看原文时必须再次读取引用或让脚本从 cache/artifact 取数。

## Capabilities

### Modified Capabilities

- `token-aware-context-management`: 强化大 tool output 的预算约束，从“截断文本”升级为“摘要 + 引用 + 按需加载原始输出”。
- `browser-script-runtime`: 为 `action="script"` 增加大返回值输出策略，避免脚本把完整抓包/日志直接撑爆模型上下文。
- `model-orchestration`: 要求编排器优先基于摘要、缓存 key 和 artifact 引用继续工作；只有确实需要原始数据时才读取完整输出。

## Impact

- `electron/server/agent.ts`: 在 tool result 进入 `lcMessages`、SSE、message blocks 和 compaction 前统一归一化大输出。
- `electron/server/browser-manager.ts`: 对脚本返回值提供摘要/缓存/artifact 交接策略，和 `scriptCache` 边界保持一致。
- `electron/server/tools/*`: 工具执行层增加输出包装结构，支持 `rawRef`、`summary`、`preview`、`stats`。
- `electron/server/routes/*`: 增加按引用读取 raw tool output 的路由，或复用现有 artifact 路由。
- `src/components/ChatPanel/ToolCallSteps.tsx`: 工具详情默认展示摘要，原始输出改为懒加载。
- `src/shared/types.ts`: 增加大工具输出引用、摘要和统计字段类型。
- `nexo/tools.json`: 更新工具说明，提示脚本避免直接返回超大对象，优先使用 `scriptCache` 或输出引用。

## Non-Goals

- 不让模型自动读取所有原始大输出；默认上下文必须保持紧凑。
- 不把临时 raw tool output 变成长期记忆。
- 不替代 `scriptCache`；短期抓包样本仍优先进入 `scriptCache`。
- 不要求 UI 永远隐藏原始数据；用户需要排查时仍可展开或下载完整原文。
