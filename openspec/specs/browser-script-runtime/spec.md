# browser-script-runtime Specification

## Purpose
TBD - created by archiving change add-browser-script-runtime. Update Purpose after archive.
## Requirements
### Requirement: 浏览器脚本轻量缓存

系统 SHALL 为 `browser_action.action="script"` 提供专门的短期轻量缓存，使高权限脚本可以直接写入、读取、列出、删除和消费浏览器捕获样本，而不需要把短期数据写入长期脚本记忆。

#### Scenario: 脚本直接读写短期缓存
- **WHEN** Agent 通过 `action="script"` 执行 Electron 侧脚本
- **THEN** 脚本上下文应当包含 `scriptCache`
- **AND** 脚本应当可以调用 `scriptCache.set`、`scriptCache.capture`、`scriptCache.get`、`scriptCache.getEntry` 和 `scriptCache.list`

#### Scenario: 缓存条目带 TTL 自动过期
- **WHEN** 脚本写入缓存并指定 TTL，或使用默认 TTL
- **THEN** 系统应当记录该缓存条目的过期时间
- **AND** 到期后的缓存条目不应继续通过 `get`、`getEntry` 或 `list` 返回

#### Scenario: 缓存写入返回摘要
- **WHEN** 脚本写入、替换或自动缓存一个条目
- **THEN** 系统应当返回包含 key、来源、创建时间、更新时间、过期时间、TTL 和大小的缓存摘要
- **AND** `browser_action` 的脚本响应应当在 `script.cache` 中报告本次调用产生的缓存写入或删除动作

#### Scenario: 缓存与长期脚本记忆隔离
- **WHEN** 脚本产生短期抓包样本、调试样本或一次性重放样本
- **THEN** 系统应当允许这些数据保留在 `scriptCache` 中
- **AND** 系统不应自动将这些短期样本写入 `store_script_memory`

### Requirement: 抓包结果自动落入短期缓存

系统 SHALL 在高权限浏览器脚本返回抓包形态数据时自动写入短期缓存，以减少 Agent 为短期样本额外调用长期记忆工具的需要。

#### Scenario: 自动缓存抓包形态返回值
- **WHEN** `action="script"` 返回值包含请求方法、URL、headers、body、状态码，或包含 `requests`、`captures`、`networkLog`、`entries` 等抓包集合
- **THEN** 系统应当将该返回值或其中的抓包 payload 写入 `scriptCache`
- **AND** 响应应当通过 `script.cache.automatic` 暴露自动缓存摘要

#### Scenario: 显式指定自动缓存 key 和 TTL
- **WHEN** Agent 调用 `action="script"` 并提供 `scriptCacheKey` 或 `scriptCacheTtlMs`
- **THEN** 系统应当使用提供的 key 或 TTL 处理自动缓存
- **AND** 当提供了 `scriptCacheKey` 时，即使返回值未被识别为抓包形态，系统也应当按该 key 缓存脚本返回值

### Requirement: 缓存样本主动移除

系统 SHALL 为脚本缓存提供主动移除机制，使一次性短期样本在完成检查、消费或重放后能够被脚本立即清理。

#### Scenario: 脚本主动删除缓存
- **WHEN** 脚本调用 `scriptCache.delete` 或 `scriptCache.clear`
- **THEN** 系统应当删除对应 key 或匹配前缀的缓存条目
- **AND** 本次脚本响应应当在 `script.cache.deletedKeys` 或 `script.cache.cleared` 中报告清理结果

#### Scenario: 一次性读取后删除
- **WHEN** 脚本调用 `scriptCache.consume` 或 `scriptCache.consumeEntry`
- **THEN** 系统应当返回对应缓存值或缓存条目
- **AND** 系统应当在同一操作中删除该缓存 key

#### Scenario: 销毁浏览器运行时时清理缓存
- **WHEN** 共享浏览器运行时被销毁
- **THEN** 系统应当清空脚本短期缓存并取消后续过期清理计时

### Requirement: 缓存请求重放

系统 SHALL 允许高权限脚本从短期缓存样本中重放网络请求，并在重放完成后按脚本选项清理源缓存。

