## 背景

动机见 proposal.md。实时提示在 `electron/server/conversation-context.ts` 组装。`enableContextCompaction` 打开且估算 token 达到 `autoCompactTokenLimit` 时，更早的对话会送给摘要模型，并写成 `session.threadSummary`。`electron/server/token-budget.ts` 的 `computePromptBudget` 用模型字典、档案字段、预留输出和压缩比例算出这个阈值。持久召回已经存在：`electron/memory.ts` 的 `storeMemory` / `recallMemory`，种类为 `daily`、`dream`、`long_term`、`script`。Agent 会在模型调用前注入召回结果。

## 目标 / 非目标

**目标：**

- 实时提示窗口只允许 256000 和 500000。
- 估算提示 token 到达所选窗口时，把更早的对话存成可召回记忆，并从下一次模型请求中拿掉。
- 归档必须写入本地持久记忆。重启或新会话之后仍可按查询召回，不能只留在当前会话里。
- 会话里的聊天记录继续可见；只有模型提示去掉已归档轮次。

**非目标：**

- 不新增 SQLite 记忆种类。当前不兼容的库会重建并丢掉已有记忆。
- 不把梦境整理变成归档原文的第二套压缩。
- 不为了塞进窗口而截断工具输出或最新一条用户消息。
- 不删除模型上下文字典；它只是不再决定实时窗口。

## 决策

### 所选窗口就是提示上限

读取设置、保存档案、计算预算时，把 `contextWindowTokens` 归一成 `256000` 或 `500000`。其他已存值回退到 `256000`。归档触发点就是估算提示 token 到达这个值。`autoCompactTokenLimit`、`compactionTargetRatio`、`enableContextCompaction` 不再参与提示组装。

备选：保留模型字典窗口，只换掉摘要器。不采用，因为要求的窗口就是这两档，不是按模型计算的压缩阈值。

### 原文分块，再推进游标

模型调用前，估算基础段落加上尚未归档的对话。估算达到或超过所选窗口时，取最老的、尚未归档、并且仍把最新用户消息留在实时提示里的消息，用 `storeMemory("daily", ...)` 存下。

每条都是原文，按可嵌入的长度分组，元数据为：

- `source: "context_window_archive"`
- `sessionId`
- 消息下标区间

`session.archivedMessageCount` 记录已经存下的非系统消息数。之后只归档新溢出的那一段。会话消息仍留在会话里，供界面和召回查询使用。模型消息从游标之后开始，并且不包含 `threadSummary`。

归档写入失败时，不推进游标，也不发送超窗提示。停止并返回归档错误，而不是丢掉历史。

备选：整段溢出写成一条记忆。不采用，因为召回按条目做相似度搜索，一条巨大记录不好检索。备选：只做事实抽取。不采用，因为要转换的是溢出内容本身，不是把它摘要掉。

### 召回走现有 daily 路径

`recallMemory` 已经会搜索 `daily`，所以归档行在后续轮次可以被召回。提示只放入匹配结果，不把整段归档原文拼回去。

### 写入本地持久记忆，下次还能用

`storeMemory` 必须先完成 SQLite 写入（有嵌入凭证时再写入向量），然后才推进 `archivedMessageCount`。这些行不是当前会话的内存缓存。新会话、隔天、进程重启都走同一套 `recallMemory` 搜索。会话游标只用来避免同一段被写两次。

`consolidateDreamForDay` 目前会把当天全部 `daily` 和 `script` 送进摘要模型。元数据 `source` 为 `context_window_archive` 的行要排除，避免梦境整理再压缩这些归档。

### 旧摘要只迁移一次

若 `session.threadSummary` 非空且还没迁移，把它作为一条 daily 记忆存一次，`source` 为 `context_window_archive`，元数据 `legacyThreadSummary: true`，然后从提示路径清掉 `threadSummary` 和 `threadSummaryMessageCount`。不要重新生成。

### 设置界面

用 256K / 500K 窗口选择替换自动压缩开关和压缩上限展示。去掉让用户压缩对话的溢出文案。归档后最新消息仍放不下时，继续返回 `context_overflow`，并说明当前内容超过所选窗口。

## 风险 / 取舍

- [语义召回可能漏掉某条归档细节] → 原文分块并带上会话与下标，之后可以精确查找；默认路径仍是按查询召回。
- [归档量可能挤占 daily 召回] → 分块存放，事实抽取保持不变。梦境整理跳过归档行。
- [所选窗口可能大于供应商真实上限] → 实时上限就是用户选的档位。供应商溢出仍会停止本次运行；这里不另做隐藏压缩来掩盖失败。
- [没有嵌入凭证] → `storeMemory` 仍写 SQLite，召回退回关键词排序，归档内容还可以取回。

## 迁移计划

1. 读取时把已保存的 `contextWindowTokens` 归一成 256000 或 500000。
2. 下次为带 `threadSummary` 的会话组装提示时，存一次并停止注入。
3. 新的溢出使用归档游标。不改数据库结构，也不清空记忆。
4. 回滚就是把提示组装改回压缩。已写入的 daily 行可以留下，它们就是普通记忆。

## 未决问题

无。窗口数值、以归档代替压缩、以及按需召回都已由规格固定。
