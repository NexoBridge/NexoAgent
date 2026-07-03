## Context

高权限浏览器脚本入口让 Agent 可以直接在 Electron 侧操作共享浏览器会话。请求捕获和重放是该入口的重要使用场景：Agent 可以监听用户提交采购工单、表单或业务请求，然后把请求方法、URL、headers、body、状态码和响应片段整理成结构化日志。

这类日志多数只服务当前对话或当前调试流程，生命周期很短。它们和长期脚本记忆的目标不同：长期记忆应保存稳定、可复用、跨会话有价值的脚本、模板或 runbook；短期抓包样本应可快速写入、读取、重放并清理。

## Goals / Non-Goals

**Goals:**
- 为 `action="script"` 提供专门的轻量缓存，不依赖长期记忆工具。
- 让脚本在同一次浏览器运行时上下文中直接读写、列出、删除、消费短期样本。
- 支持 TTL 自动过期和容量保护，避免缓存长期滞留。
- 让抓包形态的脚本返回值自动落缓存，减少 Agent 额外工具调用。
- 为请求重放提供缓存读取和重放 helper，并支持重放后主动删除。
- 在编排提示中要求 Agent 判断样本何时用完，并主动清理。

**Non-Goals:**
- 不把短期抓包样本持久化到 SQLite 或长期记忆。
- 不替代 `store_script_memory`；稳定复用脚本和模板仍应使用长期脚本记忆。
- 不实现完整 HTTP 代理或持久抓包数据库。
- 不保证缓存跨应用重启保留。

## Decisions

### 1. 缓存挂在 BrowserManager 运行时内存中

脚本缓存作为 `BrowserManager` 的内存状态存在，跟随浏览器运行时生命周期清理。这样它适合短期抓包和调试样本，不会自动进入长期记忆或跨会话召回。

### 2. 脚本上下文注入 `scriptCache`

`action="script"` 的 AsyncFunction 上下文除 `browserView`、`webContents`、CDP 和 Node/Electron 能力外，新增 `scriptCache`。脚本可以直接调用：

- `set` / `capture`: 写入样本
- `get` / `getEntry` / `list`: 读取样本和摘要
- `delete` / `clear`: 主动清理
- `consume` / `consumeEntry`: 一次性读取后删除
- `replay`: 从缓存样本构造请求并发送

### 3. 自动缓存抓包形态返回值

当脚本返回值包含请求捕获形态，例如 `method + url`、`requests`、`captures`、`networkLog`、`entries` 等结构，运行时自动写入 `scriptCache`。工具调用方可以用 `scriptCacheKey` 固定 key，也可以用 `scriptCacheTtlMs` 指定 TTL。

### 4. TTL、容量和大小保护

缓存默认 TTL 为 30 分钟，最大 TTL 限制为 24 小时，容量限制为 100 条。写入时会序列化缓存值，超出大小限制的值降级为可读摘要，避免短期缓存膨胀。

### 5. 主动移除是一等行为

TTL 只是兜底。Agent 在完成一次性检查或重放后，应调用 `consume`、`delete`、`clear`，或者在 `replay` 时使用 `deleteAfter` / `deleteOnSuccess`。删除结果通过 `script.cache.deletedKeys` 回传，便于 Agent 确认清理动作。

### 6. 重放 helper 只服务缓存样本

`scriptCache.replay` 从缓存或传入对象中提取请求方法、URL、headers 和 body，使用运行时 `fetch` 发送请求，并返回状态、响应头、响应片段和重放请求摘要。它是高权限脚本的一部分，不把 `browser_action` 变成通用 HTTP 工具。

## Risks / Trade-offs

- 短期缓存仍可能包含敏感 headers 或 body，因此必须通过 TTL 和主动删除降低滞留风险。
- 自动识别抓包形态结果采用保守启发式，不能覆盖所有自定义日志结构；脚本仍可显式调用 `scriptCache.capture`。
- `replay` 使用运行时 `fetch`，不会自动复刻浏览器页面所有上下文细节；需要脚本显式提供 headers/body 或从缓存样本中保留它们。
- 内存缓存不会跨应用重启保留，这是短期缓存的预期边界。

## Migration Plan

1. 在脚本请求/响应共享类型中增加缓存 key、TTL 和缓存报告字段。
2. 在 `BrowserManager` 中实现内存缓存、TTL 过期、容量限制、自动捕获和 replay/consume API。
3. 在脚本执行上下文注入 `scriptCache`。
4. 更新工具 schema 和编排提示，明确短期缓存、主动删除和长期记忆升格边界。
5. 增加验证脚本覆盖读写、删除、TTL、自动缓存、一次性消费和重放后删除。

## Open Questions

- 是否需要后续在 UI 或调试面板中展示当前短期缓存摘要。
- 是否需要按会话、页面 host 或 conversation id 进一步隔离缓存 key 空间。
- 是否需要为敏感 headers 提供默认脱敏策略。
