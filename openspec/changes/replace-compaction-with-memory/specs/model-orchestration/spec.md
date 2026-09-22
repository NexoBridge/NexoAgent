## MODIFIED Requirements

### Requirement: Single primary orchestrator profile
系统 MUST 只允许一个已启用的模型档案被标成主编排器。配置了主编排器时，运行时 MUST 用它作为默认规划模型。同一档案数据模型还 MUST 支持 256000 或 500000 tokens 的上下文窗口，供运行时决定何时把溢出对话归档到记忆。

#### Scenario: Save a new primary profile
- **WHEN** 用户把一个档案标成主档案并保存
- **THEN** 系统清除其他已保存档案上的主档案标记

#### Scenario: Use the primary orchestrator
- **WHEN** 用户发送普通聊天请求，且存在主档案
- **THEN** 运行时用该档案做规划和顶层推理

#### Scenario: Fall back without a primary
- **WHEN** 没有已启用档案被标成主档案
- **THEN** 运行时回退到现有的默认聊天模型设置

#### Scenario: Save profile context-budget metadata
- **WHEN** 用户保存或编辑模型档案的上下文窗口
- **THEN** 系统只把 256000 或 500000 tokens 持久化为当前窗口
- **AND** 压缩阈值和压缩目标字段 SHALL NOT 改变实时提示的组装方式

#### Scenario: Store lookup provenance
- **WHEN** 系统从字典、供应商元数据或首次使用时的 AI 查询解析出模型上下文预算
- **THEN** 系统 MAY 连同来源一起持久化该解析值
- **AND** 实时提示窗口 SHALL 保持用户选择的 256000 或 500000 token 窗口

### Requirement: Capability-based specialist resolution
系统 MUST 按能力标签解析专家工作，而不是按原始模型 ID，并且 MUST 跳过已禁用的档案。专家和编排器调用 MUST 按所选的 256000 或 500000 token 上下文窗口归档对话溢出，而不是压缩。

#### Scenario: Resolve a vision specialist
- **WHEN** 运行时请求带视觉能力的模型
- **THEN** 系统返回一个已启用、并标了视觉工作的档案

#### Scenario: Skip a disabled match
- **WHEN** 唯一匹配的专家档案处于禁用状态
- **THEN** 系统不选择该档案，并报告没有可用的已启用专家

#### Scenario: Use specialist budget metadata
- **WHEN** 运行时为一次模型调用选中专家档案
- **THEN** 提示组装使用所选的 256000 或 500000 token 上下文窗口
- **AND** 溢出归档到记忆，而不是被压缩

### Requirement: Preserve user-provided long-form text as authoritative context
服务器接受并纳入提示的当前会话长文本，编排器 SHALL 将其视为权威内容。

#### Scenario: User sends a large plain-text document
- **WHEN** 服务器接受并保存一条很长的纯文本用户消息
- **THEN** 编排器 SHALL 把这条完整消息当作当前会话上下文
- **AND** 编排器 SHALL NOT 假设应用只保留了最近的一段摘录

#### Scenario: Long-form text cannot fit the selected window
- **WHEN** 已接受的长文本加上它周围必须保留的提示，放不进所选的 256000 或 500000 token 窗口
- **THEN** 运行时 SHALL 返回 `context_overflow`
- **AND** 面向用户的响应 SHALL 说明当前内容超过所选上下文窗口
- **AND** 运行时 SHALL NOT 要求用户压缩文本或改成摘要
