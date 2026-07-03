## ADDED Requirements

### Requirement: Bounded script action return payloads
系统 SHALL 对 `browser_action.action="script"` 的返回值执行专门的大输出保护，避免脚本返回的大对象直接进入模型上下文或默认 UI 消息流。

#### Scenario: 脚本返回抓包形态大结果
- **WHEN** `action="script"` 返回请求捕获、网络日志或 replay 样本等抓包形态数据
- **THEN** 运行时 SHALL 优先将结构化样本写入 `scriptCache`
- **AND** 工具返回给模型的内容 SHALL 包含缓存 key、样本数量、URL/method/status 摘要、TTL 和清理建议
- **AND** 工具返回 SHALL NOT 默认内联完整抓包日志

#### Scenario: 脚本返回非抓包大对象
- **WHEN** `action="script"` 返回非抓包形态但超过内联预算的对象
- **THEN** 运行时 SHALL 将原始返回值写入临时 raw tool output artifact
- **AND** 工具返回给模型的内容 SHALL 包含可操作摘要、短 preview、raw 引用和大小统计

#### Scenario: 脚本显式请求内联输出但超过硬限制
- **WHEN** 脚本或工具参数请求返回完整原文
- **AND** 结果超过硬性安全限制
- **THEN** 运行时 SHALL 仍然使用摘要和 raw 引用
- **AND** 返回元数据 SHALL 说明由于大小限制无法内联完整输出
