# model-orchestration Specification

## Purpose
TBD - created by archiving change multimodal-model-orchestration. Update Purpose after archive.
## Requirements
### Requirement: Single primary orchestrator profile
The system MUST allow exactly one enabled model profile to be marked as the primary orchestrator, and the runtime MUST use that profile as the default planning model when one is configured. The same profile data model MUST also support optional context-budget metadata used by the runtime to manage prompt assembly and compaction.

#### Scenario: Save a new primary profile
- **WHEN** the user marks a profile as primary and saves it
- **THEN** the system clears the primary flag from any other saved profiles

#### Scenario: Use the primary orchestrator
- **WHEN** a user sends a normal chat request and a primary profile exists
- **THEN** the runtime uses that profile for planning and top-level reasoning

#### Scenario: Fall back without a primary
- **WHEN** no enabled profile is marked as primary
- **THEN** the runtime falls back to the existing default chat model settings

#### Scenario: Save profile context-budget metadata
- **WHEN** a user saves or edits a model profile with context window or compaction budget fields
- **THEN** the system persists those fields with the profile and makes them available to the runtime

#### Scenario: Store lookup provenance
- **WHEN** the system resolves a model context budget from dictionary, provider metadata, or first-use AI lookup
- **THEN** it persists the resolved value with enough provenance to explain where that budget came from

### Requirement: Capability-based specialist resolution
The system MUST resolve specialist work by capability tag rather than by raw model ID, and it MUST skip disabled profiles when selecting a specialist. Specialist and orchestrator profiles MUST expose enough budget metadata for the runtime to compact context against the active model limit.

#### Scenario: Resolve a vision specialist
- **WHEN** the runtime requests a model with the vision capability
- **THEN** the system returns an enabled profile tagged for vision work

#### Scenario: Skip a disabled match
- **WHEN** the only matching specialist profile is disabled
- **THEN** the system does not select that profile and reports that no enabled specialist is available

#### Scenario: Use specialist budget metadata
- **WHEN** the runtime selects a specialist profile for a model call
- **THEN** prompt budgeting and compaction decisions use that selected profile's explicit or inferred context budget

### Requirement: Deterministic routing for multiple matches
When more than one enabled profile satisfies a requested capability, the system MUST choose a single profile using deterministic rules and must not depend on manual model-name entry.

#### Scenario: Multiple specialists satisfy one capability
- **WHEN** two or more enabled profiles are tagged for the same capability
- **THEN** the system chooses one profile consistently using the same priority rules each time

#### Scenario: User switches provider connection
- **WHEN** the user updates provider base URL or API Key for a profile
- **THEN** the routing logic continues to work from capability tags without requiring a new manual model-name lookup

### Requirement: Reduced Orchestrator Tool Surface
The orchestrator SHALL operate with the reduced built-in tool catalog and MUST not rely on removed dedicated utility tools for default runtime planning.

#### Scenario: Orchestrator chooses from reduced toolset
- **WHEN** the runtime prepares the orchestrator prompt and tool bindings
- **THEN** the available tool surface SHALL exclude removed file, HTTP, skills, and scheduled-task tools

#### Scenario: Orchestrator uses shell command for operational work
- **WHEN** the user asks for a filesystem or command-line task that does not require multimodal or memory behavior
- **THEN** the orchestrator SHALL prefer `shell_command` over any removed dedicated utility path

### Requirement: 允许共享浏览器工具
编排器 SHALL 在精简的内置工具目录下运行，并在加载可用工具时包含 `browser_action`；它 MUST NOT 在默认运行时规划中依赖已移除的分散浏览器工具名。

#### Scenario: 工具目录包含共享浏览器能力
- **当** 编排器加载可用工具时
- **则** 它应当包含 `shell_command`、`invoke_model`、`recall_memory`、`write_knowledge` 和 `browser_action`

#### Scenario: 不再依赖移除的分散浏览器工具
- **当** 编排器规划浏览器任务时
- **则** 它不应当依赖已移除的分散浏览器工具名

### Requirement: 浏览器任务路由
编排器 SHALL 在交互式 Web 浏览和 Web 应用操作任务中使用 `browser_action`，通过 `action` 参数分发浏览器操作，并在需要视觉确认时将截图作为 assistant 消息附件返回对话。

#### Scenario: 交互式网页任务使用 browser_action
- **当** 用户请求浏览网页、检查页面、操作表单或操控 Web 应用时
- **则** 编排器应当在需要浏览器交互时使用 `browser_action`

#### Scenario: 浏览器任务按 action 分发
- **当** 编排器调用 `browser_action` 时
- **则** 它应当通过 `browser_action.action` 选择对应动作
- **并且** 在元素引用过期时先请求新的 `snapshot`

#### Scenario: 截图作为对话结果的一部分
- **当** 浏览器任务需要视觉确认或用户要求查看当前页面时
- **则** 编排器应当使用 `browser_action.action="screenshot"`
- **并且** 运行时应当把截图作为 assistant 消息附件返回到对话中

