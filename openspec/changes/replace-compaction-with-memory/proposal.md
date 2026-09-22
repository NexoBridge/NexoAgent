## Why

长对话现在靠滚动压缩摘要腾出上下文。压缩会丢掉原文，之后模型只能看见摘要，不能在需要时再取回被压掉的内容。上下文窗口应只提供 256K 与 500K 两档；到达所选窗口后，把超出的历史转成可召回记忆，而不是再走压缩。

## What Changes

- **BREAKING**：停止自动上下文压缩。运行时不再为腾出窗口生成或注入滚动会话摘要。
- 上下文窗口只允许设置为 `256000` 或 `500000` tokens。到达所选窗口后，把放不进窗口的更早对话写入持久记忆，并从当前提示中移出。
- 之后需要这些内容时，通过现有记忆召回按查询取回，而不是把归档原文整段塞回实时窗口。
- 归档必须写入本地持久记忆。重启或新会话之后仍可按查询召回，不能只留在当前会话里。
- 最新一条用户消息本身超过所选窗口时，仍以 `context_overflow` 停止，不把当前请求截断或压缩。
- 已有会话上的压缩摘要不再作为实时上下文注入；一次性转入记忆后清除。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `token-aware-context-management`：用 256K/500K 窗口和溢出转记忆替换自动压缩、滚动摘要，以及“超预算就直接失败而不归档历史”的行为。
- `semantic-memory-retrieval`：被移出窗口的对话成为可召回记忆；后续轮次按需从记忆调用，不再把压缩摘要与持久记忆分开存放。
- `model-orchestration`：档案预算不再驱动压缩；溢出提示不再要求用户手动压缩。

## Impact

- `electron/server/conversation-context.ts`：去掉压缩摘要循环，改为按窗口归档。
- `electron/server/agent.ts`：停止调用压缩模型，归档后走记忆召回。
- `electron/memory.ts` 与记忆召回：承接归档内容，并在后续轮次按查询召回。
- `electron/server/model-context.ts`、`electron/main.ts`、`src/shared/types.ts`、`src/store/chat.ts`、`src/components/Settings/index.tsx`：窗口设置收敛为 256K 与 500K。
- 现有压缩阈值、压缩目标比例和滚动 `threadSummary` 不再参与实时提示。
