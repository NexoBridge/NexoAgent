## MODIFIED Requirements

### Requirement: 编排器可使用高权限浏览器脚本入口

编排器 SHALL 在请求捕获和重放任务中优先使用 `action="script"` 的短期 `scriptCache` 保存临时抓包样本，并负责在样本完成用途后主动移除；只有稳定、可跨会话复用的脚本、runbook 或回放模板才应升格到 `store_script_memory`。

#### Scenario: 短期抓包样本进入 scriptCache
- **WHEN** 用户要求捕获网页网络请求、监听表单提交、保存一次性请求样本或临时重放请求
- **THEN** 编排器应当让 `action="script"` 使用 `scriptCache` 保存短期样本
- **AND** 编排器不应为了短期抓包样本默认调用 `store_script_memory`

#### Scenario: 用完临时样本后主动清理
- **WHEN** 缓存样本已经完成一次性检查、提取、对比或重放
- **THEN** 编排器应当让脚本调用 `scriptCache.consume`、`scriptCache.delete`、`scriptCache.clear`
- **AND** 在重放时也可以使用 `scriptCache.replay(key, { deleteAfter: true })` 或 `scriptCache.replay(key, { deleteOnSuccess: true })`

#### Scenario: 稳定复用内容升格长期记忆
- **WHEN** 捕获样本已经被整理成稳定的复用脚本、回放模板、操作 runbook 或跨会话工作流
- **THEN** 编排器可以调用 `store_script_memory` 保存该稳定内容
- **AND** 长期记忆内容应当是提炼后的模板或脚本，而不是未清理的短期抓包流水

#### Scenario: 缓存清理结果可用于后续推理
- **WHEN** 脚本响应包含 `script.cache.deletedKeys`、`script.cache.cleared` 或自动缓存摘要
- **THEN** 编排器应当把该摘要作为缓存生命周期状态使用
- **AND** 编排器不应假设已删除的缓存 key 仍可用于后续重放
