## ADDED Requirements

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
