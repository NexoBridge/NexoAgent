## ADDED Requirements

### Requirement: 归档上下文按需召回
后续轮次需要用到已被移出上下文窗口的对话时，系统 SHALL 通过记忆召回取回。系统 SHALL NOT 把整段归档转写重新放回实时提示。

#### Scenario: 后续轮次需要归档历史
- **WHEN** 后续用户请求依赖所选上下文窗口到达后已归档的对话
- **THEN** 运行时 SHALL 在持久记忆中搜索该归档内容，并把匹配的召回结果放进提示
- **AND** 运行时 SHALL NOT 把整段归档转写塞回实时窗口

#### Scenario: 不需要归档历史
- **WHEN** 后续轮次与已归档对话不匹配
- **THEN** 运行时 SHALL 不把未匹配的归档放进实时提示

#### Scenario: 召回包含归档上下文
- **WHEN** 运行时执行常规的提示记忆召回
- **THEN** 上下文窗口归档条目 SHALL 与其他持久记忆一起参与这次召回

#### Scenario: 重启或新会话后仍可召回
- **WHEN** 应用重启或用户开启新会话，且之前已把超出窗口的对话归档
- **THEN** 这些归档 SHALL 仍保存在本地持久记忆中
- **AND** 之后依赖这段对话的请求 SHALL 能按查询召回匹配条目
- **AND** 归档 SHALL NOT 只存在于原会话的内存状态里

## MODIFIED Requirements

### Requirement: Durable memory extraction prefers stable facts
系统 SHALL 把持久事实抽取偏向稳定、可复用的信息，并避免把临时调试状态、临时路径或一次性执行细节提升为稳定事实记忆。上下文窗口归档与事实抽取分开，溢出对话（含临时细节）仍 SHALL 存成可召回的上下文记忆。

#### Scenario: Temporary debugging detail appears in thread
- **WHEN** 对话里出现一次性堆栈、临时命令输出或只属于当前任务的死路
- **THEN** 事实抽取 SHALL NOT 把这些细节提升为稳定事实记忆
- **AND** 这些细节落到所选上下文窗口之外时，运行时 SHALL 把它们归档为可召回的上下文记忆，而不是压缩摘要

#### Scenario: User states a lasting preference
- **WHEN** 用户确认了一项稳定偏好或会反复使用的工作流
- **THEN** 系统 MAY 把该信息抽成持久记忆，供之后的会话使用

## REMOVED Requirements

### Requirement: Durable memory is distinct from thread compaction
**Reason**：溢出不再留在会话内的压缩摘要里，而是写入持久记忆，供后续轮次召回。
**Migration**：把被移出的对话存成可召回记忆。不要再另留一份压缩摘要来维持提示连续性。稳定事实抽取仍是单独路径。
