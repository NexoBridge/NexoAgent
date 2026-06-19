## Why

当前记忆系统已经能保存长期记忆、脚本记忆和 embedding，但记忆缺少按自然日组织的时间边界，也没有周期性整理机制来帮助代理从一整天的上下文里形成更高质量的回忆。现在需要把记忆改造成以天为核心的管理系统，用 Chroma 做语义向量检索，并增加「梦境」整理层，让快速检索和长期沉淀可以一起工作。

## What Changes

- 引入基于自然日的记忆组织方式，使用规范的 `day_key`（例如 `20260616`），所有面向用户和检索的记忆都挂载到某一天。
- 增加梦境记忆系统，周期性汇总、关联并整合每日记忆，形成可供助手使用的梦境记录。
- 结构化记忆（内容、元数据、生命周期）仍由 SQLite 管理；**向量 embedding 与语义检索改由本地 Chroma 持久化**，不再使用 SQLite `memory_embeddings` 表。
- 支持基于 Chroma 的跨记忆类型语义检索；当 embedding 生成或 Chroma 不可用时，回退到 SQLite 关键词/最近记忆排序。
- 通过记忆 API 与 recall 路径暴露按日与梦境的上下文，供对话、工具执行和记忆 UI 使用新存储模型。

## 能力（Capabilities）

### 新增能力

- `daily-memory-ledger`：定义记忆如何按规范 `day_key` 分组、存储、列出与检索。
- `dream-memory-consolidation`：定义如何将每日记忆转化为梦境记录，用于汇总、关联并辅助后续回忆。
- `semantic-memory-retrieval`：定义 Chroma 向量库如何与 SQLite 记忆联动，实现 embedding 持久化与快速语义查找。

### 修改的能力

- 无。

## 影响（Impact）

- 受影响代码：`electron/memory.ts`（或拆分为 `memory/` + `memory/chroma.ts`）、`electron/server/routes/memory.ts`、`electron/server/agent.ts`、`electron/server/tools/executors.ts`、`src/components/Memory/index.tsx`。
- 依赖影响：新增 `chromadb`（及 `@langchain/community` 的 Chroma 集成）；移除 `memory_embeddings` 相关 SQLite 逻辑。
- 数据影响：SQLite 仅保留 `memories` 表（含 `day_key`、四类 kind）；向量数据存放于 `.nexo-data/chroma/`。**不迁移、不保留旧版记忆与 embedding 数据**。
- API 影响：记忆列表/搜索接口按新契约实现，支持 `day_key`、记忆类型与语义查询；旧版 API 行为不再保证。
- 运行时影响：embedding 生成依赖已配置的 OpenAI 兼容 API 凭证；Chroma 或 embedding 不可用时优雅降级为 SQLite 关键词/最近记忆检索。
