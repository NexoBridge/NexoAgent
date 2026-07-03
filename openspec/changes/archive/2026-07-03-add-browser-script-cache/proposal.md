## Why

`browser_action.action="script"` 已经可以让 Agent 直接编写 Electron 侧脚本并访问 `browserView`、`webContents` 和 CDP。后续的请求捕获/重放场景会产生大量短期样本，例如表单提交请求、请求头、请求体、状态码和响应片段。

这些短期抓包样本不适合直接写入 `store_script_memory`。`store_script_memory` 是长期脚本记忆，适合保存稳定 workflow、复用脚本和回放模板；临时抓包数据如果进入长期记忆，会污染召回结果，也需要 Agent 额外调用记忆工具才能写入。

因此需要为浏览器脚本运行时补一个轻量缓存层：脚本可以直接读写和删除短期捕获结果，运行时可以自动缓存抓包形态的脚本返回值，并通过 TTL 与主动删除机制清理样本。Agent 还需要明确知道何时使用短期缓存、何时消费后删除、何时才升格到 `store_script_memory`。

## What Changes

- 为 `browser_action.action="script"` 注入 `scriptCache`，让脚本可以直接 `set/get/getEntry/list/delete/clear/capture/consume/consumeEntry/replay`。
- 为脚本缓存添加 TTL 自动过期机制、容量上限和序列化大小保护。
- 当脚本返回抓包形态结果时，运行时自动将捕获样本落入短期缓存，并在 `script.cache` 中返回缓存摘要。
- 增加 `scriptCacheKey` 与 `scriptCacheTtlMs` 参数，用于显式指定自动缓存 key 和 TTL。
- 为一次性样本提供主动移除路径：`consume/consumeEntry` 读后删除，`replay(..., { deleteAfter: true })` 或 `replay(..., { deleteOnSuccess: true })` 重放后删除。
- 更新编排提示和工具 schema：短期抓包数据使用 `scriptCache`，稳定长期复用脚本或模板才写入 `store_script_memory`。

## Capabilities

### Modified Capabilities

- `browser-script-runtime`: 扩展高权限脚本运行时，增加轻量脚本缓存、TTL 自动过期、自动捕获落缓存、缓存请求重放和主动删除机制。
- `model-orchestration`: 扩展编排策略，要求 Agent 在抓包/重放场景优先使用短期缓存，并在样本完成用途后主动消费或删除；只有稳定复用内容才升格为长期脚本记忆。

## Impact

- `electron/server/browser-manager.ts`: 新增脚本缓存、TTL/容量清理、自动捕获、消费删除和缓存重放逻辑。
- `src/shared/types.ts`: 新增脚本缓存摘要、缓存报告和脚本缓存请求参数类型。
- `electron/server/tools/executors.ts`: 转发 `scriptCacheKey`、`scriptCacheTtlMs` 及兼容别名。
- `electron/server/agent.ts`、`nexo/tools.json`: 更新 Agent 和工具描述，明确短期缓存与长期记忆边界，以及主动清理要求。
- `scripts/verify-browser-action-run.mjs`: 增加缓存读写删除、TTL 过期、自动缓存、消费删除和重放后删除验证。
