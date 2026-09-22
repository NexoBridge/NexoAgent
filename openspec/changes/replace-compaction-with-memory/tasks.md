## 1. 窗口归一化

- [x] 1.1 在设置读取、档案保存和 `computePromptBudget` 中，把 `contextWindowTokens` 归一为 `256000` 或 `500000`；其他值回退到 `256000`。
- [x] 1.2 决定实时提示上限时，不再使用 `autoCompactTokenLimit`、`compactionTargetRatio` 和 `enableContextCompaction`。

## 2. 用归档代替压缩

- [x] 2.1 在会话上增加 `archivedMessageCount`，并用 `storeMemory("daily", ...)` 的原文分块替换 `buildBudgetAwareConversationContext` 里的摘要循环。
- [x] 2.2 每块写入元数据 `source: "context_window_archive"`、`sessionId` 和消息下标区间；只有存储成功后才推进游标。
- [x] 2.3 已归档消息仍留在会话里供界面使用，但从模型提示中去掉，且不再注入 `threadSummary`。
- [x] 2.4 归档后若最新用户消息仍超过所选窗口，返回 `context_overflow`，不截断、不压缩。
- [x] 2.5 归档写入失败时不推进游标，也不发送超窗提示。

## 3. 召回与旧摘要

- [x] 3.1 归档后的 daily 行仍进入现有 `recallMemory` 提示注入，但不把整段归档原文拼回提示。
- [x] 3.2 `consolidateDreamForDay` 的输入排除 `source: "context_window_archive"` 的行。
- [x] 3.3 下次组装提示时，把已有 `threadSummary` 以 `legacyThreadSummary: true` 存一次，然后从提示路径清除。
- [x] 3.4 归档必须先写入本地持久记忆；重启或新会话后仍可按查询召回，不能只留在当前会话内存里。

## 4. 设置与溢出文案

- [x] 4.1 用 256K / 500K 上下文窗口选择替换自动压缩开关和压缩上限展示。
- [x] 4.2 溢出响应改为说明当前内容超过所选窗口，不再要求用户压缩对话。

## 5. 验证

- [x] 5.1 验证未超过所选窗口的提示会直接发送，且不写归档记忆。
- [x] 5.2 验证超过 256000 或 500000 时会归档更早轮次、从下一次模型请求中去掉，并且之后匹配的轮次能召回。
- [x] 5.3 验证仅最新用户消息就超过窗口时返回 `context_overflow`，且不会把该消息归档成残缺摘录。
- [x] 5.4 验证重启或新会话仍能按查询召回先前归档的内容。
