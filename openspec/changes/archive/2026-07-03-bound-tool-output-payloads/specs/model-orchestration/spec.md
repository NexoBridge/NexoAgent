## ADDED Requirements

### Requirement: Orchestrate from bounded tool output summaries
编排器 SHALL 基于工具输出摘要、缓存 key 和 raw 引用继续工作，而不是依赖完整大输出默认存在于上下文中。

#### Scenario: 工具返回 raw 引用
- **WHEN** 工具结果包含 `rawRef`、artifact 引用或 `scriptCache` key
- **THEN** 编排器 SHALL 使用摘要判断下一步
- **AND** 只有在确实需要完整原文时才显式读取该引用

#### Scenario: 浏览器脚本产生大量抓包数据
- **WHEN** `browser_action.action="script"` 用于网络请求捕获、CDP 日志或页面调试
- **THEN** 编排器 SHALL 指导脚本把短期样本放入 `scriptCache`
- **AND** 编排器 SHALL 避免要求脚本直接返回完整日志数组作为普通工具输出

#### Scenario: 用户要求查看完整原始输出
- **WHEN** 用户明确要求查看、复制或下载完整原始输出
- **THEN** 编排器 SHALL 使用 raw 引用或 UI/API 检索路径提供原始数据
- **AND** 不应把完整原文自动塞回后续模型上下文