#### Scenario: 从缓存样本重放请求
- **WHEN** 脚本调用 `scriptCache.replay` 并传入缓存 key 或请求样本对象
- **THEN** 系统应当从样本中提取请求方法、URL、headers 和 body
- **AND** 系统应当发送请求并返回状态码、状态文本、响应头、响应片段和重放请求摘要

#### Scenario: 重放后删除源缓存
- **WHEN** 脚本调用 `scriptCache.replay(key, { deleteAfter: true })`
- **THEN** 系统应当在重放完成后删除源缓存 key
- **AND** 响应应当报告被删除的源缓存 key

#### Scenario: 成功重放后删除源缓存
- **WHEN** 脚本调用 `scriptCache.replay(key, { deleteOnSuccess: true })`
- **THEN** 系统应当仅在重放请求成功时删除源缓存 key
- **AND** 当重放失败时，源缓存应保留以便调试或重试

### Requirement: 高权限 Electron 浏览器脚本执行
系统 SHALL 提供一个高权限浏览器脚本运行时，使 Agent 可以提交并执行 Electron 侧 JavaScript，以直接操控当前共享浏览器会话。

#### Scenario: 执行 Electron 侧服务端脚本
- **WHEN** Agent 使用浏览器脚本入口提交 Electron 侧服务端 JavaScript 源码
- **THEN** 系统应当在 Electron 侧为当前共享浏览器会话执行该脚本
- **AND** 该脚本应当绑定到当前对话使用的共享浏览器会话，而不是新建独立浏览器实例

#### Scenario: 直接访问实时浏览器运行时对象
- **WHEN** 系统执行浏览器脚本
- **THEN** 脚本应当可以直接访问当前会话的实时 `BrowserView`、`webContents`、原始 `debugger/CDP` 连接和相关 Electron/Node 能力
- **AND** Agent 不需要把这些对象先转成固定 action 或受控 primitive 才能使用

#### Scenario: 脚本可直接控制 BrowserView
- **WHEN** Agent 编写的脚本调用 `BrowserView` 方法，或通过注入的原始 `debugger/CDP` 发送浏览器与页面协议命令
- **THEN** 该脚本应当可以直接控制当前共享会话对应的 `BrowserView` 及其承载网页
- **AND** 系统不应强制 Agent 退回到页面内 JS 或固定 browser action wrapper 才能完成控制

#### Scenario: 无浏览器会话时按需创建
- **WHEN** Agent 调用浏览器脚本入口且当前不存在共享浏览器会话
- **THEN** 系统应当先创建共享浏览器会话
- **AND** 随后在该会话上执行脚本

### Requirement: 脚本结果与异常回传
系统 SHALL 把 Electron 侧浏览器脚本的执行结果返回给 Agent，并在失败时返回明确异常信息。

#### Scenario: 返回可序列化结果
- **WHEN** 浏览器脚本返回可序列化结果
- **THEN** 系统应当把该结果返回给 Agent
- **AND** 返回结果应当可用于后续推理或下一次工具调用

#### Scenario: 返回原生对象或不可序列化结果
- **WHEN** 浏览器脚本返回 `BrowserView`、`webContents` 或其他不可直接序列化的原生对象
- **THEN** 系统应当返回该结果的类型信息和可读表示
- **AND** 系统不得因为返回值不可序列化而静默丢失整个执行结果

#### Scenario: 脚本抛出异常
- **WHEN** 浏览器脚本执行期间抛出异常
- **THEN** 系统应当把异常消息和失败状态返回给 Agent
- **AND** Agent 应当能够基于该异常决定是否继续编写下一段脚本

### Requirement: 脚本与既有浏览器能力共用同一会话
系统 SHALL 让高权限浏览器脚本与既有 `browser_action` 固定 action、`run`、DOM resolver 和截图能力共用同一浏览器会话。

#### Scenario: 脚本后的固定 action 看到相同状态
- **WHEN** Agent 先执行高权限浏览器脚本并改变页面状态
- **THEN** 后续 `snapshot`、`resolve`、`click`、`type`、`run` 或 `screenshot` 应当看到同一会话中的更新后状态

