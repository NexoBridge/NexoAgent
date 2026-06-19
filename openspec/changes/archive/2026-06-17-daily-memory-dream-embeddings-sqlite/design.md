## 背景（Context）

Nexo Agent 当前通过 `sql.js` 在 `.nexo-data/memory.sqlite` 中存储长期记忆、脚本记忆及 `memory_embeddings` 向量。实现上通过 `@langchain/openai` 生成 embedding，在 `electron/memory.ts` 中对 SQLite 内 JSON 向量做余弦相似度线性扫描。

本次变更将记忆系统改造为以「天」为单位的体系，并**将向量库从 SQLite 切换为 Chroma**：

- **SQLite**：结构化记忆事实来源（`memories` 表：`day_key`、kind、content、metadata、CRUD、按日列表）。
- **Chroma**：本地持久化向量库（`.nexo-data/chroma/`），负责 embedding 存储与语义相似度检索；通过 `memory_id` 与 SQLite 行关联。

**本变更不做向后兼容**：不迁移旧版 SQLite / JSON 记忆数据，不保留旧 schema、`memory_embeddings` 表或旧 API 行为。启动时若检测到不兼容的旧库，直接重建空库并按新 schema 初始化；旧 Chroma 数据（若存在）一并丢弃。

## 目标 / 非目标（Goals / Non-Goals）

**目标：**

- 每条可召回记忆都带有规范的 `day_key`，格式为 `YYYYMMDD`，例如 `20260616`。
- 支持 `daily`、`dream`、`long_term`、`script` 四类记忆。
- SQLite 管理结构化记忆，继续使用 `sql.js`，与现有 Electron 打包方式一致。
- 使用 **Chroma 本地嵌入式模式**（`path: .nexo-data/chroma`）持久化向量，通过 `@langchain/community` 的 `Chroma` 集成做 upsert / delete / similaritySearch。
- Chroma document metadata 携带 `memory_id`、`kind`、`day_key`，以支持 recall 时的类型与日过滤。
- 通过记忆 API 暴露按日与梦境的过滤，并使 recall 在相关时包含梦境上下文。

**非目标：**

- 迁移或保留旧版 `.nexo-data/memory.sqlite`、`memory.json`、`memory_embeddings` 等历史数据。
- 兼容旧版记忆 API 参数或响应形状。
- 继续用 SQLite 存储或扫描 embedding 向量。
- 部署远程 Chroma 服务（首版仅本地嵌入式）。
- 用原生 SQLite 驱动替换 `sql.js`。
- 构建完整的日历产品或时间线分析界面。
- 在未配置模型 API Key 时保证一定能生成梦境。

## 决策（Decisions）

1. 使用规范的 `day_key` 列，而不是在查询时动态推导日期。

   `day_key` 在创建时按用户本地应用日存储为 `YYYYMMDD`。这使过滤、索引与 UI 分组确定可预期。

2. 启动时按新 schema 初始化 SQLite，不兼容则重建。

   `memories` 表直接定义为 `kind IN ('daily', 'dream', 'long_term', 'script')`，并包含 `day_key` 及 `id`、`content`、`session_id`、`key`、`scope`、`metadata`、`created_at`、`updated_at` 等字段。**不再创建 `memory_embeddings` 表**。若现有库结构或版本不匹配，删除旧表/旧文件并创建新库，**不复制旧行**。

3. Chroma 作为唯一向量存储。

   - Collection 名称：`nexo_memories`（固定）。
   - Document id = SQLite `memory_id`（UUID），便于 upsert 与删除对齐。
   - Metadata：`kind`、`day_key`、`updated_at`（及可选 `key`、`scope`）。
   - Document page content = 记忆 `content`（用于 Chroma 自带文本检索回退）。
   - 使用 LangChain `Chroma` + `OpenAIEmbeddings`，`path` 指向 `.nexo-data/chroma`。
   - 备选方案：继续 SQLite JSON 向量线性扫描——数据量增长后性能差，且与「改用 Chroma」目标冲突。

4. 将梦境作为一等记忆行存储。

   梦境记录使用 `kind = 'dream'`、`day_key = <day>`，以及稳定键如 `dream:<day_key>`。写入 SQLite 后同步 upsert 至 Chroma。

5. 在 `electron/memory.ts` 内增加记忆服务层。

   按职责拆分：day key 规范化、SQLite schema 初始化、记忆 CRUD、Chroma 向量同步、梦境整合、混合 recall。移除遗留 JSON 导入、`memory_embeddings` 与旧版迁移逻辑。

6. 混合检索：Chroma 优先，SQLite 回退。

   有 embedding 凭证且 Chroma 可用时，通过 `similaritySearchWithScore`（带 metadata `where` 过滤 `kind` / `day_key`）取 top-k，再按 `memory_id` 回表补全；失败时回退 SQLite 关键词 + 最近时间排序。

7. 择机整合梦境。

   对话记忆抽取写入每日事实后，标记该日为 dirty，并对该 `day_key` 入队防抖的梦境整合。也可通过手动接口为某一天重新生成梦境。

## 风险 / 权衡（Risks / Trade-offs）

- 升级会清空本地历史记忆与向量 → 发布说明中明确告知；用户需自行备份 `.nexo-data`。
- Chroma 在 Electron 打包中需验证 `chromadb` 原生依赖与路径 → 首版使用嵌入式 `path` 模式，数据目录与 SQLite 同级。
- 双存储一致性：删除/更新记忆须同时操作 SQLite 与 Chroma；Chroma 操作失败时记录错误并允许后续重试，结构化数据以 SQLite 为准。
- 梦境生成可能产生嘈杂摘要 → 元数据保留来源记忆 id、简洁 prompt、允许按日重新生成/删除。
- Embedding 调用可能慢或不可用 → 先写 SQLite，异步 upsert Chroma；失败时关键词/最近检索仍可用。
- 本地日边界可能因时区变化不一致 → 写入时存储 `day_key`，后续更新不重写。

## 初始化计划（Bootstrap）

1. **SQLite**：`ensureSchema` 检测版本；不匹配则 drop 并重建 `memories` 及相关索引（**不含** `memory_embeddings`）。
2. **Chroma**：启动时 `Chroma.fromExistingCollection` 或 `fromDocuments` 初始化；版本不匹配或结构变更时清空 `.nexo-data/chroma/` 并重建 collection。
3. 删除 `memory.json` 遗留读写与 `memory_embeddings` 相关代码。
4. 新记忆写入：先 persist SQLite → 有凭证时 upsert Chroma；更新/删除时双端同步。

## 待决问题（Open Questions）

- 梦境整合应在每次抽取记忆后防抖触发，还是仅在用户打开某天的记忆页时触发？
- 面向用户的 day key 是否始终使用本地系统时区，还是后续暴露可配置的记忆时区？
- Chroma 操作失败是否入队后台重试，还是仅在下一次 recall/写入时懒修复？
