## ADDED Requirements

### Requirement: 可选上下文窗口
系统 SHALL 只允许把当前上下文窗口设为 256000 或 500000 tokens，并 SHALL 用这个窗口作为实时提示上限。

#### Scenario: 选择 256K 窗口
- **WHEN** 用户把上下文窗口设为 256000 tokens
- **THEN** 运行时 SHALL 按 256000 token 窗口组装之后的提示

#### Scenario: 选择 500K 窗口
- **WHEN** 用户把上下文窗口设为 500000 tokens
- **THEN** 运行时 SHALL 按 500000 token 窗口组装之后的提示

#### Scenario: 拒绝其他窗口大小
- **WHEN** 已保存或提交的上下文窗口不是 256000 或 500000 tokens
- **THEN** 系统 SHALL NOT 把该值用作实时提示窗口
- **AND** 系统 SHALL 保留或回退到这两个允许值之一

### Requirement: 溢出内容归档为记忆
系统 SHALL NOT 为了塞进上下文窗口而压缩或摘要对话历史。估算提示用量到达所选窗口时，系统 SHALL 把放不进窗口的更早对话写成持久记忆，从实时提示中移除，并用仍然放得下的内容继续模型请求。

#### Scenario: 用量到达所选窗口
- **WHEN** 估算提示用量到达所选的 256000 或 500000 token 窗口，且移走更早对话后可以放下
- **THEN** 运行时 SHALL 在下一次模型请求前把这段更早历史存为持久记忆
- **AND** 实时提示 SHALL 不再包含已归档历史
- **AND** 运行时 SHALL NOT 生成或注入压缩摘要

#### Scenario: 会话继续变长
- **WHEN** 一次归档之后，会话再次超过所选窗口
- **THEN** 运行时 SHALL 把新溢出的更早历史归档进记忆
- **AND** 运行时 SHALL NOT 再执行压缩

#### Scenario: 仅最新用户消息就超过窗口
- **WHEN** 更早历史已经归档后，最新用户消息加上它周围必须保留的提示仍然超过所选窗口
- **THEN** 运行时 SHALL 以 `stopReason="context_overflow"` 停止
- **AND** 运行时 SHALL NOT 压缩、截断或只发送这条最新用户消息的一部分

#### Scenario: 已有压缩摘要
- **WHEN** 会话里已经有滚动压缩摘要
- **THEN** 运行时 SHALL 把该摘要存入持久记忆一次
- **AND** 之后的实时提示 SHALL NOT 再包含该摘要

#### Scenario: 重启后记忆仍在
- **WHEN** 更早历史已经归档且应用重启
- **THEN** 这段历史 SHALL 仍作为本地持久记忆存在
- **AND** 之后的会话 SHALL 能按查询召回它

## MODIFIED Requirements

### Requirement: Shared budget across auxiliary context
系统 SHALL 在所选上下文窗口用尽之前，于组装后的运行时上下文中保留完整的当前会话消息、文本附件和工具输出。超出窗口的是更早历史时，系统 SHALL 把这段更早历史归档到记忆。系统 SHALL NOT 悄悄裁掉仍然放得下的最新用户消息、附件文本或工具输出，也 SHALL NOT 用摘要来硬凑进窗口。

#### Scenario: Auxiliary context fits the active model budget
- **WHEN** 当前会话转写、召回记忆、知识笔记、文本附件和工具输出都放得进所选上下文窗口
- **THEN** 运行时 SHALL 原样纳入这些部分，不做应用层字符截断

#### Scenario: Older history exceeds the selected window
- **WHEN** 更早对话历史加上提示其余部分达到所选上下文窗口
- **THEN** 运行时 SHALL 把更早历史归档进记忆，并用仍然放得下的内容组装下一次模型请求
- **AND** 运行时 SHALL NOT 生成压缩摘要
- **AND** 运行时 SHALL NOT 为了放下请求而丢掉最新用户消息

#### Scenario: Remaining prompt still exceeds the window
- **WHEN** 更早历史归档后，必须留在实时提示里的内容仍然超过所选上下文窗口
- **THEN** 运行时 SHALL 在发送模型请求前停止
- **AND** 运行时 SHALL 返回 `stopReason="context_overflow"`，并带上估算提示 token 和所选窗口
- **AND** 运行时 SHALL NOT 悄悄丢掉最新用户消息、附件文本或当前工具输出

### Requirement: Current-session recall query fidelity
系统 SHALL 用会话里当前可用的完整转写来构造召回或搜索查询，而不是只取最新的一段字符窗口。

#### Scenario: Current session contains long user messages
- **WHEN** 运行时为记忆或知识召回准备当前会话上下文
- **THEN** 它 SHALL 纳入会话中可用的完整格式化对话转写
- **AND** 单条消息正文 SHALL NOT 被固定字符上限缩短

#### Scenario: Large current-session transcript exceeds the selected window
- **WHEN** 完整的当前会话转写超过所选上下文窗口
- **THEN** 运行时 SHALL 把更早部分归档到记忆，且 MUST NOT 仅因这段更早内容存在就失败
- **AND** 只有必须留在实时提示里的内容仍然超过所选窗口时，才 SHALL 以 `context_overflow` 失败

## REMOVED Requirements

### Requirement: Automatic compaction near the context limit
**Reason**：溢出改为在所选 256K 或 500K 窗口归档到记忆，不再做摘要。
**Migration**：估算用量到达所选窗口时，把更早历史存为持久记忆，并从实时提示中去掉。不要调用压缩摘要器。

### Requirement: Rolling session summary for thread-local continuity
**Reason**：滚动摘要是被压缩过的历史替身，现在要改成从记忆召回。
**Migration**：停止把 `threadSummary` 注入实时提示。已有摘要存入记忆一次，然后从会话提示路径清除。

### Requirement: Tool-grounded compaction summaries
**Reason**：运行时不再写压缩摘要，这些摘要的工具事实约束不再适用。
**Migration**：归档时按原文保留工具结果。后续轮次通过记忆召回取回。