#### Scenario: 固定 action 后的脚本看到相同状态
- **WHEN** Agent 先通过固定 action、`run` 或 DOM resolver 操作共享浏览器
- **THEN** 后续高权限浏览器脚本应当可以读取并继续操控同一会话状态

### Requirement: 脚本执行控制
系统 SHALL 为高权限浏览器脚本定义最基本的执行控制契约，以避免脚本永久阻塞浏览器运行时。

#### Scenario: 脚本超时
- **WHEN** Agent 为浏览器脚本指定超时时间或系统使用默认超时
- **THEN** 系统应当在超时后终止本次脚本执行并返回超时错误

#### Scenario: 脚本参与浏览器动作队列
- **WHEN** 高权限浏览器脚本与其他浏览器动作在同一会话中连续调用
- **THEN** 系统应当保持与既有浏览器动作一致的队列语义
- **AND** 系统不得因为并发脚本执行破坏共享浏览器会话的一致性

### Requirement: Bounded script action return payloads
The system SHALL NOT apply application-level character truncation to `browser_action.action="script"` results, script cache values, inspect fallbacks, or replay response bodies. Script authors MAY intentionally return summaries or cache keys, but the runtime SHALL preserve the value it receives unless serialization itself fails.

#### Scenario: Script returns a serializable large value
- **WHEN** `browser_action.action="script"` returns a large JSON-serializable value
- **THEN** the browser runtime SHALL return the complete serialized value in the script result
- **AND** it SHALL NOT replace that value with a fixed-length text preview

#### Scenario: Script returns an unserializable value
- **WHEN** a script result cannot be JSON-serialized
- **THEN** the browser runtime SHALL return an inspect-format representation
- **AND** the inspect fallback SHALL use unlimited string and array lengths at the application level

#### Scenario: Script cache stores a large value
- **WHEN** script cache stores a JSON-serializable large value
- **THEN** the cache entry SHALL preserve the complete JSON value
- **AND** the cache summary SHALL NOT mark the entry as truncated due to a fixed character cap

#### Scenario: Cached request replay returns a large response body
- **WHEN** `scriptCache.replay` receives a large response body
- **THEN** the replay result SHALL include the complete response body returned by `response.text()`
- **AND** the result SHALL NOT include a `bodyTruncated` flag produced by application-level truncation

### Requirement: Script response returns only script-owned output
The system SHALL return only `ok` plus the script execution payload for `browser_action.action="script"` so script results are not buried under repeated page snapshots.

#### Scenario: Script response omits repeated page snapshot
- **WHEN** Agent calls `browser_action` with `action="script"`
- **THEN** the tool output SHALL include `ok` and the script result, script cache report, script error, or timeout metadata when present
- **AND** the response SHALL NOT inline the full page `elements`, readable page `text`, browser `history`, or resolver state
- **AND** the response SHALL NOT inline URL/title/loading/navigation metadata unless the script itself returns those values
- **AND** the response SHALL NOT require or expose any parameter that makes the script action return full page state

#### Scenario: Full page state requires snapshot
- **WHEN** Agent needs DOM elements, readable page text, browser history, or resolver state after a script call
- **THEN** the Agent SHALL fetch that state through a separate `browser_action.action="snapshot"` call

#### Scenario: Internal state remains fresh after script response
- **WHEN** a script changes the current page or DOM state
- **THEN** the browser runtime SHALL refresh its internal post-script snapshot before returning
- **AND** subsequent `snapshot`, `resolve`, `click`, `type`, or screenshot actions SHALL operate on the same updated browser session

### Requirement: Script output overflow is handled by the agent context budget
The browser runtime SHALL return complete script-owned output, and the agent runtime SHALL decide whether the next model call can include that output.

#### Scenario: Complete script output fits the next model call
- **WHEN** a script result is complete and the next prompt remains within the active model input budget
- **THEN** the agent SHALL include the complete script result in the next model call

#### Scenario: Complete script output exceeds the next model call
- **WHEN** a complete script result would cause the next prompt to exceed the active model input budget
- **THEN** the agent SHALL stop with `stopReason="context_overflow"`
- **AND** it SHALL report the budget details rather than asking the browser runtime to truncate the script result

