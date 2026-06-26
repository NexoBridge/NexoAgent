## MODIFIED Requirements

### Requirement: 浏览器任务路由
编排器 SHALL 在交互式 Web 浏览和 Web 应用操作任务中使用 `browser_action`，并优先通过 DOM 快照、包含 `all-MiniLM-L6-v2` 语义检索的 DOM resolver 和元素引用执行普通控件操作；截图和视觉模型只应作为视觉任务或 DOM 路径不足后的兜底。

#### Scenario: 交互式网页任务使用 browser_action
- **WHEN** 用户请求浏览网页、检查页面、操作表单或操控 Web 应用时
- **THEN** 编排器应当在需要浏览器交互时使用 `browser_action`

#### Scenario: 普通控件操作优先使用 DOM resolver
- **WHEN** 用户要求点击、输入、选择或提交普通页面控件
- **THEN** 编排器应当优先使用 `snapshot`、`resolve`、ref-based `click` 或 ref-based `type`
- **AND** 不应当直接使用截图、视觉模型、shell 命令、PowerShell 或 OS 级鼠标键盘模拟定位该控件

#### Scenario: 模糊控件意图优先使用语义 resolver
- **WHEN** 用户使用模糊表达描述普通页面控件
- **THEN** 编排器应当优先调用 `browser_action.resolve`
- **AND** resolver 应当通过本地 MiniLM 语义分、DOM 规则分和上下文分融合返回候选
- **AND** 编排器不应当因为表达模糊就直接使用截图或 vision specialist

#### Scenario: 浏览器任务按 action 分发
- **WHEN** 编排器调用 `browser_action`
- **THEN** 它应当通过 `browser_action.action` 选择对应动作
- **AND** 在元素引用过期时先请求新的 `snapshot` 或使用 `resolve`

#### Scenario: 视觉兜底需要 DOM 路径不足
- **WHEN** 编排器准备使用截图或 vision specialist 来定位浏览器 UI 控件
- **THEN** 它应当已经尝试或有明确理由跳过 DOM `snapshot`/`resolve`
- **AND** 视觉调用应当限于图像、canvas、图表、视觉布局、用户显式截图请求或 DOM resolver 低置信度场景

#### Scenario: 截图作为对话结果的一部分
- **WHEN** 浏览器任务需要视觉确认或用户要求查看当前页面时
- **THEN** 编排器应当使用 `browser_action.action="screenshot"`
- **AND** 运行时应当把截图作为 assistant 消息附件返回到对话中
