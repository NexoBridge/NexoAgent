## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: 脚本结果与异常回传

系统 SHALL 在返回脚本执行结果、异常或超时状态时，同时回传本次脚本调用产生的缓存写入和删除摘要。

#### Scenario: 脚本结果包含缓存报告
- **WHEN** 脚本执行期间写入、自动缓存、删除或消费缓存条目
- **THEN** `browser_action` 响应应当在 `script.cache` 中包含对应摘要
- **AND** 该报告不应包含完整大体量缓存内容，除非脚本显式将其作为脚本返回值返回
