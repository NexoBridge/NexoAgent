## Context

大工具输出和长对话崩溃是同一类上下文压力问题，但发生得更突然：一次 `browser_action` 脚本如果返回几百 KB 或数 MB JSON，模型下一轮就会看到巨量低密度文本。即使上下文压缩存在，也经常来不及在本轮保护 UI、SSE 和模型消息构造。

截图里这类返回值包含页面 history、多个 URL、title、timestamp、action 等对象。如果脚本继续捕获网络请求或响应 body，输出会更大。对于 AI 来说，绝大多数时候只需要“抓到了什么、缓存 key 是什么、下一步该用哪个引用”，而不是完整 JSON 原文。

## Goals / Non-Goals

**Goals:**

- 保护模型上下文，不让单次 tool result 把 prompt 撑爆。
- 保护前端消息流和工具详情面板，避免大 JSON 直接渲染。
- 保留完整原始数据，支持用户按需查看、下载或后续脚本读取。
- 让 `browser_action.action="script"` 默认更适合抓包/调试场景：大数据进缓存或 artifact，小摘要进模型。
- 为后续网络请求拦截和重放提供稳定的数据边界。

**Non-Goals:**

- 不实现通用数据库式日志查询系统。
- 不保证临时 raw output 跨应用重启长期保留。
- 不把所有大输出自动写入长期 memory。
- 不改变小工具输出的正常展示和上下文行为。

## Decisions

### 1. 工具输出进入模型前统一归一化

在工具执行完成后、结果进入 `lcMessages` 和 message blocks 前，运行时执行 `normalizeToolOutputForModel`：

- 小输出保持原样。
- 中等输出保留可读 preview，并追加截断说明。
- 大输出写入 managed raw-output artifact，只把摘要、引用、大小和读取方式返回给模型。

这样所有工具共享同一保护，而不是只修 `browser_action`。

### 2. 输出分为 model payload 和 raw payload

每次工具调用可以产生两个视图：

- `modelOutput`: 精简文本，进入模型上下文和 compaction。
- `displayOutput`: UI 默认展示，可包含摘要、短 preview 和 rawRef。
- `rawOutput`: 完整原文，存储在本地 artifact/cache，通过引用读取。

`modelOutput` 是唯一默认进入后续模型 prompt 的内容。`rawOutput` 不应被自动注入，除非用户明确要求查看或后续工具显式读取。

### 3. `browser_action.script` 优先把捕获样本放入 `scriptCache`

当脚本返回抓包形态数据时：

- 结构化 request/response 样本写入 `scriptCache`。
- `modelOutput` 返回缓存 key、数量、方法/URL 摘要、TTL 和删除建议。
- 如果脚本返回了非抓包但很大的对象，则写入 raw-output artifact。

这能避免“已经有 cache，但原始返回值仍然巨大”的双重膨胀。

### 4. UI 原始输出懒加载

工具卡片默认只随消息保存摘要和 preview。用户展开“原始输出”时，前端通过 rawRef 请求完整数据。这样聊天列表、历史加载和 SSE 都不会被大对象拖慢。

### 5. 摘要必须可操作

摘要不能只是“输出太大已截断”。它至少应包含：

- 工具名和 action。
- 原始输出大小、条目数、截断原因。
- 对 `browser_action.script`：URL、method、status、cache key、重要错误。
- 对命令输出：退出码、关键错误行、生成文件路径。
- 后续读取原始数据的方法。

## Limits

初始建议阈值：

- `maxInlineToolOutputChars`: 12,000，用于直接进入模型的小输出。
- `maxToolPreviewChars`: 4,000，用于 UI preview。
- `maxRawToolOutputBytes`: 10 MB，超过后只保留头尾片段和统计，避免本地 artifact 也失控。
- `maxScriptReturnInlineChars`: 8,000，脚本返回值更保守，因为脚本常产生抓包和 DOM 大对象。

具体数值应放在后端常量或设置中，后续可配置。

## Risks / Trade-offs

- 模型默认看不到完整原文，可能需要多一次读取引用；这是为了换取稳定性。
- 摘要质量会影响后续推理，需要针对 `browser_action.script` 做结构化摘要，而不是简单截断。
- raw artifact 包含敏感 headers/body 的风险更高，必须设置 TTL、大小上限和清理策略。
- 历史会话中的旧大输出仍可能存在，需要兼容旧消息展示。

## Open Questions

- raw tool output 使用现有 artifact 存储，还是新增专用 `tool-output` 存储目录？
- raw output TTL 默认跟 session 走，还是跟脚本缓存一样有独立过期时间？
- UI 是否需要提供“复制摘要”和“下载原始输出”两个独立按钮？
- 是否允许 Agent 在后续工具调用中通过 rawRef 读取完整输出，还是只允许用户侧查看？
